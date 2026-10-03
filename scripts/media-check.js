#!/usr/bin/env node
/* Проверка бакета перед переключением карты роликов (09.09.2026).
   Ролик, которого нет в R2, в приложении просто не показывается — onerror
   прячет его молча. Значит переключить карту и «проверить глазами» нельзя:
   один пропущенный файл выглядит как карточка без видео, и заметит это
   человек в зале, а не я. Спрашиваем бакет напрямую.

     node scripts/media-check.js                 # все слаги из index.html
     node scripts/media-check.js slug1 slug2     # только названные

   Читает только публичный /media (тот же путь, что у людей), ключей не
   требует. Выход 1, если хоть один файл не отдаётся. */
const fs = require('fs'), path = require('path');
/* В контейнере с исходящим прокси node-овский fetch ходит мимо него и
   получает 403 там, где браузер и curl видят файл. Включаем чтение
   HTTPS_PROXY из окружения сами: на машине владельца прокси нет и строка
   ничего не меняет, в контейнере — чинит ложную тревогу на 156 файлов. */
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  process.env.NODE_USE_ENV_PROXY = '1';
  const r = require('child_process').spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
  process.exit(r.status == null ? 1 : r.status);
}
const BASE = process.env.BV_MEDIA || 'https://bezvodyfit.ru/media/';
const ROOT = path.resolve(__dirname, '..');

function slugsFromApp() {
  const s = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const grab = n => {
    const i = s.indexOf('\nconst ' + n + '=');
    const j = s.indexOf('\n};', i), k = s.indexOf('\n];', i);
    const e = (j < 0 ? k : (k < 0 ? j : Math.min(j, k)));   // EX — массив, MKV и MKNEAR — объекты
    return s.slice(i + 1, e + 3);
  };
  const c = {};
  for (const n of ['EX', 'MKV', 'MKNEAR']) new Function(grab(n).replace('const ' + n + '=', 'this.' + n + '=')).call(c);
  const out = new Set();
  for (const e of c.EX) { const sl = e.mk || c.MKV[e.n] || c.MKNEAR[e.n]; if (sl) out.add(sl); }
  return [...out];
}

/* Спрашиваем первый байт обычным GET, а не HEAD: прокси /media отвечает на
   HEAD 403 даже для файлов, которые прекрасно отдаются людям. Правило,
   которое ругается на живой бакет, — хуже отсутствующего. */
async function head(url) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    const cr = r.headers.get('content-range') || '';
    const size = +(cr.split('/')[1] || r.headers.get('content-length') || 0);
    return { ok: r.status === 200 || r.status === 206, code: r.status, size };
  } catch (e) { return { ok: false, code: 0, size: 0, err: e.message }; }
}

(async () => {
  const args = process.argv.slice(2).filter(x => !x.startsWith('-'));
  const slugs = args.length ? args : slugsFromApp();
  console.log('Проверяю ' + slugs.length + ' роликов в ' + BASE);
  const bad = [];
  for (let i = 0; i < slugs.length; i += 8) {
    const part = slugs.slice(i, i + 8);
    const res = await Promise.all(part.flatMap(sl => [
      head(BASE + sl + '.mp4').then(r => ({ sl, kind: 'mp4', ...r })),
      head(BASE + sl + '.webp').then(r => ({ sl, kind: 'постер', ...r })),
    ]));
    for (const r of res) if (!r.ok || !r.size) bad.push(r.sl + ' · ' + r.kind + ' · ' + (r.code || r.err));
    process.stdout.write('.');
  }
  console.log('');
  if (bad.length) {
    console.log('✗ не отдаются: ' + bad.length + ' из ' + slugs.length * 2);
    bad.slice(0, 30).forEach(x => console.log('  - ' + x));
    if (bad.length > 30) console.log('  … ещё ' + (bad.length - 30));
    process.exit(1);
  }
  console.log('✓ все ' + slugs.length + ' роликов и постеров на месте');
})();

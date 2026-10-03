/* Отправка напоминаний. Вызывается по расписанию (pg_cron → pg_net), раз в час.
   Защищено общим секретом PUSH_CRON_SECRET — снаружи ручку не дёрнуть.

   Зависимостей нет: шифрование Web Push (RFC 8291, aes128gcm) и подпись VAPID
   (RFC 8292, ES256) собраны на встроенном node:crypto. Библиотека web-push
   делает ровно это же, но тянуть пакет ради 120 строк в проект без единой
   рантайм-зависимости незачем.

   Переменные окружения (Vercel → Settings → Environment Variables):
     VAPID_PUBLIC          публичный ключ (base64url, 65 байт несжатой точки)
     VAPID_PRIVATE         приватный ключ (base64url, 32 байта) — СЕКРЕТ
     VAPID_SUBJECT         mailto:… или https://… контакт владельца
     SUPABASE_SERVICE_ROLE ключ service_role — СЕКРЕТ, только здесь
     PUSH_CRON_SECRET      общий секрет для вызова этой ручки — СЕКРЕТ

   Сгенерировать пару ключей (локально, ничего не устанавливая):
     node -e "const c=require('crypto');const{publicKey,privateKey}=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});console.log('VAPID_PUBLIC =',publicKey.export({type:'spki',format:'der'}).subarray(-65).toString('base64url'));console.log('VAPID_PRIVATE=',privateKey.export({format:'jwk'}).d)" */

import crypto from 'node:crypto';

const SB_URL = 'https://SUPABASE_PROJECT_REF.supabase.co';
const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

/* ── VAPID: JWT, подписанный ES256 ── */
function vapidHeader(endpoint, pub, priv, subject) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({
    aud, sub: subject, exp: Math.floor(Date.now() / 1000) + 12 * 3600,
  }));
  const pubRaw = fromB64u(pub);                       // 0x04 || x(32) || y(32)
  const key = crypto.createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC', crv: 'P-256',
      x: b64u(pubRaw.subarray(1, 33)),
      y: b64u(pubRaw.subarray(33, 65)),
      d: priv,
    },
  });
  // ieee-p1363 сразу даёт сырые r||s — как требует JWS, без разбора DER
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`;
}

/* ── Шифрование тела: aes128gcm (RFC 8291) ── */
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const hkdf = (salt, ikm, info, len) =>
  hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);

function encryptPayload(text, p256dh, authSecret) {
  const uaPub = fromB64u(p256dh);
  const auth = fromB64u(authSecret);

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();                  // 65 байт
  const shared = ecdh.computeSecret(uaPub);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]);
  const ikm = hkdf(auth, shared, keyInfo, 32);

  const salt = crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  // 0x02 — разделитель конца записи (padding delimiter), запись у нас одна
  const plain = Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([2])]);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, ct]);
}

async function sendOne(sub, payload, env) {
  const body = encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
      ttl: '86400',
      authorization: vapidHeader(sub.endpoint, env.pub, env.priv, env.subject),
    },
    body,
  });
}

/* ── Тексты по типам. Собираются только из настроек подписки, ничего личного.
   Правила: глагол и польза, ноль мотивационного мусора. Один пуш склеивает
   типы, совпавшие в один час (редкость). ── */
const KIND_TEXT = {
  workout: 'Сегодня по плану тренировка — программа ждёт в «Зале».',
  weigh:   'Встал — на весы. 10 секунд: натощак, после туалета.',
  water:   'Как с водой? Если меньше половины нормы — догоняй сейчас.',
  food:    'Закрой день по еде: 30 секунд — и расход считается честно.',
  sleep:   'Скоро отбой. Рост мышц происходит во сне.',
  week:    'Неделя закрыта: тренд, тренировки, сон — «Разбор недели» уже собран.',
};
function compose(sub) {
  const lines = (sub.kinds_now || []).map((k) => KIND_TEXT[k]).filter(Boolean);
  if (!lines.length) return null;
  /* Итог недели ведёт прямо в лист «Разбор недели» (Коуч), а не на главную:
     пуш, который зовёт «посмотри разбор» и открывает еду, — это обещание
     без исполнения (10.09). Остальные виды — на главную, как и были. */
  const url = (sub.kinds_now || []).includes('week') ? './?go=week' : './';
  return { title: 'Без воды', body: lines.join(' '), tag: 'bv-daily', url };
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const secret = process.env.PUSH_CRON_SECRET || '';
  const got = String(req.headers['x-push-secret'] || '');
  const ok = secret && got.length === secret.length &&
    crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret));
  if (!ok) { res.status(401).json({ error: 'nope' }); return; }

  const env = {
    pub: process.env.VAPID_PUBLIC,
    priv: process.env.VAPID_PRIVATE,
    subject: process.env.VAPID_SUBJECT || 'mailto:noreply@example.com',
  };
  const srv = process.env.SUPABASE_SERVICE_ROLE;
  if (!env.pub || !env.priv || !srv) {
    res.status(503).json({ error: 'push not configured' }); return;
  }
  const sbHead = { apikey: srv, authorization: 'Bearer ' + srv, 'content-type': 'application/json' };

  let due = [];
  try {
    const r = await fetch(SB_URL + '/rest/v1/rpc/push_due', { method: 'POST', headers: sbHead, body: '{}' });
    if (!r.ok) { res.status(502).json({ error: 'due failed: ' + r.status }); return; }
    due = await r.json();
  } catch (e) { res.status(502).json({ error: 'due failed' }); return; }

  let sent = 0, gone = 0, failed = 0;
  for (const sub of due) {
    const payload = compose(sub);
    if (!payload) continue;
    let status = 0;
    try { status = (await sendOne(sub, payload, env)).status; }
    catch (e) { status = 0; }

    if (status === 404 || status === 410) {
      // подписка мертва: человек снёс приложение или отозвал разрешение
      await fetch(SB_URL + '/rest/v1/push_subs?id=eq.' + sub.id, { method: 'DELETE', headers: sbHead }).catch(() => {});
      gone++;
    } else if (status >= 200 && status < 300) {
      // отметка по ТИПАМ (jsonb-слияние на сервере) — каждый тип раз в день
      await fetch(SB_URL + '/rest/v1/rpc/push_mark', {
        method: 'POST', headers: sbHead,
        body: JSON.stringify({ p_id: sub.id, p_kinds: sub.kinds_now || [], p_day: sub.local_day }),
      }).catch(() => {});
      sent++;
    } else {
      // временная ошибка: считаем неудачи, после пяти перестаём ломиться
      await fetch(SB_URL + '/rest/v1/rpc/push_fail', {
        method: 'POST', headers: sbHead, body: JSON.stringify({ p_id: sub.id }),
      }).catch(() => {});
      failed++;
    }
  }
  res.status(200).json({ due: due.length, sent, gone, failed });
}

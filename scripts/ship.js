#!/usr/bin/env node
/*
 * Отправка изменений одной командой.
 *   npm run ship -- "сообщение коммита"
 *   npm run ship                          (сообщение подставится автоматически)
 *
 * Порядок: тест-гейт → git add (уважает .gitignore, поэтому _src.json/.env НЕ попадут)
 *          → commit (тут же отработает pre-commit: detect-secrets + gitleaks + smoke)
 *          → push.
 * Любой сбой на любом шаге останавливает пуш.
 */
const { execSync } = require('child_process');
const run = (c) => execSync(c, { stdio: 'inherit' });

const msg =
  process.argv.slice(2).join(' ').trim() ||
  'update ' + new Date().toISOString().slice(0, 16).replace('T', ' ');

try {
  console.log('▶ Тест-гейт (node tests/smoke.js)…');
  run('node tests/smoke.js');
} catch {
  console.error('✗ Гейт не прошёл — коммит и пуш отменены.');
  process.exit(1);
}

const dirty = execSync('git status --porcelain').toString().trim();
if (!dirty) {
  console.log('✓ Нечего коммитить — дерево чистое.');
  process.exit(0);
}

// Страховка от утечки личных данных / секретов, даже если .gitignore подведёт.
const SENSITIVE = /(^|\/)(_src\.json|tracker-.*\.json|.*\.json\.bak|\.env(\..+)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|credentials.*\.json|service-account.*\.json|secrets.*\.json|token\.json|id_rsa|id_ed25519)$/;
const risky = dirty
  .split('\n')
  .map((l) => l.slice(3).trim().replace(/^"|"$/g, '').split(' -> ').pop())
  .filter((p) => p && p !== '.env.example' && SENSITIVE.test(p));
if (risky.length) {
  console.error('✗ СТОП: среди изменений — чувствительные файлы, пуш отменён:');
  risky.forEach((p) => console.error('   ' + p));
  console.error('Добавь их в .gitignore и убери из индекса: git rm --cached <файл>');
  process.exit(1);
}

try {
  run('git add -A');
  run('git commit -m "' + msg.replace(/"/g, '\\"') + '"');
  run('git push');
  console.log('\n✓ Запушено: ' + msg);
} catch {
  console.error('\n✗ Коммит или пуш не прошёл — смотри вывод выше (часто это pre-commit поймал секрет или упавший тест).');
  process.exit(1);
}

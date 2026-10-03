#!/usr/bin/env node
/*
 * Открыл проект — запусти:  node scripts/sync.js
 * Подтягивает свежее из git и показывает напоминалки из HANDOFF.md.
 */
const { execSync } = require('child_process');
const fs = require('fs');

try {
  console.log('▶ git pull…');
  execSync('git pull', { stdio: 'inherit' });
} catch {
  console.error('⚠ git pull не прошёл — разберись с этим до работы (см. вывод выше).');
}

if (fs.existsSync('HANDOFF.md')) {
  const lines = fs.readFileSync('HANDOFF.md', 'utf8').split('\n');
  const cut = lines.slice(0, 40).join('\n');
  console.log('\n' + '─'.repeat(56));
  console.log(cut);
  console.log('─'.repeat(56));
  console.log('(полностью — в HANDOFF.md)');
} else {
  console.log('\n(HANDOFF.md не найден — напоминалок нет)');
}

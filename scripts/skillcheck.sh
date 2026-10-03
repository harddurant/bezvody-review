#!/usr/bin/env bash
# Ворота для скиллов агента (решение владельца 09.09.2026): каждый скилл
# проходит через Skillspector (NVIDIA, Apache-2.0) ДО установки, а уже
# установленные — на каждый пуш в CI.
#
#   scripts/skillcheck.sh                 # все установленные: .claude/skills с базовой линией
#   scripts/skillcheck.sh <папка-скилла>  # кандидат на установку: без базовой линии, любой HIGH = стоп
#
# Только статический слой (--no-llm): содержимое скиллов никуда не уходит.
# LLM-слой сканера шлёт текст скилла провайдеру — для чужого скилла перед
# установкой это допустимо со своим ключом, для наших (GYM.md — факты о
# владельце) нет. Версия сканера закреплена коммитом: ревьюили именно её.
set -u
SS_REF="704bc9544260c2f41222dc0f92982521709496ab"   # v2.11.1, 07.09.2026
if ! command -v skillspector >/dev/null 2>&1; then
  echo "skillspector не найден. Установка (uv, отдельная среда, Python 3.12):"
  echo "  uv tool install --python 3.12 git+https://github.com/NVIDIA/skillspector.git@$SS_REF"
  exit 2
fi
TARGET="${1:-.claude/skills}"
OUT="$(mktemp)"
if [ "$TARGET" = ".claude/skills" ]; then
  skillspector scan "$TARGET" --no-llm -b .skillspector-baseline.yaml --format json --output "$OUT" >/dev/null 2>&1
else
  skillspector scan "$TARGET" --no-llm --format json --output "$OUT" >/dev/null 2>&1
fi
node - "$OUT" "$TARGET" <<'EOF'
const fs=require('fs'); const [,,out,target]=process.argv;
let j; try{ j=JSON.parse(fs.readFileSync(out,'utf8')); }catch(e){ console.log('✗ skillspector не дал отчёта по '+target); process.exit(1); }
const iss=j.issues||[], ra=j.risk_assessment||{}, hi=iss.filter(x=>x.severity==='HIGH'||x.severity==='CRITICAL');
const ac=j.analysis_completeness||{};
console.log(`skillspector · ${target} · вердикт ${ra.recommendation||'?'} · новых находок ${iss.length} (HIGH ${hi.length}) · подавлено базовой линией ${j.suppressed_count||0} · файлов ${ac.scanned_components}/${ac.total_components}`);
for(const x of iss.slice(0,20)){ const l=x.location||{}; console.log(`  - ${x.severity} ${x.id} ${x.category} ${l.file||''}:${l.start_line||''} — ${(x.explanation||'').slice(0,110)}`); }
if(iss.length>20) console.log('  … ещё '+(iss.length-20));
// Правило: любой HIGH/CRITICAL вне базовой линии — стоп. MEDIUM — читать глазами, но не стоп:
// сканер метит прозу дизайнерских скиллов («решай сам», «npx» в примере) так же, как код.
if(hi.length||ra.recommendation==='DO_NOT_INSTALL'){ console.log('✗ скилл не проходит: прочитай строки выше, почини или занеси в .skillspector-baseline.yaml с причиной'); process.exit(1); }
console.log('✓ скиллы проходят');
EOF
RC=$?; rm -f "$OUT"; exit $RC

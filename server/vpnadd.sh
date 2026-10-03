#!/bin/bash
# Добавить ещё одного пользователя VPN (жена, второй телефон и т.п.).
# Существующие профили НЕ трогает: дописывает клиента в конфиг XRay
# и присылает ассистенту готовую ссылку. Имя профиля — первым аргументом
# (по умолчанию wife). При любой поломке конфиг возвращается из копии.
set -euo pipefail
NAME="${1:-wife}"
SB="https://SUPABASE_PROJECT_REF.supabase.co"
SBKEY="sb_publishable_REDACTED"
JOB="FIXED_JOB_UUID_REDACTED"
CFG=/opt/xray/config.json
cp "$CFG" /root/xray-config.bak

report(){ curl -s -X POST "$SB/rest/v1/rpc/ai_job_put" -H "apikey: $SBKEY" \
  -H "content-type: application/json" \
  -d "$(printf '{"p_id":"%s","p_status":200,"p_body":"%s"}' "$JOB" "$1")" >/dev/null || true; }

UUID=$(/opt/xray/xray uuid)
python3 - "$CFG" "$UUID" <<'PY'
import json,sys
cfg,uuid=sys.argv[1],sys.argv[2]
d=json.load(open(cfg))
d["inbounds"][0]["settings"]["clients"].append({"id":uuid})
json.dump(d,open(cfg,"w"),ensure_ascii=False)
PY

systemctl restart xray
sleep 2
if ! systemctl is-active xray >/dev/null; then
  cp /root/xray-config.bak "$CFG"; systemctl restart xray; sleep 2
  report "ОТКАТ-ADD: xray не поднялся, конфиг возвращён"
  echo "ОТКАТ: конфиг возвращён, ничего не изменилось"; exit 1
fi

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://bezvodyfit.ru/sw.js || echo FAIL)
L="vless://$UUID@bezvodyfit.ru:443?encryption=none&security=tls&sni=bezvodyfit.ru&type=ws&path=%2Fwsvpn&host=bezvodyfit.ru#bezvody-$NAME"
report "ДОБАВЛЕН профиль $NAME сайт=$CODE | $L"
echo "ГОТОВО: профиль $NAME добавлен (сайт $CODE), ссылка у ассистента."

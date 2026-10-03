#!/bin/bash
# Личный VPN владельца: VLESS + Reality (XRay) на фронт-сервере Шарлотт.
# ЗАПУСКАТЬ РОВНО ОДИН РАЗ. Каждый запуск рождает новые ключи и рвёт
# ранее импортированный профиль — не перезапускать «на всякий случай».
#
# Грабли, учтённые (18.08):
# - VNC-консоль калечит длинные вставки → скрипт качается с сайта.
# - flow xtls-rprx-vision рвал «client hello» у iOS-клиентов → УБРАН,
#   чистый Reality совместим со всеми.
# - Ссылку и самодиагностику сервер сам шлёт ассистенту через ai_jobs —
#   владелец не копирует из консоли.
# - Клиент: V2Box (парсер надёжнее Streisand).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
SB="https://SUPABASE_PROJECT_REF.supabase.co"
SBKEY="sb_publishable_REDACTED"
JOB="FIXED_JOB_UUID_REDACTED"

apt-get install -y unzip qrencode >/dev/null 2>&1 || { apt-get update && apt-get install -y unzip qrencode; }
mkdir -p /opt/xray
systemctl stop xray 2>/dev/null || true
# XRay пришпилен к обкатанной версии (latest 26.3 отвергал клиентов)
if [ ! -x /opt/xray/xray ] || ! /opt/xray/xray version 2>/dev/null | grep -q 1.8.24; then
  curl -L -o /tmp/xray.zip https://github.com/XTLS/Xray-core/releases/download/v1.8.24/Xray-linux-64.zip
  unzip -o /tmp/xray.zip -d /opt/xray
  chmod +x /opt/xray/xray
fi
cd /opt/xray

# Ключи. Разбор надёжный: приватный и публичный по префиксу строки,
# что бы ни печатала конкретная версия (Private/Public key).
./xray x25519 > /root/rk
PRIV=$(grep -iE 'private' /root/rk | grep -oE '[A-Za-z0-9_-]{43}' | head -1)
PUB=$(grep -iE 'public|password' /root/rk | grep -oE '[A-Za-z0-9_-]{43}' | head -1)
UUID=$(./xray uuid)
SID=$(openssl rand -hex 4)
IP=$(hostname -I | awk '{print $1}')

# Reality БЕЗ vision flow — максимальная совместимость клиентов
cat > /opt/xray/config.json <<EOF
{"log":{"loglevel":"info"},
 "inbounds":[{"listen":"0.0.0.0","port":8443,"protocol":"vless",
  "settings":{"clients":[{"id":"$UUID"}],"decryption":"none"},
  "streamSettings":{"network":"tcp","security":"reality","realitySettings":{
   "dest":"www.microsoft.com:443","serverNames":["www.microsoft.com"],
   "privateKey":"$PRIV","shortIds":["$SID"]}}}],
 "outbounds":[{"protocol":"freedom"}]}
EOF

cat > /etc/systemd/system/xray.service <<'EOF'
[Unit]
Description=Xray
After=network.target
[Service]
ExecStart=/opt/xray/xray run -c /opt/xray/config.json
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now xray
systemctl restart xray
ufw allow 8443/tcp >/dev/null 2>&1 || true
sleep 2

# Самодиагностика для ассистента: жив ли сервис, слушается ли порт
ACT=$(systemctl is-active xray)
PORT=$(ss -ltn 2>/dev/null | grep -q ':8443' && echo listen || echo NOLISTEN)
# Ссылка БЕЗ flow
L="vless://$UUID@$IP:8443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=$PUB&sid=$SID&type=tcp#bezvody-USA"
echo "$L" > /root/vpn-link.txt
DIAG="xray=$ACT port=$PORT pubkey_len=${#PUB} priv_len=${#PRIV} | $L"

curl -s -X POST "$SB/rest/v1/rpc/ai_job_put" \
  -H "apikey: $SBKEY" -H "content-type: application/json" \
  -d "$(printf '{"p_id":"%s","p_status":200,"p_body":"%s"}' "$JOB" "$DIAG")" >/dev/null || true

# прибираем прежние временные раздачи
ufw delete allow 8088/tcp >/dev/null 2>&1 || true
rm -rf /tmp/q
echo "ГОТОВО: сервер настроен и отчитался ассистенту. Ничего больше не запускай — жди в чате."

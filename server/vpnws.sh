#!/bin/bash
# VPN владельца, схема WebSocket-внутри-сайта (18.08, после провала Reality).
#
# Доказанный факт: приложение ходит на 443 к bezvodyfit.ru с настоящим
# сертификатом и работает у владельца всегда, а Reality-рукопожатие
# умирало в любом клиенте и сети. Значит выкидываем Reality: туннель
# едет ВНУТРИ обычного HTTPS к нашему сайту — Caddy отдаёт сайт как
# прежде, а запросы на секретный путь /wsvpn передаёт XRay (VLESS+WS).
# Снаружи это неотличимо от работы приложения: тот же сертификат,
# тот же домен, тот же порт.
#
# Приложение защищено: проверка сайта снаружи + автооткат при сбое.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
SB="https://SUPABASE_PROJECT_REF.supabase.co"
SBKEY="sb_publishable_REDACTED"
JOB="FIXED_JOB_UUID_REDACTED"
WSPATH="/wsvpn"
cp /etc/caddy/Caddyfile /root/Caddyfile.bak.ws

report(){ curl -s -X POST "$SB/rest/v1/rpc/ai_job_put" -H "apikey: $SBKEY" \
  -H "content-type: application/json" \
  -d "$(printf '{"p_id":"%s","p_status":200,"p_body":"%s"}' "$JOB" "$1")" >/dev/null || true; }

rollback(){
  cp /root/Caddyfile.bak.ws /etc/caddy/Caddyfile
  systemctl stop xray 2>/dev/null || true
  systemctl restart caddy
  sleep 3
  S=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://bezvodyfit.ru/sw.js || echo FAIL)
  report "ОТКАТ-WS: $1 | сайт после отката: $S"
  echo "ОТКАТ: $1 — сайт возвращён"
  exit 1
}

# 1) XRay уходит с 443 внутрь: VLESS+WebSocket на localhost, без TLS
#    (шифрование даёт Caddy настоящим сертификатом Let's Encrypt)
systemctl stop xray 2>/dev/null || true
cd /opt/xray
UUID=$(./xray uuid)
cat > /opt/xray/config.json <<EOF
{"log":{"loglevel":"warning"},
 "inbounds":[{"listen":"127.0.0.1","port":10000,"protocol":"vless",
  "settings":{"clients":[{"id":"$UUID"}],"decryption":"none"},
  "streamSettings":{"network":"ws","wsSettings":{"path":"$WSPATH"}}}],
 "outbounds":[{"protocol":"freedom"}]}
EOF
systemctl restart xray
sleep 2
systemctl is-active xray >/dev/null || rollback "xray не поднялся на ws"

# 2) Caddy снова хозяин 443: сайт как был + секретный путь в туннель
cat > /etc/caddy/Caddyfile <<CADDY
bezvodyfit.ru, www.bezvodyfit.ru {
	@ws path $WSPATH
	reverse_proxy @ws 127.0.0.1:10000
	encode zstd gzip
	reverse_proxy https://bezvody.vercel.app
}
CADDY
systemctl restart caddy
sleep 3
systemctl is-active caddy >/dev/null || rollback "caddy не поднялся на 443"

# 3) Сайт обязан отвечать снаружи
ufw allow 443/tcp >/dev/null 2>&1 || true
sleep 2
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://bezvodyfit.ru/sw.js || echo FAIL)
[ "$CODE" = "200" ] || rollback "сайт ответил $CODE"

# 4) И сам туннельный путь должен отвечать (400 от xray — это норма:
#    он ждёт WebSocket-рукопожатие, а не обычный запрос)
WS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://bezvodyfit.ru$WSPATH" || echo FAIL)

L="vless://$UUID@bezvodyfit.ru:443?encryption=none&security=tls&sni=bezvodyfit.ru&type=ws&path=%2Fwsvpn&host=bezvodyfit.ru#bezvody-WS"
echo "$L" > /root/vpn-link.txt
report "ГОТОВО-WS сайт=$CODE ws=$WS | $L"
echo "ГОТОВО: сайт жив ($CODE), туннель на пути $WSPATH ($WS), ссылка у ассистента."

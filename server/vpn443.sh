#!/bin/bash
# VPN владельца, схема «за собственным сайтом» (18.08, после провала 8443).
#
# Почему так: операторы владельца душат VPN-протоколы на нестандартных
# портах — рукопожатие не доживало до сервера ни в одном клиенте и сети.
# Здесь XRay занимает 443 и маскируется под НАШ ЖЕ домен (Reality dest =
# собственный Caddy, serverNames = bezvodyfit.ru). Снаружи это обычные
# заходы на сайт: задушить = задушить сайт. Не-Reality трафик уходит
# фолбэком в Caddy, поэтому сайт продолжает работать как работал.
#
# БЕЗОПАСНОСТЬ ПРИЛОЖЕНИЯ: после перестройки скрипт проверяет сайт снаружи
# и при неудаче САМ откатывает всё назад (Caddy обратно на 443, XRay стоп).
# Запускать один раз; ссылка и диагностика уходят ассистенту через ai_jobs.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
SB="https://SUPABASE_PROJECT_REF.supabase.co"
SBKEY="sb_publishable_REDACTED"
JOB="FIXED_JOB_UUID_REDACTED"
IP=$(hostname -I | awk '{print $1}')
cp /etc/caddy/Caddyfile /root/Caddyfile.bak

report(){ curl -s -X POST "$SB/rest/v1/rpc/ai_job_put" -H "apikey: $SBKEY" \
  -H "content-type: application/json" \
  -d "$(printf '{"p_id":"%s","p_status":200,"p_body":"%s"}' "$JOB" "$1")" >/dev/null || true; }

rollback(){
  cp /root/Caddyfile.bak /etc/caddy/Caddyfile
  systemctl stop xray 2>/dev/null || true
  systemctl disable xray 2>/dev/null || true
  systemctl restart caddy
  sleep 3
  S=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://bezvodyfit.ru/sw.js || echo FAIL)
  report "ОТКАТ выполнен: $1 | сайт после отката: $S"
  echo "ОТКАТ: $1 — сайт возвращён на прежнюю схему"
  exit 1
}

# 0) Освобождаем 8443: там висит XRay прошлой (провальной) схемы —
#    без этого Caddy не сможет занять порт и всё уйдёт в откат
systemctl stop xray 2>/dev/null || true
sleep 1

# 1) Сайт переезжает на внутренний 8443, 80 остаётся Caddy (сертификаты ACME)
cat > /etc/caddy/Caddyfile <<'CADDY'
{
	https_port 8443
}
bezvodyfit.ru, www.bezvodyfit.ru {
	encode zstd gzip
	reverse_proxy https://bezvody.vercel.app
}
CADDY
systemctl restart caddy
sleep 3
systemctl is-active caddy >/dev/null || rollback "caddy не поднялся на 8443"

# 2) XRay на 443, Reality крадёт собственный домен, не-Reality → фолбэк в Caddy
cd /opt/xray
./xray x25519 > /root/rk
PRIV=$(grep -iE 'private' /root/rk | grep -oE '[A-Za-z0-9_-]{43}' | head -1)
PUB=$(grep -iE 'public|password' /root/rk | grep -oE '[A-Za-z0-9_-]{43}' | head -1)
UUID=$(./xray uuid)
SID=$(openssl rand -hex 4)
[ ${#PRIV} -eq 43 ] && [ ${#PUB} -eq 43 ] || rollback "ключи не разобрались (${#PRIV}/${#PUB})"

cat > /opt/xray/config.json <<EOF
{"log":{"loglevel":"info"},
 "inbounds":[{"listen":"0.0.0.0","port":443,"protocol":"vless",
  "settings":{"clients":[{"id":"$UUID"}],"decryption":"none",
   "fallbacks":[{"dest":"127.0.0.1:8443","xver":0}]},
  "streamSettings":{"network":"tcp","security":"reality","realitySettings":{
   "dest":"127.0.0.1:8443","serverNames":["bezvodyfit.ru","www.bezvodyfit.ru"],
   "privateKey":"$PRIV","shortIds":["$SID"]}}}],
 "outbounds":[{"protocol":"freedom"}]}
EOF
systemctl enable xray >/dev/null 2>&1 || true
systemctl restart xray
sleep 3
systemctl is-active xray >/dev/null || rollback "xray не поднялся на 443"

# 3) Проверка снаружи: сайт обязан отвечать через новую цепочку
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw delete allow 8443/tcp >/dev/null 2>&1 || true
sleep 2
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://bezvodyfit.ru/sw.js || echo FAIL)
[ "$CODE" = "200" ] || rollback "сайт ответил $CODE после перестройки"

L="vless://$UUID@$IP:443?encryption=none&security=reality&sni=bezvodyfit.ru&fp=chrome&pbk=$PUB&sid=$SID&type=tcp#bezvody-USA-443"
echo "$L" > /root/vpn-link.txt
report "ГОТОВО-443 сайт=$CODE xray=active | $L"
echo "ГОТОВО: сайт жив ($CODE), VPN на 443 поднят, ссылка отправлена ассистенту."

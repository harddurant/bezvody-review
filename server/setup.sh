#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Фронт-сервер bezvodyfit.ru (поднят 18.08.2026: aeza Шарлотт, SERVER_IP_REDACTED).
#
# Зачем: операторы РФ замедляют/режут адреса Vercel и Cloudflare —
# вечерами на мобильной сети умирает всё крупное (оболочка, видео,
# тяжёлый ИИ). Этот сервер — чистый IP за границей, который проксирует
# ВЕСЬ трафик домена на Vercel. Деплой-процесс не меняется.
#
# Грабли, уже собранные (не наступать повторно):
# 1. VNC-консоль aeza СКЛЕИВАЕТ многострочную вставку в одну строку —
#    вставлять этот файл целиком можно только в cloud-init или по SSH;
#    в VNC — команды по одной (они однострочные ниже).
# 2. Vercel режет запросы с несовпадением SNI/Host (x-vercel-mitigated:
#    deny) — поэтому НИКАКОГО header_up Host: прокси говорит с Vercel
#    полностью от имени bezvody.vercel.app.
# 3. Проверка чистоты IP браузером упирается в редирект HTTP→HTTPS —
#    для этого есть http-блок «OK» по голому IP.
#
# После запуска: http://<IP> отвечает «OK» (тест чистоты IP с LTE),
# после переключения DNS сертификаты домена выдаются сами.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update && apt-get install -y curl gnupg ufw unattended-upgrades && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy.gpg && echo "deb [signed-by=/usr/share/keyrings/caddy.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > /etc/apt/sources.list.d/caddy.list && apt-get update && apt-get install -y caddy

IP=$(hostname -I | awk '{print $1}') && printf 'bezvodyfit.ru, www.bezvodyfit.ru {\n\tencode zstd gzip\n\treverse_proxy https://bezvody.vercel.app\n}\nhttp://%s {\n\trespond "OK - server zhiv" 200\n}\n' "$IP" > /etc/caddy/Caddyfile

ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable && systemctl enable --now caddy && systemctl restart caddy && echo "ГОТОВО: фронт поднят, проверь http://$IP"

/* Отдаёт публичный VAPID-ключ приложению.
   Публичный ключ по определению не секрет: он и так уезжает в push-службу
   браузера. Секретен только VAPID_PRIVATE, и он отсюда не выходит.

   Зачем отдельная ручка, а не константа в index.html: тогда ключ вообще
   нигде не хранится в репозитории, а живёт только в переменных окружения. */
export default function handler(req, res) {
  res.setHeader('cache-control', 'public, max-age=3600');
  const key = process.env.VAPID_PUBLIC || '';
  if (!key) { res.status(503).json({ error: 'push not configured' }); return; }
  res.status(200).json({ key });
}

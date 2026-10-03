/* Тихий приёмник шагов из iOS-команды («Получить содержимое URL» — без открытия браузера).
   GET/POST /api/steps?k=ЛИЧНЫЙ_КОД&n=ШАГИ  →  строка в Supabase steps_inbox.
   Приложение читает свои строки по коду и кладёт максимум за день в локальную базу.
   Никаких имён и аккаунтов: только случайный код и число шагов. */
const SB_URL = 'https://SUPABASE_PROJECT_REF.supabase.co';
const SB_KEY = 'sb_publishable_REDACTED';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const q = req.query || {};
  const k = String(q.k || '').trim();
  const n = parseInt(q.n, 10);
  if (k.length < 8 || k.length > 64) { res.status(400).json({ error: 'bad key' }); return; }
  if (!(n > 0 && n < 200000)) { res.status(400).json({ error: 'bad steps' }); return; }
  try {
    const r = await fetch(SB_URL + '/rest/v1/steps_inbox', {
      method: 'POST',
      headers: { apikey: SB_KEY, authorization: 'Bearer ' + SB_KEY, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({ k, n }),
    });
    if (!r.ok) { res.status(502).json({ error: 'store failed' }); return; }
    res.status(200).json({ ok: true, n });
  } catch (e) { res.status(502).json({ error: 'store failed' }); }
}

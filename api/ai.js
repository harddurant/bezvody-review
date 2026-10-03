/* Прокси к Anthropic для пользователей без своего API-ключа.
   Доступ — только с валидным Supabase-токеном (человек вошёл в синхронизацию).
   Ключ хозяина приложения: переменная окружения ANTHROPIC_API_KEY
   (Vercel → Project → Settings → Environment Variables → ANTHROPIC_API_KEY).
   Модель и max_tokens зажаты на сервере — чужой клиент не заставит платить за дорогое. */
const SB_URL = 'https://SUPABASE_PROJECT_REF.supabase.co';
const SB_KEY = 'sb_publishable_REDACTED';
/* Лимиты живут в таблице public.ai_limits (free/beta/pro/global, день, месяц,
   токены) и проверяются RPC ai_bump_v3 — правятся одним UPDATE без деплоя.
   Константы ниже — только запасной счётчик в памяти на случай недоступной БД. */
const USER_DAY_LIMIT = 60;
const GLOBAL_DAY_LIMIT = 200;
/* Ключ для служебных записей (ai_jobs) — секретный ключ Supabase из env
   SB_SECRET_KEY (Vercel → Settings → Environment Variables). Пока его нет,
   ящик пишется от anon; после появления anon у ai_job_put отзывается. */
const SB_SECRET = String(process.env.SB_SECRET_KEY || '');

/* Маршрутизация по типу задачи. Клиент присылает подсказку task, но модель
   выбирает СЕРВЕР — чужой клиент не заставит платить за дорогое.
   Голос и этикетка — структурное извлечение текста, Haiku справляется и стоит
   впятеро дешевле. Фото еды и разбор месяца остаются на Sonnet: там цена ошибки —
   неверные калории в дневнике и кривые правки программы. */
const TASK_MODEL = {
  voice: 'claude-haiku-4-5',
  label: 'claude-haiku-4-5',
};
const DEFAULT_MODEL = 'claude-sonnet-5';
/* Sonnet 5 размышляет по умолчанию, а max_tokens — потолок «мысли + текст»:
   без явного отключения модель может потратить весь лимит на размышление и
   вернуть 200 без текста (полевой кейс v151). Отключаем везде, кроме
   разборов — там размышление оправдано, и лимит токенов выше. */
const THINK_TASKS = { analysis: 1 };

/* Счётчик в памяти инстанса: сбрасывается при перезапуске, поэтому лимит «грубый».
   От случайного перерасхода и растаскивания ключа защищает, для точного биллинга не годится. */
const counters = new Map();
function bump(k, lim) {
  const day = new Date().toISOString().slice(0, 10), kk = day + '|' + k;
  const n = (counters.get(kk) || 0) + 1;
  counters.set(kk, n);
  if (counters.size > 5000) for (const key of counters.keys()) { if (!key.startsWith(day)) counters.delete(key); }
  return n <= lim;
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  /* Туннель для собственного ключа пользователя: api.anthropic.com блокируется
     в РФ, клиент шлёт свой ключ транзитом в x-user-key — мы его не храним и не
     логируем, беты и Supabase-лимиты не применяем (его ключ — его расход),
     только грубый общий кап от абьюза трафика. */
  const userKey = String(req.headers['x-user-key'] || '');
  const key = userKey || process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(503).json({ error: 'Прокси не настроен: добавь ANTHROPIC_API_KEY в переменные окружения Vercel' }); return; }

  let uid = null, tok = '';
  if (userKey) {
    if (!bump('tunnel', 2000)) { res.status(429).json({ error: 'tunnel limit' }); return; }
  } else {
  tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tok) { res.status(401).json({ error: 'login required' }); return; }
  try {
    const u = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_KEY, authorization: 'Bearer ' + tok } });
    if (!u.ok) { res.status(401).json({ error: 'bad token' }); return; }
    uid = (await u.json()).id;
  } catch (e) { res.status(502).json({ error: 'auth check failed' }); return; }
  if (!uid) { res.status(401).json({ error: 'bad token' }); return; }

  /* Доступ к ИИ на ключе владельца: белый список беты ИЛИ активная подписка.
     Fail-closed: если обе проверки недоступны — доступа нет (ключ дороже удобства). */
  try {
    const ra = await fetch(SB_URL + '/rest/v1/rpc/ai_allowed', {
      method: 'POST',
      headers: { apikey: SB_KEY, authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
      body: '{}',
    });
    let ok = ra.ok && (await ra.json()) === true;
    if (!ok) {
      const rs = await fetch(SB_URL + '/rest/v1/rpc/sub_status', {
        method: 'POST',
        headers: { apikey: SB_KEY, authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
        body: '{}',
      });
      if (rs.ok) {
        const rows = await rs.json();
        const row = Array.isArray(rows) ? rows[0] : rows;
        ok = !!(row && row.active);
      }
    }
    if (!ok) { res.status(403).json({ error: 'beta' }); return; }
  } catch (e) { res.status(403).json({ error: 'beta' }); return; }

  /* Прочный лимит: RPC ai_bump_v3() под токеном пользователя (auth.uid)
     сверяет план (подписка → бета → free) с таблицей ai_limits по дню, месяцу
     и токенам, и засчитывает запрос только если он разрешён. allowed=false →
     429 с причиной: клиент по ней говорит человеку разное («сегодня», «до 1-го»,
     «общий потолок»). Если БД недоступна — запасной счётчик в памяти. */
  let counted = false;
  try {
    const rc = await fetch(SB_URL + '/rest/v1/rpc/ai_bump_v3', {
      method: 'POST',
      headers: { apikey: SB_KEY, authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
      body: '{}',
    });
    if (rc.ok) {
      const rows = await rc.json();
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row && typeof row.allowed === 'boolean') {
        counted = true;
        if (!row.allowed) {
          res.status(429).json({ error: 'quota', reason: row.reason || 'day', plan: row.plan || 'free' }); return;
        }
      }
    }
  } catch (e) { /* падаем на запасной счётчик ниже */ }
  if (!counted && (!bump('all', GLOBAL_DAY_LIMIT) || !bump(uid, USER_DAY_LIMIT))) {
    res.status(429).json({ error: 'daily limit' }); return;
  }
  }  // конец ветки «наш ключ»: бета/подписка и лимиты не касаются туннеля своего ключа

  const b = req.body || {};
  if (!Array.isArray(b.messages)) { res.status(400).json({ error: 'messages required' }); return; }
  /* Квитанция (поле 17.08, «Load failed» на мобильной сети): оператор рвёт
     длинное соединение, но функция доживает — ответ докладывается в ai_jobs,
     клиент забирает его мелкими опросами. job — uuid, сгенерённый клиентом. */
  const job = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(b.job || '')) ? b.job : null;
  /* Новый секретный ключ (sb_secret_…) шлётся только в apikey — шлюз сам
     выдаст роль service_role; старый JWT service_role — как bearer. */
  const jobHdr = SB_SECRET ? (SB_SECRET.startsWith('sb_secret_') ? { apikey: SB_SECRET }
                                                                  : { apikey: SB_KEY, authorization: 'Bearer ' + SB_SECRET })
                : tok ? { apikey: SB_KEY, authorization: 'Bearer ' + tok } : { apikey: SB_KEY };
  const jobPut = (st, body) => !job ? Promise.resolve() :
    fetch(SB_URL + '/rest/v1/rpc/ai_job_put', {
      method: 'POST',
      headers: { ...jobHdr, 'content-type': 'application/json' },
      body: JSON.stringify({ p_id: job, p_status: st, p_body: body }),
    }).catch(() => {});
  /* Списание токенов после ответа — только на ключе владельца: его расход,
     его потолок. Своему ключу пользователя считать нечего. Ответ Anthropic
     несёт usage.input_tokens/output_tokens; кэш-токены считаем как вход. */
  const spend = (txt) => {
    if (!uid || !tok) return Promise.resolve();
    let u = null; try { u = JSON.parse(txt).usage; } catch (e) {}
    if (!u) return Promise.resolve();
    const pin = (+u.input_tokens || 0) + (+u.cache_read_input_tokens || 0) + (+u.cache_creation_input_tokens || 0);
    return fetch(SB_URL + '/rest/v1/rpc/ai_spend', {
      method: 'POST',
      headers: { apikey: SB_KEY, authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
      body: JSON.stringify({ p_in: pin, p_out: +u.output_tokens || 0 }),
    }).catch(() => {});
  };
  const task = String(b.task || '');
  const model = TASK_MODEL[task] || DEFAULT_MODEL;
  const payload = {
    model,
    /* ── ПОЛ ДЛЯ ЗАДАЧ С РАЗМЫШЛЕНИЕМ ──
       Настоящие записи с телефона владельца, дважды (v323 и v397):
       «ai_empty stop=max_tokens types=thinking out_tok=400 max=400».
       Человек спросил — и не получил ничего. Причина арифметическая:
       max_tokens это потолок «мысли + текст», и у задач, где размышление
       ВКЛЮЧЕНО, четырёхсот токенов не хватает даже на мысль. Клиент был
       вправе прислать 400 — это мы обязаны не пускать заведомо пустой
       запрос. Пол в 4000 стоит здесь, на сервере: клиентов четыре, и
       чинить это в каждом значит однажды забыть в пятом. */
    max_tokens: Math.min(
      Math.max(THINK_TASKS[task] ? 4000 : 1, +b.max_tokens || 1200),
      THINK_TASKS[task] ? 16000 : 8000),
    messages: b.messages,
  };
  // Инструменты тренера (чат 24/7): клиент передаёт схемы, выполняет их тоже клиент.
  // Ограничиваем количество — чужой клиент не раздует запрос.
  if (Array.isArray(b.tools) && b.tools.length && b.tools.length <= 10) payload.tools = b.tools;
  if (model === DEFAULT_MODEL && !THINK_TASKS[task]) payload.thinking = { type: 'disabled' };
  await jobPut(0, '');   // «запрос дошёл, готовлю» — клиент отличит обрыв доставки от долгой генерации
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    await Promise.all([jobPut(r.status, txt), spend(txt)]);   // доклад в ящик ДО ответа: соединение может быть уже мертво
    res.status(r.status).setHeader('content-type', 'application/json').send(txt);
  } catch (e) {
    await jobPut(502, '{"error":"upstream failed"}');
    res.status(502).json({ error: 'upstream failed' });
  }
}

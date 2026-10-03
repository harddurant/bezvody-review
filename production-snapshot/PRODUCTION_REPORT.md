# Что существует только в продакшене — обезличенный снимок

Снято 03.10.2026 запросами только на чтение: метаданные Postgres
(`pg_class`, `pg_policies`, `pg_proc`, `cron.job`, `storage.buckets`),
советник безопасности Supabase, список деплоев Vercel, статус GitHub
Actions. **Строки пользовательских таблиц не читались.** Значения
секретов не запрашивались и не публикуются.

Идентификаторы заменены на заглушки: `SUPABASE_PROJECT_REF`,
`R2_PUBLIC_BUCKET`, `sb_publishable_REDACTED`.

---

## 1. Хостинг и домены

| Что | Факт |
|---|---|
| Прод-домен | `bezvodyfit.ru` (по коду: `isProd()` в `index.html`, ссылки в `api/steps.js`, промо) |
| Хостинг | Vercel, проект `bezvody`, автодеплой из ветки `main` |
| Последний прод-деплой на момент снимка | коммит `f183129` (v679), состояние READY |
| Preview | Vercel собирает превью на каждую ветку; закрыты логином Vercel владельца |
| Сборка | `buildCommand` из `vercel.json`: smoke → field → kitchen → matrix → build; `outputDirectory: dist` |
| Что уходит в `dist/` | см. `tests/build.js`: `index.html`, `sw.js`, `manifest.json`, `icon.svg`, `verifyadmitad.txt`, `fonts/`, `icons/`, `promo/*.html`, **`server/vpn.sh`, `vpn443.sh`, `vpnws.sh`, `vpnadd.sh`** |
| Прокси | `/sb/*` → Supabase, `/media/*` → Cloudflare R2 (публичный бакет), `/about` `/studio` `/reel` `/privacy` `/terms` → `promo/` |

## 2. Серверные функции Vercel (`api/`)

| Файл | Метод и вход | Что делает | Авторизация |
|---|---|---|---|
| `api/ai.js` | POST, JSON сообщений Anthropic | Прокси к Anthropic: модель выбирает сервер, квоты через RPC `ai_bump_v3` и `ai_spend`; длинные ответы кладёт в `ai_jobs` (квитанция) | Без своего ключа — Supabase-токен + бета-список или подписка. **Со своим ключом (`x-user-key`) — без авторизации**, общий счётчик в памяти |
| `api/steps.js` | GET/POST `?k=код&n=шаги` | Пишет шаги в `steps_inbox` от anon-ключа | Только код |
| `api/push-key.js` | GET | Отдаёт публичный VAPID-ключ | Нет |
| `api/push-send.js` | POST от крона | Рассылает веб-пуши по `push_due` | Заголовок `x-push-secret` (сравнение `timingSafeEqual`) |

`vercel.json`: `api/ai.js` — `maxDuration: 300`.

### Переменные окружения (только имена)

| Имя | Где используется |
|---|---|
| `ANTHROPIC_API_KEY` | `api/ai.js` — ключ владельца для прокси |
| `SB_SECRET_KEY` | `api/ai.js` — запись в `ai_jobs`; при отсутствии запись идёт от anon |
| `SUPABASE_SERVICE_ROLE` | `api/push-send.js` |
| `PUSH_CRON_SECRET` | `api/push-send.js` |
| `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_SUBJECT` | `api/push-key.js`, `api/push-send.js` |
| `BV_LIVE_EMAIL`, `BV_LIVE_PASS`, `BV_LIVE_OUT`, `BV_LIVE_PORT`, `BV_LIVE_WRITE` | только `tests/live.js` на машине владельца |
| `BV_CHROME`, `BV_REQUIRE_BROWSER`, `BVDBG`, `BV_DBG_SLOT`, `BV_MEDIA` | только тесты и скрипты |

Публичный ключ Supabase (`sb_publishable_…`) вшит в клиент, `api/ai.js`,
`api/steps.js`, `promo/about.html` и VPN-скрипты; он публичный по
замыслу и защищается RLS.

## 3. База Supabase (Postgres)

### Таблицы схемы `public`

`est_rows` — оценка планировщика (`reltuples`), не точный счёт; −1 —
статистика не собрана.

| Таблица | RLS | est_rows | Назначение | В git (`supabase/*.sql`) |
|---|---|---|---|---|
| `vaults` | да | 3 | Зашифрованный блоб хранилища на пользователя, версия | да |
| `keyring` | да | — | Обёртки ключа данных (под паролем и под кодом восстановления), подсказка кода | **нет** |
| `profiles` | да | — | Профиль и цели | да; **клиент не использует** |
| `diary_entries` | да | — | Дневник в открытом виде | да; **клиент не использует** |
| `body_metrics` | да | — | Вес и замеры в открытом виде | да; **клиент не использует** |
| `products` | да | 246 | Общий каталог продуктов (official/community, verified, created_by, barcode) | да |
| `product_packages` | да | 62 | Фасовки | да |
| `recipes` | да | 144 | Рецепты | да |
| `recipe_ingredients` | да | 844 | Состав рецептов | да |
| `pantry_items` | да | — | Кладовая (открытым текстом, с граммами) | да |
| `shopping_lists`, `shopping_list_items` | да | — | Списки покупок | да |
| `households`, `household_members`, `household_invites` | да | 1 / — / 4 | «Общий дом» | **нет** |
| `push_subs` | да | 1 | Пуш-подписки: endpoint, часы, часовой пояс, дни тренировок, флаги | **нет** |
| `subscriptions` | да | — | Подписка (план, статус, до) | **нет** |
| `ai_allow` | да, **без политик** | — | Бета-список ИИ | частично |
| `ai_usage` | да, **без политик** | 22 | Счётчики запросов и токенов | частично |
| `ai_limits` | **нет** (прав у anon/authenticated нет) | — | Лимиты по планам | **нет** |
| `ai_jobs` | да, **без политик** | 1 | Квитанции ответов ИИ, тело открытым текстом, чистится при записи старше часа | **нет** |
| `steps_inbox` | да | 31 | Шаги из iOS-команды по коду | **нет** |
| `app_events` | да | 806 | Телеметрия (`anon_id`, `uid`, событие, число, метка) | да |
| `client_errors` | да | 168 | Журнал ошибок клиента (версия, UA, `uid`, текст, стек, URL) | **нет** |

### Представления

| Представление | Права anon / authenticated |
|---|---|
| `products_public`, `product_quality`, `recipe_macros` | **SELECT (и формально INSERT/UPDATE) есть у anon и authenticated** — каталог читается анонимно через представления, хотя на самих таблицах чтение разрешено только вошедшим |
| `metrics.people`, `metrics.pulse`, `metrics.errors_recent` | схема `metrics` закрыта от anon и authenticated |

### Политики RLS (сводка)

| Таблица | Политики |
|---|---|
| `vaults` | select/insert/update/delete: `auth.uid() = user_id` (роль `public`) |
| `keyring` | all: `user_id = auth.uid()` (роль `public`) |
| `profiles` | insert/select/update: `id = auth.uid()` |
| `diary_entries`, `body_metrics` | all для `authenticated`: `user_id = auth.uid()` |
| `products`, `recipes` | select: `true` для `authenticated`; insert/update: только свои, `source='community'`, `verified=false` |
| `product_packages`, `recipe_ingredients` | select: `true` для `authenticated`; ингредиенты — запись только в свои рецепты |
| `pantry_items`, `shopping_lists`, `shopping_list_items` | all: свои или своего «дома» (`auth_household_ids()`) |
| `households` | insert/update: владелец; select: свой «дом» |
| `household_members` | select: свои записи или своего «дома» |
| `household_invites` | all: свой «дом» |
| `push_subs` | select/insert/update/delete: свои |
| `subscriptions` | select: свои |
| `app_events`, `client_errors` | insert для `anon` и `authenticated` с ограничениями длины полей |
| `steps_inbox` | insert для `anon` с ограничением кода и числа |
| `ai_allow`, `ai_usage`, `ai_jobs` | политик нет — доступ только через SECURITY DEFINER функции |

### Функции

Полные определения всех 40 функций — `supabase_live_functions.sql` рядом.
**27 из них в git отсутствуют:** `account_delete`, `ai_allowed`, `ai_bump`,
`ai_bump_v2`, `ai_bump_v3`, `ai_job_get`, `ai_job_put`, `ai_plan`,
`ai_spend`, `calculate_targets`, `exclusion_categories`,
`generate_shopping_list`, `keyring_put`, `log_recipe`, `pantry_qty`,
`product_by_barcode`, `push_fail`, `push_mark`, `recipe_excluded`,
`search_products_fuzzy`, `search_recipes`, `steps_pull`, `sub_status`,
`suggest_alternatives`, `suggest_day`, `suggest_from_pantry`,
`suggest_recipes`.

**Доступны роли `anon` (EXECUTE):** `steps_pull`, `push_vault`,
`product_by_barcode`, `keyring_put`, `exclusion_categories`,
`recipe_excluded`, `search_recipes`, `suggest_recipes`, `suggest_day`,
`sub_status`, `ai_job_get`. Из них SECURITY DEFINER: `steps_pull`,
`sub_status`, `ai_job_get`.

### Триггеры

| Таблица | Триггер | Что делает |
|---|---|---|
| `auth.users` | `auto_confirm_email_trg` (BEFORE INSERT) | Ставит `email_confirmed_at = now()` — **почта при регистрации не подтверждается** |

### Задания по расписанию (`pg_cron`)

| Задание | Расписание | Команда |
|---|---|---|
| `steps-inbox-ttl` | `30 3 * * *` | удалить `steps_inbox` старше 14 дней |
| `ai-usage-ttl` | `40 3 * * *` | удалить `ai_usage` старше 60 дней |
| `push-hourly` | `0 * * * *` | `net.http_post` на `[URL push-send]` с заголовком `x-push-secret: [REDACTED]` |

Отдельного задания очистки `ai_jobs` нет: старые записи удаляются только
при следующем вызове `ai_job_put`.

### Расширения

`pg_cron`, `pg_net` (установлено в схеме `public`), `pg_trgm`, `pgcrypto`,
`uuid-ossp`, `pg_stat_statements`, `supabase_vault`, `plpgsql`.

### Хранилище

Бакет `exercise-media` (публичный). Видео упражнений отдаются из
Cloudflare R2 через `/media`; связь бакета Supabase с R2 по коду не
установлена.

### Советник безопасности Supabase (03.10)

| Уровень | Находка |
|---|---|
| INFO | RLS включён без политик: `ai_allow`, `ai_jobs`, `ai_usage` (так задумано: доступ через функции) |
| WARN | Расширение `pg_net` в схеме `public` |
| WARN | SECURITY DEFINER функции, доступные `anon`: `ai_job_get`, `steps_pull`, `sub_status` |
| WARN | SECURITY DEFINER функции, доступные `authenticated`: 20 штук (`account_delete`, `ai_*`, `household_*`, `pantry_*`, `steps_pull`, `sub_status`, …) |
| WARN | Защита от утёкших паролей (HaveIBeenPwned) выключена |

## 4. Метрики (витрина `metrics.pulse`, 03.10)

| Показатель | Значение |
|---|---|
| Людей всего (засорено превью и браузерами до 30.08) | 263 |
| С аккаунтом | 2 |
| Когорта 14 дней / активированы (3 тренировки) | 226 / 1 (0,4 %) |
| Когорта 30 дней / дожили до 30-го дня | 189 / 3 (1,6 %) |
| Ошибок клиента за 7 дней | 10 |

Свежие «ошибки» клиента — в основном UX-сигналы детектора («поле брошено»
в поиске еды, «rage»-тапы по стрелкам дня в «Зале»), не исключения.

## 5. CI (GitHub Actions)

Workflow `security` (gitleaks, гейт, Chromium) на каждом пуше **не
стартует с 23.09.2026**: «The job was not started because recent account
payments have failed or your spending limit needs to be increased».
Значит, скан секретов в CI не выполняется.

## 6. Внешние сервисы в рантайме

| Сервис | Что уходит | Когда |
|---|---|---|
| Supabase (через `/sb`) | Вход, зашифрованный блоб, кладовая и дом (открыто), каталог, телеметрия с `uid`, ошибки, пуш-подписки | При аккаунте; телеметрия — по умолчанию включена |
| Anthropic | Тексты, фото еды и этикеток, бланки анализов (фото/PDF), фото тела, расшифровки голоса, контекст для тренера | При использовании ИИ: напрямую со своим ключом или через `api/ai.js` |
| Open Food Facts | Штрихкоды и текстовые поисковые запросы | Поиск и сканер |
| cdn.jsdelivr.net | Загрузка ZXing (без SRI) | Сканер на iPhone |
| Cloudflare R2 (через `/media`) | Запросы видео упражнений | Карточки упражнений |
| Web Push (сервисы браузеров) | Подписка и пуши с фиксированными текстами | При включённых напоминаниях |
| Распознавание речи браузера (Apple/Google) | Голос | Голосовой ввод |
| Магазины (Ozon, Лента и т.д.) | Ссылка поиска по названию | По тапу |

## 7. Разрешения и платформенные возможности (веб)

Камера (`getUserMedia` для сканера, `input type=file` для фото),
микрофон и `SpeechRecognition`, уведомления и Push API, Service Worker,
IndexedDB, WebCrypto, Wake Lock, вибрация, буфер обмена, Web Share.
`Permissions-Policy: camera=(self)`; CSP не задан.

## 8. Нативная платформа

Нативного проекта нет (ни `ios/`, ни `android/`, ни пакета Capacitor).
Есть только `capacitor.config.json`. Entitlements, Info.plist, bundle id в
Apple Developer, подписи, App Store Connect — отсутствуют.

## 9. Что этим снимком не покрыто

- Настройки Supabase Auth (шаблоны писем, SMTP, редиректы, лимиты), кроме
  того, что видно из триггера и советника.
- Регион Supabase.
- Значения лимитов в `ai_limits` и состав `ai_allow`.
- Настройки проекта Vercel вне `vercel.json` (домены, переменные — только
  имена из кода, без сверки с панелью).
- Содержимое R2-бакета и лицензия на видео.
- Аккаунт Apple Developer (не существует, по документам).

# GPT Review Index — «Без воды»

Публичная безопасная копия проекта для независимого анализа. Это не
презентация: здесь первоисточники как есть, включая технический долг,
противоречивые документы и проблемы безопасности. Что замаскировано и
исключено — [PUBLIC_COPY_NOTES.md](https://github.com/harddurant/bezvody-review/blob/main/PUBLIC_COPY_NOTES.md).

Все ссылки ниже открываются обычным веб-доступом. Для больших файлов даны
raw-ссылки и нарезка с номерами строк оригинала.

## Project

- Репозиторий: https://github.com/harddurant/bezvody-review
- [README.md](https://github.com/harddurant/bezvody-review/blob/main/README.md) — как проект описывает себя сам.
- [PROJECT_TREE.md](https://github.com/harddurant/bezvody-review/blob/main/PROJECT_TREE.md) — дерево файлов с размерами.
- [CLAUDE.md](https://github.com/harddurant/bezvody-review/blob/main/CLAUDE.md) — правила работы агента в репозитории, карта кода, рабочий цикл, решения владельца (51 КБ; показывает, как велась разработка).
- [PRINCIPLES.md](https://github.com/harddurant/bezvody-review/blob/main/PRINCIPLES.md) — «чего мы не делаем».
- [STRATEGY.md](https://github.com/harddurant/bezvody-review/blob/main/STRATEGY.md), [BUSINESS_PLAN.md](https://github.com/harddurant/bezvody-review/blob/main/BUSINESS_PLAN.md), [APPS.md](https://github.com/harddurant/bezvody-review/blob/main/APPS.md), [SBER_APPLY.md](https://github.com/harddurant/bezvody-review/blob/main/SBER_APPLY.md) — рынок, план выпуска, разбор конкурентов, заявка в акселератор (обновлялись редко: бизнес-план и стратегия — июль).

## Audit

- [AUDIT_2026-10.md](https://github.com/harddurant/bezvody-review/blob/main/AUDIT_2026-10.md) — аудит фактического состояния, 03.10.2026 (raw: https://raw.githubusercontent.com/harddurant/bezvody-review/main/AUDIT_2026-10.md).
- [PRODUCT_TEARDOWN.md](https://github.com/harddurant/bezvody-review/blob/main/PRODUCT_TEARDOWN.md) — продуктовый разбор поверх аудита, 03.10.2026: доказанное ядро, петли, лишнее, аудитория, минимум для App Store; в приложении — агрегаты реального использования (raw: https://raw.githubusercontent.com/harddurant/bezvody-review/main/PRODUCT_TEARDOWN.md).
- [VALIDATION_PLAN.md](https://github.com/harddurant/bezvody-review/blob/main/VALIDATION_PLAN.md) — план проверки гипотезы ядра на 10–20 внешних людях, 03.10.2026: кого ищем, сценарий по дням, метрики, пороги CONTINUE/ITERATE/PIVOT/STOP, интервью, что не делать (raw: https://raw.githubusercontent.com/harddurant/bezvody-review/main/VALIDATION_PLAN.md).
- [VALIDATION_PREFLIGHT.md](https://github.com/harddurant/bezvody-review/blob/main/VALIDATION_PREFLIGHT.md) — проверка перед набором участников, 03.10.2026: безопасность для участника, проход входа в Chromium, поправки R1–R11 к плану, вердикт GO (raw: https://raw.githubusercontent.com/harddurant/bezvody-review/main/VALIDATION_PREFLIGHT.md).
- [AUDIT_POINT_A.md](https://github.com/harddurant/bezvody-review/blob/main/AUDIT_POINT_A.md) — более ранний сквозной аудит интерфейса (v601, 14.09).
- [PROGRAM_AUDIT.md](https://github.com/harddurant/bezvody-review/blob/main/PROGRAM_AUDIT.md) — аудит генератора программ (§3 сокращён: личные данные).

## Architecture

- [ARCHITECTURE.md](https://github.com/harddurant/bezvody-review/blob/main/ARCHITECTURE.md) — схема данных и облака (последняя правка 14.07 — сверить с кодом).
- [TARGET_ARCHITECTURE.md](https://github.com/harddurant/bezvody-review/blob/main/TARGET_ARCHITECTURE.md) и [frontend-kit/](https://github.com/harddurant/bezvody-review/tree/main/frontend-kit) — целевая архитектура на TypeScript, нигде не подключена.
- [review-extracts/README.md](https://github.com/harddurant/bezvody-review/blob/main/review-extracts/README.md) — карта `index.html` по строкам и нарезка на 21 кусок.
- [review-extracts/FUNCTION_INDEX.md](https://github.com/harddurant/bezvody-review/blob/main/review-extracts/FUNCTION_INDEX.md) — 1183 функции и константы верхнего уровня с номерами строк.
- [NAVIGATION.md](https://github.com/harddurant/bezvody-review/blob/main/NAVIGATION.md) — матрица навигации PWA против HIG (14.09).
- [FOOD_BLOCK.md](https://github.com/harddurant/bezvody-review/blob/main/FOOD_BLOCK.md) — ранний замысел блока еды (14.07).

## Product / UX

- [SPEC.md](https://github.com/harddurant/bezvody-review/blob/main/SPEC.md) — реестр обещаний: что каждая функция обязана делать (132 КБ).
- [CRAFT.md](https://github.com/harddurant/bezvody-review/blob/main/CRAFT.md) — «как делаем»: кодекс UI, правила проверок, история решений по дизайну (194 КБ).
- [COUNCIL.md](https://github.com/harddurant/bezvody-review/blob/main/COUNCIL.md) — «совет ролей», кто что решает (72 КБ, последняя правка 27.08).
- [SCENARIOS.md](https://github.com/harddurant/bezvody-review/blob/main/SCENARIOS.md) — десять сценариев дня на «Еде».
- [screenshots/README.md](https://github.com/harddurant/bezvody-review/blob/main/screenshots/README.md) — 42 скриншота v679 на синтетических данных: первый запуск, знакомство, пустые состояния, еда, поиск, загрузка и ошибка поиска, тренировки, генератор программы, тело, здоровье, коуч, ИИ без ключа, настройки, подписка с ценами, вход.
- Скиллы-роли агента по вкладкам: [`.claude/skills/`](https://github.com/harddurant/bezvody-review/tree/main/.claude/skills).

## Database

- [supabase/schema_reference.sql](https://github.com/harddurant/bezvody-review/blob/main/supabase/schema_reference.sql) — слепок схемы в git (отстал от прода).
- Миграции в git: [20260720](https://github.com/harddurant/bezvody-review/blob/main/supabase/migrations_applied_20260720.sql), [20260725](https://github.com/harddurant/bezvody-review/blob/main/supabase/migrations_applied_20260725.sql), [20260906](https://github.com/harddurant/bezvody-review/blob/main/supabase/migrations_applied_20260906.sql), [metrics.sql](https://github.com/harddurant/bezvody-review/blob/main/supabase/metrics.sql), [supabase/README.md](https://github.com/harddurant/bezvody-review/blob/main/supabase/README.md).
- [production-snapshot/PRODUCTION_REPORT.md](https://github.com/harddurant/bezvody-review/blob/main/production-snapshot/PRODUCTION_REPORT.md) — что реально стоит в production-базе: таблицы, RLS, политики, права, триггеры, cron, расширения, советник безопасности, метрики.
- [production-snapshot/supabase_live_functions.sql](https://github.com/harddurant/bezvody-review/blob/main/production-snapshot/supabase_live_functions.sql) — живые тексты всех 40 функций (27 из них в git нет).
- [database.types.ts](https://github.com/harddurant/bezvody-review/blob/main/database.types.ts) — типы для неподключённого `frontend-kit`.

## Tests

- [tests/](https://github.com/harddurant/bezvody-review/tree/main/tests): `smoke.js` (гейт, 14 411 строк — нарезка в [review-extracts/smoke_js](https://github.com/harddurant/bezvody-review/tree/main/review-extracts/smoke_js)), `field.js`, `kitchen.js`, `matrix.js` + `matrix.baseline.json`, `build.js` (входят в деплой-гейт); `browser.js`, `dirty.js`, `audit.js` (настоящий Chromium, вне гейта); `live.js` (прогон по живому аккаунту владельца, нужны его доступы).
- [tools/screenshots_synthetic.js](https://github.com/harddurant/bezvody-review/blob/main/tools/screenshots_synthetic.js) — скрипт, которым сняты скриншоты.

## CI

- [.github/workflows/security.yml](https://github.com/harddurant/bezvody-review/blob/main/.github/workflows/security.yml) — gitleaks, гейт, Chromium на каждый пуш.
- [.github/workflows/skills.yml](https://github.com/harddurant/bezvody-review/blob/main/.github/workflows/skills.yml) — сканер скиллов агента.
- [.pre-commit-config.yaml](https://github.com/harddurant/bezvody-review/blob/main/.pre-commit-config.yaml), [.gitleaks.toml](https://github.com/harddurant/bezvody-review/blob/main/.gitleaks.toml).
- Факт состояния CI — в [PRODUCTION_REPORT.md §5](https://github.com/harddurant/bezvody-review/blob/main/production-snapshot/PRODUCTION_REPORT.md).

## Deployment

- [vercel.json](https://github.com/harddurant/bezvody-review/blob/main/vercel.json) — buildCommand = тест-гейт, прокси `/sb` и `/media`, заголовки.
- [tests/build.js](https://github.com/harddurant/bezvody-review/blob/main/tests/build.js) — что попадает в `dist/` (то есть на прод-домен).
- [sw.js](https://github.com/harddurant/bezvody-review/blob/main/sw.js) — service worker. [manifest.json](https://github.com/harddurant/bezvody-review/blob/main/manifest.json). [package.json](https://github.com/harddurant/bezvody-review/blob/main/package.json).
- [scripts/ship.js](https://github.com/harddurant/bezvody-review/blob/main/scripts/ship.js), [scripts/sync.js](https://github.com/harddurant/bezvody-review/blob/main/scripts/sync.js) — локальная отправка и синхронизация.
- [api/](https://github.com/harddurant/bezvody-review/tree/main/api) — четыре serverless-функции Vercel.
- [SETUP.md](https://github.com/harddurant/bezvody-review/blob/main/SETUP.md), [HANDOFF.md](https://github.com/harddurant/bezvody-review/blob/main/HANDOFF.md), [SECURITY.md](https://github.com/harddurant/bezvody-review/blob/main/SECURITY.md), [.env.example](https://github.com/harddurant/bezvody-review/blob/main/.env.example) — настройка окружения (без значений).

## Legal / App Store

- [promo/privacy.html](https://github.com/harddurant/bezvody-review/blob/main/promo/privacy.html), [promo/terms.html](https://github.com/harddurant/bezvody-review/blob/main/promo/terms.html), [promo/offer.html](https://github.com/harddurant/bezvody-review/blob/main/promo/offer.html) — политика данных, условия, черновик оферты (опубликованы на прод-домене).
- [capacitor.config.json](https://github.com/harddurant/bezvody-review/blob/main/capacitor.config.json) — единственный артефакт нативной сборки.
- [promo/](https://github.com/harddurant/bezvody-review/tree/main/promo) — лендинг и материалы.
- App Store-специфичных материалов (метаданные, скриншоты стора, Privacy Manifest, Info.plist) в проекте нет.

## Important source files

- [`index.html`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/index.html) — всё клиентское приложение (3 МБ, raw). Читать удобнее нарезкой: [review-extracts/index_html](https://github.com/harddurant/bezvody-review/tree/main/review-extracts/index_html).
- [`api/ai.js`](https://github.com/harddurant/bezvody-review/blob/main/api/ai.js) — прокси к Anthropic.
- [`api/steps.js`](https://github.com/harddurant/bezvody-review/blob/main/api/steps.js), [`api/push-send.js`](https://github.com/harddurant/bezvody-review/blob/main/api/push-send.js), [`api/push-key.js`](https://github.com/harddurant/bezvody-review/blob/main/api/push-key.js).
- [`sw.js`](https://github.com/harddurant/bezvody-review/blob/main/sw.js), [`vercel.json`](https://github.com/harddurant/bezvody-review/blob/main/vercel.json), [`tests/build.js`](https://github.com/harddurant/bezvody-review/blob/main/tests/build.js).
- [`tests/smoke.js`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/tests/smoke.js) — гейт деплоя.
- [`server/`](https://github.com/harddurant/bezvody-review/tree/main/server) — скрипты, которые не относятся к приложению, но попадают в сборку.

## Known sensitive areas — первоисточники для самостоятельной проверки

1. **VPN-скрипты в production-сборке.** [tests/build.js](https://github.com/harddurant/bezvody-review/blob/main/tests/build.js) (копирование `server/*.sh` в `dist/`); [server/vpn.sh](https://github.com/harddurant/bezvody-review/blob/main/server/vpn.sh), [server/vpn443.sh](https://github.com/harddurant/bezvody-review/blob/main/server/vpn443.sh), [server/vpnws.sh](https://github.com/harddurant/bezvody-review/blob/main/server/vpnws.sh), [server/vpnadd.sh](https://github.com/harddurant/bezvody-review/blob/main/server/vpnadd.sh), [server/setup.sh](https://github.com/harddurant/bezvody-review/blob/main/server/setup.sh); вызов `rpc/ai_job_put` в них и функция [`ai_job_get`](https://github.com/harddurant/bezvody-review/blob/main/production-snapshot/supabase_live_functions.sql).
2. **Email в публичном `index.html`.** [`index.html:4973`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L04501-06000.txt), [`index.html:4987`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L04501-06000.txt), [`index.html:20111`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L19501-21000.txt) — в копии замаскирован, на прод-домене в исходнике страницы присутствует.
3. **Anthropic proxy.** [api/ai.js](https://github.com/harddurant/bezvody-review/blob/main/api/ai.js) целиком; клиент: [`index.html:12171`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt) (прямой вызов со своим ключом), [`index.html:12270`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt) `aiFetch`, [`index.html:12329`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt) `aiErrText`, [`index.html:26634`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L25501-27000.txt) `aiAskJson`; функции квот `ai_bump_v3`, `ai_plan`, `ai_spend` в [supabase_live_functions.sql](https://github.com/harddurant/bezvody-review/blob/main/production-snapshot/supabase_live_functions.sql).
4. **Вход и возможная передача пароля.** [`index.html:13314`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt) `LEGACY_LOGIN`, [`index.html:13322`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt) (вывод ключей), [`index.html:13337`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt) `sbLogin`; хранение `S` с паролем и ключом данных — объект настроек и галочка «запомнить» рядом со строкой [`index.html:4163`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L03001-04500.txt).
5. **ИИ-функции.** Чат тренера [`index.html:29403`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L28501-30000.txt) `coachCtx`, [`index.html:29592`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L28501-30000.txt) `COACH_TOOLS`, [`index.html:29806`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L28501-30000.txt) `askCoach`; голос [`index.html:12571`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt) `voiceAny`; скан еды [`index.html:19313`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L18001-19500.txt) `doScan`; оценка по названию [`index.html:19091`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L18001-19500.txt) `fdEstimate`; бланк анализов [`index.html:27088`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L27001-28500.txt).
6. **Onboarding.** Ворота [`index.html:2742`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L01501-03000.txt); вопросы [`index.html:28518`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L28501-30000.txt) `ONBQ`; применение [`index.html:28633`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L28501-30000.txt) `onbApply`; вход из локальной ветки [`index.html:28707`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L28501-30000.txt); запуск приложения — конец файла около [`index.html:30880`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L30001-31007.txt).
7. **Тест-гейт, сравнивающий текст исходника.** [`tests/smoke.js:34`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/smoke_js/smoke_js_L00001-02000.txt) (гейт читает `NEXT.md`), [`tests/smoke.js:296`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/smoke_js/smoke_js_L00001-02000.txt), [`tests/smoke.js:1113`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/smoke_js/smoke_js_L00001-02000.txt), [`tests/smoke.js:13021`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/smoke_js/smoke_js_L12001-14000.txt); примеры охраны функций, которые нигде не вызываются: `exHistHTML` ([`index.html:20851`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L19501-21000.txt)), `altWarn` ([`index.html:22303`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L21001-22500.txt)), `readyAsk` ([`index.html:22599`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L22501-24000.txt)).
8. **Структура frontend-файла.** [review-extracts/README.md](https://github.com/harddurant/bezvody-review/blob/main/review-extracts/README.md) (карта по строкам), [FUNCTION_INDEX.md](https://github.com/harddurant/bezvody-review/blob/main/review-extracts/FUNCTION_INDEX.md); хранилище [`index.html:4648`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L04501-06000.txt) (IndexedDB), [`index.html:4710`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L04501-06000.txt) `put`; навигация [`index.html:5161`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L04501-06000.txt) `NAV`; простой режим [`index.html:20713`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L19501-21000.txt) `uiMode`.
9. **Production / deployment configuration.** [vercel.json](https://github.com/harddurant/bezvody-review/blob/main/vercel.json), [sw.js](https://github.com/harddurant/bezvody-review/blob/main/sw.js), [tests/build.js](https://github.com/harddurant/bezvody-review/blob/main/tests/build.js), [manifest.json](https://github.com/harddurant/bezvody-review/blob/main/manifest.json), [PRODUCTION_REPORT.md](https://github.com/harddurant/bezvody-review/blob/main/production-snapshot/PRODUCTION_REPORT.md); клиентские адреса [`index.html:12816`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt) `SB_URL`, [`index.html:12829`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt) `isProd`; сканер с CDN [`index.html:11249`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L10501-12000.txt).
10. **App Store blockers.** [capacitor.config.json](https://github.com/harddurant/bezvody-review/blob/main/capacitor.config.json); относительные пути [`index.html:12816`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt); мост HealthKit [`index.html:17385`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L16501-18000.txt); подписка и цены [`index.html:29894`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L28501-30000.txt) `SALES_ON`; категории AAS/ПКТ [`index.html:3936`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L03001-04500.txt), [`index.html:12049`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt), тексты [`index.html:3447`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L03001-04500.txt); общий каталог с пользовательскими записями — политики `products_insert` в [PRODUCTION_REPORT.md](https://github.com/harddurant/bezvody-review/blob/main/production-snapshot/PRODUCTION_REPORT.md); удаление аккаунта [`account_delete`](https://github.com/harddurant/bezvody-review/blob/main/production-snapshot/supabase_live_functions.sql).
11. **Privacy / data policy.** [promo/privacy.html](https://github.com/harddurant/bezvody-review/blob/main/promo/privacy.html), [promo/terms.html](https://github.com/harddurant/bezvody-review/blob/main/promo/terms.html), [PRINCIPLES.md](https://github.com/harddurant/bezvody-review/blob/main/PRINCIPLES.md) против кода: телеметрия [`index.html:13029`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt) `trk`, журнал ошибок [`index.html:12832`](https://raw.githubusercontent.com/harddurant/bezvody-review/main/review-extracts/index_html/index_html_L12001-13500.txt) `reportErr`, витрина [supabase/metrics.sql](https://github.com/harddurant/bezvody-review/blob/main/supabase/metrics.sql), таблицы в открытом виде в [PRODUCTION_REPORT.md](https://github.com/harddurant/bezvody-review/blob/main/production-snapshot/PRODUCTION_REPORT.md).
12. **Server functions, которых нет в репозитории.** [production-snapshot/supabase_live_functions.sql](https://github.com/harddurant/bezvody-review/blob/main/production-snapshot/supabase_live_functions.sql) (список 27 отсутствующих — в [PRODUCTION_REPORT.md](https://github.com/harddurant/bezvody-review/blob/main/production-snapshot/PRODUCTION_REPORT.md)); триггер автоподтверждения почты; задания cron.

## History

- [GIT_HISTORY_SUMMARY.md](https://github.com/harddurant/bezvody-review/blob/main/GIT_HISTORY_SUMMARY.md) — сводка решений и переделок.
- [history/COMMIT_LOG.txt](https://raw.githubusercontent.com/harddurant/bezvody-review/main/history/COMMIT_LOG.txt) — все 1120 сообщений коммитов с телами (raw, 1,3 МБ).
- [history/index_html_size_by_commit.txt](https://raw.githubusercontent.com/harddurant/bezvody-review/main/history/index_html_size_by_commit.txt), [history/commits_per_day.txt](https://raw.githubusercontent.com/harddurant/bezvody-review/main/history/commits_per_day.txt).
- [history/NEXT_STRUCTURE.md](https://github.com/harddurant/bezvody-review/blob/main/history/NEXT_STRUCTURE.md) — устройство исключённого `NEXT.md`.

## Files intentionally excluded

- `NEXT.md` — личные данные (заменён структурой и журналом коммитов).
- `.claude/skills/gym-coach/GYM.md` — личные данные владельца.
- `full-library-metadata/` — лицензионные метаданные MoveKit.
- 14 сторонних скиллов агента (`apple-hig`, `impeccable`, `heroui-native` и др.) — чужие материалы.
- `.secrets.baseline`, git-история.
- Любые `.env*` (кроме шаблона), ключи и секреты, данные production-базы — в репозитории их не было и нет.

Подробно — [PUBLIC_COPY_NOTES.md](https://github.com/harddurant/bezvody-review/blob/main/PUBLIC_COPY_NOTES.md).

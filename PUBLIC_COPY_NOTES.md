# Что в этой копии отличается от приватного репозитория

Копия снята с коммита `d8b0741` приватного репозитория `harddurant/bezvody`
(ветка `claude/work-session-qxxnxa`; код приложения совпадает с продом v679,
`f183129`). Собрана одним коммитом **без git-истории**: история содержит
личные данные. Структура каталогов сохранена.

## Замаскировано (замена строки, длина файла и номера строк не менялись)

| Что | На что заменено | Где было |
|---|---|---|
| Личная почта владельца (Gmail) | `[email владельца удалён в публичной копии]` | 3 комментария в `index.html` (строки 4973, 4987, 20111), 1 в `tests/smoke.js`, 1 в журнале коммитов. **В проде строки с почтой живы:** их видно в исходнике страницы прод-сайта |
| Публичный ключ Supabase (`sb_publishable_…`) | `sb_publishable_REDACTED` | `index.html`, `api/ai.js`, `api/steps.js`, `promo/about.html`, `server/*.sh`, `SETUP.md`, `frontend-kit/README.md`. Ключ публичный по замыслу (отдаётся браузеру в проде), замаскирован из осторожности |
| Идентификатор проекта Supabase | `SUPABASE_PROJECT_REF` | `vercel.json`, `api/*.js`, `server/*.sh`, документы |
| Адрес публичного R2-бакета | `R2_PUBLIC_BUCKET.r2.dev` | `vercel.json` |
| ФИО владельца (оператор данных в правовых документах) | `[ФИО владельца-оператора]`, `[фамилия владельца]` | `promo/privacy.html`, `promo/terms.html`, `promo/offer.html`, `tests/smoke.js` |
| Упоминания жены владельца как второго бета-тестера | «вторая участница беты» | `index.html`, `tests/smoke.js`, `CRAFT.md`, журнал коммитов |
| IP VPN-сервера | `SERVER_IP_REDACTED` | `server/setup.sh` |
| Фиксированный id записи `ai_jobs`, через которую VPN-скрипт передавал ссылку | `FIXED_JOB_UUID_REDACTED` | `server/vpn.sh`, `vpn443.sh`, `vpnws.sh`, `vpnadd.sh` |
| Имя и возраст в черновике промо-поста | `[имя]`, `[возраст]` | `promo/posts.md` |
| Возраст, вес, рост, режим и рабочие веса владельца | пометка «удалены» | `.claude/skills/gym-coach/SKILL.md` |
| Раздел «Твои восемь недель» (реальные тренировки владельца из живой базы) | краткий вывод без цифр | `PROGRAM_AUDIT.md` §3 |

## Исключено целиком

| Файл или каталог | Почему |
|---|---|
| `NEXT.md` (1,25 МБ) | Рабочая доска с личными данными владельца и второй участницы беты (результаты анализов, веса, личные дела). Вместо него: `history/NEXT_STRUCTURE.md` (заголовки разделов и объём) и `history/COMMIT_LOG.txt` (журнал коммитов) |
| `.claude/skills/gym-coach/GYM.md` | Факты о зале и теле владельца |
| `full-library-metadata/` (1,8 МБ) | Метаданные купленной библиотеки упражнений MoveKit (лицензионный контент). Те же описания уже вшиты в `index.html` |
| `.claude/skills/` сторонние: `animate`, `animation-vocabulary`, `apple-design`, `apple-hig`, `emil-design-eng`, `find-animation-opportunities`, `heroui-native`, `impeccable`, `improve-animations`, `mobile-app-ui-design`, `prototype`, `review-animations`, `taste-frontend`, `taste-redesign` | Чужие материалы, лицензия на переопубликование не проверялась. Свои скиллы проекта оставлены |
| `.secrets.baseline` | Служебный файл detect-secrets с хешами |
| git-история | Личные данные в старых версиях файлов |

## Не входит в репозиторий вообще (и не входило)

`.env.local` и любые `.env*`, кроме шаблона `.env.example`; ключи и
секреты (Anthropic, `service_role`, VAPID, `PUSH_CRON_SECRET`, токены
Vercel и GitHub); содержимое production-базы и её бэкапы; данные
пользователей; видеофайлы упражнений (лежат в R2).

## Что известно о поведении гейта в этой копии

`node tests/smoke.js` в копии падает на **одном** правиле (v622): оно
требует, чтобы слово `WKAppBoundDomains` было записано в `NEXT.md`, а
`NEXT.md` здесь исключён. Остальные проверки (`field`, `kitchen`,
`matrix`, `build`) проходят. В приватном репозитории весь гейт зелёный.

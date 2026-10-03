# Bezvody — архитектура базы (решения «на берегу»)

Зафиксированные решения:
- **Телефон:** PWA — веб-приложение, устанавливается на домашний экран, работает офлайн. Текущий стек Vercel + web, без сторов.
- **Личные данные:** гибрид — дневник/профиль/вес/тренировки в обычных таблицах под RLS; отдельный E2EE-`vault` остаётся только для чувствительных заметок.
- **Каталог продуктов:** общий, с разделением «официальное / пользовательское» и флагом `verified`.

---

## Как три требования ложатся на схему

**1. Запуск на телефоне (PWA).** Добавить `manifest.webmanifest` + service worker (или PWA-плагин фреймворка). Пользователь открывает сайт → «Добавить на экран» → иконка как у приложения, офлайн-кэш. Делается на фронте, схемы БД не касается.

**2. История под профилем.** Каждая личная таблица содержит `user_id` и защищена RLS-политикой `user_id = auth.uid()` — пользователь видит и меняет только своё. Профиль (цели КБЖУ, настройки) — таблица `profiles` 1:1 с `auth.users`.

**3. Общий каталог («Биг Тейсти»).** Отдельная таблица `products`, читаемая всеми авторизованными. Поток:
- Пользователь A вводит «Биг Тейсти», в каталоге нет → добавляет КБЖУ и порцию. Строка: `source='community'`, `verified=false`, `created_by=A`.
- Пользователь B пишет «биг тейсти» → поиск по нормализованному имени (триграммы, регистронезависимо) находит запись A → подтягиваются КБЖУ и порция, B просто логирует.
- Записи с `verified=true` / `source='official'` показываются в поиске выше пользовательских.

**Историчность:** запись дневника хранит **снимок** КБЖУ (`product_name`, `kcal`, `protein`…), а не только ссылку. Если кто-то позже отредактирует продукт в каталоге — прошлые приёмы пищи не поменяются.

**Приватность каталога:** `created_by` нужен для модерации, но клиенту отдаётся через view `products_public` без этого поля — кто что ел, из общего каталога не видно.

---

## Миграция (Postgres / Supabase)

Строго аддитивная — существующий `vault` не трогает.

```sql
create extension if not exists pg_trgm;

-- Профиль: 1:1 с auth.users
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  goal_kcal    numeric,
  goal_protein numeric,
  goal_fat     numeric,
  goal_carb    numeric,
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_read"   on public.profiles for select using (id = auth.uid());
create policy "profiles_insert" on public.profiles for insert with check (id = auth.uid());
create policy "profiles_update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Общий каталог продуктов
create table public.products (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  brand             text,
  name_normalized   text generated always as (lower(trim(name))) stored,
  kcal_per_100g     numeric not null,
  protein_per_100g  numeric not null default 0,
  fat_per_100g      numeric not null default 0,
  carb_per_100g     numeric not null default 0,
  default_serving_g numeric,          -- напр. Биг Тейсти ~340 г; null для продуктов «на 100 г»
  serving_label     text,             -- «1 бургер», «1 порция»
  source            text not null default 'community' check (source in ('official','community')),
  verified          boolean not null default false,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index products_name_trgm on public.products using gin (name_normalized gin_trgm_ops);
create unique index products_dedup on public.products (name_normalized, coalesce(brand,''));
alter table public.products enable row level security;
create policy "products_read"   on public.products for select to authenticated using (true);
create policy "products_insert" on public.products for insert to authenticated
  with check (created_by = auth.uid() and source = 'community' and verified = false);
create policy "products_update" on public.products for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid() and source = 'community' and verified = false);

-- Публичное представление каталога без created_by (не раскрываем автора)
create view public.products_public
  with (security_invoker = on) as
  select id, name, brand, kcal_per_100g, protein_per_100g, fat_per_100g, carb_per_100g,
         default_serving_g, serving_label, source, verified
  from public.products;

-- Дневник питания (личный, со снимком КБЖУ)
create table public.diary_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date   date not null default current_date,
  meal         text,
  product_id   uuid references public.products(id) on delete set null,
  product_name text not null,          -- снимок имени
  grams        numeric not null,
  kcal         numeric not null,       -- снимок, пересчитан на grams
  protein      numeric not null default 0,
  fat          numeric not null default 0,
  carb         numeric not null default 0,
  created_at   timestamptz not null default now()
);
create index diary_user_date on public.diary_entries (user_id, entry_date);
alter table public.diary_entries enable row level security;
create policy "diary_all" on public.diary_entries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Вес и замеры (личное). Тренировки/сон добавляются по этому же паттерну.
create table public.body_metrics (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  metric_date  date not null default current_date,
  weight_kg    numeric,
  measurements jsonb,
  created_at   timestamptz not null default now()
);
alter table public.body_metrics enable row level security;
create policy "body_all" on public.body_metrics for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

---

## Что важно не забыть

- **Подтверждение email.** Сейчас включён авто-конфирм (миграция `auto_confirm_emails`). Перед продом верните подтверждение — иначе фейковые аккаунты будут засорять общий каталог.
- **Верификация продуктов** (`verified=true`, `source='official'`) выдаётся не самим пользователем, а привилегированным путём (админ-скрипт / edge function с service_role). Обычная RLS-политика это уже запрещает.
- **Тренировки и сон** сейчас лежат в зашифрованном `vault`. При переносе на реляционную модель — тот же паттерн, что у `diary_entries`/`body_metrics` (RLS по `user_id`).
- **Снимок КБЖУ в дневнике** — не заменяйте ссылкой на продукт «вживую», иначе редактирование каталога перепишет историю.

---

## Позиционирование и объём старта

**Пользователь.** Продукт целенаправленно goal-agnostic — масса, похудение, рекомпозиция, профи обслуживаются одним ядром. Это нормально. Но «для всех» опасно как способ ВЫХОДА на рынок: без плацдарма нет первых пользователей и обратной связи. Плацдарм для запуска — ближний круг (ты + знакомые), на нём обкатываем, дальше расширяем.

**Стратегический фокус — питание.** Тренировка — 1.5 ч, 5 раз в неделю; еда — каждый день. Ежедневная поверхность = где живут привычка, удержание и отличие. Поэтому глубина идёт в питание (подбор, корректность, следование плану), тренировки — вторичны.

**Профи vs новичок в одном UI** — решается прогрессивным раскрытием: по умолчанию просто (быстрый ввод, подсказки), глубина (граммовка, микроэлементы, дни-типы) — по запросу. Схема данных должна поддерживать оба режима.

**Объём старта (решение):** база данных (сделано) + минимум для ежедневного цикла питания — дневник, каталог, быстрый повтор порции. Остальное добавляем по мере опыта и ОС, не строим спекулятивно.

### Добавлено сейчас и почему

К `products` добавлены `category` (text) и `tags` (text[]) — единственное, что дорого доставлять задним числом: продукты создаются пользователями с первого дня, и без категории на момент ввода они останутся без неё навсегда. **Форма добавления продукта должна собирать категорию** (хотя бы выпадающим списком) — это substrate для будущего ИИ-подбора и «советника альтернатив».

### Отложено (добавим, когда фича созреет — всё аддитивно и дёшево)

- `dishes` / `dish_items` — сохранённые комбинации блюд (уже есть в vault).
- `nutrition_plans` + дни-типы (тренировочный/отдых) — под «план тренера».
- роль «тренер» и назначение планов пользователям.
- тренировки реляционно (история подходов с RPE) — под авторегуляцию.
- ИИ-режим — edge function; качество каталога важнее кода, поэтому модерация (`verified`, `official/community`) заложена сразу.

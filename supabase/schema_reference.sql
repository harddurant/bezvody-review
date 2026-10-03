-- =====================================================================
-- Bezvody — снимок схемы БД (справочный, воспроизводит текущее состояние)
-- Источник правды — история миграций в Supabase. Канонично обновляется
-- командой `supabase db pull`. Этот файл — читаемый снимок для ревью в git.
-- Данные-сиды (продукты, рецепты) сюда НЕ входят — это только схема.
--
-- !!! ДРЕЙФ: этот снимок отражает состояние ДО household-фичи и части сервиса.
-- В проде ЕСТЬ, но здесь ещё НЕ отражены (см. историю миграций Supabase / `db pull`):
--   • households / household_members / household_invites + RPC household_*   (20260714203928, 20260714204009)
--       → таблицы pantry_items / shopping_lists получили колонку household_id,
--         а их RLS-политики стали household-aware (см. migrations_applied_20260720.sql)
--   • ai_allow / ai_usage + RPC ai_allowed()/ai_bump()  (закрытая бета ИИ, прочные лимиты)
--   • client_errors  (телеметрия ошибок клиента, anon-insert с лимитами длины)
--   • steps_inbox    (тихий приёмник шагов из iOS-команды по коду k; anon insert/select)
--   • products.barcode  (20260714201915)
-- Применённый 2026-07-20 хардеринг (перф RLS household, покрывающие индексы FK,
-- revoke execute у anon/public на приватные RPC, лимиты client_errors) —
-- в supabase/migrations_applied_20260720.sql. Проверено get_advisors.
-- =====================================================================

create extension if not exists pg_trgm;

-- =====================================================================
-- BASELINE (исходное, E2EE-хранилище — до серверной работы)
-- =====================================================================
create table if not exists public.vaults (
  user_id    uuid primary key,
  version    bigint not null default 1,
  blob       text not null,
  size_bytes integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.vaults enable row level security;
create policy vault_select on public.vaults for select using (auth.uid() = user_id);
create policy vault_insert on public.vaults for insert with check (auth.uid() = user_id);
create policy vault_update on public.vaults for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy vault_delete on public.vaults for delete using (auth.uid() = user_id);

-- Оптимистическая блокировка версии при записи зашифрованного блоба
create or replace function public.push_vault(p_blob text, p_expected bigint)
returns bigint language plpgsql set search_path to 'public'
as $function$
declare v bigint;
begin
  insert into public.vaults (user_id, version, blob, size_bytes, updated_at)
  values (auth.uid(), 1, p_blob, length(p_blob), now())
  on conflict (user_id) do update
     set blob=excluded.blob, size_bytes=excluded.size_bytes,
         version=public.vaults.version+1, updated_at=now()
   where public.vaults.version = p_expected
  returning version into v;
  if v is null then return -1; end if;   -- конфликт версий
  return v;
end $function$;

-- ВНИМАНИЕ: авто-подтверждение почты — dev-конвенция и дыра (фейки).
-- Удаляется в Фазе A хардеринга. Оставлено здесь для полноты снимка.
create or replace function public.auto_confirm_email()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.email_confirmed_at is null then new.email_confirmed_at := now(); end if;
  return new;
end $function$;
create trigger auto_confirm_email_trg before insert on auth.users
  for each row execute function public.auto_confirm_email();

-- =====================================================================
-- ЛИЧНЫЕ ДАННЫЕ (под RLS: user_id = auth.uid())
-- =====================================================================
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  goal_kcal numeric, goal_protein numeric, goal_fat numeric, goal_carb numeric,
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_read   on public.profiles for select using (id = auth.uid());
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create table public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  meal text,
  product_id uuid,               -- ссылка на products (null для рецептов/произвольного)
  product_name text not null,    -- СНИМОК имени
  grams numeric not null,
  kcal numeric not null, protein numeric not null default 0,
  fat numeric not null default 0, carb numeric not null default 0,
  created_at timestamptz not null default now()
);
create index diary_user_date on public.diary_entries (user_id, entry_date);
alter table public.diary_entries enable row level security;
create policy diary_all on public.diary_entries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  metric_date date not null default current_date,
  weight_kg numeric, measurements jsonb,
  created_at timestamptz not null default now()
);
alter table public.body_metrics enable row level security;
create policy body_all on public.body_metrics for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =====================================================================
-- ОБЩИЙ КАТАЛОГ (читаемо всеми authenticated; пишут community/unverified)
-- =====================================================================
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null, brand text,
  name_normalized text generated always as (lower(trim(name))) stored,
  kcal_per_100g numeric not null,
  protein_per_100g numeric not null default 0,
  fat_per_100g numeric not null default 0,
  carb_per_100g numeric not null default 0,
  default_serving_g numeric, serving_label text,
  category text, tags text[] not null default '{}',
  source text not null default 'community' check (source in ('official','community')),
  verified boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_name_trgm on public.products using gin (name_normalized gin_trgm_ops);
create unique index products_dedup on public.products (name_normalized, coalesce(brand,''));
create index products_category on public.products (category);
create index products_tags on public.products using gin (tags);
alter table public.products enable row level security;
create policy products_read   on public.products for select to authenticated using (true);
create policy products_insert on public.products for insert to authenticated
  with check (created_by = auth.uid() and source='community' and verified=false);
create policy products_update on public.products for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid() and source='community' and verified=false);
-- Хардеринг: created_by скрыт от чтения клиентом
revoke select on public.products from anon, authenticated;
grant select (id,name,brand,name_normalized,category,tags,kcal_per_100g,protein_per_100g,
  fat_per_100g,carb_per_100g,default_serving_g,serving_label,source,verified,created_at,updated_at)
  on public.products to authenticated;

create table public.product_packages (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  label text not null, amount_g numeric not null, price numeric,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index product_packages_product on public.product_packages (product_id);
alter table public.product_packages enable row level security;
create policy packages_read on public.product_packages for select to authenticated using (true);

-- Публичное представление каталога без created_by
create view public.products_public with (security_invoker = on) as
  select id, name, brand, category, tags,
         kcal_per_100g, protein_per_100g, fat_per_100g, carb_per_100g,
         default_serving_g, serving_label, source, verified
  from public.products;

-- =====================================================================
-- РЕЦЕПТЫ
-- =====================================================================
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null, instructions text,
  servings numeric not null default 1,
  needs_cooking boolean not null default true,
  equipment text[] not null default '{}',
  prep_minutes integer, category text, tags text[] not null default '{}',
  source text not null default 'community' check (source in ('official','community')),
  verified boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_name_trgm on public.recipes using gin ((lower(name)) gin_trgm_ops);
alter table public.recipes enable row level security;
create policy recipes_read   on public.recipes for select to authenticated using (true);
create policy recipes_insert on public.recipes for insert to authenticated
  with check (created_by = auth.uid() and source='community' and verified=false);
create policy recipes_update on public.recipes for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid() and source='community' and verified=false);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  product_id uuid references public.products(id) on delete restrict,
  grams numeric not null, note text, sort_order integer not null default 0
);
create index recipe_ingredients_recipe on public.recipe_ingredients (recipe_id);
alter table public.recipe_ingredients enable row level security;
create policy recipe_ing_read on public.recipe_ingredients for select to authenticated using (true);
create policy recipe_ing_write on public.recipe_ingredients for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.created_by = auth.uid()))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.created_by = auth.uid()));

-- КБЖУ рецепта вживую из ингредиентов (ИТОГ на весь рецепт; на порцию делить на servings)
create view public.recipe_macros with (security_invoker = on) as
  select r.id as recipe_id,
         round(sum(ri.grams*p.kcal_per_100g/100.0),1)    as kcal,
         round(sum(ri.grams*p.protein_per_100g/100.0),1) as protein,
         round(sum(ri.grams*p.fat_per_100g/100.0),1)     as fat,
         round(sum(ri.grams*p.carb_per_100g/100.0),1)    as carb,
         sum(ri.grams) as total_grams
  from public.recipes r
  join public.recipe_ingredients ri on ri.recipe_id = r.id
  join public.products p on p.id = ri.product_id
  group by r.id;

-- =====================================================================
-- ФАЗА 2: кладовая и закупки (под RLS)
-- =====================================================================
create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  note text, created_at timestamptz not null default now(),
  unique (user_id, product_id)
);
alter table public.pantry_items enable row level security;
create policy pantry_all on public.pantry_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text, period_start date, period_end date,
  created_at timestamptz not null default now()
);
alter table public.shopping_lists enable row level security;
create policy lists_all on public.shopping_lists for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  needed_g numeric not null,
  package_id uuid references public.product_packages(id) on delete set null,
  packages_qty numeric, checked boolean not null default false,
  created_at timestamptz not null default now()
);
create index shopping_list_items_list on public.shopping_list_items (list_id);
alter table public.shopping_list_items enable row level security;
create policy sli_all on public.shopping_list_items for all to authenticated
  using (exists (select 1 from public.shopping_lists l where l.id = list_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.shopping_lists l where l.id = list_id and l.user_id = auth.uid()));

-- =====================================================================
-- МЕТРИКА КАЧЕСТВА (нейтральная, без ярлыка «плохое»)
-- =====================================================================
create view public.product_quality with (security_invoker = on) as
  select p.id, p.name, p.category,
         p.kcal_per_100g as energy_density,
         round(p.protein_per_100g / nullif(p.kcal_per_100g,0) * 100, 1) as protein_per_100kcal,
         ('discretionary' = any(p.tags)) as is_discretionary,
         case when 'discretionary' = any(p.tags) then 'дискреционный'
              when p.protein_per_100g / nullif(p.kcal_per_100g,0) * 100 >= 10 then 'белково-плотный'
              when p.kcal_per_100g >= 350 then 'калорийно-плотный'
              else 'сбалансированный' end as quality_label
  from public.products p;
grant select on public.product_quality to authenticated;

-- =====================================================================
-- RPC (все security invoker, search_path закреплён, execute только authenticated)
-- Тела функций — см. историю миграций Supabase / db pull. Здесь перечень:
--   suggest_recipes(target_kcal, target_protein, can_cook, tolerance, max_results)
--   suggest_day(target_kcal, target_protein, can_cook, meals, tolerance)
--   generate_shopping_list(p_plan jsonb)
--   suggest_alternatives(p_product_id, max_results)
--   log_recipe(p_recipe_id, p_servings, p_meal, p_date)
--   calculate_targets(weight_kg, height_cm, age, sex, activity, goal)
--   search_products_fuzzy(q, max_results)
-- Полные определения актуальны в БД; для точной копии используйте `supabase db pull`.

-- Живые определения функций схемы public из production Supabase,
-- снятые 03.10.2026 запросом pg_get_functiondef (только чтение).
-- Это то, что реально выполняется в базе. В git (supabase/*.sql) тел 27 из
-- этих функций нет совсем — они менялись в SQL-редакторе мимо репозитория.
-- Секретов в определениях нет. Расширения (pg_trgm, pgcrypto и т.д.) не включены.

CREATE OR REPLACE FUNCTION public.account_delete()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'auth required'; end if;
  delete from vaults            where user_id = u;
  delete from keyring           where user_id = u;
  delete from push_subs         where user_id = u;
  delete from subscriptions     where user_id = u;
  delete from diary_entries     where user_id = u;
  delete from body_metrics      where user_id = u;
  delete from pantry_items      where user_id = u;
  delete from shopping_lists    where user_id = u;
  delete from ai_usage          where uid = u;
  delete from ai_allow          where uid = u;
  delete from household_members where user_id = u;
  delete from household_invites where created_by = u;
  delete from households        where owner_id = u;
  delete from app_events        where uid = u::text;
  delete from client_errors     where uid = u::text;
  update products set created_by = null where created_by = u;
  update recipes  set created_by = null where created_by = u;
  delete from auth.users where id = u;
end $function$;

CREATE OR REPLACE FUNCTION public.ai_allowed()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists(select 1 from ai_allow where uid = auth.uid()) $function$;

CREATE OR REPLACE FUNCTION public.ai_bump()
 RETURNS TABLE(user_n integer, global_n integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare u uuid := auth.uid();
begin
  if u is null then
    raise exception 'auth required';
  end if;
  insert into ai_usage(uid, day, n) values (u, now()::date, 1)
    on conflict (uid, day) do update set n = ai_usage.n + 1;
  insert into ai_usage(uid, day, n) values ('00000000-0000-0000-0000-000000000000', now()::date, 1)
    on conflict (uid, day) do update set n = ai_usage.n + 1;
  return query
    select a.n, b.n from ai_usage a, ai_usage b
    where a.uid = u and a.day = now()::date
      and b.uid = '00000000-0000-0000-0000-000000000000' and b.day = now()::date;
end $function$;

CREATE OR REPLACE FUNCTION public.ai_bump_v2()
 RETURNS TABLE(user_n integer, global_n integer, user_m integer, global_m integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare u uuid := auth.uid();
begin
  if u is null then
    raise exception 'auth required';
  end if;
  insert into ai_usage(uid, day, n) values (u, now()::date, 1)
    on conflict (uid, day) do update set n = ai_usage.n + 1;
  insert into ai_usage(uid, day, n) values ('00000000-0000-0000-0000-000000000000', now()::date, 1)
    on conflict (uid, day) do update set n = ai_usage.n + 1;
  return query
    select
      (select a.n from ai_usage a where a.uid = u and a.day = now()::date),
      (select b.n from ai_usage b where b.uid = '00000000-0000-0000-0000-000000000000' and b.day = now()::date),
      (select coalesce(sum(c.n),0)::int from ai_usage c
        where c.uid = u and c.day >= date_trunc('month', now())::date),
      (select coalesce(sum(d.n),0)::int from ai_usage d
        where d.uid = '00000000-0000-0000-0000-000000000000' and d.day >= date_trunc('month', now())::date);
end $function$;

CREATE OR REPLACE FUNCTION public.ai_bump_v3()
 RETURNS TABLE(allowed boolean, reason text, plan text, user_n integer, user_m integer, global_n integer, global_m integer, user_tok bigint, global_tok bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  u uuid := auth.uid();
  g uuid := '00000000-0000-0000-0000-000000000000';
  pl text; lu ai_limits; lg ai_limits;
  un int; um int; gn int; gm int; ut bigint; gt bigint;
  ok boolean := true; why text := null;
begin
  if u is null then raise exception 'auth required'; end if;
  pl := ai_plan(u);
  select * into lu from ai_limits where ai_limits.plan=pl;
  select * into lg from ai_limits where ai_limits.plan='global';
  select coalesce(sum(n) filter (where day=current_date),0), coalesce(sum(n),0), coalesce(sum(tok_in+tok_out),0)
    into un, um, ut from ai_usage where uid=u and day>=date_trunc('month',now())::date;
  select coalesce(sum(n) filter (where day=current_date),0), coalesce(sum(n),0), coalesce(sum(tok_in+tok_out),0)
    into gn, gm, gt from ai_usage where uid=g and day>=date_trunc('month',now())::date;
  if gn>=lg.day_n or gm>=lg.month_n or gt>=lg.month_tok then
    ok:=false; why:='global';
  elsif un>=lu.day_n then
    ok:=false; why:='day';
  elsif um>=lu.month_n or ut>=lu.month_tok then
    ok:=false; why:='month';
  end if;
  if ok then
    insert into ai_usage(uid,day,n) values (u,current_date,1) on conflict (uid,day) do update set n=ai_usage.n+1;
    insert into ai_usage(uid,day,n) values (g,current_date,1) on conflict (uid,day) do update set n=ai_usage.n+1;
    un:=un+1; um:=um+1; gn:=gn+1; gm:=gm+1;
  end if;
  return query select ok, why, pl, un, um, gn, gm, ut, gt;
end $function$;

CREATE OR REPLACE FUNCTION public.ai_job_get(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r ai_jobs;
begin
  select * into r from ai_jobs where id=p_id;
  if not found then return null; end if;
  if r.status=0 then return jsonb_build_object('status',0); end if;  -- ещё готовится
  delete from ai_jobs where id=p_id;                                  -- одноразовый талон
  return jsonb_build_object('status',r.status,'body',r.body);
end $function$;

CREATE OR REPLACE FUNCTION public.ai_job_put(p_id uuid, p_status integer, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if length(coalesce(p_body,'')) > 2000000 then raise exception 'body too big'; end if;
  if p_status is not null and (p_status<0 or p_status>599) then raise exception 'bad status'; end if;
  delete from ai_jobs where created_at < now() - interval '1 hour';
  if not exists(select 1 from ai_jobs where id=p_id) and (select count(*) from ai_jobs) >= 1000 then
    raise exception 'busy';
  end if;
  insert into ai_jobs(id,status,body) values(p_id, coalesce(p_status,0), coalesce(p_body,''))
    on conflict (id) do update set status=excluded.status, body=excluded.body;
end $function$;

CREATE OR REPLACE FUNCTION public.ai_plan(u uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select s.plan from subscriptions s where s.user_id=u and s.status='active'
       and (s.until is null or s.until>=current_date) and exists(select 1 from ai_limits l where l.plan=s.plan)
     order by s.until desc nulls first limit 1),
    (select 'beta' from ai_allow a where a.uid=u limit 1),
    'free')
$function$;

CREATE OR REPLACE FUNCTION public.ai_spend(p_in integer, p_out integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare u uuid := auth.uid(); g uuid := '00000000-0000-0000-0000-000000000000';
begin
  if u is null then raise exception 'auth required'; end if;
  if coalesce(p_in,0)<0 or coalesce(p_out,0)<0 or coalesce(p_in,0)+coalesce(p_out,0)>5000000 then raise exception 'bad usage'; end if;
  insert into ai_usage(uid,day,n,tok_in,tok_out) values (u,current_date,0,coalesce(p_in,0),coalesce(p_out,0))
    on conflict (uid,day) do update set tok_in=ai_usage.tok_in+excluded.tok_in, tok_out=ai_usage.tok_out+excluded.tok_out;
  insert into ai_usage(uid,day,n,tok_in,tok_out) values (g,current_date,0,coalesce(p_in,0),coalesce(p_out,0))
    on conflict (uid,day) do update set tok_in=ai_usage.tok_in+excluded.tok_in, tok_out=ai_usage.tok_out+excluded.tok_out;
end $function$;

CREATE OR REPLACE FUNCTION public.auth_household_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select household_id from public.household_members where user_id = auth.uid()
$function$;

-- Триггер BEFORE INSERT на auth.users (auto_confirm_email_trg) — активен.
CREATE OR REPLACE FUNCTION public.auto_confirm_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.calculate_targets(weight_kg numeric, height_cm numeric, age integer, sex text, activity text DEFAULT 'moderate'::text, goal text DEFAULT 'maintain'::text)
 RETURNS TABLE(kcal integer, protein_g integer, fat_g integer, carb_g integer, bmr integer, tdee integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  with b as (
    select (10*weight_kg + 6.25*height_cm - 5*age
            + case when lower(sex) in ('male','m','м','муж') then 5 else -161 end) as bmr
  ),
  t as (
    select bmr,
           bmr * case lower(activity)
             when 'sedentary' then 1.2 when 'light' then 1.375
             when 'moderate' then 1.55 when 'active' then 1.725
             when 'very_active' then 1.9 else 1.55 end as tdee
    from b
  ),
  g as (
    select bmr, tdee,
           tdee * case lower(goal) when 'lose' then 0.8 when 'gain' then 1.1 else 1.0 end as kcal,
           weight_kg * case lower(goal)
             when 'lose' then 2.2 when 'gain' then 2.0 when 'recomp' then 2.2 else 1.8 end as protein_g
    from t
  )
  select round(kcal)::int,
         round(protein_g)::int,
         round(kcal*0.275/9)::int as fat_g,
         greatest(round((kcal - protein_g*4 - kcal*0.275)/4)::int, 0) as carb_g,
         round(bmr)::int,
         round(tdee)::int
  from g;
$function$;

CREATE OR REPLACE FUNCTION public.exclusion_categories(p_term text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(distinct c.cat), '{}'::text[])
  from (values
    ('рыб',            'Рыба и морепродукты'),
    ('морепродукт',    'Рыба и морепродукты'),
    ('креветк',        'Рыба и морепродукты'),
    ('лосос',          'Рыба и морепродукты'),
    ('треск',          'Рыба и морепродукты'),
    ('тунец',          'Рыба и морепродукты'),
    ('лактоз',         'Молочное'),
    ('молочн',         'Молочное'),
    ('молоко',         'Молочное'),
    ('казеин',         'Молочное'),
    ('орех',           'Орехи'),
    ('арахис',         'Орехи'),
    ('миндал',         'Орехи'),
    ('яйц',            'Яйца'),
    ('яиц',            'Яйца'),
    ('мясо',           'Мясо и птица'),
    ('мясн',           'Мясо и птица'),
    ('глютен',         'Хлеб'),
    ('клейковин',      'Хлеб'),
    ('бобов',          'Бобовые'),
    ('сахар',          'Сладкое'),
    ('алкогол',        'Напитки')
  ) as c(key, cat)
  where btrim(coalesce(p_term,'')) <> '' and lower(btrim(p_term)) like '%'||c.key||'%';
$function$;

CREATE OR REPLACE FUNCTION public.generate_shopping_list(p_plan jsonb)
 RETURNS TABLE(product_id uuid, product_name text, needed_g numeric, in_pantry boolean, package_label text, package_amount_g numeric, packages_qty numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with plan as (
    select (e->>'recipe_id')::uuid            as recipe_id,
           coalesce((e->>'servings')::numeric, 1) as servings
    from jsonb_array_elements(p_plan) e
  ),
  needs as (
    select ri.product_id,
           sum(ri.grams * pl.servings / nullif(r.servings, 0)) as needed_g
    from plan pl
    join public.recipes r            on r.id = pl.recipe_id
    join public.recipe_ingredients ri on ri.recipe_id = r.id
    where ri.product_id is not null
    group by ri.product_id
  )
  select n.product_id,
         p.name as product_name,
         round(n.needed_g) as needed_g,
         exists (select 1 from public.pantry_items pi where pi.product_id = n.product_id) as in_pantry,
         pk.label    as package_label,
         pk.amount_g as package_amount_g,
         case
           when exists (select 1 from public.pantry_items pi where pi.product_id = n.product_id)
             then 0
           when pk.amount_g is not null
             then ceil(n.needed_g / pk.amount_g)
           else null
         end as packages_qty
  from needs n
  join public.products p on p.id = n.product_id
  left join public.product_packages pk on pk.product_id = n.product_id and pk.is_default
  order by in_pantry, p.name;
$function$;

CREATE OR REPLACE FUNCTION public.household_ensure()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare hid uuid;
begin
  select household_id into hid from public.household_members where user_id = auth.uid();
  if hid is not null then return hid; end if;
  insert into public.households (owner_id) values (auth.uid()) returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, auth.uid(), 'owner');
  update public.pantry_items  set household_id = hid where user_id = auth.uid() and household_id is null;
  update public.shopping_lists set household_id = hid where user_id = auth.uid() and household_id is null;
  return hid;
end $function$;

CREATE OR REPLACE FUNCTION public.household_info()
 RETURNS TABLE(household_id uuid, name text, members integer, is_owner boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select h.id, h.name,
    (select count(*)::int from public.household_members m where m.household_id = h.id),
    (h.owner_id = auth.uid())
  from public.households h
  join public.household_members me on me.household_id = h.id and me.user_id = auth.uid()
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.household_invite()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare hid uuid; c text;
begin
  hid := public.household_ensure();
  c := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));  -- 6-значный код
  insert into public.household_invites (code, household_id) values (c, hid);
  return c;
end $function$;

CREATE OR REPLACE FUNCTION public.household_join(p_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare hid uuid; cur uuid;
begin
  select household_id into hid from public.household_invites
    where code = upper(trim(p_code)) and expires_at > now();
  if hid is null then raise exception 'Код не найден или истёк'; end if;
  select household_id into cur from public.household_members where user_id = auth.uid();
  if cur = hid then return hid; end if;
  -- покидаем прежний дом (если был) и входим в новый
  delete from public.household_members where user_id = auth.uid();
  insert into public.household_members (household_id, user_id, role) values (hid, auth.uid(), 'member');
  update public.pantry_items  set household_id = hid where user_id = auth.uid();
  update public.shopping_lists set household_id = hid where user_id = auth.uid();
  return hid;
end $function$;

CREATE OR REPLACE FUNCTION public.household_leave()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare hid uuid;
begin
  select household_id into hid from public.household_members where user_id = auth.uid();
  if hid is null then return; end if;
  delete from public.household_members where user_id = auth.uid();
  -- вещи, что я добавлял, забираю обратно в личные
  update public.pantry_items  set household_id = null where user_id = auth.uid() and household_id = hid;
  update public.shopping_lists set household_id = null where user_id = auth.uid() and household_id = hid;
end $function$;

CREATE OR REPLACE FUNCTION public.keyring_put(p_pw text, p_rec text, p_hint text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  insert into public.keyring (user_id, wrap_pw, wrap_rec, rec_hint, updated_at)
  values (auth.uid(), p_pw, p_rec, p_hint, now())
  on conflict (user_id) do update
     set wrap_pw    = coalesce(excluded.wrap_pw,  public.keyring.wrap_pw),
         wrap_rec   = coalesce(excluded.wrap_rec, public.keyring.wrap_rec),
         rec_hint   = coalesce(excluded.rec_hint, public.keyring.rec_hint),
         updated_at = now();
end $function$;

CREATE OR REPLACE FUNCTION public.log_recipe(p_recipe_id uuid, p_servings numeric DEFAULT 1, p_meal text DEFAULT NULL::text, p_date date DEFAULT CURRENT_DATE)
 RETURNS diary_entries
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r public.recipes;
  m public.recipe_macros;
  f numeric;
  out_row public.diary_entries;
begin
  select * into r from public.recipes where id = p_recipe_id;
  if r.id is null then raise exception 'Рецепт не найден: %', p_recipe_id; end if;
  select * into m from public.recipe_macros where recipe_id = p_recipe_id;
  f := p_servings / nullif(r.servings, 0);
  insert into public.diary_entries
    (product_id, product_name, grams, kcal, protein, fat, carb, meal, entry_date)
  values
    (null, r.name,
     round(coalesce(m.total_grams, 0) * f),
     round(coalesce(m.kcal, 0)    * f),
     round(coalesce(m.protein, 0) * f, 1),
     round(coalesce(m.fat, 0)     * f, 1),
     round(coalesce(m.carb, 0)    * f, 1),
     p_meal, p_date)
  returning * into out_row;
  return out_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.my_household()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select household_id from public.household_members where user_id = auth.uid() limit 1
$function$;

CREATE OR REPLACE FUNCTION public.pantry_add(p_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.pantry_items (user_id, product_id, household_id)
  values (auth.uid(), p_product_id, public.my_household())
  on conflict do nothing;
end $function$;

CREATE OR REPLACE FUNCTION public.pantry_list()
 RETURNS TABLE(product_id uuid, name text, category text, qty_g integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select pi.product_id, p.name, p.category, pi.qty_g
  from public.pantry_items pi
  join public.products p on p.id = pi.product_id
  where pi.household_id = public.my_household()
     or (pi.household_id is null and pi.user_id = auth.uid())
  order by p.name
$function$;

CREATE OR REPLACE FUNCTION public.pantry_qty(p_product_id uuid, p_qty integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.pantry_items
     set qty_g = case when p_qty is null or p_qty <= 0 then null else least(p_qty,100000) end
   where product_id = p_product_id
     and (household_id = public.my_household()
          or (household_id is null and user_id = auth.uid()));
end $function$;

CREATE OR REPLACE FUNCTION public.pantry_remove(p_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare hid uuid := public.my_household();
begin
  if hid is not null then
    delete from public.pantry_items where product_id = p_product_id and household_id = hid;
  else
    delete from public.pantry_items where product_id = p_product_id and user_id = auth.uid() and household_id is null;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.product_by_barcode(p_code text)
 RETURNS TABLE(id uuid, name text, brand text, category text, kcal_per_100g numeric, protein_per_100g numeric, fat_per_100g numeric, carb_per_100g numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select id, name, brand, category, kcal_per_100g, protein_per_100g, fat_per_100g, carb_per_100g
  from public.products where barcode = p_code limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.push_due(p_now timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, endpoint text, p256dh text, auth text, kinds_now text[], local_day date, training_day boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with t as (
    select s.*, ((coalesce(p_now, now()) at time zone 'utc') + make_interval(mins => s.tz_off)) as loc
    from public.push_subs s
    where s.fails < 5
  ), d as (
    select t.*, t.loc::date as ld,
           extract(hour from t.loc)::int as lh,
           extract(isodow from t.loc::date)::smallint as dow,
           (cardinality(t.dows) = 0
            or extract(isodow from t.loc::date)::smallint = any(t.dows)) as is_train
    from t
  ), k as (
    select d.*, x.kind,
           case x.kind
             when 'workout' then d.hour
             else coalesce((d.hours->>x.kind)::int,
               case x.kind when 'weigh' then 7 when 'water' then 14
                           when 'week' then 19 when 'food' then 21
                           when 'sleep' then 23 else null end)
           end as kh
    from d
    cross join lateral unnest(d.kinds) as x(kind)
  ), fire as (
    select k.*
    from k
    where k.kh = k.lh
      and (k.sent->>k.kind) is distinct from k.ld::text
      and (k.kind <> 'workout' or (k.is_train and k.train_ok is distinct from k.ld))
      and (k.kind <> 'week'    or k.dow = 7)
      and (k.kind <> 'water'   or k.water_ok is distinct from k.ld)
  )
  select f.id, f.endpoint, f.p256dh, f.auth,
         array_agg(f.kind) as kinds_now, f.ld, f.is_train
  from fire f
  group by f.id, f.endpoint, f.p256dh, f.auth, f.ld, f.is_train
$function$;

CREATE OR REPLACE FUNCTION public.push_fail(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.push_subs set fails = least(fails + 1, 32767) where id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.push_mark(p_id uuid, p_kinds text[], p_day date)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.push_subs
  set sent = sent || (select coalesce(jsonb_object_agg(k, p_day::text), '{}'::jsonb) from unnest(p_kinds) as k),
      fails = 0
  where id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.push_vault(p_blob text, p_expected bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v bigint;
begin
  insert into public.vaults (user_id, version, blob, size_bytes, updated_at)
  values (auth.uid(), 1, p_blob, length(p_blob), now())
  on conflict (user_id) do update
     set blob       = excluded.blob,
         size_bytes = excluded.size_bytes,
         version    = public.vaults.version + 1,
         updated_at = now()
   where public.vaults.version = p_expected
  returning version into v;

  if v is null then
    return -1;  -- конфликт версий
  end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.recipe_excluded(p_recipe_id uuid, p_exclude text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when p_exclude is null or cardinality(p_exclude) = 0 then false
    else exists (
      select 1 from unnest(p_exclude) as ex(term)
      where btrim(ex.term) <> '' and (
        -- по названию блюда и его тегам
        exists (select 1 from public.recipes r
                 where r.id = p_recipe_id
                   and (r.name ilike '%'||btrim(ex.term)||'%'
                        or exists (select 1 from unnest(coalesce(r.tags,'{}'::text[])) t
                                    where t ilike '%'||btrim(ex.term)||'%')))
        -- по продуктам состава: название, теги, категория и синонимы категории
        or exists (select 1 from public.recipe_ingredients ri
                    join public.products p on p.id = ri.product_id
                   where ri.recipe_id = p_recipe_id
                     and (p.name ilike '%'||btrim(ex.term)||'%'
                          or p.category ilike '%'||btrim(ex.term)||'%'
                          or p.category = any(public.exclusion_categories(ex.term))
                          or exists (select 1 from unnest(coalesce(p.tags,'{}'::text[])) pt
                                      where pt ilike '%'||btrim(ex.term)||'%')))
      ))
  end;
$function$;

CREATE OR REPLACE FUNCTION public.search_products_fuzzy(q text, max_results integer DEFAULT 20)
 RETURNS TABLE(id uuid, name text, brand text, category text, kcal_per_100g numeric, protein_per_100g numeric, fat_per_100g numeric, carb_per_100g numeric, default_serving_g numeric, serving_label text, verified boolean, sim real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  with nq as (select lower(trim(q)) as t)
  select p.id, p.name, p.brand, p.category,
         p.kcal_per_100g, p.protein_per_100g, p.fat_per_100g, p.carb_per_100g,
         p.default_serving_g, p.serving_label, p.verified,
         strict_word_similarity(nq.t, p.name_normalized) as sim
  from public.products p, nq
  where p.name_normalized like nq.t || '%'                         -- имя начинается с запроса
     or strict_word_similarity(nq.t, p.name_normalized) >= 0.4     -- слово похоже (с опечатками), по границам
  order by p.verified desc,
           (p.name_normalized like nq.t || '%') desc,
           strict_word_similarity(nq.t, p.name_normalized) desc
  limit max_results;
$function$;

CREATE OR REPLACE FUNCTION public.search_recipes(p_q text, max_results integer DEFAULT 20)
 RETURNS TABLE(recipe_id uuid, name text, category text, needs_cooking boolean, kcal_serv numeric, protein_serv numeric, fat_serv numeric, carb_serv numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select r.id, r.name, r.category, r.needs_cooking,
         round(m.kcal/r.servings), round(m.protein/r.servings,1),
         round(m.fat/r.servings,1), round(m.carb/r.servings,1)
  from public.recipes r join public.recipe_macros m on m.recipe_id=r.id
  where r.name ilike '%'||btrim(coalesce(p_q,''))||'%' and btrim(coalesce(p_q,''))<>''
  order by (lower(r.name) like lower(btrim(p_q))||'%') desc, r.name
  limit greatest(1,least(max_results,50));
$function$;

CREATE OR REPLACE FUNCTION public.steps_pull(p_k text)
 RETURNS TABLE(n integer, ts timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.n, s.ts
  from public.steps_inbox s
  where s.k = p_k
    and char_length(p_k) between 8 and 64
    and s.ts > now() - interval '3 days'
  order by s.ts desc
  limit 50
$function$;

CREATE OR REPLACE FUNCTION public.sub_status()
 RETURNS TABLE(plan text, status text, until date, active boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.plan, s.status, s.until,
         (s.status = 'active' and s.until >= current_date) as active
  from public.subscriptions s
  where s.user_id = (select auth.uid())
$function$;

CREATE OR REPLACE FUNCTION public.suggest_alternatives(p_product_id uuid, max_results integer DEFAULT 5)
 RETURNS TABLE(product_id uuid, name text, category text, kcal_per_100g numeric, protein_per_100g numeric, protein_per_100kcal numeric, kcal_saved_per_100g numeric, protein_gained_per_100g numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with base as (select * from public.products where id = p_product_id)
  select a.id, a.name, a.category,
         a.kcal_per_100g, a.protein_per_100g,
         round(a.protein_per_100g / nullif(a.kcal_per_100g, 0) * 100, 1) as protein_per_100kcal,
         round(b.kcal_per_100g - a.kcal_per_100g, 1) as kcal_saved_per_100g,
         round(a.protein_per_100g - b.protein_per_100g, 1) as protein_gained_per_100g
  from public.products a, base b
  where a.category = b.category
    and a.id <> b.id
    and (a.kcal_per_100g < b.kcal_per_100g or a.protein_per_100g > b.protein_per_100g)
  order by (b.kcal_per_100g - a.kcal_per_100g) desc,
           (a.protein_per_100g - b.protein_per_100g) desc
  limit max_results;
$function$;

CREATE OR REPLACE FUNCTION public.suggest_day(target_kcal numeric, target_protein numeric DEFAULT 0, can_cook boolean DEFAULT true, meals integer DEFAULT 3, tolerance numeric DEFAULT 0.10, p_exclude text[] DEFAULT '{}'::text[], p_seed text DEFAULT ''::text, p_ban uuid[] DEFAULT '{}'::uuid[], p_like uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(slot integer, category text, recipe_id uuid, name text, needs_cooking boolean, kcal_serv numeric, protein_serv numeric, fat_serv numeric, carb_serv numeric, servings_mult numeric, running_kcal numeric, running_protein numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  used uuid[] := '{}';
  slots int := greatest(meals, 1);
  i int; pick record;
  acc_kcal numeric := 0; acc_protein numeric := 0;
  slot_target numeric; prot_target numeric; mult numeric;
  slot_cat text;
begin
  for i in 1..slots loop
    slot_target := (target_kcal - acc_kcal) / (slots - i + 1);
    prot_target := greatest(0, target_protein - acc_protein) / (slots - i + 1);
    slot_cat := case
        when i = 1 then 'Завтрак'
        when i = slots then 'Ужин'
        when i = 2 then 'Обед'
        else 'Перекус' end;
    with cand as (
      select r.id, r.name, r.category, r.needs_cooking,
             round(m.kcal / r.servings) as kcal_serv,
             round(m.protein / r.servings, 1) as protein_serv,
             round(m.fat / r.servings, 1) as fat_serv,
             round(m.carb / r.servings, 1) as carb_serv,
             abs(round(m.kcal / r.servings) - slot_target) / nullif(slot_target,0)
               + coalesce(1.2 * greatest(0, prot_target - round(m.protein / r.servings,1)) / nullif(prot_target,0), 0)
               - (case when r.id = any(coalesce(p_like,'{}')) then 0.15 else 0 end) as sc
      from public.recipes r
      join public.recipe_macros m on m.recipe_id = r.id
      where (can_cook or r.needs_cooking = false)
        and not (r.id = any(used))
        and r.category = slot_cat
        and not (r.id = any(coalesce(p_ban,'{}')))
        and not public.recipe_excluded(r.id, p_exclude)
      order by sc asc
      limit 6
    )
    select * into pick from cand
    order by md5(coalesce(p_seed,'') || cand.id::text || i::text) limit 1;
    exit when pick.id is null;
    mult := round(slot_target / nullif(pick.kcal_serv, 0), 1);
    mult := least(2.0, greatest(0.75, coalesce(mult, 1)));
    used := used || pick.id;
    acc_kcal := acc_kcal + pick.kcal_serv * mult;
    acc_protein := acc_protein + pick.protein_serv * mult;
    slot := i; category := pick.category; recipe_id := pick.id; name := pick.name; needs_cooking := pick.needs_cooking;
    kcal_serv := pick.kcal_serv; protein_serv := pick.protein_serv; fat_serv := pick.fat_serv; carb_serv := pick.carb_serv;
    servings_mult := mult;
    running_kcal := round(acc_kcal); running_protein := round(acc_protein);
    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.suggest_from_pantry(can_cook boolean DEFAULT true, max_results integer DEFAULT 12)
 RETURNS TABLE(recipe_id uuid, name text, needs_cooking boolean, kcal_serv numeric, protein_serv numeric, fat_serv numeric, carb_serv numeric, total_ing integer, have_ing integer, missing text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with have as (
    select pi.product_id from public.pantry_items pi
    where pi.household_id = public.my_household()
       or (pi.household_id is null and pi.user_id = auth.uid())
  ),
  ri as (
    select r.id as rid, r.name, r.needs_cooking, r.servings, p.name as pname,
           (ri.product_id in (select product_id from have)) as got
    from public.recipes r
    join public.recipe_ingredients ri on ri.recipe_id = r.id
    join public.products p on p.id = ri.product_id
    where (can_cook or r.needs_cooking = false)
  ),
  agg as (
    select rid, name, needs_cooking, servings,
           count(*)::int as total_ing,
           count(*) filter (where got)::int as have_ing,
           string_agg(case when not got then pname end, ', ') as missing
    from ri group by rid, name, needs_cooking, servings
  )
  select a.rid, a.name, a.needs_cooking,
         round(m.kcal / a.servings), round(m.protein / a.servings, 1),
         round(m.fat / a.servings, 1), round(m.carb / a.servings, 1),
         a.total_ing, a.have_ing, a.missing
  from agg a join public.recipe_macros m on m.recipe_id = a.rid
  where a.have_ing > 0
  order by (a.have_ing::numeric / nullif(a.total_ing,0)) desc, a.have_ing desc, a.name
  limit max_results;
$function$;

CREATE OR REPLACE FUNCTION public.suggest_recipes(target_kcal numeric, target_protein numeric DEFAULT 0, can_cook boolean DEFAULT true, tolerance numeric DEFAULT 0.10, max_results integer DEFAULT 10, p_category text DEFAULT NULL::text, p_exclude text[] DEFAULT '{}'::text[], p_ban uuid[] DEFAULT '{}'::uuid[], p_like uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(recipe_id uuid, name text, category text, needs_cooking boolean, kcal_serv numeric, protein_serv numeric, fat_serv numeric, carb_serv numeric, score numeric, within_tolerance boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with per_serv as (
    select r.id, r.name, r.category, r.needs_cooking,
           round(m.kcal / r.servings)        as kcal_serv,
           round(m.protein / r.servings, 1)  as protein_serv,
           round(m.fat / r.servings, 1)      as fat_serv,
           round(m.carb / r.servings, 1)     as carb_serv
    from public.recipes r
    join public.recipe_macros m on m.recipe_id = r.id
    where (can_cook or r.needs_cooking = false)
      and (p_category is null or r.category = p_category)
      and not (r.id = any(coalesce(p_ban,'{}')))
      and not public.recipe_excluded(r.id, p_exclude)
  )
  select id, name, category, needs_cooking,
         kcal_serv, protein_serv, fat_serv, carb_serv,
         round(
           abs(kcal_serv - target_kcal) / nullif(target_kcal, 0)
           + coalesce(1.2 * greatest(0, target_protein - protein_serv) / nullif(target_protein, 0), 0)
           - (case when id = any(coalesce(p_like,'{}')) then 0.15 else 0 end)
         , 3) as score,
         abs(kcal_serv - target_kcal) <= target_kcal * tolerance as within_tolerance
  from per_serv
  order by score asc
  limit max_results;
$function$;

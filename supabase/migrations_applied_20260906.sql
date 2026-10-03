-- 06.09.2026 · push_train_ok (обход ролей, удержание: v538)
-- push_subs: + train_ok date — бит «сегодня уже тренировался». Клиент ставит
-- дату при первом рабочем подходе дня (объёмы и веса на сервер не уезжают).
-- push_due: workout стреляет только в тренировочный день И только если
-- train_ok не сегодняшний. Раньше пуш «Сегодня по плану тренировка»
-- приходил в 18:00 тому, кто утром уже тренировался.
-- Дни тренировок (dows) клиент теперь досылает при каждой смене программы
-- (раньше — один раз при включении пушей). Схема dows не меняется.
alter table public.push_subs add column if not exists train_ok date;

create or replace function public.push_due(p_now timestamp with time zone default null)
 returns table(id uuid, endpoint text, p256dh text, auth text, kinds_now text[], local_day date, training_day boolean)
 language sql
 security definer
 set search_path to 'public'
as $function$
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

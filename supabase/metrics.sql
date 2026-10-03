-- ВИТРИНА ЦИФР ДЛЯ ВОРОТ 31 ОКТЯБРЯ (применена 30.08, v473)
--
-- Зачем: ворота сентября-октября — D30 выше 15% и доля новичков с 3+
-- тренировками за 14 дней выше 35%. Обе цифры надо УМЕТЬ ПОСЧИТАТЬ, иначе
-- ворота не проверить. События (app_events) и ошибки (client_errors)
-- копились с июля, но смотреть на них было нечем: разбор шёл «из SQL-редактора
-- руками», то есть никогда.
--
-- Как смотреть (Supabase → SQL Editor, одна строка):
--     select * from metrics.pulse;
--     select * from metrics.errors_recent;
--
-- Схема metrics НЕ выставлена в API: через публичный ключ её не видно.
-- Приватность не ослаблена — новых путей чтения наружу не появилось.
--
-- ВАЖНО про старые данные: всё, что до v473, засорено. Каждый запуск с пустым
-- хранилищем (превью ветки, второй браузер) заводил нового «человека»: 181
-- человек в базе при двух живых. С v473 телеметрия уходит только с боевого
-- домена, поэтому честный отсчёт когорт — с 30.08.2026.

create schema if not exists metrics;
revoke all on schema metrics from anon, authenticated;

-- Человек = аккаунт, если он есть; иначе устройство.
create or replace view metrics.people as
select coalesce(nullif(uid,''), anon_id) as person,
       min(day) as first_day,
       max(day) as last_day,
       count(distinct day) as active_days,
       bool_or(ev = 'activation_3') as activated,
       max(uid) is not null as has_account
from public.app_events
group by 1;

-- Считаем только созревшие когорты: пришедший вчера ещё не мог дожить до 30-го дня.
create or replace view metrics.pulse as
with p as (select * from metrics.people),
     c14 as (select * from p where first_day <= current_date - 14),
     c30 as (select * from p where first_day <= current_date - 30)
select
  (select count(*) from p)                                          as людей_всего,
  (select count(*) from p where has_account)                        as с_аккаунтом,
  (select count(*) from c14)                                        as когорта_14д,
  (select count(*) from c14 where activated)                        as активированы,
  round(100.0 * (select count(*) from c14 where activated)
        / nullif((select count(*) from c14),0), 1)                  as активация_проц,
  (select count(*) from c30)                                        as когорта_30д,
  (select count(*) from c30 where last_day >= first_day + 28)       as дожили_до_30,
  round(100.0 * (select count(*) from c30 where last_day >= first_day + 28)
        / nullif((select count(*) from c30),0), 1)                  as удержание_д30_проц,
  (select count(*) from public.client_errors
     where created_at >= now() - interval '7 days')                 as ошибок_за_7_дней;

-- Что реально падает у людей, свежее сверху.
create or replace view metrics.errors_recent as
select max(created_at)::date as последняя,
       count(*) as сколько,
       kind as вид,
       string_agg(distinct app_ver, ',' order by app_ver) as версии,
       left(msg, 120) as сообщение
from public.client_errors
where created_at >= now() - interval '30 days'
group by kind, left(msg,120)
order by последняя desc, сколько desc;

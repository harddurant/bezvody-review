-- =====================================================================
-- Применённый хардеринг БД — 2026-07-20
-- Эти миграции уже применены к проду (история Supabase, версии
-- 20260720203435..20260720203544) и записаны здесь для ревью в git.
-- Все — идемпотентные и семантически безопасные (поведение не меняется,
-- меняются только производительность и права anon). Проверено get_advisors.
--
-- Контекст: household-фича (общая кладовая/списки) добавлена миграциями
-- 20260714203928 / 20260714204009 ПОСЛЕ ранней оптимизации RLS
-- (20260714132717), поэтому её политики остались с «голым» auth.uid().
-- Ниже — добор оптимизации и закрытие anon-доступа к приватным RPC.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) perf_rls_initplan_household
--    Оборачиваем auth.uid() в (select auth.uid()) → оценивается один раз
--    на запрос, а не на каждую строку (advisor 0003 auth_rls_initplan).
--    Семантика идентична.
-- ---------------------------------------------------------------------
drop policy if exists hh_insert on public.households;
create policy hh_insert on public.households for insert to authenticated
  with check (owner_id = (select auth.uid()));
drop policy if exists hh_update on public.households;
create policy hh_update on public.households for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists hm_select on public.household_members;
create policy hm_select on public.household_members for select to authenticated
  using ((user_id = (select auth.uid())) or (household_id in (select auth_household_ids())));

drop policy if exists pantry_all on public.pantry_items;
create policy pantry_all on public.pantry_items for all to authenticated
  using ((user_id = (select auth.uid())) or (household_id in (select auth_household_ids())))
  with check ((user_id = (select auth.uid())) or (household_id in (select auth_household_ids())));

drop policy if exists lists_all on public.shopping_lists;
create policy lists_all on public.shopping_lists for all to authenticated
  using ((user_id = (select auth.uid())) or (household_id in (select auth_household_ids())))
  with check ((user_id = (select auth.uid())) or (household_id in (select auth_household_ids())));

drop policy if exists sli_all on public.shopping_list_items;
create policy sli_all on public.shopping_list_items for all to authenticated
  using (exists (select 1 from public.shopping_lists l
    where l.id = shopping_list_items.list_id
      and ((l.user_id = (select auth.uid())) or (l.household_id in (select auth_household_ids())))))
  with check (exists (select 1 from public.shopping_lists l
    where l.id = shopping_list_items.list_id
      and ((l.user_id = (select auth.uid())) or (l.household_id in (select auth_household_ids())))));

-- ---------------------------------------------------------------------
-- 2) perf_covering_fk_indexes
--    Покрывающие индексы для FK (advisor 0001 unindexed_foreign_keys).
-- ---------------------------------------------------------------------
create index if not exists household_invites_household_id_idx on public.household_invites (household_id);
create index if not exists households_owner_id_idx           on public.households        (owner_id);
create index if not exists shopping_lists_household_id_idx   on public.shopping_lists    (household_id);

-- ---------------------------------------------------------------------
-- 3) security_revoke_public_execute_household
--    Приватные SECURITY DEFINER RPC наследовали EXECUTE от роли PUBLIC,
--    из-за чего их мог звать anon (advisor 0028). Ревокаем PUBLIC и
--    выдаём только authenticated. Внутри все функции требуют auth.uid(),
--    так что anon и так был бы no-op/exception — это defense-in-depth.
-- ---------------------------------------------------------------------
revoke execute on function public.auth_household_ids()   from public;
revoke execute on function public.household_ensure()     from public;
revoke execute on function public.household_info()       from public;
revoke execute on function public.household_invite()     from public;
revoke execute on function public.household_join(text)   from public;
revoke execute on function public.household_leave()      from public;
revoke execute on function public.my_household()         from public;
revoke execute on function public.pantry_add(uuid)       from public;
revoke execute on function public.pantry_list()          from public;
revoke execute on function public.pantry_remove(uuid)    from public;

grant execute on function public.auth_household_ids()  to authenticated;
grant execute on function public.household_ensure()    to authenticated;
grant execute on function public.household_info()      to authenticated;
grant execute on function public.household_invite()    to authenticated;
grant execute on function public.household_join(text)  to authenticated;
grant execute on function public.household_leave()     to authenticated;
grant execute on function public.my_household()        to authenticated;
grant execute on function public.pantry_add(uuid)      to authenticated;
grant execute on function public.pantry_list()         to authenticated;
grant execute on function public.pantry_remove(uuid)   to authenticated;

-- ---------------------------------------------------------------------
-- 4) security_bound_client_errors_insert
--    client_errors принимает анонимные вставки (нужно логировать ошибки
--    до/без входа), но WITH CHECK (true) позволял писать неограниченный
--    текст и раздувать таблицу (advisor 0024). Оставляем anon-логирование,
--    но ограничиваем длину полей. Реальные отчёты об ошибках влезают.
-- ---------------------------------------------------------------------
drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors for insert to anon, authenticated
  with check (
    char_length(coalesce(app_ver, '')) <= 40
    and char_length(coalesce(ua,    '')) <= 400
    and char_length(coalesce(uid,   '')) <= 64
    and char_length(coalesce(kind,  '')) <= 40
    and char_length(coalesce(msg,   '')) <= 2000
    and char_length(coalesce(stack, '')) <= 8000
    and char_length(coalesce(url,   '')) <= 400
  );

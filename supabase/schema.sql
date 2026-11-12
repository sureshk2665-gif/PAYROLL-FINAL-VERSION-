-- =====================================================================
-- Mercury Payroll — Supabase schema
-- Run once in Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. User profiles (login → role). One row per Supabase Auth user.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null,
  full_name  text not null default '',
  role       text not null default 'operator'
             check (role in ('vendor','admin','supervisor','operator')),
  active     boolean not null default false,   -- new users stay locked until an admin activates them
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper: role of the logged-in user (null if not logged in / inactive).
create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- Create a profile automatically when a user is added in Authentication.
-- Username/name/role can be passed as user metadata; otherwise derived from the email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Stop non-admins changing roles / activation (including their own).
create or replace function public.guard_profile_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare r text := public.my_role();
begin
  -- No logged-in user = SQL Editor or the server-side admin function: allowed.
  if auth.uid() is null then return new; end if;
  if (new.role is distinct from old.role or new.active is distinct from old.active) then
    if r not in ('vendor','admin') then
      raise exception 'Only an admin can change roles or activation';
    end if;
    if new.role = 'vendor' and r <> 'vendor' then
      raise exception 'Only the software admin can grant the software admin role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

drop policy if exists "profiles: read own or admin reads all" on public.profiles;
create policy "profiles: read own or admin reads all" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.my_role() in ('vendor','admin'));

drop policy if exists "profiles: admin updates" on public.profiles;
create policy "profiles: admin updates" on public.profiles
  for update to authenticated
  using (public.my_role() in ('vendor','admin'))
  with check (public.my_role() in ('vendor','admin'));

-- ---------------------------------------------------------------------
-- 2. App data — one JSON document per dataset (mirrors the old localStorage keys).
-- ---------------------------------------------------------------------
create table if not exists public.app_data (
  key        text primary key
             check (key in ('settings','contractors','employees','advances','payroll_history')),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) default auth.uid()
);

alter table public.app_data enable row level security;

drop policy if exists "app_data: active users read" on public.app_data;
create policy "app_data: active users read" on public.app_data
  for select to authenticated
  using (public.my_role() is not null);

drop policy if exists "app_data: active users insert" on public.app_data;
create policy "app_data: active users insert" on public.app_data
  for insert to authenticated
  with check (public.my_role() is not null);

drop policy if exists "app_data: admin deletes" on public.app_data;
create policy "app_data: admin deletes" on public.app_data
  for delete to authenticated
  using (public.my_role() in ('vendor','admin'));

drop policy if exists "app_data: active users update" on public.app_data;
create policy "app_data: active users update" on public.app_data
  for update to authenticated
  using (public.my_role() is not null)
  with check (public.my_role() is not null);

-- ---------------------------------------------------------------------
-- 3. Change history — every save keeps the previous version (undo / audit).
-- ---------------------------------------------------------------------
create table if not exists public.app_data_history (
  id         bigint generated always as identity primary key,
  key        text not null,
  old_value  jsonb,
  changed_at timestamptz not null default now(),
  changed_by uuid
);

alter table public.app_data_history enable row level security;

drop policy if exists "history: admin reads" on public.app_data_history;
create policy "history: admin reads" on public.app_data_history
  for select to authenticated
  using (public.my_role() in ('vendor','admin'));

create or replace function public.log_app_data_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.app_data_history (key, old_value, changed_by)
    values (old.key, old.value, auth.uid());
    return old;
  end if;
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' and new.value is distinct from old.value then
    insert into public.app_data_history (key, old_value, changed_by)
    values (old.key, old.value, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists log_app_data_change on public.app_data;
create trigger log_app_data_change
  before insert or update or delete on public.app_data
  for each row execute function public.log_app_data_change();

-- ---------------------------------------------------------------------
-- 4. Login-page branding (company name + logo) — readable before login.
-- ---------------------------------------------------------------------
create or replace function public.public_branding()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('companyName', value->>'companyName', 'loginLogo', value->>'loginLogo')
       from public.app_data where key = 'settings'),
    '{}'::jsonb)
$$;

-- ---------------------------------------------------------------------
-- 5. Grants (automatic table exposure is OFF, so grant explicitly).
--    Nothing is granted to `anon`: logged-out visitors see no data.
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.app_data, public.app_data_history from anon;
grant select, update                 on public.profiles          to authenticated;
grant select, insert, update, delete on public.app_data          to authenticated;
grant select                         on public.app_data_history  to authenticated;
revoke execute on function public.my_role(), public.public_branding() from public;
grant execute on function public.my_role() to authenticated;
grant execute on function public.public_branding() to anon, authenticated;
-- Server-side key (Vercel function api/admin-users.js) bypasses RLS but still needs table privileges.
grant select, insert, update, delete on public.profiles, public.app_data, public.app_data_history to service_role;

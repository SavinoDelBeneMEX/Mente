-- Bitácora de Pendientes (pendientes.html): pendientes de trabajo compartidos con el equipo.
-- Solo los usuarios en public.team_members ven y editan los pendientes.
-- Cualquier miembro puede agregar a otro usuario de Mente al equipo desde la página.

-- Perfiles (correo y nombre visibles para el equipo; auth.users no se puede leer desde el navegador)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert or update of email on auth.users
  for each row execute function public.handle_new_user_profile();

insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- Equipo
create table if not exists public.team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now()
);

create or replace function public.is_team_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where user_id = auth.uid());
$$;

-- Pendientes
create table if not exists public.work_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  requester_name text not null default '',
  requester_email text not null default '',
  deadline date,
  priority text not null default 'media' check (priority in ('urgente','alta','media','baja')),
  status text not null default 'pendiente' check (status in ('pendiente','proceso','espera','hecho')),
  owner_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Bitácora de seguimiento
create table if not exists public.work_updates (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.work_items(id) on delete cascade,
  at timestamptz not null default now(),
  by uuid references auth.users(id) on delete set null default auth.uid(),
  kind text not null default 'nota',
  text text not null default '',
  who uuid references auth.users(id) on delete set null
);
create index if not exists work_updates_item_idx on public.work_updates(item_id);
create index if not exists work_items_owner_idx on public.work_items(owner_id);
create index if not exists work_items_created_by_idx on public.work_items(created_by);
create index if not exists work_updates_by_idx on public.work_updates(by);
create index if not exists work_updates_who_idx on public.work_updates(who);
create index if not exists team_members_added_by_idx on public.team_members(added_by);

alter table public.profiles enable row level security;
alter table public.team_members enable row level security;
alter table public.work_items enable row level security;
alter table public.work_updates enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_team_member()));
drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "team read" on public.team_members;
create policy "team read" on public.team_members for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_team_member()));
drop policy if exists "team add" on public.team_members;
create policy "team add" on public.team_members for insert to authenticated
  with check ((select public.is_team_member()));
drop policy if exists "team remove" on public.team_members;
create policy "team remove" on public.team_members for delete to authenticated
  using ((select public.is_team_member()));

drop policy if exists "team items" on public.work_items;
create policy "team items" on public.work_items for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
drop policy if exists "team updates" on public.work_updates;
create policy "team updates" on public.work_updates for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));

-- Cambios en vivo entre miembros del equipo
do $$ begin
  begin alter publication supabase_realtime add table public.work_items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.work_updates; exception when duplicate_object then null; end;
end $$;

-- Primer miembro: el dueño de Mente
insert into public.team_members (user_id)
select id from auth.users where email = 'juancarlos.ibarra@savinodelbene.com'
on conflict do nothing;

-- Las funciones auxiliares no se llaman directo desde la API
revoke execute on function public.handle_new_user_profile() from public, anon, authenticated;
revoke execute on function public.is_team_member() from public, anon;
grant execute on function public.is_team_member() to authenticated;

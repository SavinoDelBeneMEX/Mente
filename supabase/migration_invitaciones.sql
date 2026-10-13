-- Backbrain: invitaciones por correo al equipo (función invite-member).
-- Si la persona invitada aún no tiene cuenta, queda en team_invites y entra al equipo
-- automáticamente en cuanto se registra con ese correo.

create table if not exists public.team_invites (
  email text primary key,
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz
);
create index if not exists team_invites_invited_by_idx on public.team_invites(invited_by);
alter table public.team_invites enable row level security;

drop policy if exists "invites read" on public.team_invites;
create policy "invites read" on public.team_invites for select to authenticated
  using ((select public.is_team_member()));
drop policy if exists "invites delete" on public.team_invites;
create policy "invites delete" on public.team_invites for delete to authenticated
  using ((select public.is_team_member()));

-- Al crear (o cambiar el correo de) una cuenta: perfil + alta automática si tenía invitación.
create or replace function public.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv public.team_invites;
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;

  select * into inv from public.team_invites where email = lower(new.email) and accepted_at is null;
  if found then
    insert into public.team_members (user_id, added_by) values (new.id, inv.invited_by)
    on conflict (user_id) do nothing;
    update public.team_invites set accepted_at = now() where email = inv.email;
  end if;
  return new;
end $$;
revoke execute on function public.handle_new_user_profile() from public, anon, authenticated;

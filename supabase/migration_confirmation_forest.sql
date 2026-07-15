-- Mente: confirmación de tareas por un tercero (sin login) + árbol/bosque diario.
-- Ejecutar esto en el SQL Editor de tu proyecto Supabase (una sola vez).

alter table public.tasks add column if not exists requires_confirmation boolean not null default false;
alter table public.tasks add column if not exists confirmation_token uuid;
alter table public.tasks add column if not exists confirmed_at timestamptz;
alter table public.tasks add column if not exists confirmed_by text;
alter table public.tasks add column if not exists confirm_person text;

-- El token es el único "secreto" que necesita quien confirma: le permite ver y confirmar
-- esa tarea puntual sin cuenta ni contraseña, a través del Edge Function `confirm-task`
-- (que usa la service role key y no expone la tabla completa).
create unique index if not exists tasks_confirmation_token_idx
  on public.tasks(confirmation_token) where confirmation_token is not null;

create table if not exists public.tree_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  tree_type text not null default 'roble',
  status text not null check (status in ('bloomed', 'dead')),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.tree_days enable row level security;

drop policy if exists "own tree days" on public.tree_days;
create policy "own tree days" on public.tree_days
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists tree_days_user_idx on public.tree_days(user_id, date desc);

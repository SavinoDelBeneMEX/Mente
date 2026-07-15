-- Mente: esquema de base de datos para Supabase
-- Ejecutar esto en el SQL Editor de tu proyecto Supabase (una sola vez).

create extension if not exists "pgcrypto";

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  date date,
  time time,
  priority text not null default 'media',
  category text not null default 'personal',
  star boolean not null default false,
  done boolean not null default false,
  repeat jsonb,
  series_id uuid,                        -- agrupa todas las ocurrencias de una misma tarea recurrente
  subtasks jsonb not null default '[]'::jsonb,
  notes text,
  requires_photo boolean not null default false, -- si es true, no se puede marcar como hecha sin al menos 1 foto
  photos jsonb not null default '[]'::jsonb,      -- [{ path, url }] en el bucket de Storage "task-photos"
  google_event_id text,                  -- id del evento espejo en Google Calendar, si ya se sincronizó
  requires_confirmation boolean not null default false, -- si es true, solo se marca hecha cuando otra persona la confirma
  confirmation_token uuid,               -- token público (sin login) para la página confirm.html
  confirmed_at timestamptz,              -- cuándo confirmó la otra persona
  confirmed_by text,                     -- nombre que escribió quien confirmó (opcional, lo llena esa persona)
  confirm_person text,                   -- a quién se le va a pedir la confirmación (lo escribe el dueño de la tarea)
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  time time not null,
  repeat text not null default 'once', -- once | daily | weekdays | every
  date date,                            -- fecha puntual (once) o de referencia (every)
  n int,                                 -- cada N días (solo si repeat = 'every')
  timezone text not null default 'UTC',  -- zona horaria del dispositivo que lo creó
  last_fired_on date,                    -- último día que ya se envió (evita duplicados)
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Árbol/bosque: un registro por día en que hubo al menos una tarea con esa fecha.
-- "bloomed" = se completaron todas las tareas de ese día; "dead" = quedó alguna sin completar.
create table if not exists public.tree_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  tree_type text not null default 'roble',
  status text not null check (status in ('bloomed', 'dead')),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.tasks enable row level security;
alter table public.reminders enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.google_tokens enable row level security;
alter table public.notes enable row level security;
alter table public.tree_days enable row level security;

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own reminders" on public.reminders;
create policy "own reminders" on public.reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own push subs" on public.push_subscriptions;
create policy "own push subs" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own google tokens" on public.google_tokens;
create policy "own google tokens" on public.google_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own tree days" on public.tree_days;
create policy "own tree days" on public.tree_days
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Índices para que la función de envío de push sea rápida
create index if not exists reminders_user_idx on public.reminders(user_id);
create index if not exists reminders_lastfired_idx on public.reminders(last_fired_on);
create index if not exists tasks_user_idx on public.tasks(user_id);
create index if not exists tasks_series_idx on public.tasks(series_id, date);
create index if not exists notes_user_idx on public.notes(user_id);
create index if not exists tree_days_user_idx on public.tree_days(user_id, date desc);
-- El token es el único "secreto" que necesita quien confirma una tarea desde confirm.html.
create unique index if not exists tasks_confirmation_token_idx
  on public.tasks(confirmation_token) where confirmation_token is not null;

-- Bucket de Storage para las fotos de tareas (ver supabase/migration_photos_notes.sql
-- para el detalle y el porqué es público).
insert into storage.buckets (id, name, public)
values ('task-photos', 'task-photos', true)
on conflict (id) do nothing;

drop policy if exists "task photos public read" on storage.objects;
create policy "task photos public read" on storage.objects
  for select using (bucket_id = 'task-photos');

drop policy if exists "task photos own write" on storage.objects;
create policy "task photos own write" on storage.objects
  for insert with check (bucket_id = 'task-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "task photos own delete" on storage.objects;
create policy "task photos own delete" on storage.objects
  for delete using (bucket_id = 'task-photos' and auth.uid()::text = (storage.foldername(name))[1]);

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
  created_at timestamptz not null default now()
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

alter table public.tasks enable row level security;
alter table public.reminders enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own reminders" on public.reminders;
create policy "own reminders" on public.reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own push subs" on public.push_subscriptions;
create policy "own push subs" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Índices para que la función de envío de push sea rápida
create index if not exists reminders_user_idx on public.reminders(user_id);
create index if not exists reminders_lastfired_idx on public.reminders(last_fired_on);
create index if not exists tasks_user_idx on public.tasks(user_id);
create index if not exists tasks_series_idx on public.tasks(series_id, date);

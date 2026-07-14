-- Migración: soporte para sincronización con Google Calendar.
-- Ejecutar esto en el SQL Editor de Supabase (una sola vez, ya tenés las tablas creadas).

alter table public.tasks add column if not exists google_event_id text;

create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_tokens enable row level security;

drop policy if exists "own google tokens" on public.google_tokens;
create policy "own google tokens" on public.google_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

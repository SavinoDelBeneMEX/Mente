-- Migración: fotos por tarea (con opción de exigirla para completar) y Bloc de Notas.
-- Ejecutar esto en el SQL Editor de Supabase (una sola vez, ya tenés las tablas creadas).

alter table public.tasks add column if not exists requires_photo boolean not null default false;
alter table public.tasks add column if not exists photos jsonb not null default '[]'::jsonb;

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists notes_user_idx on public.notes(user_id);

-- Bucket de Storage para las fotos de tareas.
-- Es público (lectura libre por URL) para poder mostrarlas con una simple <img src>
-- sin manejar URLs firmadas con vencimiento; como Mente es de un solo usuario y las
-- rutas de archivo incluyen su user_id + un UUID al azar, no son adivinables por
-- terceros aunque el bucket sea público. Si preferís privacidad estricta, avisame y
-- lo paso a bucket privado con URLs firmadas (más complejidad, no hace falta acá).
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

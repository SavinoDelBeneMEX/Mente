-- Migración: agrega el campo que agrupa las ocurrencias de una tarea recurrente.
-- Ejecutar esto en el SQL Editor de Supabase (una sola vez, ya tenés las tablas creadas).

alter table public.tasks add column if not exists series_id uuid;
create index if not exists tasks_series_idx on public.tasks(series_id, date);

-- Migración: agrega el campo de notas por tarea.
-- Ejecutar esto en el SQL Editor de Supabase (una sola vez, ya tenés las tablas creadas).

alter table public.tasks add column if not exists notes text;

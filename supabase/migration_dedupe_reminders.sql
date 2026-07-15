-- Migración: elimina recordatorios duplicados de tareas repetitivas.
-- Ejecutar esto en el SQL Editor de Supabase (una sola vez).
--
-- Bug: el cliente creaba un recordatorio nuevo por cada ocurrencia futura pre-generada
-- de una tarea repetitiva (hasta 60), en vez de uno solo por serie. Como un recordatorio
-- "diario"/"días hábiles"/"cada X días" suena todos los días sin importar a qué ocurrencia
-- esté enganchado, tener 60 copias hacía que se mandaran 60 notificaciones push a la vez.
-- Ya se corrigió el código que los creaba (index.html); esto limpia los que ya se crearon.
--
-- Deja 1 solo recordatorio por serie (el más viejo) y borra el resto.

with ranked as (
  select r.id,
         t.series_id,
         row_number() over (partition by t.series_id order by r.created_at asc) as rn
  from public.reminders r
  join public.tasks t on t.id = r.task_id
  where t.series_id is not null and r.repeat in ('daily', 'weekdays', 'every')
)
delete from public.reminders
where id in (select id from ranked where rn > 1);

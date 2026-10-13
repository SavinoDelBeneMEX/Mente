-- Backbrain: etapas de trabajo (Por iniciar, Revisión, Firma, Enviado al cliente, Enviado a proveedor).
-- Se activan por persona con profiles.stages_enabled; por ahora solo el dueño las usa.
alter table public.work_items add column if not exists stage text
  check (stage in ('inicio','revision','firma','cliente','proveedor'));
alter table public.profiles add column if not exists stages_enabled boolean not null default false;

update public.profiles set stages_enabled = true
where email = 'juancarlos.ibarra@savinodelbene.com';

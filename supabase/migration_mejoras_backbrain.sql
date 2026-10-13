-- Backbrain: cliente/asunto, días en etapa, archivos adjuntos, aviso de asignación y resumen semanal.

-- 4) Cliente o asunto del pendiente
alter table public.work_items add column if not exists client text not null default '';

-- 2) Desde cuándo está en su etapa actual
alter table public.work_items add column if not exists stage_changed_at timestamptz;
update public.work_items set stage_changed_at = coalesce(updated_at, created_at)
where stage is not null and stage_changed_at is null;

create or replace function public.work_items_stage_ts()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.stage is not null then new.stage_changed_at := now(); end if;
  elsif new.stage is distinct from old.stage then
    new.stage_changed_at := case when new.stage is null then null else now() end;
  end if;
  return new;
end $$;
drop trigger if exists work_items_stage_ts on public.work_items;
create trigger work_items_stage_ts before insert or update on public.work_items
  for each row execute function public.work_items_stage_ts();
revoke execute on function public.work_items_stage_ts() from public, anon, authenticated;

-- 5) Resumen semanal del equipo (lunes)
alter table public.profiles add column if not exists weekly_summary boolean not null default false;
update public.profiles set weekly_summary = true where email = 'juancarlos.ibarra@savinodelbene.com';

-- 3) Archivos adjuntos (bucket privado; solo miembros del equipo)
create table if not exists public.work_files (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.work_items(id) on delete cascade,
  path text not null unique,
  name text not null,
  size bigint,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists work_files_item_idx on public.work_files(item_id);
create index if not exists work_files_uploaded_by_idx on public.work_files(uploaded_by);
alter table public.work_files enable row level security;
drop policy if exists "team files" on public.work_files;
create policy "team files" on public.work_files for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
do $$ begin
  begin alter publication supabase_realtime add table public.work_files; exception when duplicate_object then null; end;
end $$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('work-files', 'work-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "work files read" on storage.objects;
create policy "work files read" on storage.objects for select to authenticated
  using (bucket_id = 'work-files' and (select public.is_team_member()));
drop policy if exists "work files write" on storage.objects;
create policy "work files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'work-files' and (select public.is_team_member()));
drop policy if exists "work files delete" on storage.objects;
create policy "work files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'work-files' and (select public.is_team_member()));

-- 1) Aviso por correo cuando le asignas un pendiente a otra persona (función notify-assign)
create or replace function public.notify_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
     and new.owner_id is distinct from auth.uid() then
    perform net.http_post(
      url := 'https://ecmenbgaeqvojfcgyjgc.supabase.co/functions/v1/notify-assign',
      headers := jsonb_build_object(
        'x-cron-secret', (select value from public.app_settings where key = 'digest_cron_secret'),
        'Content-Type', 'application/json'),
      body := jsonb_build_object('item_id', new.id, 'by', auth.uid()),
      timeout_milliseconds := 10000);
  end if;
  return new;
end $$;
drop trigger if exists work_items_notify_assignment on public.work_items;
create trigger work_items_notify_assignment after insert or update of owner_id on public.work_items
  for each row execute function public.notify_assignment();
revoke execute on function public.notify_assignment() from public, anon, authenticated;

-- 5) Lunes 8:00 a. m. hora de CDMX (14:00 UTC)
select cron.unschedule('BACKBRAIN_SEMANAL') where exists (select 1 from cron.job where jobname = 'BACKBRAIN_SEMANAL');
select cron.schedule('BACKBRAIN_SEMANAL', '0 14 * * 1', $$
  select net.http_post(
    url := 'https://ecmenbgaeqvojfcgyjgc.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'x-cron-secret', (select value from public.app_settings where key = 'digest_cron_secret'),
      'Content-Type', 'application/json'),
    body := '{"mode":"weekly"}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);

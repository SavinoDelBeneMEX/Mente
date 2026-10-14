-- Backbrain: Cobranza (cartas de cobranza y convenios). Privada: cada persona solo ve lo suyo.
-- La pestaña se muestra solo a quien tenga profiles.collections_enabled = true.

alter table public.profiles add column if not exists collections_enabled boolean not null default false;
update public.profiles set collections_enabled = true where email = 'juancarlos.ibarra@savinodelbene.com';

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client text not null,
  contact_email text not null default '',
  doc_type text not null default 'carta' check (doc_type in ('carta','convenio')),
  sent_date date,
  signed_date date,
  amount numeric(14,2) not null default 0,
  currency text not null default 'MXN' check (currency in ('MXN','USD','EUR')),
  status text not null default 'enviada' check (status in ('enviada','negociacion','firmado','pagada','incumplida')),
  next_follow_up date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists collections_owner_idx on public.collections(owner_id);

create table if not exists public.collection_updates (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  at timestamptz not null default now(),
  by uuid references auth.users(id) on delete set null default auth.uid(),
  kind text not null default 'nota',
  text text not null default ''
);
create index if not exists collection_updates_col_idx on public.collection_updates(collection_id);
create index if not exists collection_updates_by_idx on public.collection_updates(by);

create table if not exists public.collection_drafts (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  template text not null default '',
  subject text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists collection_drafts_col_idx on public.collection_drafts(collection_id);

create table if not exists public.collection_files (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  path text not null unique,
  name text not null,
  size bigint,
  created_at timestamptz not null default now()
);
create index if not exists collection_files_col_idx on public.collection_files(collection_id);

alter table public.collections enable row level security;
alter table public.collection_updates enable row level security;
alter table public.collection_drafts enable row level security;
alter table public.collection_files enable row level security;

drop policy if exists "own collections" on public.collections;
create policy "own collections" on public.collections for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists "own collection updates" on public.collection_updates;
create policy "own collection updates" on public.collection_updates for all to authenticated
  using (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid())));
drop policy if exists "own collection drafts" on public.collection_drafts;
create policy "own collection drafts" on public.collection_drafts for all to authenticated
  using (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid())));
drop policy if exists "own collection files" on public.collection_files;
create policy "own collection files" on public.collection_files for all to authenticated
  using (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid())));

-- Archivos de cobranza: bucket privado; cada quien solo en su carpeta (<user_id>/...)
insert into storage.buckets (id, name, public, file_size_limit)
values ('collection-files', 'collection-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "collection files read" on storage.objects;
create policy "collection files read" on storage.objects for select to authenticated
  using (bucket_id = 'collection-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "collection files write" on storage.objects;
create policy "collection files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'collection-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "collection files delete" on storage.objects;
create policy "collection files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'collection-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

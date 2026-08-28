-- Run this in Supabase SQL Editor before enabling shared sync.
create extension if not exists pgcrypto;

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  mood text not null default 'soft',
  entry_type text not null default 'diary',
  memory_date date,
  unlock_date date,
  image_path text,
  hide_date boolean not null default false,
  responses jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.entries add column if not exists memory_date date;
alter table public.entries add column if not exists entry_type text not null default 'diary';
alter table public.entries add column if not exists unlock_date date;
alter table public.entries add column if not exists responses jsonb not null default '[]'::jsonb;

alter table public.entries enable row level security;

drop policy if exists "owners can read entries" on public.entries;
create policy "owners can read entries"
  on public.entries for select to authenticated using (created_by = auth.uid());

drop policy if exists "owners can create entries" on public.entries;
create policy "owners can create entries"
  on public.entries for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists "owners can update entries" on public.entries;
create policy "owners can update entries"
  on public.entries for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists "owners can delete entries" on public.entries;
create policy "owners can delete entries"
  on public.entries for delete to authenticated using (created_by = auth.uid());

create table if not exists public.voices (
  id uuid primary key default gen_random_uuid(),
  author text not null default '甜甜',
  audio_path text not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.voices enable row level security;

drop policy if exists "owners can read voices" on public.voices;
create policy "owners can read voices"
  on public.voices for select to authenticated using (created_by = auth.uid());

drop policy if exists "owners can create voices" on public.voices;
create policy "owners can create voices"
  on public.voices for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists "owners can delete voices" on public.voices;
create policy "owners can delete voices"
  on public.voices for delete to authenticated using (created_by = auth.uid());

create index if not exists voices_created_at_idx on public.voices (created_at desc);

insert into storage.buckets (id, name, public)
values ('memory-photos', 'memory-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('memory-voices', 'memory-voices', false)
on conflict (id) do nothing;

drop policy if exists "owners can upload memory photos" on storage.objects;
create policy "owners can upload memory photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners can read memory photos" on storage.objects;
create policy "owners can read memory photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners can delete memory photos" on storage.objects;
create policy "owners can delete memory photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'memory-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners can upload memory voices" on storage.objects;
create policy "owners can upload memory voices"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'memory-voices' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners can read memory voices" on storage.objects;
create policy "owners can read memory voices"
  on storage.objects for select to authenticated
  using (bucket_id = 'memory-voices' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners can delete memory voices" on storage.objects;
create policy "owners can delete memory voices"
  on storage.objects for delete to authenticated
  using (bucket_id = 'memory-voices' and (storage.foldername(name))[1] = auth.uid()::text);

do $$
begin
  alter publication supabase_realtime add table public.entries;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.voices;
exception
  when duplicate_object then null;
end $$;

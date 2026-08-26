create table if not exists public.leaf_devices (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.leaf_books (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.leaf_devices(id) on delete cascade,
  title text not null,
  author text not null default 'Unknown author',
  content jsonb not null,
  byte_size integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists leaf_books_device_created_idx
  on public.leaf_books(device_id, created_at desc);

create table if not exists public.leaf_pairings (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.leaf_devices(id) on delete cascade,
  code text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  book_id uuid references public.leaf_books(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists leaf_pairings_device_created_idx
  on public.leaf_pairings(device_id, created_at desc);

create index if not exists leaf_pairings_book_idx
  on public.leaf_pairings(book_id);

create table if not exists public.leaf_progress (
  device_id uuid not null references public.leaf_devices(id) on delete cascade,
  book_id uuid not null references public.leaf_books(id) on delete cascade,
  chapter_index integer not null default 0 check (chapter_index >= 0),
  anchor integer not null default 0 check (anchor >= 0),
  font_size integer not null default 28 check (font_size between 18 and 44),
  updated_at timestamptz not null default now(),
  primary key (device_id, book_id)
);

create index if not exists leaf_progress_book_idx
  on public.leaf_progress(book_id);

alter table public.leaf_devices enable row level security;
alter table public.leaf_books enable row level security;
alter table public.leaf_pairings enable row level security;
alter table public.leaf_progress enable row level security;

-- All browser access goes through the custom-authenticated Edge Function.
-- Explicit deny policies keep the public API fail-closed and make that intent
-- visible to database security tooling.
create policy leaf_devices_no_direct_access on public.leaf_devices
  as restrictive for all to public using (false) with check (false);
create policy leaf_books_no_direct_access on public.leaf_books
  as restrictive for all to public using (false) with check (false);
create policy leaf_pairings_no_direct_access on public.leaf_pairings
  as restrictive for all to public using (false) with check (false);
create policy leaf_progress_no_direct_access on public.leaf_progress
  as restrictive for all to public using (false) with check (false);

revoke all on table public.leaf_devices from anon, authenticated;
revoke all on table public.leaf_books from anon, authenticated;
revoke all on table public.leaf_pairings from anon, authenticated;
revoke all on table public.leaf_progress from anon, authenticated;

comment on table public.leaf_devices is 'Leaf reader devices, addressed only by a SHA-256 hash of a browser-held random token.';
comment on table public.leaf_pairings is 'Short-lived one-use codes that let an uploader deliver a book to one Leaf device.';
comment on table public.leaf_books is 'Sanitized EPUB chapter text. Never publicly readable; accessed through the Leaf Edge Function.';

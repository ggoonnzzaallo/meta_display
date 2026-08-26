create index if not exists leaf_pairings_book_idx
  on public.leaf_pairings(book_id);

create index if not exists leaf_progress_book_idx
  on public.leaf_progress(book_id);

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leaf_devices' and policyname = 'leaf_devices_no_direct_access') then
    create policy leaf_devices_no_direct_access on public.leaf_devices as restrictive for all to public using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leaf_books' and policyname = 'leaf_books_no_direct_access') then
    create policy leaf_books_no_direct_access on public.leaf_books as restrictive for all to public using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leaf_pairings' and policyname = 'leaf_pairings_no_direct_access') then
    create policy leaf_pairings_no_direct_access on public.leaf_pairings as restrictive for all to public using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leaf_progress' and policyname = 'leaf_progress_no_direct_access') then
    create policy leaf_progress_no_direct_access on public.leaf_progress as restrictive for all to public using (false) with check (false);
  end if;
end
$$;

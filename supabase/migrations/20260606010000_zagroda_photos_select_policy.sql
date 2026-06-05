-- S-01 fix (found during phase 3 verification): photo replace never removed the
-- old object. Supabase Storage's delete/list endpoints SELECT storage.objects
-- under the caller's RLS before acting — with no SELECT policy the old object is
-- invisible to its owner and remove() silently no-ops, orphaning replaced photos.
-- The bucket's public flag covers anonymous *reads* (CDN URL); this owner-scoped
-- SELECT is what makes owner-side delete (and any future list) actually work.
create policy "owners can read photos in their folder"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'zagroda-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

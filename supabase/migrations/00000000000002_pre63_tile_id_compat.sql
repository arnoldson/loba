-- Local-only: lets commits from before #63 (e.g. 726dd22) run against the
-- current schema, so one local database serves old and new code with the
-- same seeded posts.
--
-- scripts/sql/063-viewport-relative-sectoring.sql dropped these columns.
-- Pre-#63 code writes tile_id on every post insert (format "<latTile>:
-- <lngTile>", see 726dd22:apps/backend/src/db/tiles.ts) and reads it only
-- for the tap-to-detail list (/api/posts/by-tiles); its map density query
-- works from latitude/longitude. Live had tile_id NOT NULL with no
-- default; it's nullable here so post-#63 code, which never writes it,
-- keeps working. Seed while a pre-#63 backend is running to give every
-- post a tile_id.
ALTER TABLE "public"."posts" ADD COLUMN IF NOT EXISTS "tile_id" "text";
ALTER TABLE "public"."post_reports" ADD COLUMN IF NOT EXISTS "tile_id_snapshot" "text";

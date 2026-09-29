/**
 * Client-side tile constants -- now used for exactly one thing: the
 * app's max zoom-out lock (#53). All other grid math (grouping factor
 * selection, sector geometry, marker centers) lives server-side -- see
 * apps/backend/src/utils/grouping.ts. The client computes none of
 * that; it sends raw viewport parameters and displays whatever sectors
 * the density endpoint returns.
 */

// Must match TILE_SIZE_METERS in apps/backend/src/utils/grouping.ts --
// used here only to derive getMaxAllowedLongitudeDelta below.
const TILE_SIZE_METERS = 3

/**
 * Convert latitudeDelta to approximate zoom level
 * Based on Google Maps zoom level formula
 */
export function getZoomLevel(latitudeDelta: number): number {
  return Math.round(Math.log2(360 / latitudeDelta))
}

// ─── Max zoom-out lock (#53) ────────────────────────────────────────

// The marker's actual fixed on-screen size (see TileMarker.tsx's
// styles.marker -- 36x36px, does not scale with post count). Must
// match MARKER_SIZE_PX in apps/backend/src/utils/grouping.ts -- the
// server's groupingFactor selection targets this same on-screen size,
// and getMaxAllowedLongitudeDelta below only correctly predicts where
// the server's CITY_CAP_GROUPING_FACTOR will engage if both sides agree
// on this value.
const MARKER_SIZE_PX = 36

// City-scale ceiling on real-world supertile size -- see issue #53.
// Must match CITY_CAP_GROUPING_FACTOR in
// apps/backend/src/utils/grouping.ts, which is where this cap actually
// applies now (the server determines groupingFactor, and clamps it
// here). This client-side copy exists only so
// getMaxAllowedLongitudeDelta below can predict, without a round trip,
// where that server-side cap will engage -- see that function's
// comment for why the client still needs to know this independently
// (a UX snap-back needs to react instantly to a gesture, not wait on a
// network response).
const CITY_CAP_GROUPING_FACTOR = 8192

/**
 * The smallest longitudeDelta (i.e. least zoomed out) from which the
 * server's groupingFactor selection (apps/backend/src/utils/grouping.ts's
 * getGroupingFactor) is guaranteed to have clamped to
 * CITY_CAP_GROUPING_FACTOR for every delta beyond it -- i.e. the point
 * from which the grid is permanently frozen and no more hops (#53) can
 * happen server-side, no matter how much further out the view goes.
 *
 * NOT the delta at which rawFactor reaches CITY_CAP_GROUPING_FACTOR --
 * the rounding in getGroupingFactor, factor = 2^ceil(log2(rawFactor)),
 * holds factor at a given power of 2 for a whole range of rawFactor
 * (rawFactor in (CAP/2, CAP] all round to CAP), so the grid already
 * stops changing once rawFactor first exceeds CAP/2, a full zoom level
 * before rawFactor would naturally reach CAP itself.
 *
 * Exact, not a numeric search: rawFactor > CAP/2 solved for
 * longitudeDelta. Latitude-independent, like the server's grouping
 * factor (#93: the grid is in Web Mercator space, so cell size depends
 * only on zoom), so the lock engages at the same zoom everywhere.
 * Duplicating the derivation here (rather than calling the server) is
 * deliberate: the map screen uses this to clamp/snap the region back
 * the instant a zoom-out gesture settles -- that needs to happen
 * locally, not after a network round trip.
 *
 * Going further out than this lock is out of scope for the app
 * entirely right now (a viewport at that scale puts far more markers in
 * view than the map can render smoothly) -- see the follow-up issue on
 * metro-scale zoom.
 */
export function getMaxAllowedLongitudeDelta(viewportWidthPx: number): number {
  return (
    ((CITY_CAP_GROUPING_FACTOR / 2) * TILE_SIZE_METERS * viewportWidthPx) /
    (MARKER_SIZE_PX * 111320)
  )
}

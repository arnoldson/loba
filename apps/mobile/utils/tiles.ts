/**
 * Client-side tile constants -- now used for exactly one thing: the
 * app's max zoom-out lock (#53). All other tile/grid math (grouping
 * factor selection, grid identity, supertile boundaries, marker
 * centers) moved server-side -- see apps/backend/src/utils/grouping.ts
 * and issue #58's follow-up ("move rendering/clustering logic
 * server-side"). The client no longer computes any of that; it sends
 * raw viewport parameters and displays whatever grid rectangle + cell
 * list the density endpoint returns.
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
const CITY_CAP_GROUPING_FACTOR = 4096

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
 * before rawFactor would naturally reach CAP itself. Using CAP instead
 * of CAP/2 here would pick a needlessly-far-out lock point and allow a
 * whole extra doubling-range of avoidable zoom (and viewport-cell-count
 * growth) before the lock engages, without preventing any additional
 * hops -- the grid's already static there.
 *
 * Exact, not a numeric search: solving rawFactor > CAP/2 for
 * longitudeDelta (the same terms getGroupingFactor's rawFactor
 * derivation uses, just solved for delta instead of for factor) gives
 * this closed form. Duplicating the derivation here (rather than
 * calling the server) is deliberate: the map screen uses this to
 * clamp/snap the region back the instant a zoom-out gesture settles --
 * that needs to happen locally, not after a network round trip.
 *
 * Going further out than this lock is out of scope for the app
 * entirely right now (the grid would be frozen server-side but a
 * viewport at that scale puts far more cells in view than
 * MAX_MARKERS budgets for) -- see the follow-up issue on metro-scale
 * zoom.
 */
export function getMaxAllowedLongitudeDelta(
  latitude: number,
  viewportWidthPx: number,
): number {
  return (
    ((CITY_CAP_GROUPING_FACTOR / 2) * TILE_SIZE_METERS * viewportWidthPx) /
    (MARKER_SIZE_PX * 111320 * Math.cos((latitude * Math.PI) / 180))
  )
}

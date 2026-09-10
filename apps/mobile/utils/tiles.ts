/**
 * Tile utilities for Loba
 * Handles 3m × 3m tile calculations and zoom-based grouping
 */

// Each tile is 3m × 3m
const TILE_SIZE_METERS = 3

/**
 * Calculate tile ID from GPS coordinates
 * Format: "latTile:lngTile"
 */
export function getTileId(lat: number, lng: number): string {
  const latTile = Math.floor((lat * 111320) / TILE_SIZE_METERS)
  const lngTile = Math.floor(
    (lng * 111320 * Math.cos((lat * Math.PI) / 180)) / TILE_SIZE_METERS,
  )
  return `${latTile}:${lngTile}`
}

/**
 * Get center coordinates of a tile
 */
export function getTileCenter(tileId: string): {
  latitude: number
  longitude: number
} {
  const [latTile, lngTile] = tileId.split(":").map(Number)

  const latitude = (latTile * TILE_SIZE_METERS) / 111320
  const longitude =
    (lngTile * TILE_SIZE_METERS) /
    (111320 * Math.cos((latitude * Math.PI) / 180))

  return { latitude, longitude }
}

/**
 * Convert latitudeDelta to approximate zoom level
 * Based on Google Maps zoom level formula
 */
export function getZoomLevel(latitudeDelta: number): number {
  return Math.round(Math.log2(360 / latitudeDelta))
}

// ─── Grouping factor ──────────────────────────────────────────────────

// The marker's actual fixed on-screen size (see TileMarker.tsx's
// styles.marker -- 36x36px, does not scale with post count). Target
// cell size is matched to this directly, not an abstract "N markers
// across the screen" ratio: too much smaller and markers in a dense
// area would visually overlap; too much larger and too few cells span
// the viewport, risking the "isolated markers in a vast void" illusion
// in a world-anchored grid (a viewport can catch as few as 2 cells
// near a boundary, making a genuinely dense area look sparse). Keep
// this in sync with TileMarker.tsx if that graphic's size ever changes.
const MARKER_SIZE_PX = 36

// Keeps grouping factor from growing on a degenerate latitude/delta
// input (NaN, zero, etc.) rather than to bound supertile IDs --
// floor(tile / groupingFactor) shrinks toward zero as groupingFactor
// grows, it does not grow. Set high enough that it never realistically
// binds in normal use -- a cap that binds freezes the grid at that
// resolution for every coarser view below it, which is what caused
// isolated clusters sitting near a grid boundary to permanently split
// with no way to resolve by zooming out further.
const MIN_GROUPING_FACTOR = 1
const MAX_GROUPING_FACTOR = 8_388_608

// Hard ceiling on real-world supertile size, distinct from and much
// smaller than MAX_GROUPING_FACTOR above (that one guards against
// degenerate inputs, not normal zoom-out -- see its comment).
//
// Without this, groupingFactor grows without bound as the view zooms
// out, to keep hitting the MARKER_SIZE_PX on-screen target. Every time
// it crosses a power-of-2 threshold, floor(tile / groupingFactor)
// reassigns every cluster to a *different* world-anchored grid cell --
// and since a cell's rendered center is the cell's own geometric
// center, not the centroid of the data inside it (see "Tile-Based
// Marker Centers" in decisions-and-learnings), a cluster that's been a
// stable single marker for several zoom levels can suddenly jump to a
// new position, by a distance that grows with cell size -- i.e. without
// bound, the further out you zoom (issue #53). A cluster's *count* can
// also flicker between one and several markers as a real boundary
// happens to fall across its footprint at one grouping factor but not
// the next; this cap doesn't touch that (see #53).
//
// 4096 -> a 12.3km (4096 * TILE_SIZE_METERS) supertile, roughly
// city-scale. Freezing groupingFactor here means the grid stops
// realigning beyond this zoom -- no further hops are possible past this
// point, by construction. This also intentionally locks the practical
// max zoom-out for the whole app: see getMaxAllowedLongitudeDelta below,
// which the map screen uses to keep the view from ever reaching zoom
// levels where a frozen city-scale grid would mean hundreds+ of cells
// in a single viewport. Going further out than that is out of scope
// here -- see the follow-up issue on metro-scale zoom.
const CITY_CAP_GROUPING_FACTOR = 4096

/**
 * Get grouping factor based on the actual visible region's
 * longitudeDelta, latitude, and the real measured viewport width.
 *
 * metersPerPixel is derived directly from the region react-native-maps
 * actually reports -- not from a derived "zoom" integer. The previous
 * version computed metersPerPixel via the standard Web Mercator
 * formula (156543.03 * cos(lat) / 2^zoom), which is only correct if
 * zoom is calibrated against a 256px reference tile width. Our zoom
 * number (from getZoomLevel, degrees-based) carries no such
 * calibration, so on a real device (~400px wide) that formula
 * overestimated metersPerPixel by roughly 1.5-1.7x -- cells rendered
 * far larger on screen than intended, worst at high latitude where it
 * compounded with the already-narrow real viewport width. Deriving
 * metersPerPixel from longitudeDelta directly (the same value
 * getVisibleAreaMeters already uses) sidesteps the whole zoom-integer
 * abstraction and is correct by construction, regardless of device
 * width or map library internals.
 *
 * Target cell size is MARKER_SIZE_PX -- matching the marker's actual
 * rendered footprint, not an arbitrary screen-width fraction. Power-of-2
 * rounding can overshoot up to ~2x in the worst case, which from a
 * ~1/11-of-screen-width target lands around 1/5-1/6 -- comfortably
 * under the "avoid isolated-marker-in-a-void" ceiling discussed
 * without needing a separate explicit clamp for it. The one case this
 * can't cover: extreme zoom-in, where a single atomic 3m tile
 * (MIN_GROUPING_FACTOR) already renders larger than MARKER_SIZE_PX --
 * an unavoidable physical limit, not something to correct for.
 */
export function getGroupingFactor(
  longitudeDelta: number,
  latitude: number,
  viewportWidthPx: number,
): number {
  const metersPerPixel =
    (longitudeDelta * 111320 * Math.cos((latitude * Math.PI) / 180)) /
    viewportWidthPx

  const desiredSupertileMeters = MARKER_SIZE_PX * metersPerPixel
  const rawFactor = desiredSupertileMeters / TILE_SIZE_METERS

  const factor = Math.pow(
    2,
    Math.ceil(Math.log2(Math.max(rawFactor, MIN_GROUPING_FACTOR))),
  )

  return Math.min(
    CITY_CAP_GROUPING_FACTOR,
    MAX_GROUPING_FACTOR,
    Math.max(MIN_GROUPING_FACTOR, factor),
  )
}

/**
 * The smallest longitudeDelta (i.e. least zoomed out) from which
 * getGroupingFactor above is guaranteed to return
 * CITY_CAP_GROUPING_FACTOR for every delta beyond it -- i.e. the point
 * from which the grid is permanently frozen and no more hops (#53) can
 * happen, no matter how much further out the view goes.
 *
 * NOT the delta at which rawFactor reaches CITY_CAP_GROUPING_FACTOR --
 * getGroupingFactor's rounding, factor = 2^ceil(log2(rawFactor)), holds
 * factor at a given power of 2 for a whole range of rawFactor
 * (rawFactor in (CAP/2, CAP] all round to CAP), so the grid already
 * stops changing once rawFactor first exceeds CAP/2, a full zoom level
 * before rawFactor would naturally reach CAP itself. Using CAP instead
 * of CAP/2 here would pick a needlessly-far-out lock point and allow a
 * whole extra doubling-range of avoidable zoom (and viewport-cell-count
 * growth) before the lock engages, without preventing any additional
 * hops -- the grid's already static there.
 *
 * Exact, not a numeric search: solving rawFactor > CAP/2 for
 * longitudeDelta (same terms as getGroupingFactor's rawFactor
 * derivation, just solved for delta instead of for factor) gives this
 * closed form.
 *
 * The map screen uses this to clamp/snap the region back after a
 * zoom-out gesture settles -- locking the app's practical max zoom-out
 * at exactly this point. Going further out than that is out of scope
 * here (the grid would be frozen but a viewport at that scale puts far
 * more cells in view than the MAX_MARKERS budget assumes) -- see the
 * follow-up issue on metro-scale zoom.
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

/**
 * Get supertile ID from regular tile ID and grouping factor
 * Supertile groups tiles into larger units for better performance
 */
export function getSupertileId(tileId: string, groupingFactor: number): string {
  const [latTile, lngTile] = tileId.split(":").map(Number)

  const superLatTile = Math.floor(latTile / groupingFactor)
  const superLngTile = Math.floor(lngTile / groupingFactor)

  return `${superLatTile}:${superLngTile}`
}

/**
 * Get center of a supertile
 */
export function getSupertileCenter(
  superTileId: string,
  groupingFactor: number,
): { latitude: number; longitude: number } {
  const [superLatTile, superLngTile] = superTileId.split(":").map(Number)

  // Center is at the middle of the grouped tiles
  const centerLatTile = superLatTile * groupingFactor + groupingFactor / 2
  const centerLngTile = superLngTile * groupingFactor + groupingFactor / 2

  const latitude = (centerLatTile * TILE_SIZE_METERS) / 111320
  const longitude =
    (centerLngTile * TILE_SIZE_METERS) /
    (111320 * Math.cos((latitude * Math.PI) / 180))

  return { latitude, longitude }
}

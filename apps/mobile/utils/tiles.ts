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

  return Math.min(MAX_GROUPING_FACTOR, Math.max(MIN_GROUPING_FACTOR, factor))
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

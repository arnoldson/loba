/**
 * Server-side supertile grid math for the density query.
 *
 * Previously this logic (or approximations of it) existed in three
 * places at once: the client computed its own groupingFactor and grid
 * boundaries to decide what to display, the server independently
 * re-derived grid identity to decide what to group posts by, and the
 * two had to be kept in agreement by hand across two codebases --
 * which is exactly how #52, #58, and #58's follow-up all happened. Now
 * there is exactly one implementation, here. The client sends raw
 * viewport parameters (latitude, longitude, deltas, viewport width) and
 * displays whatever grid rectangle + sparse cell list this returns --
 * it does no geographic math of its own for this anymore.
 */

const TILE_SIZE_METERS = 3

// Must match apps/mobile/components/TileMarker.tsx's marker size --
// this is the on-screen pixel target the grouping factor is chosen to
// hit. See apps/mobile/utils/tiles.ts's own copy of this constant
// (kept there too, for the client's zoom-lock feature, which still
// needs to reason about on-screen marker size independently -- see
// that file's comments) for the full rationale.
const MARKER_SIZE_PX = 36

const MIN_GROUPING_FACTOR = 1
const MAX_GROUPING_FACTOR = 8_388_608

// City-scale ceiling on real-world supertile size -- see issue #53.
// Must match apps/mobile/utils/tiles.ts's CITY_CAP_GROUPING_FACTOR
// exactly. The client separately enforces a max zoom-out (its own
// getMaxAllowedLongitudeDelta) as a UX snap-back so the camera never
// even reaches a delta that would need this cap to bind server-side --
// but this cap still exists here independently, as the actual
// data-level invariant: even if the client's zoom-lock were ever
// bypassed or wrong, this clamp is what actually prevents the grid
// from growing without bound.
const CITY_CAP_GROUPING_FACTOR = 4096

// Fixed reference latitude for the longitude term's cos() correction in
// GRID IDENTITY math -- which supertile a real-world point belongs to.
// See the equivalent constant's comment in apps/mobile/utils/tiles.ts
// for the full history (corner-inversion, then client/backend
// mismatch, then cross-fetch drift -- all fixed by moving to one fixed
// constant). The client no longer has its own copy of this at all now
// that it doesn't compute grid identity -- this is the only place it
// needs to exist.
export const GRID_REFERENCE_LATITUDE = 0

/**
 * Choose a groupingFactor so supertiles render at roughly
 * MARKER_SIZE_PX on screen, given the viewport's real dimensions.
 * Direct port of apps/mobile/utils/tiles.ts's getGroupingFactor -- see
 * that function's comments for the full derivation (metersPerPixel
 * from longitudeDelta directly, power-of-2 rounding, the two-tier
 * clamp). Must stay in sync with the client's copy: not because the
 * client still computes this itself (it doesn't, anymore), but because
 * the client's zoom-lock (getMaxAllowedLongitudeDelta) independently
 * predicts where CITY_CAP_GROUPING_FACTOR will engage, and that
 * prediction is only correct if both sides agree on how groupingFactor
 * is chosen.
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

export interface GridRect {
  groupingFactor: number
  // World-anchored supertile-unit coordinates of the grid's
  // south-west corner cell -- row 0 / col 0 in the M x N grid is this
  // cell; row increases northward, col increases eastward.
  gridOrigin: { latTile: number; lngTile: number }
  gridWidth: number
  gridHeight: number
  // Exact real-world rectangle spanned by the M x N grid -- snapped
  // outward to the grid's own boundaries (no partial edge cells),
  // matching the old client-side snapBoundsToGrid's behavior. The
  // client interpolates a cell's center directly within this rectangle
  // using (row, col, gridWidth, gridHeight) -- plain proportional math,
  // no cos() needed, because GRID_REFERENCE_LATITUDE being a fixed
  // constant makes both axes linear across the whole rectangle.
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
}

/**
 * Compute the full world-anchored supertile grid rectangle covering a
 * viewport -- the server-side equivalent of the old client
 * getVisibleSupertileIds + snapBoundsToGrid combined.
 */
export function computeGridRect(
  latitude: number,
  longitude: number,
  latitudeDelta: number,
  longitudeDelta: number,
  viewportWidthPx: number,
): GridRect {
  const groupingFactor = getGroupingFactor(
    longitudeDelta,
    latitude,
    viewportWidthPx,
  )

  const minLat = latitude - latitudeDelta / 2
  const maxLat = latitude + latitudeDelta / 2
  const minLng = longitude - longitudeDelta / 2
  const maxLng = longitude + longitudeDelta / 2

  const cosRef = Math.cos((GRID_REFERENCE_LATITUDE * Math.PI) / 180)

  const minLatTile = Math.floor((minLat * 111320) / TILE_SIZE_METERS)
  const maxLatTile = Math.floor((maxLat * 111320) / TILE_SIZE_METERS)
  const minLngTile = Math.floor((minLng * 111320 * cosRef) / TILE_SIZE_METERS)
  const maxLngTile = Math.floor((maxLng * 111320 * cosRef) / TILE_SIZE_METERS)

  const minSuperLat = Math.floor(minLatTile / groupingFactor)
  const maxSuperLat = Math.floor(maxLatTile / groupingFactor)
  const minSuperLng = Math.floor(minLngTile / groupingFactor)
  const maxSuperLng = Math.floor(maxLngTile / groupingFactor)

  const gridOrigin = { latTile: minSuperLat, lngTile: minSuperLng }
  const gridWidth = maxSuperLng - minSuperLng + 1
  const gridHeight = maxSuperLat - minSuperLat + 1

  const boundMinLat = (minSuperLat * groupingFactor * TILE_SIZE_METERS) / 111320
  const boundMaxLat =
    ((maxSuperLat + 1) * groupingFactor * TILE_SIZE_METERS) / 111320
  const boundMinLng =
    (minSuperLng * groupingFactor * TILE_SIZE_METERS) / (111320 * cosRef)
  const boundMaxLng =
    ((maxSuperLng + 1) * groupingFactor * TILE_SIZE_METERS) / (111320 * cosRef)

  return {
    groupingFactor,
    gridOrigin,
    gridWidth,
    gridHeight,
    bounds: {
      minLat: boundMinLat,
      maxLat: boundMaxLat,
      minLng: boundMinLng,
      maxLng: boundMaxLng,
    },
  }
}

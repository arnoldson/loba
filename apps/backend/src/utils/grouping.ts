/**
 * Server-side sector grid math for the density query (#63).
 *
 * Grid IDENTITY (which sector a point belongs to) is now computed
 * purely relative to the CURRENT request's own (snapped) viewport --
 * there is no more persistent, world-anchored tile/supertile grid. A
 * previous version of this file anchored longitude's cos() correction
 * to a fixed GRID_REFERENCE_LATITUDE=0 (the equator), which meant real-
 * world cell width was computed correctly only at the equator -- at
 * Seoul (~37.5N) this made cells non-square in real meters and produced
 * overlapping markers (#63, superseding the deferred #60). Cells are
 * now sized using the viewport's own latitude, eliminating that
 * distortion at the root instead of compensating for it with a
 * "better" fixed reference (which would just be wrong somewhere else).
 *
 * Since there's no persistent identity, a sector's row/col numbering is
 * only meaningful within one response -- see computeSectorGeometry's
 * snapBounds step for how repeat/overlapping requests still agree on
 * sector boundaries (needed for the client's DensityCache and for
 * marker position/key stability -- see apps/mobile/utils/postGrouping.ts).
 */

const TILE_SIZE_METERS = 3
const METERS_PER_DEGREE = 111320

// Must match apps/mobile/components/TileMarker.tsx's marker size -- the
// on-screen pixel target the grouping factor is chosen to hit.
const MARKER_SIZE_PX = 36

const MIN_GROUPING_FACTOR = 1
const MAX_GROUPING_FACTOR = 8_388_608

// City-scale ceiling on real-world sector size -- see issue #53. Must
// match apps/mobile/utils/tiles.ts's CITY_CAP_GROUPING_FACTOR exactly --
// the client's own zoom-lock (getMaxAllowedLongitudeDelta) predicts
// where this cap engages so it can snap back instantly on a zoom
// gesture, without a network round-trip.
const CITY_CAP_GROUPING_FACTOR = 4096

// How much coarser the snap grid is than a sector cell -- see
// computeSectorGeometry. Larger means fewer distinct snapped bboxes
// (better cache/key stability across small pans) at the cost of a
// larger query envelope per request.
const SNAP_STEP_MULTIPLIER = 4

export interface Bounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

/**
 * Choose a groupingFactor so sectors render at roughly MARKER_SIZE_PX
 * on screen, given the viewport's real dimensions. Already correctly
 * uses the request's own latitude for the meters-per-pixel conversion
 * -- this part was never the source of #63's distortion, only grid
 * identity (computeSectorGeometry below) was.
 */
export function getGroupingFactor(
  longitudeDelta: number,
  latitude: number,
  viewportWidthPx: number,
): number {
  const metersPerPixel =
    (longitudeDelta * METERS_PER_DEGREE * Math.cos((latitude * Math.PI) / 180)) /
    viewportWidthPx

  const desiredSectorMeters = MARKER_SIZE_PX * metersPerPixel
  const rawFactor = desiredSectorMeters / TILE_SIZE_METERS

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
 * Snap a raw viewport bbox outward to a coarser, latitude-INDEPENDENT
 * grid before any sector geometry is derived from it -- the hard
 * requirement from #63: overlapping/near-identical requests (a small
 * pan, a zoom in/out) must agree on sector boundaries, or markers
 * jitter and the client's DensityCache keys thrash for no reason.
 *
 * Deliberately no cos() term on either axis here (unlike the real
 * per-cell geometry below, which does need one) -- this stage only
 * picks reproducible anchor lines, so two requests at slightly
 * different latitudes but the same raw longitude corners must still
 * snap identically. Introducing latitude here would reintroduce the
 * exact "grid identity depends on which of two nearby latitudes you
 * used" instability this function exists to prevent.
 */
function snapBounds(raw: Bounds, groupingFactor: number): Bounds {
  const stepDeg =
    (SNAP_STEP_MULTIPLIER * groupingFactor * TILE_SIZE_METERS) /
    METERS_PER_DEGREE

  return {
    minLat: Math.floor(raw.minLat / stepDeg) * stepDeg,
    maxLat: Math.ceil(raw.maxLat / stepDeg) * stepDeg,
    minLng: Math.floor(raw.minLng / stepDeg) * stepDeg,
    maxLng: Math.ceil(raw.maxLng / stepDeg) * stepDeg,
  }
}

export interface SectorGeometry {
  groupingFactor: number
  cellMeters: number
  // cos(refLat) for the longitude axis, refLat taken from the SNAPPED
  // bbox's center -- fixed per-request once snapping has happened, so
  // both axes stay linear across the whole geometry (cellBounds/
  // cellCenter can invert it with plain arithmetic).
  cosRef: number
  xMin: number
  yMin: number
  numCols: number
  numRows: number
  // Exact real-world rectangle the geometry covers, grown outward to a
  // whole number of cells on the longitude axis (the snap step is
  // already an exact multiple of cellMeters on the latitude axis, see
  // below) -- this is what the SQL query's bounding envelope uses.
  queryBounds: Bounds
}

/**
 * Compute the sector grid geometry covering a viewport -- the
 * per-request equivalent of the old world-anchored computeGridRect,
 * but with no persistent identity and no fixed reference latitude.
 */
export function computeSectorGeometry(
  latitude: number,
  longitude: number,
  latitudeDelta: number,
  longitudeDelta: number,
  viewportWidthPx: number,
): SectorGeometry {
  const groupingFactor = getGroupingFactor(
    longitudeDelta,
    latitude,
    viewportWidthPx,
  )
  const cellMeters = groupingFactor * TILE_SIZE_METERS

  const rawBounds: Bounds = {
    minLat: latitude - latitudeDelta / 2,
    maxLat: latitude + latitudeDelta / 2,
    minLng: longitude - longitudeDelta / 2,
    maxLng: longitude + longitudeDelta / 2,
  }
  const snapped = snapBounds(rawBounds, groupingFactor)

  const refLat = (snapped.minLat + snapped.maxLat) / 2
  const cosRef = Math.cos((refLat * Math.PI) / 180)

  const yMin = snapped.minLat * METERS_PER_DEGREE
  const yMax = snapped.maxLat * METERS_PER_DEGREE
  const xMin = snapped.minLng * METERS_PER_DEGREE * cosRef
  const xMax = snapped.maxLng * METERS_PER_DEGREE * cosRef

  // Exact by construction: snapBounds's stepDeg is
  // (SNAP_STEP_MULTIPLIER * cellMeters / METERS_PER_DEGREE), so the
  // snapped lat span is always an integer multiple of
  // SNAP_STEP_MULTIPLIER * cellMeters in real meters.
  const numRows = Math.round((yMax - yMin) / cellMeters)

  // Not generally exact on this axis -- cosRef compresses it -- so grow
  // the max edge outward rather than truncate a partial edge cell.
  const numCols = Math.ceil((xMax - xMin) / cellMeters)
  const grownXMax = xMin + numCols * cellMeters

  return {
    groupingFactor,
    cellMeters,
    cosRef,
    xMin,
    yMin,
    numCols,
    numRows,
    queryBounds: {
      minLat: snapped.minLat,
      maxLat: snapped.maxLat,
      minLng: snapped.minLng,
      maxLng: grownXMax / (METERS_PER_DEGREE * cosRef),
    },
  }
}

export function cellBounds(
  geom: SectorGeometry,
  row: number,
  col: number,
): Bounds {
  return {
    minLat: (geom.yMin + row * geom.cellMeters) / METERS_PER_DEGREE,
    maxLat: (geom.yMin + (row + 1) * geom.cellMeters) / METERS_PER_DEGREE,
    minLng:
      (geom.xMin + col * geom.cellMeters) / (METERS_PER_DEGREE * geom.cosRef),
    maxLng:
      (geom.xMin + (col + 1) * geom.cellMeters) /
      (METERS_PER_DEGREE * geom.cosRef),
  }
}

export function cellCenter(
  geom: SectorGeometry,
  row: number,
  col: number,
): { latitude: number; longitude: number } {
  const b = cellBounds(geom, row, col)
  return {
    latitude: (b.minLat + b.maxLat) / 2,
    longitude: (b.minLng + b.maxLng) / 2,
  }
}

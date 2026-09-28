/**
 * Server-side sector grid math for the density query (#63, #93).
 *
 * The grid lives in Web Mercator space -- the projection the map itself
 * is drawn in -- not in lat/lng degrees. Every degree-based grid has to
 * compensate for a degree of longitude shrinking by cos(latitude)
 * somewhere: a fixed reference latitude made cells narrow at high
 * latitude (#60), a per-request one made the grid (and so every marker)
 * shift whenever a pan crossed a snap step (#93). Mercator is conformal,
 * so a square grid in Mercator x/y is square on screen at every
 * latitude with no cos() term at all.
 *
 * The grid is anchored at (0°, 0°) and depends only on zoom (via
 * groupingFactor): a post's row/col is a pure function of its own
 * coordinates, never of the viewport it was fetched in. Panning can't
 * move a marker, and because cell sizes are powers of two on a shared
 * origin, each cell is exactly four cells of the next zoom step in.
 *
 * Units: Mercator x/y are in "equator meters" (x = lng * METERS_PER_DEGREE),
 * so a cell of groupingFactor * TILE_SIZE_METERS is that many real
 * meters wide at the equator and cos(lat) times that elsewhere -- the
 * same scaling the map (and its scale bar) has.
 */

const TILE_SIZE_METERS = 3
export const METERS_PER_DEGREE = 111320
// Earth radius implied by METERS_PER_DEGREE, so Mercator y and x share units.
export const MERCATOR_RADIUS = (METERS_PER_DEGREE * 180) / Math.PI
// Web Mercator's own latitude limit -- y is infinite at the poles.
const MAX_MERCATOR_LATITUDE = 85.05112878

// Must match apps/mobile/components/TileMarker.tsx's marker size -- the
// on-screen pixel target the grouping factor is chosen to hit.
const MARKER_SIZE_PX = 36

const MIN_GROUPING_FACTOR = 1
const MAX_GROUPING_FACTOR = 8_388_608

// Ceiling on sector size -- see issue #53. Must match
// apps/mobile/utils/tiles.ts's CITY_CAP_GROUPING_FACTOR exactly -- the
// client's own zoom-lock (getMaxAllowedLongitudeDelta) predicts where
// this cap engages so it can snap back instantly on a zoom gesture,
// without a network round-trip.
const CITY_CAP_GROUPING_FACTOR = 8192

export interface Bounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

/**
 * Choose a groupingFactor so sectors render at roughly MARKER_SIZE_PX
 * on screen. Depends only on zoom (longitude degrees per pixel): Mercator
 * meters-per-pixel is the same at every latitude for a given zoom, so
 * the same zoom gives the same cell size everywhere.
 */
export function getGroupingFactor(
  longitudeDelta: number,
  viewportWidthPx: number,
): number {
  const metersPerPixel = (longitudeDelta * METERS_PER_DEGREE) / viewportWidthPx

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

function clampLatitude(lat: number): number {
  return Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, lat))
}

export function mercatorX(lng: number): number {
  return lng * METERS_PER_DEGREE
}

export function mercatorY(lat: number): number {
  const phi = (clampLatitude(lat) * Math.PI) / 180
  return MERCATOR_RADIUS * Math.log(Math.tan(Math.PI / 4 + phi / 2))
}

function inverseMercatorX(x: number): number {
  return x / METERS_PER_DEGREE
}

function inverseMercatorY(y: number): number {
  return ((2 * Math.atan(Math.exp(y / MERCATOR_RADIUS)) - Math.PI / 2) * 180) / Math.PI
}

export interface SectorGeometry {
  groupingFactor: number
  // Cell edge length in Mercator (equator) meters.
  cellMeters: number
  // Viewport grown outward to whole cells -- this is what the SQL
  // query's bounding envelope uses, so edge cells get their full count.
  queryBounds: Bounds
}

/**
 * The cell size for this zoom, plus the viewport grown out to whole
 * cells. Unlike the #63 version, nothing here affects which cell a post
 * is in -- that's fixed by the world-anchored grid (see cellBounds).
 */
export function computeSectorGeometry(
  latitude: number,
  longitude: number,
  latitudeDelta: number,
  longitudeDelta: number,
  viewportWidthPx: number,
): SectorGeometry {
  const groupingFactor = getGroupingFactor(longitudeDelta, viewportWidthPx)
  const cellMeters = groupingFactor * TILE_SIZE_METERS

  const minCol = Math.floor(mercatorX(longitude - longitudeDelta / 2) / cellMeters)
  const maxCol = Math.ceil(mercatorX(longitude + longitudeDelta / 2) / cellMeters)
  const minRow = Math.floor(mercatorY(latitude - latitudeDelta / 2) / cellMeters)
  const maxRow = Math.ceil(mercatorY(latitude + latitudeDelta / 2) / cellMeters)

  return {
    groupingFactor,
    cellMeters,
    queryBounds: {
      minLat: inverseMercatorY(minRow * cellMeters),
      maxLat: inverseMercatorY(maxRow * cellMeters),
      minLng: inverseMercatorX(minCol * cellMeters),
      maxLng: inverseMercatorX(maxCol * cellMeters),
    },
  }
}

/** The world-anchored cell (row counts north from the equator). */
export function cellOf(
  cellMeters: number,
  latitude: number,
  longitude: number,
): { row: number; col: number } {
  return {
    row: Math.floor(mercatorY(latitude) / cellMeters),
    col: Math.floor(mercatorX(longitude) / cellMeters),
  }
}

export function cellBounds(
  cellMeters: number,
  row: number,
  col: number,
): Bounds {
  return {
    minLat: inverseMercatorY(row * cellMeters),
    maxLat: inverseMercatorY((row + 1) * cellMeters),
    minLng: inverseMercatorX(col * cellMeters),
    maxLng: inverseMercatorX((col + 1) * cellMeters),
  }
}

/** The cell's center on screen (its Mercator midpoint). */
export function cellCenter(
  cellMeters: number,
  row: number,
  col: number,
): { latitude: number; longitude: number } {
  return {
    latitude: inverseMercatorY((row + 0.5) * cellMeters),
    longitude: inverseMercatorX((col + 0.5) * cellMeters),
  }
}

/**
 * Grid/bounds utilities for the supertile system.
 *
 * Supertiles are the fixed, world-anchored clustering grid the map view
 * displays. As of the density/detail fetch split, clustering itself
 * happens server-side (GROUP BY supertile_id) -- this file's job is:
 *   1. Determine which supertile grid cells overlap the viewport
 *   2. Snap fetch bounds outward to the grid so a supertile straddling
 *      the viewport edge is never partially counted
 *   3. Cache returned {supertile_id, count} pairs (DensityCache) --
 *      no post content, since the map view never fetches any
 *
 * TileDetailsModal fetches actual post content separately, scoped to
 * one supertile at a time, only on tap.
 */

const TILE_SIZE_METERS = 3

// ─── Coordinate Conversion ───────────────────────────────────────────

/**
 * Convert tile coordinates → lat/lng.
 * `refLat` is a reference latitude for the longitude cosine correction.
 */
export function tileToLatLng(
  latTile: number,
  lngTile: number,
  refLat: number,
): { latitude: number; longitude: number } {
  const latitude = (latTile * TILE_SIZE_METERS) / 111320
  const longitude =
    (lngTile * TILE_SIZE_METERS) / (111320 * Math.cos((refLat * Math.PI) / 180))
  return { latitude, longitude }
}

/**
 * Convert lat/lng → base tile coordinates (the inverse of tileToLatLng).
 */
export function latLngToTile(
  latitude: number,
  longitude: number,
): { latTile: number; lngTile: number } {
  const latTile = Math.floor((latitude * 111320) / TILE_SIZE_METERS)
  const lngTile = Math.floor(
    (longitude * 111320 * Math.cos((latitude * Math.PI) / 180)) /
      TILE_SIZE_METERS,
  )
  return { latTile, lngTile }
}

// ─── Supertile Grid Helpers ──────────────────────────────────────────

export interface Bounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

/**
 * Return the set of supertile IDs that overlap a bounding box at the
 * given grouping factor.
 */
export function getVisibleSupertileIds(
  bounds: Bounds,
  groupingFactor: number,
): Set<string> {
  const minTile = latLngToTile(bounds.minLat, bounds.minLng)
  const maxTile = latLngToTile(bounds.maxLat, bounds.maxLng)

  const minSuperLat = Math.floor(minTile.latTile / groupingFactor)
  const maxSuperLat = Math.floor(maxTile.latTile / groupingFactor)
  const minSuperLng = Math.floor(minTile.lngTile / groupingFactor)
  const maxSuperLng = Math.floor(maxTile.lngTile / groupingFactor)

  const ids = new Set<string>()
  for (let lat = minSuperLat; lat <= maxSuperLat; lat++) {
    for (let lng = minSuperLng; lng <= maxSuperLng; lng++) {
      ids.add(`${lat}:${lng}`)
    }
  }
  return ids
}

/**
 * Snap a bounding box outward so its edges align with the supertile grid.
 * This guarantees every fetched supertile is complete — no partial edge tiles.
 */
export function snapBoundsToGrid(
  bounds: Bounds,
  groupingFactor: number,
): Bounds {
  const refLat = (bounds.minLat + bounds.maxLat) / 2

  const minTile = latLngToTile(bounds.minLat, bounds.minLng)
  const maxTile = latLngToTile(bounds.maxLat, bounds.maxLng)

  const snappedMinLatTile =
    Math.floor(minTile.latTile / groupingFactor) * groupingFactor
  const snappedMaxLatTile =
    (Math.floor(maxTile.latTile / groupingFactor) + 1) * groupingFactor
  const snappedMinLngTile =
    Math.floor(minTile.lngTile / groupingFactor) * groupingFactor
  const snappedMaxLngTile =
    (Math.floor(maxTile.lngTile / groupingFactor) + 1) * groupingFactor

  const min = tileToLatLng(snappedMinLatTile, snappedMinLngTile, refLat)
  const max = tileToLatLng(snappedMaxLatTile, snappedMaxLngTile, refLat)

  return {
    minLat: min.latitude,
    maxLat: max.latitude,
    minLng: min.longitude,
    maxLng: max.longitude,
  }
}

// ─── Density Cache ────────────────────────────────────────────────────

export interface DensityEntry {
  supertile_id: string
  count: number
}

/**
 * A cache for map-view density data — supertile_id -> count only, no
 * post content. Backs the density/detail fetch split: the map view
 * only ever needs counts to render markers, never full post arrays.
 *
 * There's no meaningful "append a post" operation — the server
 * computed the count, so a locally-known new post can only be
 * optimistically incremented (see incrementCount), not derived.
 * The next real fetch reconciles it with the server's true count.
 */
export class DensityCache {
  private cache = new Map<string, number>()
  private currentGroupingFactor: number | null = null

  /**
   * Store density entries. If groupingFactor changed, clears the old
   * cache first — a count computed at one grid size is meaningless at
   * another.
   */
  addDensity(entries: DensityEntry[], groupingFactor: number): void {
    if (this.currentGroupingFactor !== groupingFactor) {
      this.cache.clear()
      this.currentGroupingFactor = groupingFactor
    }

    for (const entry of entries) {
      this.cache.set(entry.supertile_id, entry.count)
    }
  }

  get(supertileId: string): number | undefined {
    return this.cache.get(supertileId)
  }

  getMissing(visibleIds: Set<string>, groupingFactor: number): Set<string> {
    if (this.currentGroupingFactor !== groupingFactor) {
      return new Set(visibleIds)
    }
    const missing = new Set<string>()
    for (const id of visibleIds) {
      if (!this.cache.has(id)) {
        missing.add(id)
      }
    }
    return missing
  }

  /**
   * Return cached entries for the visible set, with centers computed
   * on demand via getSupertileCenter — center isn't stored, since it's
   * cheap to derive and storing it would just be denormalized state
   * that could drift from the grid math.
   */
  getVisible(
    visibleIds: Set<string>,
    getCenterFn: (id: string) => { latitude: number; longitude: number },
  ): {
    supertile_id: string
    count: number
    center: { latitude: number; longitude: number }
  }[] {
    const result: {
      supertile_id: string
      count: number
      center: { latitude: number; longitude: number }
    }[] = []
    for (const id of visibleIds) {
      const count = this.cache.get(id)
      if (count !== undefined) {
        result.push({ supertile_id: id, count, center: getCenterFn(id) })
      }
    }
    return result
  }

  evictOutside(keepIds: Set<string>): number {
    let evicted = 0
    for (const id of this.cache.keys()) {
      if (!keepIds.has(id)) {
        this.cache.delete(id)
        evicted++
      }
    }
    return evicted
  }

  /**
   * Optimistically bump a supertile's count by 1 (e.g. user just
   * created a post there). Not authoritative — the next real fetch
   * reconciles with the server's true count.
   */
  incrementCount(supertileId: string, groupingFactor: number): void {
    if (this.currentGroupingFactor !== groupingFactor) return
    const existing = this.cache.get(supertileId)
    this.cache.set(supertileId, (existing ?? 0) + 1)
  }

  /** Invalidate a single entry, forcing a re-fetch on next request. */
  invalidate(supertileId: string): void {
    this.cache.delete(supertileId)
  }

  clear(): void {
    this.cache.clear()
    this.currentGroupingFactor = null
  }

  get size(): number {
    return this.cache.size
  }

  get groupingFactor(): number | null {
    return this.currentGroupingFactor
  }
}

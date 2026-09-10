/**
 * Client-side density cache and cell-center interpolation.
 *
 * All grid/bounds computation (grouping factor, which cells overlap a
 * viewport, supertile boundaries) now lives entirely server-side -- see
 * apps/backend/src/utils/grouping.ts and issue #58's follow-up. This
 * file's job is much smaller than it used to be:
 *   1. Interpolate a cell's center within the grid rectangle the server
 *      returned -- plain proportional math, no geographic computation.
 *   2. Cache {supertile_id, count, center} entries between fetches.
 *
 * TileDetailsModal fetches actual post content separately, scoped to
 * one supertile at a time, only on tap -- unaffected by any of this.
 */

export interface Bounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export interface DensityEntry {
  supertile_id: string
  count: number
  center: { latitude: number; longitude: number }
}

/**
 * A cell's center, found by plain proportional interpolation of its
 * (row, col) position within the grid's exact real-world `bounds` --
 * no cos() or tile-index math needed. This only works out to be exact
 * (not an approximation) because the server's GRID_REFERENCE_LATITUDE
 * is a fixed constant rather than derived per-request: that makes both
 * axes of the grid linear across the whole rectangle, so proportional
 * interpolation lands on exactly the same point the server's own tile
 * formula would compute for that cell. row 0/col 0 is `bounds`'s
 * south-west corner (gridOrigin from the server response); row
 * increases northward, col increases eastward -- matching how the
 * server numbers cells relative to gridOrigin.
 */
export function interpolateCellCenter(
  row: number,
  col: number,
  gridWidth: number,
  gridHeight: number,
  bounds: Bounds,
): { latitude: number; longitude: number } {
  const latFrac = (row + 0.5) / gridHeight
  const lngFrac = (col + 0.5) / gridWidth
  return {
    latitude: bounds.minLat + latFrac * (bounds.maxLat - bounds.minLat),
    longitude: bounds.minLng + lngFrac * (bounds.maxLng - bounds.minLng),
  }
}

/**
 * A cache for map-view density data -- supertile_id -> {count, center}.
 * Backs the density fetch: the map view only ever needs counts and
 * positions to render markers, never full post content.
 *
 * Centers are stored, not derived lazily on display (the old design,
 * back when the client could independently recompute a center from an
 * ID string via its own cos() math): a cell's center can now only be
 * computed once, at the moment its response arrives, using THAT
 * response's own grid rectangle (bounds/gridWidth/gridHeight) --
 * there's no way to correctly recompute it later from just the ID,
 * once the client no longer does geographic math of its own. See
 * addDensity below.
 *
 * No getMissing/cache-hit-skip-fetch optimization anymore: that
 * required the client to independently compute which cells a viewport
 * needed, to check against the cache before deciding whether to fetch
 * -- exactly the computation being deleted. The map screen now simply
 * fetches on every pan/zoom-stop (still throttled/debounced), and this
 * cache's job is just to have something to display immediately while a
 * new fetch is in flight, and to avoid unbounded growth via
 * evictOutside.
 *
 * No incrementCount either -- the old optimistic post-creation bump
 * needed client-side tile math (which supertile did this post land in)
 * that no longer exists; post creation now just triggers a normal
 * re-fetch instead.
 */
export class DensityCache {
  private cache = new Map<
    string,
    { count: number; center: { latitude: number; longitude: number } }
  >()
  private currentGroupingFactor: number | null = null

  /**
   * Store density entries. If groupingFactor changed, clears the old
   * cache first — a cell computed at one grid size is meaningless at
   * another.
   */
  addDensity(entries: DensityEntry[], groupingFactor: number): void {
    if (this.currentGroupingFactor !== groupingFactor) {
      this.cache.clear()
      this.currentGroupingFactor = groupingFactor
    }

    for (const entry of entries) {
      this.cache.set(entry.supertile_id, {
        count: entry.count,
        center: entry.center,
      })
    }
  }

  get(supertileId: string): number | undefined {
    return this.cache.get(supertileId)?.count
  }

  /** Return cached entries for the given IDs, with their stored centers. */
  getVisible(visibleIds: Set<string>): DensityEntry[] {
    const result: DensityEntry[] = []
    for (const id of visibleIds) {
      const entry = this.cache.get(id)
      if (entry) {
        result.push({
          supertile_id: id,
          count: entry.count,
          center: entry.center,
        })
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

/**
 * Client-side density cache.
 *
 * All grid/bounds computation (grouping factor, sector geometry) lives
 * entirely server-side -- see apps/backend/src/utils/grouping.ts. Each
 * sector in a density response already carries its own center and
 * bounds directly (#63), so this file no longer does any geographic
 * math at all -- it's purely a display cache: {key, count, center,
 * bounds} entries keyed by `key`, a hash of the sector's member post
 * IDs (never its coordinates, so identical membership always produces
 * the same key across a pan/zoom that doesn't change what's shown).
 *
 * TileDetailsModal fetches actual post content separately, scoped to
 * one sector's bounds at a time, only on tap -- unaffected by any of
 * this.
 */

export interface Bounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export interface DensityEntry {
  key: string
  count: number
  center: { latitude: number; longitude: number }
  bounds: Bounds
}

/**
 * A cache for map-view density data -- key -> {count, center, bounds}.
 * Backs the density fetch: the map view only ever needs counts and
 * positions to render markers, never full post content.
 *
 * No cache-hit-skip-fetch optimization: the map screen fetches on every
 * pan/zoom-stop (still throttled/debounced), and this cache's job is
 * just to have something to display immediately while a new fetch is
 * in flight, and to avoid unbounded growth via evictOutside.
 */
export class DensityCache {
  private cache = new Map<
    string,
    { count: number; center: { latitude: number; longitude: number }; bounds: Bounds }
  >()
  private currentGroupingFactor: number | null = null

  /**
   * Store density entries. If groupingFactor changed, clears the old
   * cache first — a key computed at one cell size is meaningless at
   * another.
   */
  addDensity(entries: DensityEntry[], groupingFactor: number): void {
    if (this.currentGroupingFactor !== groupingFactor) {
      this.cache.clear()
      this.currentGroupingFactor = groupingFactor
    }

    for (const entry of entries) {
      this.cache.set(entry.key, {
        count: entry.count,
        center: entry.center,
        bounds: entry.bounds,
      })
    }
  }

  get(key: string): number | undefined {
    return this.cache.get(key)?.count
  }

  /** Return cached entries for the given keys. */
  getVisible(visibleKeys: Set<string>): DensityEntry[] {
    const result: DensityEntry[] = []
    for (const key of visibleKeys) {
      const entry = this.cache.get(key)
      if (entry) {
        result.push({
          key,
          count: entry.count,
          center: entry.center,
          bounds: entry.bounds,
        })
      }
    }
    return result
  }

  evictOutside(keepKeys: Set<string>): number {
    let evicted = 0
    for (const key of this.cache.keys()) {
      if (!keepKeys.has(key)) {
        this.cache.delete(key)
        evicted++
      }
    }
    return evicted
  }

  /** Invalidate a single entry, forcing a re-fetch on next request. */
  invalidate(key: string): void {
    this.cache.delete(key)
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

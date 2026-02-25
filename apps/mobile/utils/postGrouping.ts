/**
 * Post grouping utilities for creating SuperTiles.
 *
 * The supertile is the fundamental unit of caching and display.
 * Posts are grouped into supertiles based on the current zoom level,
 * and the cache stores complete supertiles — not individual posts.
 *
 * Flow:
 *   1. Determine visible supertile grid cells from viewport bounds
 *   2. Check which cells are already cached
 *   3. Fetch only the missing region (snapped to supertile grid boundaries)
 *   4. Group fetched posts into supertiles → store in cache
 *   5. Display from cache — filter to visible grid cells
 */

import type { PublicPost } from "@loba/shared"

const TILE_SIZE_METERS = 3

export interface SuperTile {
  supertile_id: string
  count: number
  posts: PublicPost[]
  center: {
    latitude: number
    longitude: number
  }
}

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

// ─── Post → SuperTile Grouping ───────────────────────────────────────

/**
 * Normalize a post's coordinates (handle PostgreSQL string serialization).
 */
function normalizePost(
  post: PublicPost,
): PublicPost & { latitude: number; longitude: number } {
  return {
    ...post,
    latitude:
      typeof post.latitude === "string"
        ? parseFloat(post.latitude)
        : post.latitude,
    longitude:
      typeof post.longitude === "string"
        ? parseFloat(post.longitude)
        : post.longitude,
  }
}

/**
 * Group an array of posts into SuperTiles at the given grouping factor.
 * Returns a Map keyed by supertile_id for easy cache insertion.
 */
export function groupPostsIntoSupertiles(
  posts: PublicPost[],
  groupingFactor: number,
): Map<string, SuperTile> {
  const validPosts = posts
    .filter(
      (p) =>
        p.latitude != null &&
        p.longitude != null &&
        !isNaN(Number(p.latitude)) &&
        !isNaN(Number(p.longitude)),
    )
    .map(normalizePost)

  // Bucket posts by supertile_id
  const buckets = new Map<string, PublicPost[]>()

  for (const post of validPosts) {
    const [latTileStr, lngTileStr] = post.tile_id.split(":")
    const latTile = parseInt(latTileStr)
    const lngTile = parseInt(lngTileStr)

    const superLatTile = Math.floor(latTile / groupingFactor)
    const superLngTile = Math.floor(lngTile / groupingFactor)
    const id = `${superLatTile}:${superLngTile}`

    if (!buckets.has(id)) buckets.set(id, [])
    buckets.get(id)!.push(post)
  }

  // Build SuperTile objects
  const result = new Map<string, SuperTile>()

  buckets.forEach((groupPosts, supertile_id) => {
    const [superLatTile, superLngTile] = supertile_id.split(":").map(Number)

    const centerLatTile = superLatTile * groupingFactor + groupingFactor / 2
    const centerLngTile = superLngTile * groupingFactor + groupingFactor / 2

    const avgLat =
      groupPosts.reduce((sum, p) => sum + (p.latitude as number), 0) /
      groupPosts.length

    const center = tileToLatLng(centerLatTile, centerLngTile, avgLat)

    result.set(supertile_id, {
      supertile_id,
      count: groupPosts.length,
      posts: groupPosts,
      center,
    })
  })

  return result
}

// ─── Backward-compatible wrapper ─────────────────────────────────────

/**
 * Original function signature kept for any code that still calls it.
 * Prefer `groupPostsIntoSupertiles()` + `SupertileCache` for new code.
 */
export function groupPostsByZoomLevel(
  posts: PublicPost[],
  groupingFactor: number,
): SuperTile[] {
  const map = groupPostsIntoSupertiles(posts, groupingFactor)
  const result = Array.from(map.values())
  console.log(
    `🔍 Grouping: ${posts.length} posts → ${result.length} markers (factor: ${groupingFactor})`,
  )
  return result
}

// ─── Supertile Cache ─────────────────────────────────────────────────

/**
 * A cache that stores complete supertiles, keyed by supertile_id.
 *
 * The cache only holds tiles for a single grouping factor at a time.
 * When the zoom band changes (and thus the grouping factor), the cache
 * is cleared because the grid is completely different.
 */
export class SupertileCache {
  private cache = new Map<string, SuperTile>()
  private currentGroupingFactor: number | null = null

  /**
   * Store supertiles. If groupingFactor changed, clears the old cache first.
   */
  addSupertiles(
    supertiles: Map<string, SuperTile>,
    groupingFactor: number,
  ): void {
    if (this.currentGroupingFactor !== groupingFactor) {
      console.log(
        `🔄 Grouping factor changed ${this.currentGroupingFactor} → ${groupingFactor}, clearing supertile cache`,
      )
      this.cache.clear()
      this.currentGroupingFactor = groupingFactor
    }

    for (const [id, tile] of supertiles) {
      this.cache.set(id, tile)
    }

    console.log(`💾 Supertile cache: ${this.cache.size} tiles stored`)
  }

  /**
   * Get a single cached supertile, or undefined if not cached.
   */
  get(supertileId: string): SuperTile | undefined {
    return this.cache.get(supertileId)
  }

  /**
   * Check which of the given supertile IDs are NOT in cache.
   */
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
   * Return all cached supertiles whose IDs are in the visible set.
   */
  getVisible(visibleIds: Set<string>): SuperTile[] {
    const result: SuperTile[] = []
    for (const id of visibleIds) {
      const tile = this.cache.get(id)
      if (tile) result.push(tile)
    }
    return result
  }

  /**
   * Evict supertiles not in the keep set. Call with an expanded set of IDs
   * (e.g., 2× viewport) to maintain a buffer zone around the viewport.
   */
  evictOutside(keepIds: Set<string>): number {
    let evicted = 0
    for (const id of this.cache.keys()) {
      if (!keepIds.has(id)) {
        this.cache.delete(id)
        evicted++
      }
    }
    if (evicted > 0) {
      console.log(`🗑️ Evicted ${evicted} supertiles, ${this.cache.size} remain`)
    }
    return evicted
  }

  /** Add a single post (e.g., user just created one). */
  addPost(post: PublicPost, groupingFactor: number): void {
    if (this.currentGroupingFactor !== groupingFactor) return

    const normalized = normalizePost(post)
    const [latTileStr, lngTileStr] = normalized.tile_id.split(":")
    const latTile = parseInt(latTileStr)
    const lngTile = parseInt(lngTileStr)
    const superLatTile = Math.floor(latTile / groupingFactor)
    const superLngTile = Math.floor(lngTile / groupingFactor)
    const id = `${superLatTile}:${superLngTile}`

    const existing = this.cache.get(id)
    if (existing) {
      existing.posts.push(normalized)
      existing.count = existing.posts.length
    } else {
      const centerLatTile = superLatTile * groupingFactor + groupingFactor / 2
      const centerLngTile = superLngTile * groupingFactor + groupingFactor / 2
      const center = tileToLatLng(
        centerLatTile,
        centerLngTile,
        normalized.latitude,
      )
      this.cache.set(id, {
        supertile_id: id,
        count: 1,
        posts: [normalized],
        center,
      })
    }
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

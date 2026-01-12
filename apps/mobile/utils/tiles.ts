/**
 * Tile utilities for Loba
 * Handles 3m × 3m tile calculations and zoom-based grouping
 */

// Each tile is 3m × 3m
const TILE_SIZE_METERS = 3;

/**
 * Calculate tile ID from GPS coordinates
 * Format: "latTile:lngTile"
 */
export function getTileId(lat: number, lng: number): string {
  const latTile = Math.floor((lat * 111320) / TILE_SIZE_METERS);
  const lngTile = Math.floor(
    (lng * 111320 * Math.cos((lat * Math.PI) / 180)) / TILE_SIZE_METERS
  );
  return `${latTile}:${lngTile}`;
}

/**
 * Get center coordinates of a tile
 */
export function getTileCenter(tileId: string): {
  latitude: number;
  longitude: number;
} {
  const [latTile, lngTile] = tileId.split(":").map(Number);

  const latitude = (latTile * TILE_SIZE_METERS) / 111320;
  const longitude =
    (lngTile * TILE_SIZE_METERS) /
    (111320 * Math.cos((latitude * Math.PI) / 180));

  return { latitude, longitude };
}

/**
 * Get array of tile IDs in a square radius around a center point
 * @param centerLat - Center latitude
 * @param centerLng - Center longitude
 * @param radius - Number of tiles in each direction (total grid is (2*radius+1)×(2*radius+1))
 * @returns Array of tile IDs
 */
export function getTileRange(
  centerLat: number,
  centerLng: number,
  radius: number
): string[] {
  const centerTileId = getTileId(centerLat, centerLng);
  const [centerLatTile, centerLngTile] = centerTileId.split(":").map(Number);

  const tileIds: string[] = [];

  for (let latOffset = -radius; latOffset <= radius; latOffset++) {
    for (let lngOffset = -radius; lngOffset <= radius; lngOffset++) {
      const latTile = centerLatTile + latOffset;
      const lngTile = centerLngTile + lngOffset;
      tileIds.push(`${latTile}:${lngTile}`);
    }
  }

  return tileIds;
}

/**
 * Convert latitudeDelta to approximate zoom level
 * Based on Google Maps zoom level formula
 */
export function getZoomLevel(latitudeDelta: number): number {
  return Math.round(Math.log2(360 / latitudeDelta));
}

/**
 * OPTIMIZED: Get grouping factor based on zoom level
 *
 * VERY aggressive progression based on actual clustering test data:
 * - Zoom 20:    factor = 1   (3m × 3m - atomic tiles)
 * - Zoom 19:    factor = 2   (6m × 6m)
 * - Zoom 18:    factor = 4   (12m × 12m)
 * - Zoom 17:    factor = 8   (24m × 24m)
 * - Zoom 16:    factor = 16  (48m × 48m)
 * - Zoom 15:    factor = 32  (96m × 96m)
 * - Zoom 14:    factor = 64  (192m × 192m)
 * - Zoom 13:    factor = 128 (384m × 384m)
 * - Zoom < 13:  factor = 256 (768m × 768m)
 * - Zoom < 11:  null (too zoomed out, hide markers)
 *
 * This produces optimal marker density matching screen-space clustering results:
 * - Zoom 15: ~10-15 markers (was 115→12 with clustering)
 * - Zoom 16: ~20-30 markers (was 115→28 with clustering)
 * - Zoom 17: ~40-60 markers (was 138→52 with clustering)
 * - Zoom 18: ~80-100 markers (was 139→86 with clustering)
 * - Zoom 19: ~120-140 markers (was 147→127 with clustering)
 * - Zoom 20: ~140-150 markers (was 147→147 with clustering)
 */
export function getGroupingFactor(zoom: number): number | null {
  if (zoom >= 20) return 1;
  if (zoom >= 19) return 2;
  if (zoom >= 18) return 4;
  if (zoom >= 17) return 8;
  if (zoom >= 16) return 16;
  if (zoom >= 15) return 32;
  if (zoom >= 14) return 64;
  if (zoom >= 13) return 128;
  if (zoom >= 11) return 256;

  // Too zoomed out - don't show markers
  return null;
}

/**
 * Get supertile ID from regular tile ID and grouping factor
 * Supertile groups tiles into larger units for better performance
 */
export function getSupertileId(tileId: string, groupingFactor: number): string {
  const [latTile, lngTile] = tileId.split(":").map(Number);

  const superLatTile = Math.floor(latTile / groupingFactor);
  const superLngTile = Math.floor(lngTile / groupingFactor);

  return `${superLatTile}:${superLngTile}`;
}

/**
 * Get center of a supertile
 */
export function getSupertileCenter(
  superTileId: string,
  groupingFactor: number
): { latitude: number; longitude: number } {
  const [superLatTile, superLngTile] = superTileId.split(":").map(Number);

  // Center is at the middle of the grouped tiles
  const centerLatTile = superLatTile * groupingFactor + groupingFactor / 2;
  const centerLngTile = superLngTile * groupingFactor + groupingFactor / 2;

  const latitude = (centerLatTile * TILE_SIZE_METERS) / 111320;
  const longitude =
    (centerLngTile * TILE_SIZE_METERS) /
    (111320 * Math.cos((latitude * Math.PI) / 180));

  return { latitude, longitude };
}

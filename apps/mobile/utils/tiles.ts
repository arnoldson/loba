const TILE_SIZE_METERS = 3;
const METERS_PER_DEGREE_LAT = 111320;

/**
 * Calculate tile ID from coordinates
 */
export function getTileId(latitude: number, longitude: number): string {
  const latTile = Math.floor(latitude * METERS_PER_DEGREE_LAT / TILE_SIZE_METERS);
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos(latitude * Math.PI / 180);
  const lngTile = Math.floor(longitude * metersPerDegreeLng / TILE_SIZE_METERS);
  
  return `${latTile}:${lngTile}`;
}

/**
 * Get supertile ID by grouping base tiles
 */
export function getSupertileId(tile_id: string, groupingFactor: number): string {
  const [latTile, lngTile] = tile_id.split(':').map(Number);
  
  const supertileLat = Math.floor(latTile / groupingFactor);
  const supertileLng = Math.floor(lngTile / groupingFactor);
  
  return `${supertileLat}:${supertileLng}`;
}

/**
 * Calculate center coordinates for a supertile
 */
export function getSupertileCenter(
  supertile_id: string,
  groupingFactor: number
): { latitude: number; longitude: number } {
  const [supertileLat, supertileLng] = supertile_id.split(':').map(Number);
  
  // Center of supertile
  const centerLatTile = supertileLat * groupingFactor + groupingFactor / 2;
  const centerLngTile = supertileLng * groupingFactor + groupingFactor / 2;
  
  // Convert to lat/lng
  const centerLat = centerLatTile * TILE_SIZE_METERS / METERS_PER_DEGREE_LAT;
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos(centerLat * Math.PI / 180);
  const centerLng = centerLngTile * TILE_SIZE_METERS / metersPerDegreeLng;
  
  return { latitude: centerLat, longitude: centerLng };
}

/**
 * Get range of tile IDs around a center point
 */
export function getTileRange(
  centerLat: number,
  centerLng: number,
  radius: number = 5
): string[] {
  const centerTileId = getTileId(centerLat, centerLng);
  const [centerLatTile, centerLngTile] = centerTileId.split(':').map(Number);
  
  const tileIds: string[] = [];
  
  for (let latOffset = -radius; latOffset <= radius; latOffset++) {
    for (let lngOffset = -radius; lngOffset <= radius; lngOffset++) {
      tileIds.push(`${centerLatTile + latOffset}:${centerLngTile + lngOffset}`);
    }
  }
  
  return tileIds;
}

/**
 * Calculate zoom level from region delta
 */
export function getZoomLevel(latitudeDelta: number): number {
  return Math.round(Math.log2(360 / latitudeDelta));
}

/**
 * Get grouping factor based on zoom level
 * Slow progression: doubles every 2 zoom levels
 */
export function getGroupingFactor(zoom: number): number | null {
  if (zoom >= 19) return 1;   // 3m - atomic tiles
  if (zoom >= 17) return 2;   // 6m - very detailed
  if (zoom >= 15) return 4;   // 12m - block level
  if (zoom >= 13) return 8;   // 24m - neighborhood
  if (zoom >= 11) return 16;  // 48m - district
  return null;                // Too zoomed out
}

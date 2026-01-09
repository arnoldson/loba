const TILE_SIZE_METERS = 3;
const METERS_PER_DEGREE_LAT = 111320;

/**
 * Calculates the tile ID for a given latitude and longitude
 */
export function getTileId(latitude: number, longitude: number): string {
  const latTile = Math.floor(latitude * METERS_PER_DEGREE_LAT / TILE_SIZE_METERS);
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos(latitude * Math.PI / 180);
  const lngTile = Math.floor(longitude * metersPerDegreeLng / TILE_SIZE_METERS);
  
  return `${latTile}:${lngTile}`;
}

/**
 * Gets an array of tile IDs in a range around a center tile
 * @param centerLat Center latitude
 * @param centerLng Center longitude
 * @param radius Number of tiles in each direction (e.g., 1 = 3x3 grid, 2 = 5x5 grid)
 */
export function getTileRange(
  centerLat: number,
  centerLng: number,
  radius: number = 1
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

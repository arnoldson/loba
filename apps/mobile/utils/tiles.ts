// Tile system for 3m x 3m grid
const TILE_SIZE_METERS = 3.0;
const METERS_PER_DEGREE_LAT = 111320; // Approximately constant

/**
 * Convert GPS coordinates to a tile ID
 */
export function getTileId(latitude: number, longitude: number): string {
  // Calculate degrees per tile
  const latDegreesPerTile = TILE_SIZE_METERS / METERS_PER_DEGREE_LAT;
  const lngDegreesPerTile =
    TILE_SIZE_METERS /
    (METERS_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180));

  // Get tile coordinates
  const tileLat = Math.floor(latitude / latDegreesPerTile);
  const tileLng = Math.floor(longitude / lngDegreesPerTile);

  // Return as string ID
  return `${tileLat}:${tileLng}`;
}

/**
 * Get all tile IDs in an NxN grid around a center point
 */
export function getTileRange(
  latitude: number,
  longitude: number,
  gridSize: number
): string[] {
  const latDegreesPerTile = TILE_SIZE_METERS / METERS_PER_DEGREE_LAT;
  const lngDegreesPerTile =
    TILE_SIZE_METERS /
    (METERS_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180));

  const centerTileLat = Math.floor(latitude / latDegreesPerTile);
  const centerTileLng = Math.floor(longitude / lngDegreesPerTile);

  const radius = Math.floor(gridSize / 2);
  const tiles: string[] = [];

  for (let dLat = -radius; dLat <= radius; dLat++) {
    for (let dLng = -radius; dLng <= radius; dLng++) {
      const tileLat = centerTileLat + dLat;
      const tileLng = centerTileLng + dLng;
      tiles.push(`${tileLat}:${tileLng}`);
    }
  }

  return tiles;
}

/**
 * Get the GPS bounds of a tile (for visualization)
 */
export function getTileBounds(tileId: string, latitude: number) {
  const [tileLat, tileLng] = tileId.split(":").map(Number);

  const latDegreesPerTile = TILE_SIZE_METERS / METERS_PER_DEGREE_LAT;
  const lngDegreesPerTile =
    TILE_SIZE_METERS /
    (METERS_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180));

  return {
    minLat: tileLat * latDegreesPerTile,
    maxLat: (tileLat + 1) * latDegreesPerTile,
    minLng: tileLng * lngDegreesPerTile,
    maxLng: (tileLng + 1) * lngDegreesPerTile,
  };
}

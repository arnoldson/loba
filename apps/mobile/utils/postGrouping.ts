/**
 * Post grouping utilities for creating SuperTiles
 * Groups posts into tiles based on zoom level
 */

import type { Post } from "@loba/shared";

export interface SuperTile {
  supertile_id: string;
  count: number;
  posts: Post[];
  center: {
    latitude: number;
    longitude: number;
  };
}

/**
 * Convert tile coordinates to lat/lng
 */
function tileToLatLng(
  latTile: number,
  lngTile: number,
  avgLat: number
): {
  latitude: number;
  longitude: number;
} {
  const TILE_SIZE_METERS = 3;

  // Convert tile coordinate to degrees
  const latitude = (latTile * TILE_SIZE_METERS) / 111320;
  const longitude =
    (lngTile * TILE_SIZE_METERS) /
    (111320 * Math.cos((avgLat * Math.PI) / 180));

  return { latitude, longitude };
}

/**
 * Group posts into supertiles based on grouping factor
 * @param posts - Array of posts to group
 * @param groupingFactor - How many base tiles to group (1, 2, 4, 8, 16, etc.)
 * @returns Array of SuperTiles with counts and centers
 */
export function groupPostsByZoomLevel(
  posts: Post[],
  groupingFactor: number
): SuperTile[] {
  // Filter and normalize posts (convert string coords to numbers)
  const validPosts = posts
    .filter(
      (p) =>
        p.latitude != null &&
        p.longitude != null &&
        !isNaN(Number(p.latitude)) &&
        !isNaN(Number(p.longitude))
    )
    .map((p) => ({
      ...p,
      // Convert to numbers if they're strings (PostgreSQL DECIMAL serializes as string)
      latitude:
        typeof p.latitude === "string" ? parseFloat(p.latitude) : p.latitude,
      longitude:
        typeof p.longitude === "string" ? parseFloat(p.longitude) : p.longitude,
    }));

  const invalidCount = posts.length - validPosts.length;

  // Group posts by their supertile_id
  const supertileMap = new Map<string, Post[]>();

  validPosts.forEach((post) => {
    // Parse the original tile coordinates
    const [latTileStr, lngTileStr] = post.tile_id.split(":");
    const latTile = parseInt(latTileStr);
    const lngTile = parseInt(lngTileStr);

    // Calculate supertile coordinates by dividing by grouping factor
    const superLatTile = Math.floor(latTile / groupingFactor);
    const superLngTile = Math.floor(lngTile / groupingFactor);
    const supertile_id = `${superLatTile}:${superLngTile}`;

    // Add post to supertile group
    if (!supertileMap.has(supertile_id)) {
      supertileMap.set(supertile_id, []);
    }
    supertileMap.get(supertile_id)!.push(post);
  });

  // Convert map to array of SuperTiles
  const supertiles: SuperTile[] = [];

  supertileMap.forEach((groupPosts, supertile_id) => {
    const [superLatTile, superLngTile] = supertile_id.split(":").map(Number);

    // Calculate CENTER of the supertile using tile coordinates
    // This is deterministic and consistent regardless of which posts are fetched
    const centerLatTile = superLatTile * groupingFactor + groupingFactor / 2;
    const centerLngTile = superLngTile * groupingFactor + groupingFactor / 2;

    // Use average latitude of posts for accurate longitude calculation
    const avgLat =
      groupPosts.reduce((sum, p) => sum + p.latitude, 0) / groupPosts.length;

    // Convert center tile coordinates to lat/lng
    const center = tileToLatLng(centerLatTile, centerLngTile, avgLat);

    supertiles.push({
      supertile_id,
      count: groupPosts.length,
      posts: groupPosts,
      center,
    });
  });

  // DIAGNOSTIC: Log grouping statistics
  // DIAGNOSTIC: Log grouping statistics
  console.log(
    `🔍 Grouping: ${validPosts.length} posts → ${supertiles.length} markers (factor: ${groupingFactor})`
  );

  return supertiles;
}

import type { Post } from '@loba/shared';
import { getSupertileId, getSupertileCenter } from './tiles';

export interface SuperTile {
  supertile_id: string;
  posts: Post[];
  count: number;
  center: { latitude: number; longitude: number };
}

/**
 * Group posts by supertile based on zoom level
 */
export function groupPostsByZoomLevel(
  posts: Post[],
  groupingFactor: number
): SuperTile[] {
  const supertileMap = new Map<string, Post[]>();
  
  // Group posts by supertile
  posts.forEach(post => {
    const supertileId = getSupertileId(post.tile_id, groupingFactor);
    
    if (!supertileMap.has(supertileId)) {
      supertileMap.set(supertileId, []);
    }
    supertileMap.get(supertileId)!.push(post);
  });
  
  // Convert to array with metadata
  return Array.from(supertileMap.entries()).map(([supertile_id, posts]) => ({
    supertile_id,
    posts,
    count: posts.length,
    center: getSupertileCenter(supertile_id, groupingFactor),
  }));
}

/**
 * Get color based on post count
 */
export function getColorByCount(count: number): string {
  if (count === 1) return '#4CAF50';  // Green - single post
  if (count <= 3) return '#2196F3';   // Blue - few posts
  if (count <= 10) return '#FFC107';  // Yellow - medium
  if (count <= 20) return '#FF9800';  // Orange - high
  return '#F44336';                    // Red - very high
}

import { db } from '../db/index.js';
import { getTileId } from '../db/tiles.js';
import type { Post, CreatePostRequest } from '@loba/shared';

export class PostService {
  /**
   * Create a new post
   */
  async createPost(data: CreatePostRequest): Promise<Post> {
    const tileId = getTileId(data.latitude, data.longitude);
    
    const post = await db
      .insertInto('posts')
      .values({
        id: crypto.randomUUID(),
        user_id: null, // TODO: Add auth later
        content: data.content,
        photo_url: data.photo_url || null,
        latitude: data.latitude,
        longitude: data.longitude,
        tile_id: tileId,
        tags: data.tags,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    
    return post;
  }

  /**
   * Get posts by tile IDs
   */
  async getPostsByTiles(tileIds: string[], limit: number = 50): Promise<Post[]> {
    const posts = await db
      .selectFrom('posts')
      .selectAll()
      .where('tile_id', 'in', tileIds)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    
    return posts;
  }

  /**
   * Get a single post by ID
   */
  async getPostById(id: string): Promise<Post | null> {
    const post = await db
      .selectFrom('posts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    
    return post || null;
  }
}

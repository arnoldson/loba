import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { getTileId } from '../db/tiles.js';

const SEED_TAGS = [
  ['#food', '#restaurant'],
  ['#coffee', '#cafe'],
  ['#parking', '#cars'],
  ['#event', '#music'],
  ['#park', '#nature'],
  ['#shopping', '#retail'],
  ['#emergency', '#safety'],
  ['#transit', '#bus'],
  ['#art', '#gallery'],
  ['#gym', '#fitness'],
];

const SEED_CONTENT = [
  'Great spot!',
  'Highly recommend this place',
  'Amazing experience here',
  'Just discovered this gem',
  'Perfect location',
  'Love this area',
  'Must visit!',
  'Hidden treasure',
  'Best in the neighborhood',
  'Worth checking out',
  'Awesome vibe',
  'Can\'t recommend enough',
  'Fantastic spot',
  'Really enjoyed this',
  'Beautiful location',
];

/**
 * Generate random posts around a center point
 */
function generateSeedPosts(
  centerLat: number,
  centerLng: number,
  count: number
): Array<{
  content: string;
  tags: string[];
  latitude: number;
  longitude: number;
}> {
  const posts = [];
  
  // Create clusters with different densities
  const clusters = [
    // Dense cluster (city center)
    { lat: centerLat, lng: centerLng, radius: 0.002, density: 0.4 },
    // Medium clusters (nearby areas)
    { lat: centerLat + 0.003, lng: centerLng + 0.002, radius: 0.003, density: 0.3 },
    { lat: centerLat - 0.002, lng: centerLng + 0.003, radius: 0.003, density: 0.2 },
    // Sparse areas (outskirts)
    { lat: centerLat + 0.005, lng: centerLng - 0.004, radius: 0.004, density: 0.1 },
  ];
  
  for (let i = 0; i < count; i++) {
    // Pick a cluster based on density
    const rand = Math.random();
    let cumulative = 0;
    let selectedCluster = clusters[0];
    
    for (const cluster of clusters) {
      cumulative += cluster.density;
      if (rand <= cumulative) {
        selectedCluster = cluster;
        break;
      }
    }
    
    // Generate random point within cluster
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.random() * selectedCluster.radius;
    
    const latitude = selectedCluster.lat + distance * Math.cos(angle);
    const longitude = selectedCluster.lng + distance * Math.sin(angle);
    
    // Random content and tags
    const content = SEED_CONTENT[Math.floor(Math.random() * SEED_CONTENT.length)];
    const tagSet = SEED_TAGS[Math.floor(Math.random() * SEED_TAGS.length)];
    
    posts.push({
      content,
      tags: tagSet,
      latitude,
      longitude,
    });
  }
  
  return posts;
}

export async function seedRoutes(fastify: FastifyInstance) {
  // Seed database with test posts
  fastify.post('/seed', async (request, reply) => {
    try {
      const body = request.body as {
        centerLat?: number;
        centerLng?: number;
        count?: number;
      };
      
      const centerLat = body.centerLat ?? 37.7749; // Default: San Francisco
      const centerLng = body.centerLng ?? -122.4194;
      const count = body.count ?? 200; // Default: 200 posts
      
      // Generate seed posts
      const seedPosts = generateSeedPosts(centerLat, centerLng, count);
      
      // Insert into database
      const insertedPosts = [];
      for (const post of seedPosts) {
        const tileId = getTileId(post.latitude, post.longitude);
        
        const inserted = await db
          .insertInto('posts')
          .values({
            id: crypto.randomUUID(),
            user_id: null,
            content: post.content,
            photo_url: null,
            latitude: post.latitude,
            longitude: post.longitude,
            tile_id: tileId,
            tags: post.tags,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .returningAll()
          .executeTakeFirst();
        
        if (inserted) {
          insertedPosts.push(inserted);
        }
      }
      
      return {
        success: true,
        message: `Seeded ${insertedPosts.length} posts`,
        center: { latitude: centerLat, longitude: centerLng },
        count: insertedPosts.length,
      };
    } catch (error) {
      console.error('Error seeding database:', error);
      reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to seed database',
      });
    }
  });
  
  // Clear all posts (use with caution!)
  fastify.delete('/seed', async (request, reply) => {
    try {
      const result = await db
        .deleteFrom('posts')
        .executeTakeFirst();
      
      return {
        success: true,
        message: 'Deleted all posts',
        deletedCount: Number(result.numDeletedRows),
      };
    } catch (error) {
      console.error('Error clearing database:', error);
      reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear database',
      });
    }
  });
  
  // Get post count by tile
  fastify.get('/seed/stats', async (request, reply) => {
    try {
      const stats = await db
        .selectFrom('posts')
        .select((eb) => [
          'tile_id',
          eb.fn.count('id').as('count'),
        ])
        .groupBy('tile_id')
        .orderBy('count', 'desc')
        .limit(20)
        .execute();
      
      const totalPosts = await db
        .selectFrom('posts')
        .select((eb) => eb.fn.count('id').as('total'))
        .executeTakeFirst();
      
      return {
        success: true,
        totalPosts: Number(totalPosts?.total ?? 0),
        topTiles: stats.map(s => ({
          tile_id: s.tile_id,
          count: Number(s.count),
        })),
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get stats',
      });
    }
  });
}

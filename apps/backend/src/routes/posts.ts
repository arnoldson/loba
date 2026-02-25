import type { FastifyInstance } from 'fastify';
import { PostService } from '../services/posts.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import type {
  CreatePostRequest,
  CreatePostResponse,
  GetPostsRequest,
  GetPostsResponse,
  GetMyPostsResponse,
} from '@loba/shared';

export async function postRoutes(fastify: FastifyInstance) {
  const postService = new PostService();

  // ─── Create a new post (requires auth) ──────────────────────────────

  fastify.post<{ Body: CreatePostRequest; Reply: CreatePostResponse }>(
    '/posts',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const userId = request.userId!;
        const post = await postService.createPost(request.body, userId);

        reply.send({
          success: true,
          post,
        });
      } catch (error) {
        console.error('Error creating post:');
        console.error('Error details:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'N/A');

        const errorMessage = error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Failed to create post';

        reply.code(500).send({
          success: false,
          post: {} as any,
          error: errorMessage || 'Unknown error occurred',
        });
      }
    }
  );

  // ─── Get posts by tile IDs (public, optional auth for is_own flag) ──

  fastify.post<{ Body: GetPostsRequest; Reply: GetPostsResponse }>(
    '/posts/by-tiles',
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      try {
        const { tile_ids, limit } = request.body;
        const posts = await postService.getPostsByTiles(
          tile_ids,
          limit,
          request.userId
        );

        reply.send({
          success: true,
          posts,
        });
      } catch (error) {
        reply.code(500).send({
          success: false,
          posts: [],
          error: error instanceof Error ? error.message : 'Failed to fetch posts',
        });
      }
    }
  );

  // ─── Get a single post by ID (public, optional auth) ───────────────

  fastify.get<{ Params: { id: string } }>(
    '/posts/:id',
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      try {
        const post = await postService.getPostById(
          request.params.id,
          request.userId
        );

        if (!post) {
          reply.code(404).send({
            success: false,
            error: 'Post not found',
          });
          return;
        }

        reply.send({
          success: true,
          post,
        });
      } catch (error) {
        reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch post',
        });
      }
    }
  );

  // ─── Get my posts (requires auth) ──────────────────────────────────

  fastify.get<{ Reply: GetMyPostsResponse }>(
    '/posts/mine',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const userId = request.userId!;
        const posts = await postService.getMyPosts(userId);

        reply.send({
          success: true,
          posts,
        });
      } catch (error) {
        reply.code(500).send({
          success: false,
          posts: [],
          error: error instanceof Error ? error.message : 'Failed to fetch posts',
        });
      }
    }
  );
}

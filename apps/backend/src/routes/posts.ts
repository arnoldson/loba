import type { FastifyInstance } from 'fastify';
import { PostService } from '../services/posts.js';
import type { 
  CreatePostRequest, 
  CreatePostResponse, 
  GetPostsRequest, 
  GetPostsResponse 
} from '@loba/shared';

export async function postRoutes(fastify: FastifyInstance) {
  const postService = new PostService();

  // Create a new post
  fastify.post<{ Body: CreatePostRequest; Reply: CreatePostResponse }>(
    '/posts',
    async (request, reply) => {
      try {
        const post = await postService.createPost(request.body);
        
        reply.send({
          success: true,
          post,
        });
      } catch (error) {
        console.error('Error creating post:');
        console.error('Error type:', typeof error);
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

  // Get posts by tile IDs
  fastify.post<{ Body: GetPostsRequest; Reply: GetPostsResponse }>(
    '/posts/by-tiles',
    async (request, reply) => {
      try {
        const { tile_ids, limit } = request.body;
        const posts = await postService.getPostsByTiles(tile_ids, limit);
        
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

  // Get a single post by ID
  fastify.get<{ Params: { id: string } }>(
    '/posts/:id',
    async (request, reply) => {
      try {
        const post = await postService.getPostById(request.params.id);
        
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
}

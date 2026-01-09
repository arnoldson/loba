// Database types
export type Post = {
  id: string;
  user_id: string | null;
  content: string;
  photo_url: string | null;
  latitude: number;
  longitude: number;
  tile_id: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

// API Request types
export type CreatePostRequest = {
  content: string;
  tags: string[];
  latitude: number;
  longitude: number;
  photo_url?: string;
};

export type GetPostsRequest = {
  tile_ids: string[];
  limit?: number;
};

// API Response types
export type CreatePostResponse = {
  success: boolean;
  post: Post;
  error?: string;
};

export type GetPostsResponse = {
  success: boolean;
  posts: Post[];
  error?: string;
};

// Utility types
export type ApiError = {
  success: false;
  error: string;
};

// ─── Database types ──────────────────────────────────────────────────

export type Post = {
  id: string;
  user_id: string | null;
  content: string;
  photo_url: string | null;
  latitude: number;
  longitude: number;
  tile_id: string;
  tags: string[];
  comment_count: number;
  like_count: number;
  dislike_count: number;
  expires_at: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Comment = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

export type UserProfile = {
  user_id: string;
  verification_status: "unverified" | "pending" | "verified" | "rejected";
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PostReaction = {
  id: string;
  post_id: string;
  user_id: string;
  reaction: "like" | "dislike";
  latitude: number;
  longitude: number;
  created_at: string;
};

// ─── Public-facing post (stripped of user_id) ────────────────────────

/** What other users see. user_id is replaced with a per-post display name. */
export type PublicPost = Omit<Post, "user_id"> & {
  display_name: string;
  is_verified: boolean;
  is_own: boolean;
  user_reaction: "like" | "dislike" | null;
};

/** What the post author sees. Includes everything plus display name. */
export type OwnPost = Post & {
  display_name: string;
  is_verified: boolean;
  is_own: true;
};

// ─── Public-facing comment (stripped of user_id) ─────────────────────

/** What other users see. Display name is derived from user_id + post_id. */
export type PublicComment = Omit<Comment, "user_id"> & {
  display_name: string;
  is_verified: boolean;
  is_own: boolean;
};

// ─── API Request types ──────────────────────────────────────────────

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

export type CreateCommentRequest = {
  content: string;
};

export type ReactToPostRequest = {
  reaction: "like" | "dislike";
  latitude: number;
  longitude: number;
};

// ─── API Response types ─────────────────────────────────────────────

export type CreatePostResponse = {
  success: boolean;
  post: OwnPost;
  error?: string;
};

export type GetPostsResponse = {
  success: boolean;
  posts: PublicPost[];
  error?: string;
};

export type GetMyPostsResponse = {
  success: boolean;
  posts: OwnPost[];
  error?: string;
};

export type GetCommentsResponse = {
  success: boolean;
  comments: PublicComment[];
  error?: string;
};

export type CreateCommentResponse = {
  success: boolean;
  comment: PublicComment;
  error?: string;
};

export type ReactToPostResponse = {
  success: boolean;
  reaction: "like" | "dislike" | null;
  like_count: number;
  dislike_count: number;
  new_expires_at: string;
  error?: string;
};

export type AuthStatusResponse = {
  success: boolean;
  user_id: string;
  verification_status: UserProfile["verification_status"];
};

// ─── Utility types ──────────────────────────────────────────────────

export type ApiError = {
  success: false;
  error: string;
};

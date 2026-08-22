// ─── Database types ──────────────────────────────────────────────────

export type Post = {
  id: string
  user_id: string | null
  content: string
  photo_url: string | null
  latitude: number
  longitude: number
  tile_id: string
  tags: string[]
  comment_count: number
  upvote_count: number
  downvote_count: number
  expires_at: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type Comment = {
  id: string
  post_id: string
  user_id: string
  content: string
  created_at: string
}

export type UserProfile = {
  user_id: string
  verification_status: "unverified" | "pending" | "verified" | "rejected"
  verified_at: string | null
  restriction_status: "none" | "pending_review"
  created_at: string
  updated_at: string
}

export type PostReaction = {
  id: string
  post_id: string
  user_id: string
  reaction: "upvote" | "downvote"
  latitude: number
  longitude: number
  created_at: string
}

// ─── Public-facing post (stripped of user_id) ────────────────────────

/** What other users see. user_id is replaced with a per-post display name. */
export type PublicPost = Omit<Post, "user_id"> & {
  display_name: string
  is_verified: boolean
  is_own: boolean
  user_reaction: "upvote" | "downvote" | null
}

/** What the post author sees. Includes everything plus display name. */
export type OwnPost = Post & {
  display_name: string
  is_verified: boolean
  is_own: true
}

// ─── Public-facing comment (stripped of user_id) ─────────────────────

/** What other users see. Display name is derived from user_id + post_id. */
export type PublicComment = Omit<Comment, "user_id"> & {
  display_name: string
  is_verified: boolean
  is_own: boolean
}

// ─── API Request types ──────────────────────────────────────────────

export type CreatePostRequest = {
  content: string
  tags: string[]
  latitude: number
  longitude: number
  photo_url?: string
}

export type GetPostsRequest = {
  tile_ids: string[]
  limit?: number
}

export type CreateCommentRequest = {
  content: string
}

export type ReactToPostRequest = {
  reaction: "upvote" | "downvote"
  latitude: number
  longitude: number
}

export type ReportReason = "spam" | "harassment" | "illegal" | "other"

export type ReportPostRequest = {
  reason: ReportReason
}

// ─── API Response types ─────────────────────────────────────────────

export type CreatePostResponse = {
  success: boolean
  post: OwnPost
  error?: string
}

export type GetPostsResponse = {
  success: boolean
  posts: PublicPost[]
  error?: string
}

export type GetMyPostsResponse = {
  success: boolean
  posts: OwnPost[]
  error?: string
}

export type GetCommentsResponse = {
  success: boolean
  comments: PublicComment[]
  error?: string
}

export type CreateCommentResponse = {
  success: boolean
  comment: PublicComment
  error?: string
}

export type ReactToPostResponse = {
  success: boolean
  reaction: "upvote" | "downvote" | null
  upvote_count: number
  downvote_count: number
  new_expires_at: string
  error?: string
}

export type AuthStatusResponse = {
  success: boolean
  user_id: string
  verification_status: UserProfile["verification_status"]
}

/**
 * Response for GET /api/auth/ping — a minimal "am I currently allowed to
 * use the account" check. Reaching a 200 here already means the caller
 * passed requireAuth's ban check, so there's nothing else to report;
 * a banned user never reaches the handler at all (403 from middleware),
 * which is what the client treats as "banned" — see AuthGate.
 */
export type AuthPingResponse = {
  success: true
}

export type ReportPostResponse = {
  success: boolean
  error?: string
}

// ─── Utility types ──────────────────────────────────────────────────

export type ApiError = {
  success: false
  error: string
  code?: "banned" | "restricted"
}

// ─── Shared runtime utilities ────────────────────────────────────────

/**
 * Lowercases and deduplicates tags so "#Food" and "#food" are treated as
 * the same tag for storage, filtering, and popularity aggregation.
 * Shared between backend (write/filter paths) and mobile (submit payload)
 * so both sides apply identical normalization rather than two copies that
 * could drift apart.
 */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const tag of tags) {
    const lower = tag.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      normalized.push(lower)
    }
  }
  return normalized
}

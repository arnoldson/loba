// ─── Database types ──────────────────────────────────────────────────

export type Post = {
  id: string
  user_id: string | null
  content: string
  photo_url: string | null
  latitude: number
  longitude: number
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

// locationAccuracy (meters, from CLLocation.horizontalAccuracy) and
// locationTimestamp (ms since epoch, from the GPS fix itself, not
// Date.now() at send time) let the server independently judge the
// *quality* of a claimed location -- see utils/proximity.ts on the
// backend. This is not a second location field to cross-check the
// first against (a request-body value can't corroborate itself); it's
// metadata about the one reading, captured fresh at the moment of the
// gated action -- see apps/mobile/utils/location.ts.

export type CreatePostRequest = {
  content: string
  tags: string[]
  latitude: number
  longitude: number
  locationAccuracy: number
  locationTimestamp: number
  photo_url?: string
}

export type PostsByBoundsRequest = {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
  cursor?: string | null
  limit?: number
  tags?: string[]
}

// latitude/longitude/location metadata are optional because a comment
// from a user who has already voted on the post skips the proximity
// gate entirely -- see CommentService.createComment.
export type CreateCommentRequest = {
  content: string
  latitude?: number
  longitude?: number
  locationAccuracy?: number
  locationTimestamp?: number
}

export type ReactToPostRequest = {
  reaction: "upvote" | "downvote"
  latitude: number
  longitude: number
  locationAccuracy: number
  locationTimestamp: number
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

export type PostsByBoundsResponse = {
  success: boolean
  posts: PublicPost[]
  nextCursor: string | null
  error?: string
}

export type DensitySector = {
  key: string
  count: number
  center: { latitude: number; longitude: number }
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
}

export type PostsDensityResponse = {
  success: boolean
  groupingFactor: number
  sectors: DensitySector[]
  filtered_by_tags: string[] | null
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

// ─── Input caps (#76) ────────────────────────────────────────────────
//
// Shared so the app's composer/filter UI and the server's 400 checks
// can't drift apart. They have to agree from 1.0 on: a released binary
// that lets users compose something the server rejects can only be
// fixed through another App Review cycle.

// Measured in JS string length (UTF-16 units), the same way the app's
// TextInput maxLength counts, so a full-length draft always passes.
export const MAX_POST_LENGTH = 280
export const MAX_COMMENT_LENGTH = 500

export const MAX_TAGS_PER_POST = 10
// Counted without the leading '#'.
export const MAX_TAG_LENGTH = 32
export const MAX_FILTER_TAGS = 10

// Per-axis cap on a map query's bbox, in degrees. Query cost follows
// bbox size (see #68), and nothing else bounds it server-side. The
// app's own zoom-out lock (#53, getMaxAllowedLongitudeDelta) tops out
// around 2°×4.5° on a large iPhone and ~6.6° on a 13" iPad, so 10°
// leaves headroom without letting a caller query a continent.
export const MAX_BBOX_SPAN_DEGREES = 10

/**
 * Returns a user-facing error if a post's tags break the caps, or null
 * if they're fine. Expects already-normalized tags (see normalizeTags)
 * so "#Food" and "#food" count once, the same way the server stores
 * them.
 */
export function getPostTagsError(tags: string[]): string | null {
  if (tags.length > MAX_TAGS_PER_POST) {
    return `Posts can have up to ${MAX_TAGS_PER_POST} tags`
  }
  const tooLong = tags.find(
    (tag) => tag.replace(/^#/, "").length > MAX_TAG_LENGTH,
  )
  if (tooLong) {
    return `Tags can be up to ${MAX_TAG_LENGTH} characters`
  }
  return null
}

/**
 * True if both spans are finite and within MAX_BBOX_SPAN_DEGREES. The
 * epsilon absorbs float error from spans computed as max - min, so a
 * box exactly at the cap isn't rejected by rounding.
 */
export function isBboxSpanAllowed(
  latitudeSpan: number,
  longitudeSpan: number,
): boolean {
  return [latitudeSpan, longitudeSpan].every(
    (span) =>
      Number.isFinite(span) && Math.abs(span) <= MAX_BBOX_SPAN_DEGREES + 1e-9,
  )
}

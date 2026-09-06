import React, { useState, useCallback, useMemo, useEffect, useRef } from "react"
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Alert,
  Platform,
} from "react-native"
import type { PublicPost, PublicComment, ReportReason } from "@loba/shared"
import {
  API_URL,
  isBannedError,
  isRestrictedError,
  UNDER_REVIEW_MESSAGE,
} from "@/utils/api"

// ─── Configuration ──────────────────────────────────────────────────

const PAGE_SIZE = 25

// ─── Props ──────────────────────────────────────────────────────────

/**
 * What the modal receives on tap — just enough to identify and fetch a
 * supertile's posts. Deliberately lightweight: since the map view now
 * only fetches aggregate counts (see /api/posts/density-in-bounds),
 * there's no pre-fetched posts[] to hand off anymore. The modal owns
 * its own paginated fetch instead.
 */
export interface SelectedTile {
  supertile_id: string
  groupingFactor: number
  count: number
  center: { latitude: number; longitude: number }
}

interface TileDetailsModalProps {
  visible: boolean
  tile: SelectedTile | null
  onClose: () => void
  authToken?: string | null
  onPostDeleted?: (postId: string) => void
  userLocation?: { latitude: number; longitude: number } | null
}

export function TileDetailsModal({
  visible,
  tile,
  onClose,
  authToken,
  onPostDeleted,
  userLocation,
}: TileDetailsModalProps) {
  // ─── State ──────────────────────────────────────────────────────────

  // Posts loaded for the current tile — accumulates across "load more"
  // pages. Reset whenever `tile` changes (a different supertile was
  // tapped) or the modal closes.
  const [posts, setPosts] = useState<PublicPost[]>([])
  const [isLoadingPosts, setIsLoadingPosts] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [postsError, setPostsError] = useState<string | null>(null)
  const nextCursorRef = useRef<string | null>(null)

  // Tracks which supertile_id the current `posts` state belongs to, so
  // a fetch response arriving after the user has already tapped a
  // different marker doesn't overwrite the wrong tile's list (a real
  // risk given fetches are async and taps can happen in quick succession).
  const loadedForRef = useRef<string | null>(null)

  const [selectedPost, setSelectedPost] = useState<PublicPost | null>(null)
  const [comments, setComments] = useState<PublicComment[]>([])
  const [isLoadingComments, setIsLoadingComments] = useState(false)
  const [newComment, setNewComment] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Separate from `error` deliberately — this is for expected,
  // non-alarming states (like the under-review restriction) that
  // shouldn't render with error styling, unlike a genuine failure.
  const [infoMessage, setInfoMessage] = useState<string | null>(null)

  // Track deleted post IDs so they disappear from the list immediately
  const [deletedPostIds, setDeletedPostIds] = useState<Set<string>>(new Set())

  // Track reported post IDs so the report button reflects it immediately
  // (backend also enforces this via a unique constraint — this is just
  // for UI feedback, not the source of truth)
  const [reportedPostIds, setReportedPostIds] = useState<Set<string>>(new Set())

  // Track local reaction state so UI updates immediately
  const [localReactions, setLocalReactions] = useState<
    Map<
      string,
      {
        reaction: "upvote" | "downvote" | null
        upvote_count: number
        downvote_count: number
        expires_at: string
      }
    >
  >(new Map())

  // Stable auth headers object — only changes when token changes
  const authHeaders = useMemo(
    () => (authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    [authToken],
  ) as Record<string, string>

  // ─── Helpers ────────────────────────────────────────────────────────

  /** Get the effective reaction state for a post (local override or server) */
  const getPostWithReaction = useCallback(
    (post: PublicPost) => {
      const local = localReactions.get(post.id)
      if (local) {
        return {
          ...post,
          user_reaction: local.reaction,
          upvote_count: local.upvote_count,
          downvote_count: local.downvote_count,
          expires_at: local.expires_at,
        }
      }
      return post
    },
    [localReactions],
  )

  // ─── Post fetching (paginated, per-supertile) ────────────────────────

  const fetchTilePosts = useCallback(
    async (targetTile: SelectedTile, cursor?: string) => {
      const isFirstPage = !cursor
      if (isFirstPage) {
        setIsLoadingPosts(true)
      } else {
        setIsLoadingMore(true)
      }
      setPostsError(null)

      try {
        const params = new URLSearchParams({
          groupingFactor: String(targetTile.groupingFactor),
          limit: String(PAGE_SIZE),
        })
        if (cursor) params.set("after", cursor)

        const res = await fetch(
          `${API_URL}/api/posts/by-supertile/${encodeURIComponent(
            targetTile.supertile_id,
          )}?${params}`,
          { headers: authHeaders },
        )
        const data = await res.json()

        // If the user tapped a different marker while this request was
        // in flight, drop the result — it belongs to a tile we're no
        // longer showing.
        if (loadedForRef.current !== targetTile.supertile_id) return

        if (data.success) {
          setPosts((prev) =>
            isFirstPage ? data.posts : [...prev, ...data.posts],
          )
          nextCursorRef.current = data.nextCursor
        } else if (!isBannedError(data)) {
          setPostsError(data.error || "Failed to load posts")
        }
      } catch {
        if (loadedForRef.current === targetTile.supertile_id) {
          setPostsError("Could not connect to server")
        }
      } finally {
        if (loadedForRef.current === targetTile.supertile_id) {
          setIsLoadingPosts(false)
          setIsLoadingMore(false)
        }
      }
    },
    [authHeaders],
  )

  const handleLoadMore = useCallback(() => {
    if (!tile || isLoadingMore || !nextCursorRef.current) return
    fetchTilePosts(tile, nextCursorRef.current)
  }, [tile, isLoadingMore, fetchTilePosts])

  // Fetch the first page whenever a new supertile is selected. Keyed on
  // supertile_id (not the whole tile object) so re-renders that produce
  // a new-but-equivalent tile reference don't trigger a redundant fetch.
  useEffect(() => {
    if (!visible || !tile) return
    if (loadedForRef.current === tile.supertile_id) return

    loadedForRef.current = tile.supertile_id
    setPosts([])
    nextCursorRef.current = null
    fetchTilePosts(tile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, tile?.supertile_id])

  // ─── Handlers ───────────────────────────────────────────────────────

  const fetchComments = useCallback(
    async (postId: string) => {
      setIsLoadingComments(true)
      setError(null)
      setInfoMessage(null)
      try {
        const res = await fetch(`${API_URL}/api/posts/${postId}/comments`, {
          headers: authHeaders,
        })
        const data = await res.json()

        if (data.success) {
          setComments(data.comments)
        } else if (!isBannedError(data)) {
          setError(data.error || "Failed to load comments")
        }
      } catch {
        setError("Could not connect to server")
      } finally {
        setIsLoadingComments(false)
      }
    },
    [authHeaders],
  )

  const handleSelectPost = useCallback(
    (post: PublicPost) => {
      setSelectedPost(post)
      setComments([])
      setNewComment("")
      setError(null)
      setInfoMessage(null)
      fetchComments(post.id)
    },
    [fetchComments],
  )

  const handleBack = useCallback(() => {
    setSelectedPost(null)
    setComments([])
    setNewComment("")
    setError(null)
    setInfoMessage(null)
  }, [])

  const handleClose = useCallback(() => {
    setSelectedPost(null)
    setComments([])
    setNewComment("")
    setError(null)
    setInfoMessage(null)
    setDeletedPostIds(new Set())
    setLocalReactions(new Map())
    // Reset so reopening the same supertile re-fetches fresh data rather
    // than reusing posts that may have expired/changed while closed.
    loadedForRef.current = null
    setPosts([])
    nextCursorRef.current = null
    onClose()
  }, [onClose])

  const handleSubmitComment = useCallback(async () => {
    if (!selectedPost || !newComment.trim() || !authToken) return

    setIsSubmitting(true)
    setError(null)
    setInfoMessage(null)
    try {
      const res = await fetch(
        `${API_URL}/api/posts/${selectedPost.id}/comments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({
            content: newComment.trim(),
            latitude: userLocation?.latitude,
            longitude: userLocation?.longitude,
          }),
        },
      )
      const data = await res.json()

      if (data.success) {
        setComments((prev) => [...prev, data.comment])
        setNewComment("")
      } else if (isRestrictedError(data)) {
        setInfoMessage(UNDER_REVIEW_MESSAGE)
      } else if (!isBannedError(data)) {
        setError(data.error || "Failed to post comment")
      }
    } catch {
      setError("Could not connect to server")
    } finally {
      setIsSubmitting(false)
    }
  }, [selectedPost, newComment, authToken, authHeaders])

  // ─── Reaction handler ───────────────────────────────────────────────

  const handleReaction = useCallback(
    async (post: PublicPost, reaction: "upvote" | "downvote") => {
      if (!authToken || !userLocation) return

      // Optimistic update
      const current = localReactions.get(post.id)
      const currentReaction = current?.reaction ?? post.user_reaction ?? null
      const currentUpvotes = current?.upvote_count ?? post.upvote_count
      const currentDownvotes = current?.downvote_count ?? post.downvote_count
      const currentExpiry = current?.expires_at ?? post.expires_at

      let optimisticReaction: "upvote" | "downvote" | null
      let optimisticUpvotes = currentUpvotes
      let optimisticDownvotes = currentDownvotes

      if (currentReaction === reaction) {
        // Toggle off
        optimisticReaction = null
        if (reaction === "upvote") optimisticUpvotes--
        else optimisticDownvotes--
      } else {
        // New or switch
        optimisticReaction = reaction
        if (reaction === "upvote") {
          optimisticUpvotes++
          if (currentReaction === "downvote") optimisticDownvotes--
        } else {
          optimisticDownvotes++
          if (currentReaction === "upvote") optimisticUpvotes--
        }
      }

      setLocalReactions((prev) => {
        const next = new Map(prev)
        next.set(post.id, {
          reaction: optimisticReaction,
          upvote_count: Math.max(0, optimisticUpvotes),
          downvote_count: Math.max(0, optimisticDownvotes),
          expires_at: currentExpiry,
        })
        return next
      })

      try {
        const res = await fetch(`${API_URL}/api/posts/${post.id}/react`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({
            reaction,
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
          }),
        })
        const data = await res.json()

        if (data.success) {
          // Reconcile with server response
          setLocalReactions((prev) => {
            const next = new Map(prev)
            next.set(post.id, {
              reaction: data.reaction,
              upvote_count: data.upvote_count,
              downvote_count: data.downvote_count,
              expires_at: data.new_expires_at,
            })
            return next
          })
        } else {
          // Revert optimistic update
          setLocalReactions((prev) => {
            const next = new Map(prev)
            next.delete(post.id)
            return next
          })
          if (data.error === "You must be near this post to react") {
            Alert.alert(
              "Too far away",
              "You need to be near this post to vote.",
            )
          }
        }
      } catch {
        // Revert on network error
        setLocalReactions((prev) => {
          const next = new Map(prev)
          next.delete(post.id)
          return next
        })
      }
    },
    [authToken, userLocation, authHeaders, localReactions],
  )

  // ─── Delete handlers ────────────────────────────────────────────────

  const handleDeletePost = useCallback(
    (post: PublicPost) => {
      Alert.alert(
        "Delete post",
        "This will permanently delete this post and all its comments.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              setIsDeleting(true)
              try {
                const res = await fetch(`${API_URL}/api/posts/${post.id}`, {
                  method: "DELETE",
                  headers: authHeaders,
                })
                const data = await res.json()

                if (data.success) {
                  if (selectedPost?.id === post.id) {
                    setSelectedPost(null)
                    setComments([])
                  }

                  setDeletedPostIds((prev) => new Set(prev).add(post.id))
                  onPostDeleted?.(post.id)
                } else if (isRestrictedError(data)) {
                  Alert.alert("Account under review", UNDER_REVIEW_MESSAGE)
                } else if (!isBannedError(data)) {
                  Alert.alert("Error", data.error || "Failed to delete post")
                }
              } catch {
                Alert.alert("Error", "Could not connect to server")
              } finally {
                setIsDeleting(false)
              }
            },
          },
        ],
      )
    },
    [authHeaders, selectedPost, onPostDeleted],
  )

  const handleDeleteComment = useCallback(
    (comment: PublicComment) => {
      if (!selectedPost) return

      Alert.alert("Delete comment", "Are you sure?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await fetch(
                `${API_URL}/api/posts/${selectedPost.id}/comments/${comment.id}`,
                {
                  method: "DELETE",
                  headers: authHeaders,
                },
              )
              const data = await res.json()

              if (data.success) {
                setComments((prev) => prev.filter((c) => c.id !== comment.id))
              } else if (isRestrictedError(data)) {
                Alert.alert("Account under review", UNDER_REVIEW_MESSAGE)
              } else if (!isBannedError(data)) {
                Alert.alert("Error", data.error || "Failed to delete comment")
              }
            } catch {
              Alert.alert("Error", "Could not connect to server")
            }
          },
        },
      ])
    },
    [authHeaders, selectedPost],
  )

  const handleReportPost = useCallback(
    (post: PublicPost) => {
      if (reportedPostIds.has(post.id)) return

      const submitReport = async (reason: ReportReason) => {
        try {
          const res = await fetch(`${API_URL}/api/posts/${post.id}/report`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeaders,
            },
            body: JSON.stringify({ reason }),
          })
          const data = await res.json()

          if (data.success) {
            setReportedPostIds((prev) => new Set(prev).add(post.id))
            Alert.alert("Reported", "Thanks — we'll take a look at this post.")
          } else if (res.status === 409) {
            // Already reported — treat as success from the UI's
            // perspective, just sync local state
            setReportedPostIds((prev) => new Set(prev).add(post.id))
          } else if (isRestrictedError(data)) {
            Alert.alert("Account under review", UNDER_REVIEW_MESSAGE)
          } else if (!isBannedError(data)) {
            Alert.alert("Error", data.error || "Failed to report post")
          }
        } catch {
          Alert.alert("Error", "Could not connect to server")
        }
      }

      Alert.alert("Report this post", "Why are you reporting this post?", [
        { text: "Cancel", style: "cancel" },
        { text: "Spam", onPress: () => submitReport("spam") },
        { text: "Harassment", onPress: () => submitReport("harassment") },
        { text: "Illegal content", onPress: () => submitReport("illegal") },
        { text: "Other", onPress: () => submitReport("other") },
      ])
    },
    [authHeaders, reportedPostIds],
  )

  // ─── Render ─────────────────────────────────────────────────────────

  if (!tile) return null

  const isPostView = selectedPost !== null

  // Filter out locally deleted posts
  const visiblePosts = posts.filter((p) => !deletedPostIds.has(p.id))

  // True on the very first render after a new tile is selected, before
  // the fetch-triggering effect has had a chance to run and reset
  // `posts`/set isLoadingPosts. Without this, that first render could
  // briefly show the *previous* tile's already-loaded posts instead of
  // a loading state — effects run after commit, not during it.
  const isSwitchingTiles = loadedForRef.current !== tile.supertile_id
  const showLoading = isLoadingPosts || isSwitchingTiles

  // If all loaded posts were deleted and there's nothing left to page
  // in, close the modal. If more pages remain, leave it open — the
  // supertile isn't actually empty, just the currently-loaded page is.
  if (
    visiblePosts.length === 0 &&
    deletedPostIds.size > 0 &&
    !nextCursorRef.current &&
    !showLoading
  ) {
    setTimeout(handleClose, 0)
    return null
  }

  const canReact = !!authToken && !!userLocation

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalContainer}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
        />

        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            {isPostView ? (
              <TouchableOpacity onPress={handleBack} style={styles.backButton}>
                <Text style={styles.backButtonText}>‹</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.title} numberOfLines={1}>
              {isPostView
                ? `${getPostWithReaction(selectedPost).display_name}'s post`
                : `${tile.count} ${tile.count === 1 ? "post" : "posts"} in this area`}
            </Text>

            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Body: post list OR comment thread */}
          {isPostView ? (
            <PostDetailView
              post={getPostWithReaction(selectedPost)}
              comments={comments}
              isLoading={isLoadingComments}
              error={error}
              infoMessage={infoMessage}
              onDeletePost={handleDeletePost}
              onDeleteComment={handleDeleteComment}
              onReaction={handleReaction}
              onReportPost={handleReportPost}
              isReported={reportedPostIds.has(selectedPost.id)}
              isDeleting={isDeleting}
              canReact={canReact}
            />
          ) : showLoading ? (
            <View style={styles.centeredLoading}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.centeredLoadingText}>Loading posts...</Text>
            </View>
          ) : postsError ? (
            <View style={styles.centeredLoading}>
              <Text style={styles.errorText}>{postsError}</Text>
              <TouchableOpacity
                onPress={() => tile && fetchTilePosts(tile)}
                style={styles.retryButton}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <PostListView
              posts={visiblePosts.map(getPostWithReaction)}
              onSelectPost={handleSelectPost}
              onDeletePost={handleDeletePost}
              onReaction={handleReaction}
              isDeleting={isDeleting}
              canReact={canReact}
              hasMore={!!nextCursorRef.current}
              isLoadingMore={isLoadingMore}
              onLoadMore={handleLoadMore}
            />
          )}

          {/* Comment input (only when viewing a post) */}
          {isPostView && authToken && (
            <View style={styles.commentInputContainer}>
              <TextInput
                style={styles.commentInput}
                placeholder="Add a comment..."
                placeholderTextColor="#999"
                value={newComment}
                onChangeText={setNewComment}
                maxLength={500}
                multiline
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  (!newComment.trim() || isSubmitting) &&
                    styles.sendButtonDisabled,
                ]}
                onPress={handleSubmitComment}
                disabled={!newComment.trim() || isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text style={styles.sendButtonText}>↑</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Sign-in prompt if no auth token */}
          {isPostView && !authToken && (
            <View style={styles.signInPrompt}>
              <Text style={styles.signInText}>
                Sign in to join the conversation
              </Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════

// ─── Vote buttons ───────────────────────────────────────────────────

function VoteButtons({
  post,
  onReaction,
  canReact,
  compact = false,
}: {
  post: PublicPost
  onReaction: (post: PublicPost, reaction: "upvote" | "downvote") => void
  canReact: boolean
  compact?: boolean
}) {
  const isUpvoted = post.user_reaction === "upvote"
  const isDownvoted = post.user_reaction === "downvote"
  const isDisabled = !canReact || post.is_own

  return (
    <View style={compact ? voteStyles.containerCompact : voteStyles.container}>
      <TouchableOpacity
        style={[
          compact ? voteStyles.buttonCompact : voteStyles.button,
          isUpvoted && voteStyles.buttonUpvoted,
        ]}
        onPress={() => onReaction(post, "upvote")}
        disabled={isDisabled}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Text
          style={[
            compact ? voteStyles.arrowCompact : voteStyles.arrow,
            isUpvoted && voteStyles.arrowActive,
            isDisabled && voteStyles.arrowDisabled,
          ]}
        >
          ▲
        </Text>
        <Text
          style={[
            compact ? voteStyles.countCompact : voteStyles.count,
            isUpvoted && voteStyles.countActive,
          ]}
        >
          {post.upvote_count ?? 0}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          compact ? voteStyles.buttonCompact : voteStyles.button,
          isDownvoted && voteStyles.buttonDownvoted,
        ]}
        onPress={() => onReaction(post, "downvote")}
        disabled={isDisabled}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Text
          style={[
            compact ? voteStyles.arrowCompact : voteStyles.arrow,
            isDownvoted && voteStyles.arrowActiveDown,
            isDisabled && voteStyles.arrowDisabled,
          ]}
        >
          ▼
        </Text>
        <Text
          style={[
            compact ? voteStyles.countCompact : voteStyles.count,
            isDownvoted && voteStyles.countActiveDown,
          ]}
        >
          {post.downvote_count ?? 0}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const voteStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginVertical: 8,
  },
  containerCompact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#f0f0f0",
    gap: 4,
  },
  buttonCompact: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#f0f0f0",
    gap: 3,
  },
  buttonUpvoted: {
    backgroundColor: "#e8f5e9",
  },
  buttonDownvoted: {
    backgroundColor: "#fbe9e7",
  },
  arrow: {
    fontSize: 14,
    color: "#999",
  },
  arrowCompact: {
    fontSize: 11,
    color: "#999",
  },
  arrowActive: {
    color: "#4caf50",
  },
  arrowActiveDown: {
    color: "#e57373",
  },
  arrowDisabled: {
    color: "#ccc",
  },
  count: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
  },
  countCompact: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
  },
  countActive: {
    color: "#4caf50",
  },
  countActiveDown: {
    color: "#e57373",
  },
})

// ─── Expiry indicator ───────────────────────────────────────────────

function ExpiryIndicator({ expiresAt }: { expiresAt: string }) {
  const now = new Date()
  const expiry = new Date(expiresAt)
  const remainingMs = expiry.getTime() - now.getTime()

  if (remainingMs <= 0) return null

  const remainingHours = remainingMs / 3600000
  const remainingDays = Math.floor(remainingHours / 24)
  const remainingH = Math.floor(remainingHours % 24)

  let label: string
  if (remainingDays > 0) {
    label = `${remainingDays}d ${remainingH}h left`
  } else if (remainingHours >= 1) {
    label = `${Math.floor(remainingHours)}h left`
  } else {
    label = `${Math.max(1, Math.floor(remainingMs / 60000))}m left`
  }

  const isUrgent = remainingHours < 2
  const isWarning = remainingHours < 6

  return (
    <View
      style={[
        expiryStyles.badge,
        isUrgent
          ? expiryStyles.badgeUrgent
          : isWarning
            ? expiryStyles.badgeWarning
            : expiryStyles.badgeCalm,
      ]}
    >
      <Text
        style={[
          expiryStyles.text,
          isUrgent
            ? expiryStyles.textUrgent
            : isWarning
              ? expiryStyles.textWarning
              : expiryStyles.textCalm,
        ]}
      >
        {label}
      </Text>
    </View>
  )
}

const expiryStyles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeCalm: {
    backgroundColor: "#f0f0f0",
  },
  badgeWarning: {
    backgroundColor: "#fff3e0",
  },
  badgeUrgent: {
    backgroundColor: "#fbe9e7",
  },
  text: {
    fontSize: 11,
    fontWeight: "600",
  },
  textCalm: {
    color: "#999",
  },
  textWarning: {
    color: "#f57c00",
  },
  textUrgent: {
    color: "#e53935",
  },
})

// ─── Post list view ─────────────────────────────────────────────────

function PostListView({
  posts,
  onSelectPost,
  onDeletePost,
  onReaction,
  isDeleting,
  canReact,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: {
  posts: PublicPost[]
  onSelectPost: (post: PublicPost) => void
  onDeletePost: (post: PublicPost) => void
  onReaction: (post: PublicPost, reaction: "upvote" | "downvote") => void
  isDeleting: boolean
  canReact: boolean
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
}) {
  return (
    <ScrollView
      style={styles.postsList}
      onScroll={({ nativeEvent }) => {
        if (!hasMore || isLoadingMore || !onLoadMore) return
        const { layoutMeasurement, contentOffset, contentSize } = nativeEvent
        const nearBottom =
          layoutMeasurement.height + contentOffset.y >= contentSize.height - 200
        if (nearBottom) onLoadMore()
      }}
      scrollEventThrottle={200}
    >
      {posts.map((post, index) => (
        <TouchableOpacity
          key={post.id}
          style={styles.postItem}
          onPress={() => onSelectPost(post)}
          activeOpacity={0.7}
        >
          <View style={styles.authorRow}>
            <Text style={styles.displayName}>
              {post.display_name || "Anonymous"}
            </Text>
            {post.is_verified && (
              <View style={styles.verifiedBadge}>
                <Text style={styles.verifiedText}>✓</Text>
              </View>
            )}
            {post.is_own && <Text style={styles.ownLabel}>you</Text>}
            {post.is_own && (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => onDeletePost(post)}
                disabled={isDeleting}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.deleteButtonText}>🗑</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.postContent} numberOfLines={3}>
            {post.content}
          </Text>

          {post.tags.length > 0 && (
            <View style={styles.tagsContainer}>
              {post.tags.map((tag, tagIndex) => (
                <View key={tagIndex} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.postFooter}>
            <VoteButtons
              post={post}
              onReaction={onReaction}
              canReact={canReact}
              compact
            />
            <ExpiryIndicator expiresAt={post.expires_at} />
            <Text style={styles.commentCount}>
              💬 {post.comment_count ?? 0}
            </Text>
          </View>

          {index < posts.length - 1 && <View style={styles.divider} />}
        </TouchableOpacity>
      ))}

      {hasMore && (
        <TouchableOpacity
          style={styles.loadMoreButton}
          onPress={onLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore ? (
            <ActivityIndicator size="small" color="#007AFF" />
          ) : (
            <Text style={styles.loadMoreText}>Load more</Text>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
  )
}

// ─── Post detail view ───────────────────────────────────────────────

function PostDetailView({
  post,
  comments,
  isLoading,
  error,
  infoMessage,
  onDeletePost,
  onDeleteComment,
  onReaction,
  onReportPost,
  isReported,
  isDeleting,
  canReact,
}: {
  post: PublicPost
  comments: PublicComment[]
  isLoading: boolean
  error: string | null
  infoMessage: string | null
  onDeletePost: (post: PublicPost) => void
  onDeleteComment: (comment: PublicComment) => void
  onReaction: (post: PublicPost, reaction: "upvote" | "downvote") => void
  onReportPost: (post: PublicPost) => void
  isReported: boolean
  isDeleting: boolean
  canReact: boolean
}) {
  return (
    <ScrollView style={styles.postsList}>
      <View style={styles.detailPost}>
        <View style={styles.authorRow}>
          <Text style={styles.displayName}>
            {post.display_name || "Anonymous"}
          </Text>
          {post.is_verified && (
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedText}>✓</Text>
            </View>
          )}
          {post.is_own && <Text style={styles.ownLabel}>you</Text>}
          {post.is_own && (
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => onDeletePost(post)}
              disabled={isDeleting}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.deleteButtonText}>🗑</Text>
            </TouchableOpacity>
          )}
          {!post.is_own && (
            <TouchableOpacity
              style={styles.reportButton}
              onPress={() => onReportPost(post)}
              disabled={isReported}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.reportButtonText}>
                {isReported ? "Reported" : "🚩"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.detailContent}>{post.content}</Text>

        {post.tags.length > 0 && (
          <View style={styles.tagsContainer}>
            {post.tags.map((tag, tagIndex) => (
              <View key={tagIndex} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        <VoteButtons post={post} onReaction={onReaction} canReact={canReact} />

        <View style={styles.detailFooter}>
          <Text style={styles.timestamp}>
            {formatTimestamp(post.created_at)}
          </Text>
          <ExpiryIndicator expiresAt={post.expires_at} />
        </View>
      </View>

      <View style={styles.commentsSection}>
        <Text style={styles.commentsHeader}>
          {isLoading
            ? "Loading comments..."
            : `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`}
        </Text>

        {isLoading && (
          <ActivityIndicator
            size="small"
            color="#007AFF"
            style={{ marginVertical: 12 }}
          />
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}
        {infoMessage && <Text style={styles.infoText}>{infoMessage}</Text>}

        {!isLoading &&
          comments.map((comment) => (
            <View key={comment.id} style={styles.commentItem}>
              <View style={styles.authorRow}>
                <Text style={styles.commentAuthor}>{comment.display_name}</Text>
                {comment.is_verified && (
                  <View style={styles.verifiedBadgeSm}>
                    <Text style={styles.verifiedTextSm}>✓</Text>
                  </View>
                )}
                {comment.is_own && <Text style={styles.ownLabel}>you</Text>}
                {comment.is_own && (
                  <TouchableOpacity
                    style={styles.deleteButtonSm}
                    onPress={() => onDeleteComment(comment)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={styles.deleteButtonTextSm}>🗑</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.commentContent}>{comment.content}</Text>
              <Text style={styles.commentTimestamp}>
                {formatTimestamp(comment.created_at)}
              </Text>
            </View>
          ))}

        {!isLoading && comments.length === 0 && !error && (
          <Text style={styles.emptyComments}>
            No comments yet. Be the first!
          </Text>
        )}
      </View>
    </ScrollView>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}

// ═══════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    paddingBottom: Platform.OS === "ios" ? 20 : 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  backButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  backButtonText: {
    fontSize: 28,
    color: "#007AFF",
    fontWeight: "600",
    marginTop: -2,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
  },
  closeButtonText: {
    fontSize: 20,
    color: "#666",
  },
  postsList: {
    padding: 20,
  },
  postItem: {
    marginBottom: 15,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  displayName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#555",
  },
  verifiedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 6,
  },
  verifiedText: {
    color: "white",
    fontSize: 10,
    fontWeight: "bold",
  },
  ownLabel: {
    fontSize: 11,
    color: "#007AFF",
    fontWeight: "600",
    marginLeft: 6,
  },
  deleteButton: {
    marginLeft: "auto",
    padding: 4,
  },
  deleteButtonText: {
    fontSize: 14,
  },
  deleteButtonSm: {
    marginLeft: "auto",
    padding: 2,
  },
  deleteButtonTextSm: {
    fontSize: 12,
  },
  reportButton: {
    marginLeft: "auto",
    padding: 4,
  },
  reportButtonText: {
    fontSize: 12,
    color: "#999",
  },
  postContent: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 8,
  },
  tagsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  tag: {
    backgroundColor: "#007AFF",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  tagText: {
    color: "white",
    fontSize: 12,
  },
  postFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  detailFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  timestamp: {
    fontSize: 12,
    color: "#999",
  },
  commentCount: {
    fontSize: 13,
    color: "#777",
    marginLeft: "auto",
  },
  divider: {
    height: 1,
    backgroundColor: "#f0f0f0",
    marginTop: 15,
  },
  detailPost: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  detailContent: {
    fontSize: 17,
    lineHeight: 24,
    marginBottom: 10,
  },
  commentsSection: {
    marginTop: 4,
  },
  commentsHeader: {
    fontSize: 14,
    fontWeight: "700",
    color: "#333",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  commentItem: {
    marginBottom: 14,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: "#e8e8e8",
  },
  commentAuthor: {
    fontSize: 13,
    fontWeight: "600",
    color: "#555",
  },
  verifiedBadgeSm: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 5,
  },
  verifiedTextSm: {
    color: "white",
    fontSize: 8,
    fontWeight: "bold",
  },
  commentContent: {
    fontSize: 15,
    lineHeight: 20,
    color: "#333",
    marginTop: 3,
  },
  commentTimestamp: {
    fontSize: 11,
    color: "#aaa",
    marginTop: 4,
  },
  emptyComments: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    paddingVertical: 20,
  },
  errorText: {
    fontSize: 14,
    color: "#d32f2f",
    textAlign: "center",
    paddingVertical: 8,
  },
  centeredLoading: {
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
  },
  centeredLoadingText: {
    color: "#007AFF",
    fontSize: 14,
    fontWeight: "500",
    marginTop: 8,
  },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#007AFF",
    borderRadius: 16,
  },
  retryButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  loadMoreButton: {
    paddingVertical: 14,
    alignItems: "center",
  },
  loadMoreText: {
    color: "#007AFF",
    fontSize: 14,
    fontWeight: "600",
  },
  infoText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    paddingVertical: 8,
  },
  commentInputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 4 : 10,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    gap: 10,
  },
  commentInput: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    maxHeight: 100,
    color: "#333",
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#ccc",
  },
  sendButtonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
  signInPrompt: {
    paddingVertical: 14,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  signInText: {
    fontSize: 14,
    color: "#999",
  },
})

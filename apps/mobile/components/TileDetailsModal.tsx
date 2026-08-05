import React, { useState, useCallback, useMemo } from "react"
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
import type { SuperTile } from "@/utils/postGrouping"
import type { PublicPost, PublicComment } from "@loba/shared"
import { API_URL } from "@/utils/api"

// ─── Configuration ──────────────────────────────────────────────────

// ─── Props ──────────────────────────────────────────────────────────

interface TileDetailsModalProps {
  visible: boolean
  tile: SuperTile | null
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

  const [selectedPost, setSelectedPost] = useState<PublicPost | null>(null)
  const [comments, setComments] = useState<PublicComment[]>([])
  const [isLoadingComments, setIsLoadingComments] = useState(false)
  const [newComment, setNewComment] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track deleted post IDs so they disappear from the list immediately
  const [deletedPostIds, setDeletedPostIds] = useState<Set<string>>(new Set())

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

  // ─── Handlers ───────────────────────────────────────────────────────

  const fetchComments = useCallback(
    async (postId: string) => {
      setIsLoadingComments(true)
      setError(null)
      try {
        const res = await fetch(`${API_URL}/api/posts/${postId}/comments`, {
          headers: authHeaders,
        })
        const data = await res.json()

        if (data.success) {
          setComments(data.comments)
        } else {
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
      fetchComments(post.id)
    },
    [fetchComments],
  )

  const handleBack = useCallback(() => {
    setSelectedPost(null)
    setComments([])
    setNewComment("")
    setError(null)
  }, [])

  const handleClose = useCallback(() => {
    setSelectedPost(null)
    setComments([])
    setNewComment("")
    setError(null)
    setDeletedPostIds(new Set())
    setLocalReactions(new Map())
    onClose()
  }, [onClose])

  const handleSubmitComment = useCallback(async () => {
    if (!selectedPost || !newComment.trim() || !authToken) return

    setIsSubmitting(true)
    setError(null)
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
      } else {
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
                } else {
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
              } else {
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

  // ─── Render ─────────────────────────────────────────────────────────

  if (!tile) return null

  const isPostView = selectedPost !== null

  // Filter out locally deleted posts
  const visiblePosts = tile.posts.filter((p) => !deletedPostIds.has(p.id))

  // If all posts were deleted, close the modal
  if (visiblePosts.length === 0 && deletedPostIds.size > 0) {
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
                : `${visiblePosts.length} ${visiblePosts.length === 1 ? "post" : "posts"} in this area`}
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
              onDeletePost={handleDeletePost}
              onDeleteComment={handleDeleteComment}
              onReaction={handleReaction}
              isDeleting={isDeleting}
              canReact={canReact}
            />
          ) : (
            <PostListView
              posts={visiblePosts.map(getPostWithReaction)}
              onSelectPost={handleSelectPost}
              onDeletePost={handleDeletePost}
              onReaction={handleReaction}
              isDeleting={isDeleting}
              canReact={canReact}
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
}: {
  posts: PublicPost[]
  onSelectPost: (post: PublicPost) => void
  onDeletePost: (post: PublicPost) => void
  onReaction: (post: PublicPost, reaction: "upvote" | "downvote") => void
  isDeleting: boolean
  canReact: boolean
}) {
  return (
    <ScrollView style={styles.postsList}>
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
    </ScrollView>
  )
}

// ─── Post detail view ───────────────────────────────────────────────

function PostDetailView({
  post,
  comments,
  isLoading,
  error,
  onDeletePost,
  onDeleteComment,
  onReaction,
  isDeleting,
  canReact,
}: {
  post: PublicPost
  comments: PublicComment[]
  isLoading: boolean
  error: string | null
  onDeletePost: (post: PublicPost) => void
  onDeleteComment: (comment: PublicComment) => void
  onReaction: (post: PublicPost, reaction: "upvote" | "downvote") => void
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

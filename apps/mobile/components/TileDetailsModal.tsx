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

// ─── Configuration ──────────────────────────────────────────────────

const API_URL = Platform.select({
  ios: "http://localhost:3000",
  android: "http://10.0.2.2:3000",
  default: "http://localhost:3000",
})

// ─── Props ──────────────────────────────────────────────────────────

interface TileDetailsModalProps {
  visible: boolean
  tile: SuperTile | null
  onClose: () => void
  authToken?: string | null
  onPostDeleted?: (postId: string) => void
}

export function TileDetailsModal({
  visible,
  tile,
  onClose,
  authToken,
  onPostDeleted,
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

  // Stable auth headers object — only changes when token changes
  const authHeaders = useMemo(
    () => (authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    [authToken],
  ) as Record<string, string>

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
          body: JSON.stringify({ content: newComment.trim() }),
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
                ? `${selectedPost.display_name}'s post`
                : `${visiblePosts.length} ${visiblePosts.length === 1 ? "post" : "posts"} in this area`}
            </Text>

            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Body: post list OR comment thread */}
          {isPostView ? (
            <PostDetailView
              post={selectedPost}
              comments={comments}
              isLoading={isLoadingComments}
              error={error}
              onDeletePost={handleDeletePost}
              onDeleteComment={handleDeleteComment}
              isDeleting={isDeleting}
            />
          ) : (
            <PostListView
              posts={visiblePosts}
              onSelectPost={handleSelectPost}
              onDeletePost={handleDeletePost}
              isDeleting={isDeleting}
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

function PostListView({
  posts,
  onSelectPost,
  onDeletePost,
  isDeleting,
}: {
  posts: PublicPost[]
  onSelectPost: (post: PublicPost) => void
  onDeletePost: (post: PublicPost) => void
  isDeleting: boolean
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
            <Text style={styles.timestamp}>
              {formatTimestamp(post.created_at)}
            </Text>
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

function PostDetailView({
  post,
  comments,
  isLoading,
  error,
  onDeletePost,
  onDeleteComment,
  isDeleting,
}: {
  post: PublicPost
  comments: PublicComment[]
  isLoading: boolean
  error: string | null
  onDeletePost: (post: PublicPost) => void
  onDeleteComment: (comment: PublicComment) => void
  isDeleting: boolean
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

        <Text style={styles.timestamp}>{formatTimestamp(post.created_at)}</Text>
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
    justifyContent: "space-between",
    alignItems: "center",
  },
  timestamp: {
    fontSize: 12,
    color: "#999",
  },
  commentCount: {
    fontSize: 13,
    color: "#777",
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

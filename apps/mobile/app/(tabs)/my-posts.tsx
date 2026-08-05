import { useCallback, useEffect, useState } from "react"
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useAuth } from "@/utils/auth"
import type { OwnPost } from "@loba/shared"
import { API_URL } from "@/utils/api"

export default function MyPostsScreen() {
  const { getAuthHeaders } = useAuth()
  const [posts, setPosts] = useState<OwnPost[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMyPosts = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true)
      setError(null)

      try {
        const res = await fetch(`${API_URL}/api/posts/mine`, {
          headers: getAuthHeaders(),
        })
        const data = await res.json()

        if (data.success) {
          setPosts(data.posts)
        } else {
          setError(data.error || "Failed to load posts")
        }
      } catch {
        setError("Could not connect to server")
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    [getAuthHeaders],
  )

  useEffect(() => {
    fetchMyPosts()
  }, [fetchMyPosts])

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true)
    fetchMyPosts(true)
  }, [fetchMyPosts])

  const handleDelete = useCallback(
    (post: OwnPost) => {
      Alert.alert(
        "Delete post",
        "This will permanently delete this post and all its comments.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                const res = await fetch(`${API_URL}/api/posts/${post.id}`, {
                  method: "DELETE",
                  headers: getAuthHeaders(),
                })
                const data = await res.json()

                if (data.success) {
                  setPosts((prev) => prev.filter((p) => p.id !== post.id))
                } else {
                  Alert.alert("Error", data.error || "Failed to delete post")
                }
              } catch {
                Alert.alert("Error", "Could not connect to server")
              }
            },
          },
        ],
      )
    },
    [getAuthHeaders],
  )

  const renderPost = useCallback(
    ({ item }: { item: OwnPost }) => (
      <View style={styles.postCard}>
        {/* Header: display name + delete */}
        <View style={styles.postHeader}>
          <View style={styles.authorInfo}>
            <Text style={styles.displayName}>{item.display_name}</Text>
            {item.is_verified && (
              <View style={styles.verifiedBadge}>
                <Text style={styles.verifiedText}>✓</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            onPress={() => handleDelete(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.deleteIcon}>🗑</Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <Text style={styles.postContent}>{item.content}</Text>

        {/* Tags */}
        {item.tags.length > 0 && (
          <View style={styles.tagsRow}>
            {item.tags.map((tag, i) => (
              <View key={i} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Footer: timestamp, comments, location */}
        <View style={styles.postFooter}>
          <Text style={styles.meta}>{formatTimestamp(item.created_at)}</Text>
          <Text style={styles.meta}>💬 {item.comment_count ?? 0}</Text>
          <Text style={styles.meta}>
            📍 {Number(item.latitude).toFixed(4)},{" "}
            {Number(item.longitude).toFixed(4)}
          </Text>
        </View>
      </View>
    ),
    [handleDelete],
  )

  // ─── Loading state ──────────────────────────────────────────────

  if (isLoading && posts.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Posts</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading your posts...</Text>
        </View>
      </SafeAreaView>
    )
  }

  // ─── Error state ────────────────────────────────────────────────

  if (error && posts.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Posts</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => fetchMyPosts()}
          >
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ─── Main view ──────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Posts</Text>
        <Text style={styles.headerCount}>
          {posts.length} {posts.length === 1 ? "post" : "posts"}
        </Text>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        contentContainerStyle={
          posts.length === 0 ? styles.emptyContainer : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#007AFF"
          />
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptySubtitle}>
              Head to the map and create your first post!
            </Text>
          </View>
        }
      />
    </SafeAreaView>
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
  container: {
    flex: 1,
    backgroundColor: "#f8f8f8",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#000",
  },
  headerCount: {
    fontSize: 15,
    color: "#888",
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },

  // ─── Post card ────────────────────────────────────────────────
  postCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  postHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  authorInfo: {
    flexDirection: "row",
    alignItems: "center",
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
  deleteIcon: {
    fontSize: 16,
    padding: 4,
  },
  postContent: {
    fontSize: 16,
    lineHeight: 22,
    color: "#222",
    marginBottom: 10,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 10,
  },
  tag: {
    backgroundColor: "#007AFF",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: {
    color: "white",
    fontSize: 12,
  },
  postFooter: {
    flexDirection: "row",
    gap: 16,
  },
  meta: {
    fontSize: 12,
    color: "#999",
  },

  // ─── Empty / loading / error states ───────────────────────────
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: "#888",
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 15,
    color: "#888",
    textAlign: "center",
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 16,
    color: "#d32f2f",
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
  },
  retryText: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
  },
})

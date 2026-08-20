import { useMemo, useState } from "react"
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import type { CreatePostRequest, CreatePostResponse } from "@loba/shared"
import { useAuth } from "@/utils/auth"
import { API_URL } from "@/utils/api"

interface CreatePostModalProps {
  visible: boolean
  onClose: () => void
  latitude: number
  longitude: number
  onPostCreated: (post: CreatePostResponse["post"]) => void
}

// Matches Twitter/Instagram-style hashtag tokens: '#' followed by one or
// more word characters (letters, digits, underscore).
const TAG_PATTERN = /#\w+/g

/**
 * Extracts unique hashtags from freeform post text, in first-seen order.
 * This is the single source of truth for tags — there's no separate draft
 * field to keep in sync, so nothing can be "silently dropped" (see #39).
 */
function extractTags(text: string): string[] {
  const matches = text.match(TAG_PATTERN) || []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const match of matches) {
    if (!seen.has(match)) {
      seen.add(match)
      tags.push(match)
    }
  }
  return tags
}

/** Escapes regex special characters for safe use inside a dynamic RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function CreatePostModal({
  visible,
  onClose,
  latitude,
  longitude,
  onPostCreated,
}: CreatePostModalProps) {
  const { getAuthHeaders } = useAuth()

  const [postText, setPostText] = useState("")

  // Derived, not stored: tags are always exactly what's parseable from the
  // current text, so there's nothing to lose sync with.
  const tags = useMemo(() => extractTags(postText), [postText])

  const handleCreatePost = async () => {
    if (!postText.trim()) {
      Alert.alert("Error", "Post content cannot be empty")
      return
    }

    const requestBody: CreatePostRequest = {
      content: postText,
      tags,
      latitude,
      longitude,
    }

    try {
      const response = await fetch(`${API_URL}/api/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(requestBody),
      })

      const data: CreatePostResponse = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to create post")
      }

      Alert.alert("Success!", "Post created successfully!")
      onPostCreated(data.post)

      setPostText("")
      onClose()
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to create post",
      )
      console.error(error)
    }
  }

  // Removes every occurrence of a tag from the text (not just the first),
  // using a negative lookahead so "#food" doesn't also strip "#foodie".
  const removeTag = (tagToRemove: string) => {
    const pattern = new RegExp(`${escapeRegExp(tagToRemove)}(?!\\w)`, "g")
    setPostText((prev) =>
      prev
        .replace(pattern, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .trimEnd(),
    )
  }

  const handleCancel = () => {
    setPostText("")
    onClose()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalContainer}
      >
        <TouchableOpacity style={styles.modalBackdrop} onPress={handleCancel} />
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Create Post</Text>

          <TextInput
            style={styles.textInput}
            placeholder="What's happening here? Use #tags inline"
            value={postText}
            onChangeText={setPostText}
            multiline
            maxLength={280}
          />

          {tags.length > 0 && (
            <View style={styles.tagsContainer}>
              {tags.map((tag) => (
                <TouchableOpacity
                  key={tag}
                  style={styles.tagChip}
                  onPress={() => removeTag(tag)}
                >
                  <Text style={styles.tagText}>{tag}</Text>
                  <Text style={styles.removeTag}> ×</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancel}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.postButton}
              onPress={handleCreatePost}
            >
              <Text style={styles.postButtonText}>Post</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 15,
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    minHeight: 100,
    textAlignVertical: "top",
    fontSize: 16,
    marginBottom: 10,
  },
  tagsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 15,
  },
  tagChip: {
    flexDirection: "row",
    backgroundColor: "#007AFF",
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
    alignItems: "center",
  },
  tagText: {
    color: "white",
    fontSize: 14,
  },
  removeTag: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    marginLeft: 4,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cancelButton: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
    marginRight: 10,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    color: "#666",
  },
  postButton: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    backgroundColor: "#007AFF",
    marginLeft: 10,
    alignItems: "center",
  },
  postButtonText: {
    fontSize: 16,
    color: "white",
    fontWeight: "600",
  },
})

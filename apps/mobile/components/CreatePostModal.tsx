import { useState } from "react"
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

const API_URL = Platform.select({
  ios: "http://localhost:3000",
  android: "http://10.0.2.2:3000",
  default: "http://localhost:3000",
})

interface CreatePostModalProps {
  visible: boolean
  onClose: () => void
  latitude: number
  longitude: number
  onPostCreated: (post: CreatePostResponse["post"]) => void
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
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")

  const handleCreatePost = async () => {
    if (!postText.trim()) {
      Alert.alert("Error", "Post content cannot be empty")
      return
    }

    const requestBody: CreatePostRequest = {
      content: postText,
      tags: tags,
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

      // Reset form
      setPostText("")
      setTags([])
      setTagInput("")
      onClose()
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to create post",
      )
      console.error(error)
    }
  }

  const handleAddTag = (text: string) => {
    setTagInput(text)

    if (text.endsWith(" ") && text.trim().startsWith("#")) {
      const newTag = text.trim()
      if (newTag.length > 1 && !tags.includes(newTag)) {
        setTags([...tags, newTag])
        setTagInput("")
      }
    }
  }

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove))
  }

  const handleCancel = () => {
    setPostText("")
    setTags([])
    setTagInput("")
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
            placeholder="What's happening here?"
            value={postText}
            onChangeText={setPostText}
            multiline
            maxLength={280}
          />

          <TextInput
            style={styles.tagInput}
            placeholder="Add tags (e.g., #food #event)"
            value={tagInput}
            onChangeText={handleAddTag}
          />

          {tags.length > 0 && (
            <View style={styles.tagsContainer}>
              {tags.map((tag, index) => (
                <TouchableOpacity
                  key={index}
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
    marginBottom: 15,
  },
  tagInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
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

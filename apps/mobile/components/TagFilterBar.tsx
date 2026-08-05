import React, { useEffect, useState, useCallback } from "react"
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native"
import { API_URL } from "@/utils/api"

interface TagFilterBarProps {
  selectedTags: string[]
  onTagsChanged: (tags: string[]) => void
}

interface PopularTag {
  tag: string
  count: number
}

export function TagFilterBar({
  selectedTags,
  onTagsChanged,
}: TagFilterBarProps) {
  const [popularTags, setPopularTags] = useState<PopularTag[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Fetch popular tags on mount
  useEffect(() => {
    let cancelled = false

    const fetchTags = async () => {
      try {
        const res = await fetch(`${API_URL}/api/tags/popular?limit=20`)
        const data = await res.json()
        if (!cancelled && data.success) {
          setPopularTags(data.tags)
        }
      } catch (err) {
        console.error("Failed to fetch popular tags:", err)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchTags()
    return () => {
      cancelled = true
    }
  }, [])

  const toggleTag = useCallback(
    (tag: string) => {
      if (selectedTags.includes(tag)) {
        onTagsChanged(selectedTags.filter((t) => t !== tag))
      } else {
        onTagsChanged([...selectedTags, tag])
      }
    },
    [selectedTags, onTagsChanged],
  )

  const clearAll = useCallback(() => {
    onTagsChanged([])
  }, [onTagsChanged])

  // Don't render if no tags exist
  if (!isLoading && popularTags.length === 0) return null

  return (
    <View style={styles.container}>
      {isLoading ? (
        <ActivityIndicator size="small" color="#007AFF" style={styles.loader} />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Clear filter button — only visible when tags are selected */}
          {selectedTags.length > 0 && (
            <TouchableOpacity
              style={styles.clearChip}
              onPress={clearAll}
              activeOpacity={0.7}
            >
              <Text style={styles.clearChipText}>✕ Clear</Text>
            </TouchableOpacity>
          )}

          {popularTags.map(({ tag, count }) => {
            const isSelected = selectedTags.includes(tag)
            return (
              <TouchableOpacity
                key={tag}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => toggleTag(tag)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.chipText,
                    isSelected && styles.chipTextSelected,
                  ]}
                >
                  {tag}
                </Text>
                <Text
                  style={[
                    styles.chipCount,
                    isSelected && styles.chipCountSelected,
                  ]}
                >
                  {count}
                </Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 100,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  loader: {
    paddingVertical: 10,
  },
  scrollContent: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  chipSelected: {
    backgroundColor: "#007AFF",
  },
  chipText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  chipTextSelected: {
    color: "white",
  },
  chipCount: {
    fontSize: 12,
    fontWeight: "600",
    color: "#999",
  },
  chipCountSelected: {
    color: "rgba(255, 255, 255, 0.75)",
  },
  clearChip: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  clearChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#999",
  },
})

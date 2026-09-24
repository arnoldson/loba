import React, { useCallback } from "react"
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native"
import { MAX_FILTER_TAGS } from "@loba/shared"

export interface PopularTag {
  tag: string
  count: number
}

interface TagFilterBarProps {
  popularTags: PopularTag[]
  isLoading: boolean
  selectedTags: string[]
  onTagsChanged: (tags: string[]) => void
}

// Presentational only — fetching and refresh timing are owned by the
// parent screen (index.tsx), alongside the rest of its post/map fetch
// orchestration. See handlePostCreated / handleRegionChangeComplete for
// when popularTags gets refreshed.
export function TagFilterBar({
  popularTags,
  isLoading,
  selectedTags,
  onTagsChanged,
}: TagFilterBarProps) {
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

  // The server rejects more than MAX_FILTER_TAGS (#76), so once the
  // cap is reached only deselecting stays possible.
  const atLimit = selectedTags.length >= MAX_FILTER_TAGS

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
            const isDisabled = atLimit && !isSelected
            return (
              <TouchableOpacity
                key={tag}
                style={[
                  styles.chip,
                  isSelected && styles.chipSelected,
                  isDisabled && styles.chipDisabled,
                ]}
                onPress={() => toggleTag(tag)}
                disabled={isDisabled}
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
  chipDisabled: {
    opacity: 0.4,
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

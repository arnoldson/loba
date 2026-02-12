import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import type { CreatePostRequest, CreatePostResponse, Post } from "@loba/shared";
import { TileMarker } from "@/components/TileMarker";
import { TileDetailsModal } from "@/components/TileDetailsModal";
import { getZoomLevel, getGroupingFactor } from "@/utils/tiles";
import { groupPostsByZoomLevel, type SuperTile } from "@/utils/postGrouping";
import {
  getBoundingBox,
  getVisibleAreaMeters,
  BoundsCache,
} from "@/utils/mapBounds";
import { perfMonitor } from "@/utils/diagnostics";

// Backend API URL
const API_URL = Platform.select({
  ios: "http://localhost:3000",
  android: "http://10.0.2.2:3000",
  default: "http://localhost:3000",
});

// Initial map settings
const INITIAL_LAT_DELTA = 0.005;

export default function HomeScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(
    null
  );
  const [posts, setPosts] = useState<Post[]>([]);
  const [zoom, setZoom] = useState(() => getZoomLevel(INITIAL_LAT_DELTA));
  const [isLoadingPosts, setIsLoadingPosts] = useState(false);

  const mapRef = useRef<MapView>(null);
  const boundsCache = useRef(new BoundsCache(50)).current;
  const lastFetchTime = useRef(0);
  const hasInitialFetched = useRef(false);

  // Post creation modal
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [postText, setPostText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // Tile details modal
  const [selectedTile, setSelectedTile] = useState<SuperTile | null>(null);
  const [isTileModalVisible, setIsTileModalVisible] = useState(false);

  // Track renders for performance monitoring
  useEffect(() => {
    perfMonitor.logRender("HomeScreen");
  });

  // Get current location
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission denied", "Location permission is required");
        return;
      }

      let currentLocation = await Location.getCurrentPositionAsync({});
      setLocation(currentLocation);
    })();
  }, []);

  // Fetch posts for visible map area using bounding box
  const fetchVisiblePosts = useCallback(
    async (region: Region) => {
      const fetchStartTime = Date.now();

      try {
        // Check loading state directly
        if (isLoadingPosts) {
          console.log("⏭️  Skipping fetch - already loading");
          return;
        }

        const currentZoom = getZoomLevel(region.latitudeDelta);

        if (currentZoom < 13) {
          console.log(`⏸️  Zoom ${currentZoom} too low - skipping fetch`);
          setPosts([]);
          return;
        }

        setIsLoadingPosts(true);

        // CRITICAL: Clear posts while loading to prevent marker index crashes
        setPosts([]);

        const bounds = getBoundingBox(region);
        const area = getVisibleAreaMeters(region);

        console.log(`🗺️  Visible area: ${area.width}m × ${area.height}m`);
        console.log(
          `📦 Bounding box: [${bounds.minLat.toFixed(
            4
          )}, ${bounds.minLng.toFixed(4)}, ${bounds.maxLat.toFixed(
            4
          )}, ${bounds.maxLng.toFixed(4)}]`
        );

        // Check cache
        const cachedPosts = boundsCache.get(bounds);
        if (cachedPosts) {
          console.log(`✅ Loaded ${cachedPosts.length} posts from cache`);
          setPosts(cachedPosts);
          setIsLoadingPosts(false);
          return;
        }

        // Fetch from backend
        const response = await fetch(`${API_URL}/api/posts/in-bounds`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bounds),
        });

        if (!response.ok) {
          throw new Error("Failed to fetch posts");
        }

        const data = await response.json();

        if (data.success) {
          const fetchDuration = Date.now() - fetchStartTime;
          console.log(
            `✅ Fetched ${data.posts.length} posts (DB: ${
              data.dbQueryTime || "N/A"
            }ms, Total: ${fetchDuration}ms)`
          );
          perfMonitor.logFetch(fetchDuration, data.posts.length);

          boundsCache.set(bounds, data.posts);
          setPosts(data.posts);

          console.log(
            `💾 Cache now has ${boundsCache.getStats().size} regions`
          );
        }
      } catch (error) {
        console.error("❌ Error fetching posts:", error);
        setPosts([]); // Clear on error too
      } finally {
        setIsLoadingPosts(false);
      }
    },
    [boundsCache]
  );

  // Fetch nearby posts when location is available - ONLY ONCE
  useEffect(() => {
    if (location && mapRef.current && !hasInitialFetched.current) {
      hasInitialFetched.current = true;

      console.log(
        "📍 Your location:",
        location.coords.latitude,
        location.coords.longitude
      );

      mapRef.current.getCamera().then((camera) => {
        if (camera) {
          const initialRegion: Region = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: INITIAL_LAT_DELTA,
            longitudeDelta: INITIAL_LAT_DELTA,
          };

          const calculatedZoom = getZoomLevel(initialRegion.latitudeDelta);
          console.log(`🎯 Initial zoom calculated: ${calculatedZoom}`);
          setZoom(calculatedZoom);

          fetchVisiblePosts(initialRegion);
        }
      });
    }
  }, [location, fetchVisiblePosts]);

  // Handle map region changes while panning (lightweight - just update zoom)
  const handleRegionChange = (newRegion: Region) => {
    const calculatedZoom = getZoomLevel(newRegion.latitudeDelta);
    setZoom(calculatedZoom);
  };

  // Handle region change complete (when user stops panning - fetch posts)
  const handleRegionChangeComplete = useCallback(
    (region: Region) => {
      const calculatedZoom = getZoomLevel(region.latitudeDelta);
      setZoom(calculatedZoom);

      // Don't fetch if already loading
      if (isLoadingPosts) {
        console.log("⏭️  Skipping - already loading");
        return;
      }

      // Throttle: only fetch once per second
      const now = Date.now();
      if (now - lastFetchTime.current < 1000) {
        console.log("⏭️  Skipping - throttled");
        return;
      }

      lastFetchTime.current = now;
      fetchVisiblePosts(region);
    },
    [isLoadingPosts, fetchVisiblePosts]
  );

  const recenterMap = () => {
    if (location && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: INITIAL_LAT_DELTA,
          longitudeDelta: INITIAL_LAT_DELTA,
        },
        500
      );
    }
  };

  const handleCreatePost = async () => {
    if (!location) {
      Alert.alert("Error", "Location not available");
      return;
    }

    const requestBody: CreatePostRequest = {
      content: postText,
      tags: tags,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };

    try {
      const response = await fetch(`${API_URL}/api/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data: CreatePostResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to create post");
      }

      Alert.alert("Success!", "Post created successfully!");

      setPosts([data.post, ...posts]);
      boundsCache.clear();

      setPostText("");
      setTags([]);
      setTagInput("");
      setIsModalVisible(false);
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to create post"
      );
      console.error(error);
    }
  };

  const handleAddTag = (text: string) => {
    setTagInput(text);

    if (text.endsWith(" ") && text.trim().startsWith("#")) {
      const newTag = text.trim();
      if (newTag.length > 1 && !tags.includes(newTag)) {
        setTags([...tags, newTag]);
        setTagInput("");
      }
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleTilePress = (tile: SuperTile) => {
    setSelectedTile(tile);
    setIsTileModalVisible(true);
  };

  // Calculate grouping based on current zoom - MEMOIZED with marker limit
  const groupingFactor = getGroupingFactor(zoom);
  const supertiles = useMemo(() => {
    if (!groupingFactor) return [];

    const grouped = groupPostsByZoomLevel(posts, groupingFactor);

    // CRITICAL: Limit markers to prevent native crashes
    const MAX_MARKERS = 150;
    if (grouped.length > MAX_MARKERS) {
      console.warn(
        `⚠️  Too many markers (${grouped.length}), limiting to ${MAX_MARKERS}`
      );
      return grouped.slice(0, MAX_MARKERS);
    }

    return grouped;
  }, [posts, groupingFactor]);

  // Log marker count for verification
  if (supertiles.length > 0) {
    console.log(
      `🎯 Zoom ${zoom}: Showing ${supertiles.length} markers (grouping factor: ${groupingFactor})`
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        region={
          location
            ? {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                latitudeDelta: INITIAL_LAT_DELTA,
                longitudeDelta: INITIAL_LAT_DELTA,
              }
            : {
                latitude: 37.78825,
                longitude: -122.4324,
                latitudeDelta: 0.0922,
                longitudeDelta: 0.0421,
              }
        }
        onRegionChange={handleRegionChange}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {/* User location */}
        {location && (
          <Marker
            coordinate={{
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            }}
            title="You are here"
          />
        )}

        {/* Tile markers with optimized grouping and stable keys */}
        {supertiles.map((tile) => {
          // CRITICAL: Create unique key using post IDs to prevent index crashes
          // Using first and last post ID creates a stable, unique identifier
          const firstPostId = tile.posts[0]?.id || "";
          const lastPostId = tile.posts[tile.posts.length - 1]?.id || "";
          const uniqueKey = `z${zoom}-${tile.supertile_id}-${firstPostId}-${lastPostId}`;

          return (
            <Marker
              key={uniqueKey}
              coordinate={tile.center}
              onPress={() => handleTilePress(tile)}
              tracksViewChanges={false}
            >
              <TileMarker count={tile.count} groupingFactor={groupingFactor} />
            </Marker>
          );
        })}
      </MapView>

      {/* Zoom indicator */}
      {groupingFactor === null && (
        <View style={styles.zoomHint}>
          <Text style={styles.zoomHintText}>Zoom in to see posts</Text>
        </View>
      )}

      {/* Loading indicator */}
      {isLoadingPosts && (
        <View style={styles.loadingIndicator}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.loadingText}>Loading posts...</Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.createButton}
        onPress={() => setIsModalVisible(true)}
      >
        <Text style={styles.createButtonText}>+</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.recenterButton} onPress={recenterMap}>
        <Text style={styles.recenterButtonText}>⦿</Text>
      </TouchableOpacity>

      {/* Create Post Modal */}
      <Modal
        visible={isModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalContainer}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            onPress={() => setIsModalVisible(false)}
          />
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
                onPress={() => {
                  setPostText("");
                  setTags([]);
                  setTagInput("");
                  setIsModalVisible(false);
                }}
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

      {/* Tile Details Modal */}
      <TileDetailsModal
        visible={isTileModalVisible}
        tile={selectedTile}
        onClose={() => setIsTileModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  createButton: {
    position: "absolute",
    bottom: 30,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  createButtonText: {
    fontSize: 36,
    color: "white",
    fontWeight: "300",
  },
  recenterButton: {
    position: "absolute",
    bottom: 30,
    left: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  recenterButtonText: {
    fontSize: 24,
    color: "#007AFF",
  },
  zoomHint: {
    position: "absolute",
    top: 60,
    alignSelf: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  zoomHintText: {
    color: "white",
    fontSize: 14,
    fontWeight: "500",
  },
  loadingIndicator: {
    position: "absolute",
    top: 100,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  loadingText: {
    color: "#007AFF",
    fontSize: 14,
    fontWeight: "500",
    marginLeft: 8,
  },
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
});

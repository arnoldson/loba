import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
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
} from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import type { CreatePostRequest, CreatePostResponse, Post } from "@loba/shared";
import { TileMarker } from "@/components/TileMarker";
import { TileDetailsModal } from "@/components/TileDetailsModal";
import { getTileRange, getZoomLevel, getGroupingFactor, getTileId } from "@/utils/tiles";
import { groupPostsByZoomLevel, type SuperTile } from "@/utils/postGrouping";

// Backend API URL
const API_URL = Platform.select({
  ios: "http://localhost:3000",
  android: "http://10.0.2.2:3000",
  default: "http://localhost:3000",
});

export default function HomeScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [zoom, setZoom] = useState(18);
  const mapRef = useRef<MapView>(null);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Post creation modal
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [postText, setPostText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  
  // Tile details modal
  const [selectedTile, setSelectedTile] = useState<SuperTile | null>(null);
  const [isTileModalVisible, setIsTileModalVisible] = useState(false);

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

  // Fetch nearby posts when location is available
  useEffect(() => {
    if (location) {
      console.log('📍 Your location:', location.coords.latitude, location.coords.longitude);
      console.log('🔍 Fetching posts in ~33m × 33m area (11×11 tiles of 3m each)');
      
      // VISIBLE ALERT - Can't miss this!
      Alert.alert(
        'Location Found',
        `Lat: ${location.coords.latitude.toFixed(4)}\nLng: ${location.coords.longitude.toFixed(4)}\n\nFetching posts...`,
        [{ text: 'OK' }]
      );
      
      fetchNearbyPosts(location.coords.latitude, location.coords.longitude);
    }
  }, [location]);

  // Fetch nearby posts based on map region (not just GPS location)
  const fetchNearbyPosts = async (lat: number, lng: number) => {
    try {
      // Get tile IDs in MUCH LARGER grid (101×101 tiles = 303m × 303m area)
      // Changed from radius 5 (33m) to radius 50 (303m) to see more posts
      const tileIds = getTileRange(lat, lng, 50);
      
      console.log(`📦 Fetching posts for ${tileIds.length} tiles`);
      console.log('🎯 Center tile:', getTileId(lat, lng));
      console.log('📍 Tile IDs sample:', tileIds.slice(0, 5));
      
      const response = await fetch(`${API_URL}/api/posts/by-tiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tile_ids: tileIds, limit: 5000 }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch posts");
      }

      const data = await response.json();
      if (data.success) {
        console.log(`✅ Fetched ${data.posts.length} posts`);
        if (data.posts.length === 0) {
          console.log('⚠️ No posts found in this area!');
          console.log('💡 Try seeding posts: curl -X POST http://localhost:3000/api/seed -H "Content-Type: application/json" -d \'{"centerLat": ' + lat + ', "centerLng": ' + lng + ', "count": 500}\'');
        }
        setPosts(data.posts);
      }
    } catch (error) {
      console.error("❌ Error fetching posts:", error);
    }
  };

  const handleRegionChange = (region: Region) => {
    const calculatedZoom = getZoomLevel(region.latitudeDelta);
    setZoom(calculatedZoom);
    
    // Debounce fetch - wait 500ms after user stops moving map
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }
    
    fetchTimeoutRef.current = setTimeout(() => {
      fetchNearbyPosts(region.latitude, region.longitude);
    }, 500);
  };

  const recenterMap = () => {
    if (location && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
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
      
      // Add new post to local state
      setPosts([data.post, ...posts]);

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

  // DEV ONLY: Seed posts around current location
  const handleSeedPosts = async () => {
    if (!location) {
      Alert.alert("Error", "Location not available");
      return;
    }

    Alert.alert(
      "Seed Posts",
      "Create 500 test posts around your location?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Seed",
          onPress: async () => {
            try {
              const response = await fetch(`${API_URL}/api/seed`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  centerLat: location.coords.latitude,
                  centerLng: location.coords.longitude,
                  count: 500,
                }),
              });

              const data = await response.json();

              if (data.success) {
                Alert.alert("Success!", `Seeded ${data.count} posts!`);
                // Re-fetch posts
                fetchNearbyPosts(location.coords.latitude, location.coords.longitude);
              } else {
                throw new Error(data.error || "Failed to seed");
              }
            } catch (error) {
              Alert.alert("Error", "Failed to seed posts");
              console.error(error);
            }
          },
        },
      ]
    );
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

  // Calculate grouping based on current zoom
  const groupingFactor = getGroupingFactor(zoom);
  const supertiles = groupingFactor 
    ? groupPostsByZoomLevel(posts, groupingFactor)
    : [];

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
                latitudeDelta: 0.005,
                longitudeDelta: 0.005,
              }
            : {
                latitude: 37.78825,
                longitude: -122.4324,
                latitudeDelta: 0.0922,
                longitudeDelta: 0.0421,
              }
        }
        onRegionChangeComplete={handleRegionChange}
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

        {/* Tile markers */}
        {supertiles.map((tile) => (
          <Marker
            key={tile.supertile_id}
            coordinate={tile.center}
            onPress={() => handleTilePress(tile)}
            tracksViewChanges={false}
          >
            <TileMarker count={tile.count} groupingFactor={groupingFactor!} />
          </Marker>
        ))}
      </MapView>

      {/* Zoom indicator */}
      {groupingFactor === null && (
        <View style={styles.zoomHint}>
          <Text style={styles.zoomHintText}>Zoom in to see posts</Text>
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

import { useAuth } from "@/utils/auth"
import * as Location from "expo-location"
import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import MapView, { Marker, Region } from "react-native-maps"
import { TileMarker } from "@/components/TileMarker"
import { TileDetailsModal } from "@/components/TileDetailsModal"
import { CreatePostModal } from "@/components/CreatePostModal"
import { getZoomLevel, getGroupingFactor } from "@/utils/tiles"
import {
  type SuperTile,
  SupertileCache,
  getVisibleSupertileIds,
  snapBoundsToGrid,
  groupPostsIntoSupertiles,
  type Bounds,
} from "@/utils/postGrouping"
import { getBoundingBox, getVisibleAreaMeters } from "@/utils/mapBounds"
import { perfMonitor } from "@/utils/diagnostics"

// Backend API URL
const API_URL = Platform.select({
  ios: "http://localhost:3000",
  android: "http://10.0.2.2:3000",
  default: "http://localhost:3000",
})

// Initial map settings
const INITIAL_LAT_DELTA = 0.005

/**
 * Expand a Region into bounds scaled by `factor` (e.g., 2.0 = 2× the viewport).
 * Used for the eviction zone — supertiles outside this area are pruned from cache.
 */
function expandRegionToBounds(region: Region, factor: number): Bounds {
  const latMargin = (region.latitudeDelta * factor) / 2
  const lngMargin = (region.longitudeDelta * factor) / 2
  return {
    minLat: region.latitude - latMargin,
    maxLat: region.latitude + latMargin,
    minLng: region.longitude - lngMargin,
    maxLng: region.longitude + lngMargin,
  }
}

export default function HomeScreen() {
  const { getAuthHeaders, session } = useAuth()
  const [location, setLocation] = useState<Location.LocationObject | null>(null)
  const [zoom, setZoom] = useState(() => getZoomLevel(INITIAL_LAT_DELTA))
  const [isLoadingPosts, setIsLoadingPosts] = useState(false)

  // Supertile cache — THE source of truth for all tile data.
  const supertileCache = useRef(new SupertileCache()).current

  // The supertiles currently visible on screen — derived from the cache.
  const [visibleSupertiles, setVisibleSupertiles] = useState<SuperTile[]>([])

  const mapRef = useRef<MapView>(null)
  const lastFetchTime = useRef(0)
  const hasInitialFetched = useRef(false)

  // Modal visibility
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false)
  const [selectedTile, setSelectedTile] = useState<SuperTile | null>(null)
  const [isTileModalVisible, setIsTileModalVisible] = useState(false)

  // Track renders for performance monitoring
  useEffect(() => {
    perfMonitor.logRender("HomeScreen")
  })

  // Get current location
  useEffect(() => {
    ;(async () => {
      let { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== "granted") {
        Alert.alert("Permission denied", "Location permission is required")
        return
      }

      let currentLocation = await Location.getCurrentPositionAsync({})
      setLocation(currentLocation)
    })()
  }, [])

  // Fetch posts for visible area — only fetches supertiles not already cached
  const fetchVisiblePosts = useCallback(
    async (region: Region) => {
      const fetchStartTime = Date.now()

      try {
        if (isLoadingPosts) {
          console.log("⏭️  Skipping fetch - already loading")
          return
        }

        const currentZoom = getZoomLevel(region.latitudeDelta)
        const grouping = getGroupingFactor(currentZoom)

        if (!grouping || currentZoom < 13) {
          console.log(`⏸️  Zoom ${currentZoom} too low - clearing`)
          supertileCache.clear()
          setVisibleSupertiles([])
          return
        }

        // 1. Determine which supertile grid cells are visible
        const viewportBounds = getBoundingBox(region)
        const visibleIds = getVisibleSupertileIds(viewportBounds, grouping)

        console.log(
          `🔍 Visible: ${visibleIds.size} supertile cells at grouping ${grouping}`,
        )

        // 2. Check which are missing from cache
        const missingIds = supertileCache.getMissing(visibleIds, grouping)

        if (missingIds.size === 0) {
          // Everything is cached — just update the display, no fetch needed!
          console.log(`✅ Full cache hit — ${visibleIds.size} supertiles`)
          setVisibleSupertiles(supertileCache.getVisible(visibleIds))

          // Evict supertiles far from viewport (3× buffer)
          const evictionBounds = expandRegionToBounds(region, 3.0)
          const keepIds = getVisibleSupertileIds(evictionBounds, grouping)
          supertileCache.evictOutside(keepIds)
          return
        }

        console.log(
          `📡 Cache miss: ${missingIds.size}/${visibleIds.size} supertiles need fetching`,
        )

        setIsLoadingPosts(true)

        // 3. Show what we have from cache immediately (no blank screen)
        const cachedTiles = supertileCache.getVisible(visibleIds)
        if (cachedTiles.length > 0) {
          setVisibleSupertiles(cachedTiles)
        }

        // 4. Fetch the snapped bounding box (aligned to supertile grid)
        //    This ensures we get COMPLETE supertiles at the edges
        const snappedBounds = snapBoundsToGrid(viewportBounds, grouping)
        const area = getVisibleAreaMeters(region)

        console.log(`🗺️  Visible area: ${area.width}m × ${area.height}m`)
        console.log(
          `📦 Snapped bounds: [${snappedBounds.minLat.toFixed(
            4,
          )}, ${snappedBounds.minLng.toFixed(
            4,
          )}, ${snappedBounds.maxLat.toFixed(
            4,
          )}, ${snappedBounds.maxLng.toFixed(4)}]`,
        )

        const response = await fetch(`${API_URL}/api/posts/in-bounds`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify(snappedBounds),
        })

        if (!response.ok) {
          throw new Error("Failed to fetch posts")
        }

        const data = await response.json()

        if (data.success) {
          const fetchDuration = Date.now() - fetchStartTime
          console.log(
            `✅ Fetched ${data.posts.length} posts (DB: ${
              data.dbQueryTime || "N/A"
            }ms, Total: ${fetchDuration}ms)`,
          )
          perfMonitor.logFetch(fetchDuration, data.posts.length)

          // 5. Group into supertiles and add to cache
          const newSupertiles = groupPostsIntoSupertiles(data.posts, grouping)
          supertileCache.addSupertiles(newSupertiles, grouping)

          // 6. Update display from cache
          setVisibleSupertiles(supertileCache.getVisible(visibleIds))

          // 7. Evict far-away supertiles (keep 3× viewport as buffer)
          const evictionBounds = expandRegionToBounds(region, 3.0)
          const keepIds = getVisibleSupertileIds(evictionBounds, grouping)
          supertileCache.evictOutside(keepIds)

          console.log(`💾 Supertile cache: ${supertileCache.size} tiles`)
        }
      } catch (error) {
        console.error("❌ Error fetching posts:", error)
        // On error, show whatever is cached — don't blank the map
        const grouping = getGroupingFactor(getZoomLevel(region.latitudeDelta))
        if (grouping) {
          const viewportBounds = getBoundingBox(region)
          const visibleIds = getVisibleSupertileIds(viewportBounds, grouping)
          setVisibleSupertiles(supertileCache.getVisible(visibleIds))
        }
      } finally {
        setIsLoadingPosts(false)
      }
    },
    [supertileCache],
  )

  // Fetch nearby posts when location is available - ONLY ONCE
  useEffect(() => {
    if (location && mapRef.current && !hasInitialFetched.current) {
      hasInitialFetched.current = true

      console.log(
        "📍 Your location:",
        location.coords.latitude,
        location.coords.longitude,
      )

      mapRef.current.getCamera().then((camera) => {
        if (camera) {
          const initialRegion: Region = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: INITIAL_LAT_DELTA,
            longitudeDelta: INITIAL_LAT_DELTA,
          }

          const calculatedZoom = getZoomLevel(initialRegion.latitudeDelta)
          console.log(`🎯 Initial zoom calculated: ${calculatedZoom}`)
          setZoom(calculatedZoom)

          fetchVisiblePosts(initialRegion)
        }
      })
    }
  }, [location, fetchVisiblePosts])

  // Handle map region changes while panning (lightweight - just update zoom)
  const handleRegionChange = (newRegion: Region) => {
    const calculatedZoom = getZoomLevel(newRegion.latitudeDelta)
    setZoom(calculatedZoom)
  }

  // Handle region change complete (when user stops panning - fetch posts)
  const handleRegionChangeComplete = useCallback(
    (region: Region) => {
      const calculatedZoom = getZoomLevel(region.latitudeDelta)
      setZoom(calculatedZoom)

      if (isLoadingPosts) {
        console.log("⏭️  Skipping - already loading")
        return
      }

      const now = Date.now()
      if (now - lastFetchTime.current < 1000) {
        console.log("⏭️  Skipping - throttled")
        return
      }

      lastFetchTime.current = now
      fetchVisiblePosts(region)
    },
    [isLoadingPosts, fetchVisiblePosts],
  )

  const recenterMap = () => {
    if (location && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: INITIAL_LAT_DELTA,
          longitudeDelta: INITIAL_LAT_DELTA,
        },
        500,
      )
    }
  }

  // Called by CreatePostModal after a successful post
  const handlePostCreated = useCallback(
    (post: any) => {
      const grouping = getGroupingFactor(zoom)
      if (grouping && location) {
        supertileCache.addPost(post, grouping)
        const region: Region = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: INITIAL_LAT_DELTA,
          longitudeDelta: INITIAL_LAT_DELTA,
        }
        const viewportBounds = getBoundingBox(region)
        const visibleIds = getVisibleSupertileIds(viewportBounds, grouping)
        setVisibleSupertiles(supertileCache.getVisible(visibleIds))
      }
    },
    [zoom, location, supertileCache],
  )

  const handleTilePress = (tile: SuperTile) => {
    setSelectedTile(tile)
    setIsTileModalVisible(true)
  }

  // Apply marker limit to prevent native crashes
  const groupingFactor = getGroupingFactor(zoom)
  const supertiles = useMemo(() => {
    const MAX_MARKERS = 150
    if (visibleSupertiles.length > MAX_MARKERS) {
      console.warn(
        `⚠️  Too many markers (${visibleSupertiles.length}), limiting to ${MAX_MARKERS}`,
      )
      return visibleSupertiles.slice(0, MAX_MARKERS)
    }
    return visibleSupertiles
  }, [visibleSupertiles])

  if (supertiles.length > 0) {
    console.log(
      `🎯 Zoom ${zoom}: Showing ${supertiles.length} markers (grouping factor: ${groupingFactor})`,
    )
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
        {location && (
          <Marker
            coordinate={{
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            }}
            title="You are here"
          />
        )}

        {supertiles.map((tile) => {
          const uniqueKey = `g${groupingFactor}-${tile.supertile_id}`

          return (
            <Marker
              key={uniqueKey}
              coordinate={tile.center}
              onPress={() => handleTilePress(tile)}
              tracksViewChanges={false}
            >
              <TileMarker count={tile.count} groupingFactor={groupingFactor} />
            </Marker>
          )
        })}
      </MapView>

      {groupingFactor === null && (
        <View style={styles.zoomHint}>
          <Text style={styles.zoomHintText}>Zoom in to see posts</Text>
        </View>
      )}

      {isLoadingPosts && (
        <View style={styles.loadingIndicator}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.loadingText}>Loading posts...</Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.createButton}
        onPress={() => setIsCreateModalVisible(true)}
      >
        <Text style={styles.createButtonText}>+</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.recenterButton} onPress={recenterMap}>
        <Text style={styles.recenterButtonText}>⦿</Text>
      </TouchableOpacity>

      {location && (
        <CreatePostModal
          visible={isCreateModalVisible}
          onClose={() => setIsCreateModalVisible(false)}
          latitude={location.coords.latitude}
          longitude={location.coords.longitude}
          onPostCreated={handlePostCreated}
        />
      )}

      <TileDetailsModal
        visible={isTileModalVisible}
        tile={selectedTile}
        onClose={() => setIsTileModalVisible(false)}
        authToken={session?.access_token ?? null}
      />
    </View>
  )
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
})

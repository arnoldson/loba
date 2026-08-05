import { useAuth } from "@/utils/auth"
import * as Location from "expo-location"
import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import MapView, { Marker, Region } from "react-native-maps"
import { TileMarker } from "@/components/TileMarker"
import { TileDetailsModal } from "@/components/TileDetailsModal"
import { CreatePostModal } from "@/components/CreatePostModal"
import { TagFilterBar } from "@/components/TagFilterBar"
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
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { DevCrashButton } from "@/components/DevCrashButton"
import { API_URL } from "@/utils/api"

// Backend API URL

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

function UserLocationDot() {
  return (
    <View
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: "#007AFF",
        borderWidth: 2,
        borderColor: "white",
      }}
    />
  )
}

export default function HomeScreen() {
  const { getAuthHeaders, session } = useAuth()
  const [location, setLocation] = useState<Location.LocationObject | null>(null)
  const [zoom, setZoom] = useState(() => getZoomLevel(INITIAL_LAT_DELTA))
  const [isLoadingPosts, setIsLoadingPosts] = useState(false)

  // Tag filter state
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  // Supertile cache — THE source of truth for all tile data.
  const supertileCache = useRef(new SupertileCache()).current

  // The supertiles currently visible on screen — derived from the cache.
  const [visibleSupertiles, setVisibleSupertiles] = useState<SuperTile[]>([])

  // Whether newly-added markers should still be tracked for re-snapshotting.
  // iOS can take a custom marker's view snapshot before its first layout pass
  // completes, resulting in an invisible marker if tracksViewChanges is false
  // from the start. We track for a short window after new markers appear,
  // then switch tracking off again for performance.
  const [markersReady, setMarkersReady] = useState(false)

  const mapRef = useRef<MapView>(null)
  const lastFetchTime = useRef(0)
  const hasInitialFetched = useRef(false)

  // Track the last region so we can re-fetch when tags change or posts are deleted
  const lastRegion = useRef<Region | null>(null)

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
  // Omitting getAuthHeaders and isLoadingPosts from deps is intentional:
  // - isLoadingPosts: checked as a guard inside the callback, not a reactive dependency
  // - getAuthHeaders: stable from useAuth, adding it causes unnecessary re-renders
  const fetchVisiblePosts = useCallback(
    async (region: Region, tags?: string[]) => {
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

        // When tags are active, skip the cache optimization and always fetch
        // fresh data so filtering is accurate.
        const hasTags = tags && tags.length > 0

        // 1. Determine which supertile grid cells are visible
        const viewportBounds = getBoundingBox(region)
        const visibleIds = getVisibleSupertileIds(viewportBounds, grouping)

        console.log(
          `🔍 Visible: ${visibleIds.size} supertile cells at grouping ${grouping}${
            hasTags ? ` (filtered by: ${tags!.join(", ")})` : ""
          }`,
        )

        // 2. Check which are missing from cache (skip when filtering by tags)
        if (!hasTags) {
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
        }

        setIsLoadingPosts(true)

        // 3. Show what we have from cache immediately (no blank screen)
        if (!hasTags) {
          const cachedTiles = supertileCache.getVisible(visibleIds)
          if (cachedTiles.length > 0) {
            setVisibleSupertiles(cachedTiles)
          }
        }

        // 4. Fetch the snapped bounding box (aligned to supertile grid)
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

        const body: Record<string, any> = { ...snappedBounds }
        if (hasTags) {
          body.tags = tags
        }

        const response = await fetch(`${API_URL}/api/posts/in-bounds`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify(body),
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

          if (hasTags) {
            supertileCache.clear()
          }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supertileCache],
  )

  // Re-fetch when tags change.
  // Intentionally only depends on selectedTags — fetchVisiblePosts and supertileCache
  // are stable refs that don't need to trigger this effect.
  useEffect(() => {
    if (!hasInitialFetched.current) return

    const region = lastRegion.current
    if (!region) return

    supertileCache.clear()
    setVisibleSupertiles([])
    fetchVisiblePosts(region, selectedTags)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTags])

  // Fetch nearby posts when location is available - ONLY ONCE.
  // Also moves the camera to the real location, since MapView now uses
  // initialRegion (mount-only) instead of a controlled region prop.
  // Intentionally omits selectedTags — initial fetch should always be unfiltered.
  useEffect(() => {
    if (location && mapRef.current && !hasInitialFetched.current) {
      hasInitialFetched.current = true

      console.log(
        "📍 Your location:",
        location.coords.latitude,
        location.coords.longitude,
      )

      const initialRegion: Region = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: INITIAL_LAT_DELTA,
        longitudeDelta: INITIAL_LAT_DELTA,
      }

      mapRef.current.animateToRegion(initialRegion, 0)

      const calculatedZoom = getZoomLevel(initialRegion.latitudeDelta)
      console.log(`🎯 Initial zoom calculated: ${calculatedZoom}`)
      setZoom(calculatedZoom)
      lastRegion.current = initialRegion

      fetchVisiblePosts(initialRegion, selectedTags)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      lastRegion.current = region

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
      fetchVisiblePosts(region, selectedTags)
    },
    [isLoadingPosts, fetchVisiblePosts, selectedTags],
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

  // Called by TileDetailsModal after a post is deleted
  const handlePostDeleted = useCallback(
    (_postId: string) => {
      supertileCache.clear()
      const region = lastRegion.current
      if (region) {
        fetchVisiblePosts(region, selectedTags)
      }
    },
    [supertileCache, fetchVisiblePosts, selectedTags],
  )

  const handleTilePress = (tile: SuperTile) => {
    setSelectedTile(tile)
    setIsTileModalVisible(true)
  }

  const handleTagsChanged = useCallback((tags: string[]) => {
    setSelectedTags(tags)
  }, [])

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

  // Briefly re-enable tracksViewChanges whenever the set of markers changes,
  // so newly-mounted custom marker views get a chance to render before their
  // snapshot is frozen. Switches back off after ~100ms for performance.
  useEffect(() => {
    if (supertiles.length > 0) {
      setMarkersReady(false)
      const timer = setTimeout(() => setMarkersReady(true), 100)
      return () => clearTimeout(timer)
    }
  }, [supertiles])

  if (supertiles.length > 0) {
    console.log(
      `🎯 Zoom ${zoom}: Showing ${supertiles.length} markers (grouping factor: ${groupingFactor})`,
    )
  }

  return (
    <View style={styles.container}>
      <ErrorBoundary label="Map">
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={
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
          {supertiles.map((tile) => {
            const uniqueKey = `g${groupingFactor}-${tile.supertile_id}`
            return (
              <Marker
                key={uniqueKey}
                coordinate={tile.center}
                onPress={() => handleTilePress(tile)}
                tracksViewChanges={!markersReady}
                zIndex={1}
              >
                <TileMarker
                  count={tile.count}
                  groupingFactor={groupingFactor}
                />
              </Marker>
            )
          })}

          {location && (
            <Marker
              coordinate={{
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
              }}
              title="You are here"
              zIndex={1000}
              tracksViewChanges={false}
            >
              <UserLocationDot />
            </Marker>
          )}
        </MapView>
        {__DEV__ && <DevCrashButton />}
      </ErrorBoundary>

      {/* Tag filter bar */}
      <TagFilterBar
        selectedTags={selectedTags}
        onTagsChanged={handleTagsChanged}
      />

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

      {selectedTags.length > 0 && (
        <View style={styles.filterIndicator}>
          <Text style={styles.filterIndicatorText}>
            Filtering: {selectedTags.join(", ")}
          </Text>
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
      <ErrorBoundary label="Post details">
        <TileDetailsModal
          visible={isTileModalVisible}
          tile={selectedTile}
          onClose={() => setIsTileModalVisible(false)}
          authToken={session?.access_token ?? null}
          onPostDeleted={handlePostDeleted}
          userLocation={
            location
              ? {
                  latitude: location.coords.latitude,
                  longitude: location.coords.longitude,
                }
              : null
          }
        />
      </ErrorBoundary>
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
    top: 140,
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
  filterIndicator: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    backgroundColor: "rgba(0, 122, 255, 0.9)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  filterIndicatorText: {
    color: "white",
    fontSize: 13,
    fontWeight: "500",
  },
})

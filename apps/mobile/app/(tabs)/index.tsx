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
  useWindowDimensions,
} from "react-native"
import MapView, { Marker, Region } from "react-native-maps"
import { TileMarker } from "@/components/TileMarker"
import {
  TileDetailsModal,
  type SelectedTile,
} from "@/components/TileDetailsModal"
import { CreatePostModal } from "@/components/CreatePostModal"
import { TagFilterBar, type PopularTag } from "@/components/TagFilterBar"
import {
  getZoomLevel,
  getGroupingFactor,
  getSupertileCenter,
  getSupertileId,
} from "@/utils/tiles"
import {
  DensityCache,
  type DensityEntry,
  getVisibleSupertileIds,
  snapBoundsToGrid,
  type Bounds,
} from "@/utils/postGrouping"
import { getBoundingBox, getVisibleAreaMeters } from "@/utils/mapBounds"
import { perfMonitor } from "@/utils/diagnostics"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { DevTestMenu } from "@/components/DevTestMenu"
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

  // The map fills its container edge-to-edge (absoluteFillObject on a
  // plain flex:1 root, no padding), so window width is an accurate,
  // always-in-sync proxy for the actual rendered map width — feeds the
  // viewport-relative clustering formula in getGroupingFactor.
  const { width: viewportWidthPx } = useWindowDimensions()

  // Tag filter state
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  // Popular tags shown in TagFilterBar — owned here (not in the component)
  // so it can be refreshed from the same places posts get refreshed
  // (post creation, pan/zoom stop), instead of only fetching once on mount.
  const [popularTags, setPopularTags] = useState<PopularTag[]>([])
  const [isLoadingTags, setIsLoadingTags] = useState(true)

  // Density cache — counts only, no post content. THE source of truth
  // for map-view marker data now that the map fetches aggregate counts
  // instead of raw posts (see /api/posts/density-in-bounds).
  const densityCache = useRef(new DensityCache()).current

  // The supertiles currently visible on screen — derived from the cache.
  const [visibleSupertiles, setVisibleSupertiles] = useState<
    {
      supertile_id: string
      count: number
      center: { latitude: number; longitude: number }
    }[]
  >([])

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
  const [selectedTile, setSelectedTile] = useState<SelectedTile | null>(null)
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

  // Fetch popular tags for TagFilterBar, scoped to the given region's
  // bounding box — mirrors fetchVisiblePosts so the tag list only ever
  // reflects what's actually visible on the map. Called on mount, after
  // creating a post, and on pan/zoom stop (piggybacking on the same fetch
  // cycle as fetchVisiblePosts) so it reflects both the user's own new
  // posts and other users' posts without needing a separate polling timer.
  const fetchPopularTags = useCallback(async (region: Region) => {
    try {
      const bounds = getBoundingBox(region)
      const params = new URLSearchParams({
        minLat: String(bounds.minLat),
        maxLat: String(bounds.maxLat),
        minLng: String(bounds.minLng),
        maxLng: String(bounds.maxLng),
        limit: "20",
      })
      const res = await fetch(`${API_URL}/api/tags/popular?${params}`)
      const data = await res.json()
      if (data.success) {
        setPopularTags(data.tags)
      }
    } catch (err) {
      console.error("Failed to fetch popular tags:", err)
    } finally {
      setIsLoadingTags(false)
    }
  }, [])

  // Fetch posts for visible area — only fetches supertiles not already cached
  // Omitting getAuthHeaders and isLoadingPosts from deps is intentional:
  // - isLoadingPosts: checked as a guard inside the callback, not a reactive dependency
  // - getAuthHeaders: stable from useAuth, adding it causes unnecessary re-renders
  const fetchVisiblePosts = useCallback(
    async (region: Region, tags?: string[]) => {
      const fetchStartTime = Date.now()

      // getCenter helper bound to the current grouping factor — DensityCache
      // doesn't store centers itself, they're cheap to derive on demand.
      const makeGetCenter = (grouping: number) => (id: string) =>
        getSupertileCenter(id, grouping)

      try {
        if (isLoadingPosts) {
          console.log("⏭️  Skipping fetch - already loading")
          return
        }

        // Viewing is never zoom-restricted (standing decision) — grouping
        // always returns a factor now, no null/too-zoomed-out case.
        const grouping = getGroupingFactor(
          region.longitudeDelta,
          region.latitude,
          viewportWidthPx,
        )
        const getCenter = makeGetCenter(grouping)

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
          const missingIds = densityCache.getMissing(visibleIds, grouping)

          if (missingIds.size === 0) {
            // Everything is cached — just update the display, no fetch needed!
            console.log(`✅ Full cache hit — ${visibleIds.size} supertiles`)
            setVisibleSupertiles(densityCache.getVisible(visibleIds, getCenter))

            // Evict supertiles far from viewport (3× buffer)
            const evictionBounds = expandRegionToBounds(region, 3.0)
            const keepIds = getVisibleSupertileIds(evictionBounds, grouping)
            densityCache.evictOutside(keepIds)
            return
          }

          console.log(
            `📡 Cache miss: ${missingIds.size}/${visibleIds.size} supertiles need fetching`,
          )
        }

        setIsLoadingPosts(true)

        // 3. Show what we have from cache immediately (no blank screen)
        if (!hasTags) {
          const cachedTiles = densityCache.getVisible(visibleIds, getCenter)
          if (cachedTiles.length > 0) {
            setVisibleSupertiles(cachedTiles)
          }
        }

        // 4. Fetch the snapped bounding box (aligned to supertile grid) —
        // density counts only, no post content.
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

        const body: Record<string, any> = {
          ...snappedBounds,
          groupingFactor: grouping,
        }
        if (hasTags) {
          body.tags = tags
        }

        const response = await fetch(`${API_URL}/api/posts/density-in-bounds`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          let code: string | undefined
          try {
            const errBody = await response.json()
            code = errBody?.code
          } catch {
            // Response wasn't JSON — fall through, code stays undefined
          }
          throw new Error(
            code === "banned"
              ? "BANNED_ACCOUNT"
              : "Failed to fetch post density",
          )
        }

        const data = await response.json()

        if (data.success) {
          const fetchDuration = Date.now() - fetchStartTime
          const density: DensityEntry[] = data.density
          console.log(
            `✅ Fetched ${density.length} supertile counts (DB: ${
              data.dbQueryTime || "N/A"
            }ms, Total: ${fetchDuration}ms)`,
          )
          perfMonitor.logFetch(fetchDuration, density.length)

          // 5. Add to cache
          if (hasTags) {
            densityCache.clear()
          }

          densityCache.addDensity(density, grouping)

          // 6. Update display from cache
          setVisibleSupertiles(densityCache.getVisible(visibleIds, getCenter))

          // 7. Evict far-away supertiles (keep 3× viewport as buffer)
          const evictionBounds = expandRegionToBounds(region, 3.0)
          const keepIds = getVisibleSupertileIds(evictionBounds, grouping)
          densityCache.evictOutside(keepIds)

          console.log(`💾 Density cache: ${densityCache.size} tiles`)
        }
      } catch (error) {
        // The global ban interceptor (utils/auth.tsx) already handles
        // redirecting to /suspended for this case — logging it here too
        // is just noise on a screen the user's about to leave anyway.
        const isBannedError =
          error instanceof Error && error.message === "BANNED_ACCOUNT"

        if (!isBannedError) {
          console.error("❌ Error fetching post density:", error)
        }

        const grouping = getGroupingFactor(
          region.longitudeDelta,
          region.latitude,
          viewportWidthPx,
        )
        const getCenter = makeGetCenter(grouping)
        const viewportBounds = getBoundingBox(region)
        const visibleIds = getVisibleSupertileIds(viewportBounds, grouping)
        setVisibleSupertiles(densityCache.getVisible(visibleIds, getCenter))
      } finally {
        setIsLoadingPosts(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [densityCache, viewportWidthPx],
  )

  // Re-fetch when tags change.
  // Intentionally only depends on selectedTags — fetchVisiblePosts and densityCache
  // are stable refs that don't need to trigger this effect.
  useEffect(() => {
    if (!hasInitialFetched.current) return

    const region = lastRegion.current
    if (!region) return

    densityCache.clear()
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
      fetchPopularTags(initialRegion)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, fetchVisiblePosts, fetchPopularTags])

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

      // Tags are cheap (a single indexed aggregate query) unlike
      // fetchVisiblePosts (fetches/parses/groups potentially hundreds of
      // posts), so they intentionally aren't subject to the same
      // isLoadingPosts/throttle guards below. Coupling them meant a
      // throttled or skipped posts-fetch call would also skip refreshing
      // tags, leaving the bar showing stale counts from an earlier
      // viewport indefinitely (e.g. a post just outside the current view
      // still counted, because the "final" region never got a tags
      // fetch of its own).
      fetchPopularTags(region)

      if (isLoadingPosts) {
        console.log("⏭️  Skipping posts fetch - already loading")
        return
      }

      const now = Date.now()
      if (now - lastFetchTime.current < 1000) {
        console.log("⏭️  Skipping posts fetch - throttled")
        return
      }

      lastFetchTime.current = now
      fetchVisiblePosts(region, selectedTags)
    },
    [isLoadingPosts, fetchVisiblePosts, selectedTags, fetchPopularTags],
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

  // Dev-only: lets the dev test menu override the app's notion of
  // "current location" to match a hopped-to city, so post creation, the
  // "you are here" marker, and the recenter button all follow the hop
  // too -- not just the map camera. Does NOT touch real device GPS --
  // expo-location's actual reading is controlled by the simulator, not
  // in-app JS. This only overwrites the React state the rest of this
  // screen reads, which is safe because nothing else here re-syncs
  // `location` from GPS after the initial mount fetch (see the effect
  // above, guarded by hasInitialFetched -- no watchPositionAsync either).
  const overrideLocationForTesting = useCallback(
    (coords: { latitude: number; longitude: number }) => {
      setLocation({
        coords: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          altitude: null,
          accuracy: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
        mocked: true,
      })
    },
    [],
  )

  // Called by CreatePostModal after a successful post
  const handlePostCreated = useCallback(
    (post: { tile_id: string }) => {
      if (location) {
        const region: Region = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: INITIAL_LAT_DELTA,
          longitudeDelta: INITIAL_LAT_DELTA,
        }
        const grouping = getGroupingFactor(
          region.longitudeDelta,
          location.coords.latitude,
          viewportWidthPx,
        )
        // Optimistic +1 on the supertile this post landed in — not
        // authoritative, the next real fetch reconciles with the
        // server's true count. We don't have raw post content to cache
        // anymore, only the aggregate.
        const supertileId = getSupertileId(post.tile_id, grouping)
        densityCache.incrementCount(supertileId, grouping)

        const viewportBounds = getBoundingBox(region)
        const visibleIds = getVisibleSupertileIds(viewportBounds, grouping)
        setVisibleSupertiles(
          densityCache.getVisible(visibleIds, (id) =>
            getSupertileCenter(id, grouping),
          ),
        )
      }
      // A new post may introduce a new tag, or bump an existing tag's
      // count — refresh immediately rather than waiting for the next
      // pan/zoom stop. Uses the real current viewport (lastRegion) rather
      // than a GPS-reconstructed region, since tags are scoped to what's
      // actually visible, which may differ from the user's raw location
      // if they've panned since their last fetch.
      const tagsRegion = lastRegion.current ?? {
        latitude: location?.coords.latitude ?? 0,
        longitude: location?.coords.longitude ?? 0,
        latitudeDelta: INITIAL_LAT_DELTA,
        longitudeDelta: INITIAL_LAT_DELTA,
      }
      fetchPopularTags(tagsRegion)
    },
    [location, densityCache, fetchPopularTags, viewportWidthPx],
  )

  // Called by TileDetailsModal after a post is deleted. Invalidates just
  // the affected supertile's cached count rather than the whole cache —
  // the modal knows which supertile it's showing, so this stays a
  // cheap, targeted invalidation instead of a full re-fetch of everything
  // visible.
  const handlePostDeleted = useCallback(
    (_postId: string) => {
      if (selectedTile) {
        densityCache.invalidate(selectedTile.supertile_id)
      }
      const region = lastRegion.current
      if (region) {
        fetchVisiblePosts(region, selectedTags)
      }
    },
    [densityCache, fetchVisiblePosts, selectedTags, selectedTile],
  )

  const handleTilePress = (tile: {
    supertile_id: string
    count: number
    center: { latitude: number; longitude: number }
  }) => {
    setSelectedTile({ ...tile, groupingFactor })
    setIsTileModalVisible(true)
  }

  const handleTagsChanged = useCallback((tags: string[]) => {
    setSelectedTags(tags)
  }, [])

  // Apply marker limit to prevent native crashes
  //
  // Uses lastRegion's latitude/longitudeDelta (not `location`/`zoom`) so
  // this matches whatever actually drove the density data currently in
  // visibleSupertiles — fetchVisiblePosts computes groupingFactor from
  // region.latitude/longitudeDelta too. Falling back to location, then
  // INITIAL_LAT_DELTA, only matters before the very first fetch has set
  // lastRegion.
  const groupingFactor = getGroupingFactor(
    lastRegion.current?.longitudeDelta ?? INITIAL_LAT_DELTA,
    lastRegion.current?.latitude ?? location?.coords.latitude ?? 37.78825,
    viewportWidthPx,
  )
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
      </ErrorBoundary>

      {__DEV__ && (
        <ErrorBoundary label="Dev test menu">
          <DevTestMenu
            mapRef={mapRef}
            overrideLocation={overrideLocationForTesting}
          />
        </ErrorBoundary>
      )}

      {/* Tag filter bar */}
      <TagFilterBar
        popularTags={popularTags}
        isLoading={isLoadingTags}
        selectedTags={selectedTags}
        onTagsChanged={handleTagsChanged}
      />

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

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
import MapView, { Marker, Polygon, Region } from "react-native-maps"
import { TileMarker } from "@/components/TileMarker"
import {
  TileDetailsModal,
  type SelectedTile,
} from "@/components/TileDetailsModal"
import { CreatePostModal } from "@/components/CreatePostModal"
import { TagFilterBar, type PopularTag } from "@/components/TagFilterBar"
import { getZoomLevel, getMaxAllowedLongitudeDelta } from "@/utils/tiles"
import {
  DensityCache,
  type DensityEntry,
  type Bounds,
} from "@/utils/postGrouping"
import {
  getBoundingBox,
  isFitOf,
  regionFromBoundaries,
} from "@/utils/mapBounds"
import { perfMonitor } from "@/utils/diagnostics"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { DevTestMenu } from "@/components/DevTestMenu"
import { API_URL } from "@/utils/api"
import { E2EMapState, type E2EFetch } from "@/components/E2EMapState"

// Backend API URL

// E2E runs only -- see components/E2EMapState.tsx.
const IS_E2E = process.env.EXPO_PUBLIC_E2E === "1"

// Initial map settings
const INITIAL_LAT_DELTA = 0.005

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
  // Dev-only sector outline overlay -- draws each visible sector's own
  // server-returned bounds, so the grid can be checked for drift on pan
  // (there should be none -- #93).
  const [showGridOutline, setShowGridOutline] = useState(false)

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

  // The sectors currently visible on screen — derived from the cache.
  const [visibleSupertiles, setVisibleSupertiles] = useState<DensityEntry[]>(
    [],
  )

  // What the last completed fetch was for -- feeds E2EMapState only.
  const [e2eFetch, setE2eFetch] = useState<E2EFetch>({
    n: 0,
    region: null,
    screen: null,
    groupingFactor: 0,
    viewportWidthPx,
  })

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
      const hasTags = tags && tags.length > 0

      try {
        if (isLoadingPosts) {
          console.log("⏭️  Skipping fetch - already loading")
          return
        }

        setIsLoadingPosts(true)

        // No explicit "show cached data immediately" step needed: the
        // previous render's markers simply stay displayed as-is while
        // this fetch is in flight (state isn't cleared here), so there's
        // nothing to recompute for that.

        // Simplest possible query: raw viewport parameters only. The
        // server determines groupingFactor, the grid rectangle, and
        // which cells are non-empty entirely on its own -- see
        // apps/backend/src/utils/grouping.ts. The client does no
        // geographic computation here at all.
        const body: Record<string, any> = {
          latitude: region.latitude,
          longitude: region.longitude,
          latitudeDelta: region.latitudeDelta,
          longitudeDelta: region.longitudeDelta,
          viewportWidthPx,
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
          const { groupingFactor, sectors } = data as {
            groupingFactor: number
            sectors: DensityEntry[]
          }

          console.log(
            `✅ Fetched ${sectors.length} non-empty sectors ` +
              `(grouping ${groupingFactor}, ${fetchDuration}ms)${hasTags ? ` (filtered by: ${tags!.join(", ")})` : ""}`,
          )
          perfMonitor.logFetch(fetchDuration, sectors.length)

          const visibleKeys = new Set(sectors.map((s) => s.key))

          if (hasTags) {
            densityCache.clear()
          }
          densityCache.addDensity(sectors, groupingFactor)

          setVisibleSupertiles(densityCache.getVisible(visibleKeys))
          if (IS_E2E) {
            // What's really on screen, so flows can check no part of it
            // is left without markers.
            const screen =
              (await mapRef.current?.getMapBoundaries().catch(() => null)) ??
              null
            setE2eFetch((prev) => ({
              n: prev.n + 1,
              region,
              screen,
              groupingFactor,
              viewportWidthPx,
            }))
          }

          // No buffer anymore -- keep exactly what the latest fetch
          // covers. The 3x-buffer eviction margin existed to support the
          // cache-hit-skip-fetch optimization on small pans, which no
          // longer exists (every pan re-fetches), so there's nothing
          // left for the buffer to protect against a redundant fetch.
          densityCache.evictOutside(visibleKeys)

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
        // No fallback recomputation of "what's visible" on error -- the
        // client can't determine that independently anymore without a
        // server response. Leaving the display as whatever it already
        // was is a reasonable failure mode on its own (stale-but-cached
        // beats a guess), not a gap to fill.
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
  //
  // Fetches the region the map is really showing, read back with
  // getMapBoundaries(), not the region it was asked for (#97). The map
  // fits INITIAL_LAT_DELTA to the screen, which at high latitude means a
  // much wider longitude span -- and groupingFactor is sized from that
  // span, so fetching the requested region gave markers sized for the
  // wrong zoom. Nothing corrects it later: onRegionChangeComplete doesn't
  // fire for this camera move (only for the user's first gesture). The
  // move is applied asynchronously, so poll until the map shows it rather
  // than reading back the view from before it.
  useEffect(() => {
    if (location && mapRef.current && !hasInitialFetched.current) {
      hasInitialFetched.current = true

      console.log(
        "📍 Your location:",
        location.coords.latitude,
        location.coords.longitude,
      )

      const center = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      }
      const requestedRegion: Region = {
        ...center,
        latitudeDelta: INITIAL_LAT_DELTA,
        longitudeDelta: INITIAL_LAT_DELTA,
      }

      const map = mapRef.current
      map.animateToRegion(requestedRegion, 0)
      ;(async () => {
        let region: Region | null = null
        try {
          for (let attempt = 0; attempt < 20 && !region; attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 50))
            const shown = regionFromBoundaries(await map.getMapBoundaries())
            if (shown && isFitOf(shown, requestedRegion)) {
              region = { ...shown, ...center }
            }
          }
        } catch (err) {
          console.warn("Couldn't read the initial map bounds:", err)
        }
        if (!region) {
          // Falls back to the requested region -- the old behavior.
          console.warn("Initial map bounds not settled; using requested region")
          region = requestedRegion
        }

        const calculatedZoom = getZoomLevel(region.latitudeDelta)
        console.log(`🎯 Initial zoom calculated: ${calculatedZoom}`)
        setZoom(calculatedZoom)
        lastRegion.current = region

        fetchVisiblePosts(region, selectedTags)
        fetchPopularTags(region)
      })()
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
      // Enforce the app's max zoom-out (#53): past this point,
      // groupingFactor is frozen at CITY_CAP_GROUPING_FACTOR and the
      // sector grid stops changing regardless of further zoom-out --
      // but the *viewport* would keep growing, eventually putting far
      // more markers in view than the map can render smoothly. Rather than let
      // that happen, snap back to the max allowed delta and let the
      // snap's own onRegionChangeComplete (recursing into this function
      // with an in-bounds region) do the actual fetch.
      const maxDelta = getMaxAllowedLongitudeDelta(viewportWidthPx)
      if (region.longitudeDelta > maxDelta) {
        mapRef.current?.animateToRegion(
          {
            ...region,
            longitudeDelta: maxDelta,
            // Preserve the viewport's aspect ratio rather than hardcoding
            // a latitudeDelta, so this doesn't distort the view.
            latitudeDelta:
              maxDelta * (region.latitudeDelta / region.longitudeDelta),
          },
          300,
        )
        return
      }

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
    [
      isLoadingPosts,
      fetchVisiblePosts,
      selectedTags,
      fetchPopularTags,
      viewportWidthPx,
    ],
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

  // Called by CreatePostModal after a successful post. No more optimistic
  // count-bump -- that required client-side tile math (which supertile
  // did this post land in) that no longer exists now that grid identity
  // is entirely server-side. A brief delay (one fetch round-trip) before
  // the new post's count shows up on the map, in exchange for not
  // keeping a shadow copy of grid math on the client just for this one
  // case.
  const handlePostCreated = useCallback(() => {
    // Prefer the real current viewport (lastRegion) over a
    // GPS-reconstructed one, since the user may have panned since their
    // last fetch -- both the density re-fetch and the tags refresh
    // should reflect what's actually on screen, not just where they are.
    const region = lastRegion.current ?? {
      latitude: location?.coords.latitude ?? 0,
      longitude: location?.coords.longitude ?? 0,
      latitudeDelta: INITIAL_LAT_DELTA,
      longitudeDelta: INITIAL_LAT_DELTA,
    }
    fetchVisiblePosts(region, selectedTags)
    // A new post may introduce a new tag, or bump an existing tag's
    // count — refresh immediately rather than waiting for the next
    // pan/zoom stop.
    fetchPopularTags(region)
  }, [location, fetchVisiblePosts, fetchPopularTags, selectedTags])

  // Called by TileDetailsModal after a post is deleted. Invalidates just
  // the affected sector's cached count rather than the whole cache —
  // the modal knows which sector it's showing, so this stays a
  // cheap, targeted invalidation instead of a full re-fetch of everything
  // visible.
  const handlePostRemoved = useCallback(
    (_postId: string) => {
      if (selectedTile) {
        densityCache.invalidate(selectedTile.key)
      }
      const region = lastRegion.current
      if (region) {
        fetchVisiblePosts(region, selectedTags)
      }
    },
    [densityCache, fetchVisiblePosts, selectedTags, selectedTile],
  )

  const handleTilePress = (tile: DensityEntry) => {
    setSelectedTile(tile)
    setIsTileModalVisible(true)
  }

  const handleTagsChanged = useCallback((tags: string[]) => {
    setSelectedTags(tags)
  }, [])

  // Uses densityCache.groupingFactor -- the value the CURRENTLY CACHED
  // data was actually fetched under -- rather than recomputing fresh
  // from lastRegion.current. Those two can disagree: lastRegion.current
  // updates synchronously on every pan, but a fetch is async, and
  // fetchVisiblePosts's own `grouping` is captured from whatever region
  // was current when THAT fetch started. If the user pans again before
  // an in-flight fetch resolves (easy in a dense area with a lot to
  // aggregate), lastRegion.current moves on before the older fetch
  // writes its results -- and a mismatched groupingFactor doesn't just
  // shift markers slightly, it implies a completely different grid, so
  // rendering markers/outlines against a freshly-recomputed value while
  // the cache actually holds data from an older one produces exactly
  // the kind of unrelated-looking scatter this was.
  // Falls back to 1 only before any fetch has ever completed
  // (densityCache.groupingFactor starts null) -- there's nothing to
  // render yet at that point regardless, so the exact fallback value
  // doesn't matter.
  const groupingFactor = densityCache.groupingFactor ?? 1

  // Dev-only sector outline overlay data: each visible sector's own
  // bounds, straight from the server (#63 -- there's no outer grid
  // rectangle to reconstruct anymore, and only non-empty sectors are
  // ever known to the client, so this only draws populated sectors,
  // unlike the old grid overlay which also drew empty cells).
  const gridOutlineCells = useMemo(() => {
    if (!__DEV__ || !showGridOutline) return []
    // Safety cap -- well above the most sectors the zoom-out lock allows
    // on screen, so it never kicks in for a real view.
    if (visibleSupertiles.length > 500) {
      console.warn(
        `⚠️  Sector outline skipped -- ${visibleSupertiles.length} sectors is too many to render`,
      )
      return []
    }
    return visibleSupertiles.map((s) => ({ key: s.key, bounds: s.bounds }))
  }, [showGridOutline, visibleSupertiles])

  // Every visible sector gets a marker. There used to be a 150-marker cap
  // (a guard against react-native-maps 1.20's crash, fixed in #95), but it
  // silently dropped sectors past 150 -- and since they arrive row by row,
  // that left a whole edge of the screen without markers when zoomed out
  // over a busy area. The count is bounded anyway: markers are >= 36px
  // apart and the zoom-out lock caps the view (a few hundred on a phone).
  const supertiles = visibleSupertiles

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
    <View style={styles.container} testID="map-screen">
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

          {supertiles.map((tile) => (
            <Marker
              key={tile.key}
              coordinate={tile.center}
              onPress={() => handleTilePress(tile)}
              tracksViewChanges={!markersReady}
              zIndex={1}
            >
              {/* testID on the content, not the Marker: react-native-maps'
                  Fabric Marker doesn't pass its testID on to the native
                  annotation view, so Maestro couldn't find it (#95). */}
              <TileMarker
                count={tile.count}
                groupingFactor={groupingFactor}
                testID="tile-marker"
              />
            </Marker>
          ))}

          {__DEV__ &&
            showGridOutline &&
            gridOutlineCells.map(({ key, bounds }) => (
              <Polygon
                key={`outline-${key}`}
                coordinates={[
                  { latitude: bounds.minLat, longitude: bounds.minLng },
                  { latitude: bounds.minLat, longitude: bounds.maxLng },
                  { latitude: bounds.maxLat, longitude: bounds.maxLng },
                  { latitude: bounds.maxLat, longitude: bounds.minLng },
                ]}
                strokeColor="rgba(0, 200, 255, 0.9)"
                strokeWidth={1}
                fillColor="rgba(0, 200, 255, 0.08)"
                zIndex={0}
                tappable={false}
              />
            ))}
        </MapView>
      </ErrorBoundary>

      {IS_E2E && (
        <E2EMapState
          fetch={e2eFetch}
          sectors={supertiles}
          onGoTo={(region) => mapRef.current?.animateToRegion(region, 300)}
        />
      )}

      {__DEV__ && (
        <ErrorBoundary label="Dev test menu">
          <DevTestMenu
            mapRef={mapRef}
            overrideLocation={overrideLocationForTesting}
            showGridOutline={showGridOutline}
            onToggleGridOutline={() => setShowGridOutline((v) => !v)}
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
        testID="create-post-fab"
        style={styles.createButton}
        onPress={() => setIsCreateModalVisible(true)}
      >
        <Text style={styles.createButtonText}>+</Text>
      </TouchableOpacity>

      <TouchableOpacity
        testID="recenter-button"
        style={styles.recenterButton}
        onPress={recenterMap}
      >
        <Text style={styles.recenterButtonText}>⦿</Text>
      </TouchableOpacity>

      {location && (
        <CreatePostModal
          visible={isCreateModalVisible}
          onClose={() => setIsCreateModalVisible(false)}
          onPostCreated={handlePostCreated}
        />
      )}
      <ErrorBoundary label="Post details">
        <TileDetailsModal
          visible={isTileModalVisible}
          tile={selectedTile}
          onClose={() => setIsTileModalVisible(false)}
          authToken={session?.access_token ?? null}
          onPostRemoved={handlePostRemoved}
          selectedTags={selectedTags}
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

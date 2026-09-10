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
  interpolateCellCenter,
} from "@/utils/postGrouping"
import { getBoundingBox } from "@/utils/mapBounds"
import { perfMonitor } from "@/utils/diagnostics"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { DevTestMenu } from "@/components/DevTestMenu"
import { API_URL } from "@/utils/api"

// Backend API URL

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
  // Dev-only supertile grid outline overlay -- see issue #58's follow-up.
  // Deliberately recomputed fresh at render time (see render section)
  // rather than stored alongside visibleSupertiles: the point is to
  // reveal drift between a possibly-stale cached marker position and
  // what the grid looks like right now, not to redraw whatever refLat
  // happened to be used when that marker was fetched.
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

  // Grid metadata from the most recent successful density fetch --
  // bounds/gridWidth/gridHeight, needed for the dev-only grid outline
  // overlay to draw the exact same M x N rectangle the server returned,
  // without the client re-deriving it. Also doubles as the source of
  // the "current visible IDs" set used for cache eviction.
  const lastGrid = useRef<{
    bounds: Bounds
    gridWidth: number
    gridHeight: number
    gridOrigin: { latTile: number; lngTile: number }
  } | null>(null)

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
          const {
            groupingFactor,
            gridOrigin,
            gridWidth,
            gridHeight,
            bounds,
            cells,
          } = data as {
            groupingFactor: number
            gridOrigin: { latTile: number; lngTile: number }
            gridWidth: number
            gridHeight: number
            bounds: Bounds
            cells: { row: number; col: number; count: number }[]
          }

          console.log(
            `✅ Fetched ${cells.length} non-empty cells of a ${gridWidth}x${gridHeight} grid ` +
              `(grouping ${groupingFactor}, ${fetchDuration}ms)${hasTags ? ` (filtered by: ${tags!.join(", ")})` : ""}`,
          )
          perfMonitor.logFetch(fetchDuration, cells.length)

          // Interpolate each cell's center within the server's exact
          // grid rectangle -- plain proportional math, no cos(). This is
          // the only place the client computes a geographic position at
          // all now.
          const entries: DensityEntry[] = cells.map((c) => ({
            supertile_id: `${gridOrigin.latTile + c.row}:${gridOrigin.lngTile + c.col}`,
            count: c.count,
            center: interpolateCellCenter(
              c.row,
              c.col,
              gridWidth,
              gridHeight,
              bounds,
            ),
          }))
          const visibleIds = new Set(entries.map((e) => e.supertile_id))

          if (hasTags) {
            densityCache.clear()
          }
          densityCache.addDensity(entries, groupingFactor)
          lastGrid.current = { bounds, gridWidth, gridHeight, gridOrigin }

          setVisibleSupertiles(densityCache.getVisible(visibleIds))

          // No buffer anymore -- keep exactly what the latest fetch
          // covers. The 3x-buffer eviction margin existed to support the
          // cache-hit-skip-fetch optimization on small pans, which no
          // longer exists (every pan re-fetches), so there's nothing
          // left for the buffer to protect against a redundant fetch.
          densityCache.evictOutside(visibleIds)

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
      // Enforce the app's max zoom-out (#53): past this point,
      // groupingFactor is frozen at CITY_CAP_GROUPING_FACTOR and the
      // supertile grid stops changing regardless of further zoom-out --
      // but the *viewport* would keep growing, eventually putting far
      // more cells in view than MAX_MARKERS budgets for. Rather than let
      // that happen, snap back to the max allowed delta and let the
      // snap's own onRegionChangeComplete (recursing into this function
      // with an in-bounds region) do the actual fetch.
      //
      // Deliberately evaluated at a fixed latitude, not region.latitude:
      // plain panning doesn't change longitudeDelta, but it does change
      // latitude, and getMaxAllowedLongitudeDelta is latitude-dependent
      // -- so using the live region's latitude here caused a real bug:
      // panning while already at the lock point could make an in-bounds
      // delta suddenly register as over the (now-recalculated) limit and
      // trigger a same-center corrective re-zoom, shrinking the viewport
      // right after a pan and pushing a marker near the edge of the
      // screen out of the new fetch bounds. A fixed threshold can't
      // shift under a pan, so it can't cause that.
      //
      // The fixed latitude has to be the *highest* latitude the app
      // cares about, not the lowest: a degree of longitude covers less
      // ground near the poles, so higher latitude needs a LARGER delta
      // before the grid actually finishes freezing at
      // CITY_CAP_GROUPING_FACTOR. Anchoring at the equator (the smallest
      // such delta) would lock zoom-out before freezing completes for
      // every latitude north of it -- worse the further north, and this
      // app already tests up to Utqiagvik, AK (71.2906N, the US's
      // northernmost point -- see DevTestMenu's test cities), where that
      // gap would be largest. Anchoring at that latitude instead
      // guarantees the grid is genuinely frozen by the lock point
      // everywhere at or south of it, which covers the entire US.
      const MAX_EXPECTED_LATITUDE = 71.2906 // Utqiagvik, AK
      const maxDelta = getMaxAllowedLongitudeDelta(
        MAX_EXPECTED_LATITUDE,
        viewportWidthPx,
      )
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

  // Dev-only grid outline overlay data: the exact M x N rectangle from
  // the most recent fetch (lastGrid), covering every cell -- not just
  // populated ones (that made it look like the grid didn't cover the
  // viewport at all, it just meant every empty cell was silently
  // skipped). Drawn directly from the server's own bounds/gridWidth/
  // gridHeight now, with no client-side grid computation at all.
  const gridOutlineCells = useMemo(() => {
    if (!__DEV__ || !showGridOutline || !lastGrid.current) return []
    const { bounds, gridWidth, gridHeight } = lastGrid.current
    // Safety cap, matching MAX_MARKERS's spirit -- the #53 zoom lock
    // should keep grids well under this in normal use, but dev-only
    // tooling shouldn't be able to freeze the UI if that's ever wrong.
    if (gridWidth * gridHeight > 500) {
      console.warn(
        `⚠️  Grid outline skipped -- ${gridWidth}x${gridHeight} is too large to render`,
      )
      return []
    }
    const latStep = (bounds.maxLat - bounds.minLat) / gridHeight
    const lngStep = (bounds.maxLng - bounds.minLng) / gridWidth
    const cells: { row: number; col: number; bounds: Bounds }[] = []
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        cells.push({
          row,
          col,
          bounds: {
            minLat: bounds.minLat + row * latStep,
            maxLat: bounds.minLat + (row + 1) * latStep,
            minLng: bounds.minLng + col * lngStep,
            maxLng: bounds.minLng + (col + 1) * lngStep,
          },
        })
      }
    }
    return cells
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGridOutline, visibleSupertiles])

  const supertiles = useMemo(() => {
    // Apply marker limit to prevent native crashes
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

          {__DEV__ &&
            showGridOutline &&
            gridOutlineCells.map(({ row, col, bounds }) => (
              <Polygon
                key={`outline-${groupingFactor}-${row}-${col}`}
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

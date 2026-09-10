// apps/mobile/components/DevTestMenu.tsx
//
// Dev-only panel for testing map/clustering behavior across latitudes
// without hand-driving the iOS Simulator's mock location + curl-ing
// /api/seed every time. See issue #54.
//
// "Hopping" to a city does NOT touch GPS/expo-location — there's no way
// for in-app JS to override what Location.getCurrentPositionAsync()
// reports; that's controlled by the simulator itself (Features >
// Location). Instead this just moves the MapView camera
// (mapRef.animateToRegion), which drives the exact same
// onRegionChangeComplete -> fetchVisiblePosts flow as a real pan. The
// map/clustering/fetch pipeline in index.tsx only ever reads the current
// camera region, never GPS, so this is sufficient for testing it. GPS is
// only used for the initial region, the "you are here" marker, the
// recenter button, and post creation/proximity — none of which this menu
// needs to touch.
import React, { useState, useCallback } from "react"
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native"
import MapView, { Region } from "react-native-maps"
import { API_URL } from "../utils/api"

function Bomb(): React.ReactElement {
  throw new Error("Test crash: intentional render error from DevTestMenu")
}

export interface TestCity {
  name: string
  latitude: number
  longitude: number
}

// Fixed set of test cities spanning a useful range of latitudes.
// Apopka is the dense baseline (matches everyday manual testing).
// Utqiagvik/Ka Lae are the true northernmost/southernmost points in the
// US. Tromsø is kept for extreme-latitude testing beyond the US range.
export const TEST_CITIES: TestCity[] = [
  { name: "Apopka, FL", latitude: 28.6774, longitude: -81.532 },
  { name: "Utqiagvik, AK", latitude: 71.2906, longitude: -156.7887 },
  { name: "Ka Lae, HI", latitude: 18.9106, longitude: -155.6811 },
  { name: "Tromsø, Norway", latitude: 69.6492, longitude: 18.9553 },
]

// Camera delta used for the hop — matches index.tsx's INITIAL_LAT_DELTA
// so hopping lands at the same zoom level as a fresh app launch.
const HOP_LAT_DELTA = 0.005

// Generous fixed margin (in degrees) for the clear bounding box — needs
// to comfortably cover generateSeedPosts's cluster scatter (cluster
// centers offset up to ~0.005° from center, plus up to ~0.004° radius),
// not to be a tight fit. Longitude is corrected for latitude so the box
// stays roughly square in real-world meters at high latitude.
const CLEAR_MARGIN_LAT_DEGREES = 0.05

function clearBoundsFor(city: TestCity) {
  const latRad = (city.latitude * Math.PI) / 180
  const lngMargin = CLEAR_MARGIN_LAT_DEGREES / Math.max(Math.cos(latRad), 0.01)
  return {
    minLat: city.latitude - CLEAR_MARGIN_LAT_DEGREES,
    maxLat: city.latitude + CLEAR_MARGIN_LAT_DEGREES,
    minLng: city.longitude - lngMargin,
    maxLng: city.longitude + lngMargin,
  }
}

// Parses the custom lat/lon text fields into a TestCity, or null if
// either field is empty/non-numeric/out of range. Used to gate the
// custom-location buttons and as the "city" passed into the same
// hop/seed/clear paths the fixed city list uses.
function parseCustomCity(latText: string, lngText: string): TestCity | null {
  const latitude = Number(latText)
  const longitude = Number(lngText)
  if (
    latText.trim() === "" ||
    lngText.trim() === "" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null
  }
  return { name: "Custom location", latitude, longitude }
}

interface DevTestMenuProps {
  mapRef: React.RefObject<MapView | null>
  // Overrides the app's `location` state (not real GPS) to match a
  // hopped-to city, so "current location" consumers elsewhere in the
  // screen -- post creation, the "you are here" marker, recenter --
  // follow the hop too, not just the map camera.
  overrideLocation: (coords: { latitude: number; longitude: number }) => void
  // Toggles the supertile grid outline overlay -- see issue #58's
  // follow-up. Lifted to index.tsx rather than owned here since the
  // overlay itself is rendered alongside the markers on MapView, not
  // inside this panel.
  showGridOutline: boolean
  onToggleGridOutline: () => void
}

type CityAction = "hop" | "seed" | "clear"

export function DevTestMenu({
  mapRef,
  overrideLocation,
  showGridOutline,
  onToggleGridOutline,
}: DevTestMenuProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [shouldCrash, setShouldCrash] = useState(false)
  const [customLat, setCustomLat] = useState("")
  const [customLng, setCustomLng] = useState("")

  const withPending = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setPendingAction(key)
      try {
        await fn()
      } finally {
        setPendingAction(null)
      }
    },
    [],
  )

  const regionFor = useCallback(
    (city: TestCity): Region => ({
      latitude: city.latitude,
      longitude: city.longitude,
      latitudeDelta: HOP_LAT_DELTA,
      longitudeDelta: HOP_LAT_DELTA,
    }),
    [],
  )

  // Recenters the camera on the city, which drives the normal fetch flow
  // via MapView's native onRegionChangeComplete — same pattern as the
  // existing recenterMap() button elsewhere in this screen. Deliberately
  // does NOT also call onRegionChangeComplete directly: doing both was
  // tried and caused a real bug — on rapid/overlapping animateToRegion
  // calls (e.g. tapping Hop then Seed quickly), react-native-maps can
  // report a corrupted region (observed: inverted/negative delta) on the
  // animation's native completion, which raced against and clobbered the
  // correct synthetic region, zeroing out the visible supertile grid.
  // Native-only, letting one call settle before triggering another,
  // avoids the race entirely.
  //
  // Also overrides the app's location state to match, so "current
  // location" consumers (post creation, "you are here", recenter) follow
  // the hop too — not just the camera.
  const refreshAt = useCallback(
    (city: TestCity) => {
      overrideLocation({ latitude: city.latitude, longitude: city.longitude })
      mapRef.current?.animateToRegion(regionFor(city), 300)
    },
    [mapRef, overrideLocation, regionFor],
  )

  const seedCity = useCallback(
    async (city: TestCity) => {
      try {
        const res = await fetch(`${API_URL}/api/seed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            centerLat: city.latitude,
            centerLng: city.longitude,
            count: 200,
            ttlDays: 7,
          }),
        })
        const data = await res.json()
        if (!data.success) throw new Error(data.error ?? "Seed failed")
        console.log(`🌱 Seeded ${data.count} posts at ${city.name}`)
        refreshAt(city)
      } catch (err) {
        console.error(`Failed to seed ${city.name}:`, err)
        Alert.alert(
          "Seed failed",
          err instanceof Error ? err.message : "Unknown error",
        )
      }
    },
    [refreshAt],
  )

  const clearCity = useCallback(
    async (city: TestCity) => {
      try {
        const bounds = clearBoundsFor(city)
        const params = new URLSearchParams({
          minLat: String(bounds.minLat),
          maxLat: String(bounds.maxLat),
          minLng: String(bounds.minLng),
          maxLng: String(bounds.maxLng),
        })
        const res = await fetch(`${API_URL}/api/seed?${params}`, {
          method: "DELETE",
        })
        const data = await res.json()
        if (!data.success) throw new Error(data.error ?? "Clear failed")
        console.log(`🧹 Cleared ${data.deletedCount} posts at ${city.name}`)
        refreshAt(city)
      } catch (err) {
        console.error(`Failed to clear ${city.name}:`, err)
        Alert.alert(
          "Clear failed",
          err instanceof Error ? err.message : "Unknown error",
        )
      }
    },
    [refreshAt],
  )

  const runAction = (city: TestCity, action: CityAction) => {
    const key = `${city.name}:${action}`
    if (pendingAction) return
    if (action === "hop") {
      refreshAt(city)
      return
    }
    withPending(
      key,
      action === "seed" ? () => seedCity(city) : () => clearCity(city),
    )
  }

  const customCity = parseCustomCity(customLat, customLng)

  if (__DEV__ !== true) return null // never renders in production builds

  if (shouldCrash) {
    return <Bomb />
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerToggle}
          onPress={() => setIsExpanded((v) => !v)}
        >
          <Text style={styles.headerText}>
            🧪 Dev test menu {isExpanded ? "▲" : "▼"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.crashButton}
          onPress={() => setShouldCrash(true)}
        >
          <Text style={styles.crashButtonText}>💣</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.crashButton,
            showGridOutline && styles.gridButtonActive,
          ]}
          onPress={onToggleGridOutline}
        >
          <Text style={styles.crashButtonText}>▦</Text>
        </TouchableOpacity>
      </View>

      {isExpanded && (
        <View style={styles.body}>
          <View style={styles.customSection}>
            <View style={styles.customInputs}>
              <TextInput
                style={styles.input}
                placeholder="Lat"
                placeholderTextColor="#888"
                value={customLat}
                onChangeText={setCustomLat}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                placeholder="Lon"
                placeholderTextColor="#888"
                value={customLng}
                onChangeText={setCustomLng}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
              />
            </View>
            <View style={styles.actions}>
              <CityButton
                label="Hop"
                pending={pendingAction === "Custom location:hop"}
                disabled={!!pendingAction || !customCity}
                onPress={() => customCity && runAction(customCity, "hop")}
              />
              <CityButton
                label="Seed"
                pending={pendingAction === "Custom location:seed"}
                disabled={!!pendingAction || !customCity}
                onPress={() => customCity && runAction(customCity, "seed")}
              />
              <CityButton
                label="Clear"
                pending={pendingAction === "Custom location:clear"}
                disabled={!!pendingAction || !customCity}
                onPress={() => customCity && runAction(customCity, "clear")}
                variant="danger"
              />
            </View>
          </View>

          {TEST_CITIES.map((city) => (
            <View key={city.name} style={styles.cityRow}>
              <Text style={styles.cityName} numberOfLines={1}>
                {city.name}
              </Text>
              <View style={styles.actions}>
                <CityButton
                  label="Hop"
                  pending={pendingAction === `${city.name}:hop`}
                  disabled={!!pendingAction}
                  onPress={() => runAction(city, "hop")}
                />
                <CityButton
                  label="Seed"
                  pending={pendingAction === `${city.name}:seed`}
                  disabled={!!pendingAction}
                  onPress={() => runAction(city, "seed")}
                />
                <CityButton
                  label="Clear"
                  pending={pendingAction === `${city.name}:clear`}
                  disabled={!!pendingAction}
                  onPress={() => runAction(city, "clear")}
                  variant="danger"
                />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function CityButton({
  label,
  onPress,
  pending,
  disabled,
  variant = "default",
}: {
  label: string
  onPress: () => void
  pending: boolean
  disabled: boolean
  variant?: "default" | "danger"
}) {
  return (
    <TouchableOpacity
      style={[
        styles.button,
        variant === "danger" && styles.buttonDanger,
        disabled && !pending && styles.buttonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      {pending ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    zIndex: 999,
    backgroundColor: "rgba(20, 20, 20, 0.92)",
    borderRadius: 8,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerToggle: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  crashButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  crashButtonText: {
    fontSize: 14,
  },
  gridButtonActive: {
    backgroundColor: "rgba(0, 200, 255, 0.35)",
  },
  headerText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 12,
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  customSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 255, 255, 0.2)",
    marginBottom: 4,
  },
  customInputs: {
    flexDirection: "row",
    flex: 1,
    marginRight: 8,
  },
  input: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    color: "#fff",
    fontSize: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  cityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  cityName: {
    color: "#fff",
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  actions: {
    flexDirection: "row",
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginLeft: 6,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDanger: {
    backgroundColor: "#e53935",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 11,
  },
})

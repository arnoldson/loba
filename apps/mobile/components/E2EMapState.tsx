// E2E-only hooks for the map screen (#93, #95), rendered only when
// EXPO_PUBLIC_E2E=1. Read and driven by .maestro/scripts/map-state.js and
// the marker flows.
//
// Readout (id e2e-map-state): Maestro can't read a map marker's coordinate,
// but a marker is drawn exactly at its sector's `center`, so the sectors from
// the last completed fetch are the marker positions. Format:
// "n=<fetch count> <json>", where the json is {w, g,
// r: [lat, lng, latDelta, longitudeDelta] (the region fetched),
// b: [swLat, swLng, neLat, neLng] (what the map really shows),
// s: [[key, count, centerLat, centerLng, minLat, maxLat, minLng, maxLng]]}.
// The leading n lets a flow wait for the next fetch to land.
//
// Go-to field (id e2e-goto): Maestro can't pinch, so flows zoom out by typing
// "lat,lng,longitudeDelta" here and submitting; the camera moves there and
// the normal region-change fetch follows.
import { useState } from "react"
import { StyleSheet, Text, TextInput, View } from "react-native"
import type { LatLng, Region } from "react-native-maps"
import type { DensityEntry } from "@/utils/postGrouping"

export interface E2EFetch {
  n: number
  region: Region | null
  screen: { northEast: LatLng; southWest: LatLng } | null
  groupingFactor: number
  viewportWidthPx: number
}

export function E2EMapState({
  fetch,
  sectors,
  onGoTo,
}: {
  fetch: E2EFetch
  sectors: DensityEntry[]
  onGoTo: (region: Region) => void
}) {
  const r = fetch.region
  const b = fetch.screen
  const text =
    `n=${fetch.n} ` +
    JSON.stringify({
      w: fetch.viewportWidthPx,
      g: fetch.groupingFactor,
      r: r ? [r.latitude, r.longitude, r.latitudeDelta, r.longitudeDelta] : null,
      b: b
        ? [b.southWest.latitude, b.southWest.longitude, b.northEast.latitude, b.northEast.longitude]
        : null,
      s: sectors.map((s) => [
        s.key,
        s.count,
        s.center.latitude,
        s.center.longitude,
        s.bounds.minLat,
        s.bounds.maxLat,
        s.bounds.minLng,
        s.bounds.maxLng,
      ]),
    })

  // Cleared after every submit, so the next one never types onto leftovers.
  const [goToText, setGoToText] = useState("")

  const goTo = (value: string) => {
    setGoToText("")
    const parts = value.split(",").map(Number)
    const [latitude, longitude, longitudeDelta] = parts
    // MapKit throws (crashing the app) on an out-of-range region.
    if (
      parts.length !== 3 ||
      !parts.every(Number.isFinite) ||
      Math.abs(latitude) > 85 ||
      Math.abs(longitude) > 180 ||
      !(longitudeDelta > 0 && longitudeDelta <= 10)
    ) {
      console.warn(`e2e-goto: ignoring "${value}"`)
      return
    }
    // A small latitude span, so longitude is what the map fits to.
    onGoTo({
      latitude,
      longitude,
      longitudeDelta,
      latitudeDelta: longitudeDelta / 10,
    })
  }

  return (
    <>
      <View style={styles.readout} pointerEvents="none">
        <Text
          testID="e2e-map-state"
          accessibilityLabel={text}
          numberOfLines={1}
          style={styles.text}
        >
          {text}
        </Text>
      </View>
      <TextInput
        testID="e2e-goto"
        style={styles.goto}
        autoCorrect={false}
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
        value={goToText}
        onChangeText={setGoToText}
        onSubmitEditing={(e) => goTo(e.nativeEvent.text)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  // A thin strip under the status bar: visible to the accessibility tree
  // (Maestro skips zero-size views), out of the way of taps and swipes.
  readout: {
    position: "absolute",
    top: 48,
    left: 0,
    right: 0,
    height: 8,
  },
  text: {
    fontSize: 6,
    color: "rgba(0, 0, 0, 0.4)",
  },
  // Small and at the right edge, clear of the seeded posts and gestures.
  goto: {
    position: "absolute",
    top: 160,
    right: 4,
    width: 24,
    height: 24,
    fontSize: 6,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
})

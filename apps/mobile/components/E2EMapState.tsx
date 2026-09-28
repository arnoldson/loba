// E2E-only readout of what the map is showing (#93), so Maestro flows can
// check marker positions and cell sizes. Maestro can't read a map marker's
// coordinate, but a marker is drawn exactly at its sector's `center`, so the
// sectors from the last completed fetch are the marker positions.
//
// Rendered only when EXPO_PUBLIC_E2E=1. Format: "n=<fetch count> <json>",
// where the json is {w, g, r: [lat, lng, latDelta, longitudeDelta],
// s: [[key, count, centerLat, centerLng, minLat, maxLat, minLng, maxLng]]}.
// The leading n lets a flow wait for the next fetch to land. Read by
// .maestro/scripts/map-state.js.
import { StyleSheet, Text, View } from "react-native"
import type { Region } from "react-native-maps"
import type { DensityEntry } from "@/utils/postGrouping"

export interface E2EFetch {
  n: number
  region: Region | null
  groupingFactor: number
  viewportWidthPx: number
}

export function E2EMapState({
  fetch,
  sectors,
}: {
  fetch: E2EFetch
  sectors: DensityEntry[]
}) {
  const r = fetch.region
  const text =
    `n=${fetch.n} ` +
    JSON.stringify({
      w: fetch.viewportWidthPx,
      g: fetch.groupingFactor,
      r: r ? [r.latitude, r.longitude, r.latitudeDelta, r.longitudeDelta] : null,
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

  return (
    <View style={styles.container} pointerEvents="none">
      <Text
        testID="e2e-map-state"
        accessibilityLabel={text}
        numberOfLines={1}
        style={styles.text}
      >
        {text}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  // A thin strip under the status bar: visible to the accessibility tree
  // (Maestro skips zero-size views), out of the way of taps and swipes.
  container: {
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
})

import * as Location from "expo-location"

/**
 * A single GPS reading plus the metadata the backend uses to judge its
 * quality — see assertLocationQuality in the backend's utils/proximity.ts.
 */
export interface VerifiedLocation {
  latitude: number
  longitude: number
  /** Meters, from CLLocation.horizontalAccuracy. */
  accuracy: number
  /** Ms since epoch — from the GPS fix itself, not Date.now() at call time. */
  timestamp: number
}

/**
 * Captures a fresh GPS reading at the moment of a location-gated action
 * (posting, reacting, commenting). This is deliberately a new
 * getCurrentPositionAsync() call, not a reuse of whatever `location`
 * state a screen was already holding — that value can be stale by the
 * time the user actually submits (e.g. captured once on map mount,
 * modal left open for a while, app resumed from background with a
 * cached last-known fix). See issue #43 for why staleness specifically
 * matters here: the backend rejects readings older than 60s.
 *
 * Every location-gated feature should call this at the point of
 * submission rather than threading a location prop through from
 * higher up the component tree.
 */
export async function getVerifiedLocation(): Promise<VerifiedLocation> {
  const { status } = await Location.getForegroundPermissionsAsync()
  if (status !== "granted") {
    throw new Error("Location permission is required for this action")
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  })

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    // expo-location types accuracy as number | null; treat a missing
    // reading as maximally imprecise so it fails the backend's
    // accuracy check rather than slipping through as falsy/undefined.
    accuracy: position.coords.accuracy ?? Number.MAX_SAFE_INTEGER,
    timestamp: position.timestamp,
  }
}

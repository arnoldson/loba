/**
 * Proximity validation and post TTL constants.
 *
 * All location-gated actions (posting, reacting) must pass
 * a proximity check before being accepted.
 */

import geoip from "geoip-lite"

// ─── TTL constants ──────────────────────────────────────────────────

/** Default time-to-live for new posts (hours) */
export const DEFAULT_TTL_HOURS = 24

/** How many hours an upvote adds to expires_at */
export const UPVOTE_TTL_EXTENSION_HOURS = 2

/** Maximum total TTL a post can accumulate (hours from creation) */
export const MAX_TTL_HOURS = 24 * 7 // 7 days

/** Maximum distance (meters) a user can be from a post/tile to interact */
export const PROXIMITY_RADIUS_METERS = 50

// ─── Haversine distance ─────────────────────────────────────────────

/**
 * Calculate the distance in meters between two lat/lng points
 * using the Haversine formula.
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000 // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Proximity check ────────────────────────────────────────────────

/**
 * Returns true if the user's position is within PROXIMITY_RADIUS_METERS
 * of the target position.
 */
export function isWithinProximity(
  userLat: number,
  userLng: number,
  targetLat: number,
  targetLng: number,
): boolean {
  return (
    haversineMeters(userLat, userLng, targetLat, targetLng) <=
    PROXIMITY_RADIUS_METERS
  )
}

// ─── Location quality verification (#43) ───────────────────────────
//
// Every location-gated write (createPost, reactToPost, and createComment
// when it isn't skipping the gate via a prior reaction) is client-
// supplied data end to end: nothing here can catch a modified client or
// a genuine GPS spoofer. What this DOES catch is the two cheap cases
// that matter for a "naive general user" threat model (see issue #43
// discussion): a bare curl request that doesn't know these fields
// exist, and a stale/cached location reading (e.g. the app resuming
// from background with `expo-location`'s last-known fix rather than a
// fresh one). See apps/mobile/utils/location.ts for where the mobile
// client captures the reading these fields describe.

/** Reject a location reading reported less precise than this. */
export const MAX_LOCATION_ACCURACY_METERS = 100

/** Reject a location reading older than this. */
export const MAX_LOCATION_AGE_MS = 60_000 // 60s

/** Allowance for device clock drift when a timestamp is in the future. */
export const MAX_CLOCK_SKEW_MS = 5_000

export class LocationQualityError extends Error {}

/**
 * Throws LocationQualityError if the reading is too old, implausibly
 * far in the future (clock skew beyond a small allowance), or too
 * imprecise to trust. Callers should treat this the same as a failed
 * proximity check (403), not a generic 500.
 */
export function assertLocationQuality(
  accuracy: number,
  timestampMs: number,
): void {
  const ageMs = Date.now() - timestampMs

  if (ageMs > MAX_LOCATION_AGE_MS) {
    throw new LocationQualityError(
      "Location reading is too old — please try again",
    )
  }

  if (ageMs < -MAX_CLOCK_SKEW_MS) {
    throw new LocationQualityError("Location timestamp is invalid")
  }

  if (!(accuracy > 0) || accuracy > MAX_LOCATION_ACCURACY_METERS) {
    throw new LocationQualityError(
      "Location is not accurate enough — please try again",
    )
  }
}

// ─── IP-geolocation corroboration (#43) ────────────────────────────
//
// The only signal here that isn't sitting in the same request body the
// client controls end to end -- the server derives it from the
// connection itself (see `trustProxy: true` in index.ts, which makes
// request.ip the real client IP behind Railway's proxy). Deliberately
// NOT a hard gate: free IP-geolocation databases are city-level at
// best, and VPNs, corporate networks, and carrier NAT all produce real
// false positives for legitimate users. This exists specifically to
// catch the one case the accuracy/staleness check structurally can't:
// a spoofed request where the attacker set a fabricated but internally
// "valid-looking" accuracy/timestamp. Used as a flag for moderation
// visibility, never a rejection.

/** Distance beyond which IP geolocation is treated as inconsistent. */
export const IP_MISMATCH_THRESHOLD_KM = 300

export interface IpConsistencyResult {
  consistent: boolean
  distanceKm: number | null
}

/**
 * Compares claimed lat/lng against IP-based geolocation. Returns
 * consistent: true (with distanceKm: null) whenever the IP can't be
 * geolocated at all -- e.g. private/reserved ranges in local dev --
 * rather than penalizing what's just missing data.
 */
export function checkIpConsistency(
  ip: string,
  lat: number,
  lng: number,
): IpConsistencyResult {
  const geo = geoip.lookup(ip)

  if (!geo?.ll) {
    return { consistent: true, distanceKm: null }
  }

  const [ipLat, ipLng] = geo.ll
  const distanceKm = haversineMeters(lat, lng, ipLat, ipLng) / 1000

  return { consistent: distanceKm <= IP_MISMATCH_THRESHOLD_KM, distanceKm }
}

// ─── TTL helpers ────────────────────────────────────────────────────

/**
 * Compute the new expires_at after an upvote, capped at MAX_TTL_HOURS
 * from the post's created_at.
 */
export function computeExtendedExpiry(
  currentExpiresAt: string | Date,
  createdAt: string | Date,
): Date {
  const current = new Date(currentExpiresAt)
  const created = new Date(createdAt)
  const maxExpiry = new Date(created.getTime() + MAX_TTL_HOURS * 60 * 60 * 1000)

  const extended = new Date(
    current.getTime() + UPVOTE_TTL_EXTENSION_HOURS * 60 * 60 * 1000,
  )

  // Don't exceed the cap
  return extended > maxExpiry ? maxExpiry : extended
}

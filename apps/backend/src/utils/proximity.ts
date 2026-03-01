/**
 * Proximity validation and post TTL constants.
 *
 * All location-gated actions (posting, reacting) must pass
 * a proximity check before being accepted.
 */

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

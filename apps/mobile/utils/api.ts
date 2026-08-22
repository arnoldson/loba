import { Platform } from "react-native"

// Local dev fallback — used automatically when EXPO_PUBLIC_API_URL isn't set.
const LOCAL_API_URL = Platform.select({
  ios: "http://localhost:3000",
  android: "http://10.0.2.2:3000",
  default: "http://localhost:3000",
})

// Set EXPO_PUBLIC_API_URL (in .env, or an EAS build profile) to point the
// app at the deployed backend. Expo exposes anything prefixed EXPO_PUBLIC_
// to client code automatically. Falls back to localhost when unset, so
// local dev keeps working with zero config.
export const API_URL = process.env.EXPO_PUBLIC_API_URL || LOCAL_API_URL

/**
 * True if a parsed API error body is specifically a ban rejection.
 * Used to suppress user-visible error UI (alerts, inline error text) at
 * individual call sites — the global fetch interceptor in utils/auth.tsx
 * already handles the actual redirect to /suspended for this case, so
 * showing anything else here is just noise on a screen about to
 * disappear. See #24 design discussion.
 */
export function isBannedError(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    (data as { code?: string }).code === "banned"
  )
}

/**
 * True if a parsed API error body is specifically the view-only
 * pending_review restriction — see isBannedError above for the same
 * reasoning. Unlike a ban, this case still shows the user something
 * (they're not being redirected away), just a friendly, expected
 * explanation rather than the raw backend error text.
 */
export function isRestrictedError(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    (data as { code?: string }).code === "restricted"
  )
}

export const UNDER_REVIEW_MESSAGE =
  "Your account is temporarily limited to browsing while we review recent activity. You can still explore the map — this feature will be available again once review is complete."

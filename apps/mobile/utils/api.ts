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

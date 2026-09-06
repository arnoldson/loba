import { useEffect } from "react"
import { ActivityIndicator, StyleSheet, View } from "react-native"
import { Stack, useRouter, useSegments } from "expo-router"
import { AuthProvider, useAuth } from "@/utils/auth"

/**
 * Handles auth-based navigation.
 * - No session → redirect to /login
 * - Has session but on /login → redirect to /(tabs)
 */
function AuthGate() {
  const { session, isLoading, isBanned } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  // A session existing but isBanned still null (unchecked) is treated
  // as a loading state too, not just isLoading itself. Without this, a
  // banned user could briefly see /(tabs) render with real data on
  // every fresh login/cold boot/resume, until the ping check resolved
  // — exactly the flash-of-access window #24 was built to close. Cost:
  // a brief spinner on every session establishment, not just fresh
  // logins. Deliberate tradeoff — see #24 design discussion.
  const stillResolvingBanStatus = !!session && isBanned === null
  const isReady = !isLoading && !stillResolvingBanStatus

  useEffect(() => {
    if (!isReady) return

    const onLoginScreen = segments[0] === "login"
    const onSuspendedScreen = segments[0] === "suspended"

    if (!session && !onLoginScreen) {
      // Not logged in and not on login screen → go to login
      router.replace("/login")
    } else if (session && isBanned && !onSuspendedScreen) {
      // Banned → hard lockout, not just blocked writes.
      router.replace("/suspended")
    } else if (session && !isBanned && (onLoginScreen || onSuspendedScreen)) {
      // Logged in, not banned, but stuck on login/suspended → go to app
      router.replace("/(tabs)")
    }
  }, [session, isLoading, isBanned, isReady, segments, router])

  // The Stack (and its route table, including "(tabs)") stays mounted
  // regardless of isReady. Previously this returned the spinner in
  // place of the Stack while loading — meaning "(tabs)" didn't exist
  // as a registered route yet on the very first render where isReady
  // flips true, which is also the render where the effect above fires
  // and calls router.replace("/(tabs)"). Mounting the Stack and firing
  // a replace into it happened in the same pass, racing whether the
  // navigator had actually finished registering its screens yet —
  // hence the "not handled by any navigator" warning. Keeping the
  // Stack always mounted removes the race entirely: the route table
  // exists before any navigate call is ever made.
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="suspended" />
        <Stack.Screen name="(tabs)" />
      </Stack>

      {!isReady && (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: "#fff",
            },
          ]}
        >
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      )}
    </>
  )
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}

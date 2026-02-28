import { useEffect } from "react"
import { ActivityIndicator, View } from "react-native"
import { Stack, useRouter, useSegments } from "expo-router"
import { AuthProvider, useAuth } from "@/utils/auth"

/**
 * Handles auth-based navigation.
 * - No session → redirect to /login
 * - Has session but on /login → redirect to /(tabs)
 */
function AuthGate() {
  const { session, isLoading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return

    const onLoginScreen = segments[0] === "login"

    if (!session && !onLoginScreen) {
      // Not logged in and not on login screen → go to login
      router.replace("/login")
    } else if (session && onLoginScreen) {
      // Logged in but still on login screen → go to app
      router.replace("/(tabs)")
    }
  }, [session, isLoading, segments, router])

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#fff",
        }}
      >
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    )
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}

import { useEffect, useState } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useAuth } from "@/utils/auth"

// Mirrors BAN_CHECK_COOLDOWN_MS in utils/auth.tsx — the provider's
// cooldown gate is the one actually enforced (it'll silently no-op a
// request made before it, network call or not), this local timer just
// keeps the button's disabled state honest so it doesn't look tappable
// when a tap wouldn't do anything yet. Deliberately kept as a separate,
// simple local timer rather than threading precise cooldown state
// through the provider — a minor UI/gate mismatch (e.g. right after an
// automatic resume-triggered check) is an acceptable rough edge for v1.
const RETRY_COOLDOWN_SECONDS = 30

export default function SuspendedScreen() {
  const { logout, retryBanCheck } = useAuth()
  const [secondsRemaining, setSecondsRemaining] = useState(0)

  useEffect(() => {
    if (secondsRemaining <= 0) return
    const timer = setInterval(() => {
      setSecondsRemaining((s) => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [secondsRemaining])

  const handleRetry = () => {
    retryBanCheck()
    setSecondsRemaining(RETRY_COOLDOWN_SECONDS)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🚫</Text>
      <Text style={styles.title}>Account suspended</Text>
      <Text style={styles.body}>
        This account is no longer able to use Loba.
      </Text>

      <TouchableOpacity
        style={[
          styles.retryButton,
          secondsRemaining > 0 && styles.retryButtonDisabled,
        ]}
        onPress={handleRetry}
        disabled={secondsRemaining > 0}
      >
        <Text style={styles.retryButtonText}>
          {secondsRemaining > 0
            ? `Try again in ${secondsRemaining}s`
            : "Try again"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={logout}>
        <Text style={styles.signOutButtonText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 10,
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 21,
  },
  retryButton: {
    backgroundColor: "#007AFF",
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 28,
    marginBottom: 16,
  },
  retryButtonDisabled: {
    backgroundColor: "#ccc",
  },
  retryButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  signOutButton: {
    paddingVertical: 8,
  },
  signOutButtonText: {
    color: "#999",
    fontSize: 14,
  },
})

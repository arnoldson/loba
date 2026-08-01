// apps/mobile/components/DevCrashButton.tsx
import React, { useState } from "react"
import { TouchableOpacity, Text, StyleSheet } from "react-native"

function Bomb(): React.ReactElement {
  throw new Error("Test crash: intentional render error from DevCrashButton")
}

export function DevCrashButton() {
  const [shouldCrash, setShouldCrash] = useState(false)

  if (__DEV__ !== true) return null // never renders in production builds

  if (shouldCrash) {
    return <Bomb />
  }

  return (
    <TouchableOpacity
      style={styles.button}
      onPress={() => setShouldCrash(true)}
    >
      <Text style={styles.text}>💣 Trigger crash</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    top: 60,
    right: 16,
    backgroundColor: "#e53935",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    zIndex: 999,
  },
  text: { color: "#fff", fontWeight: "600", fontSize: 12 },
})

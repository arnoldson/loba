import { useCallback, useState } from "react"
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useAuth } from "@/utils/auth"
import { API_URL } from "@/utils/api"

export default function SettingsScreen() {
  const { user, logout, getAuthHeaders } = useAuth()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleLogout = useCallback(() => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: () => logout() },
    ])
  }, [logout])

  const performDelete = useCallback(async () => {
    setIsDeleting(true)

    try {
      const res = await fetch(`${API_URL}/api/account`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      })
      const data = await res.json()

      if (data.success) {
        // Account is gone server-side; clear the local session so
        // AuthGate redirects to /login. No need to await confirmation
        // from the server on this — signOut() just clears local state.
        await logout()
      } else {
        setIsDeleting(false)
        Alert.alert("Error", data.error || "Failed to delete account")
      }
    } catch {
      setIsDeleting(false)
      Alert.alert("Error", "Could not connect to server")
    }
  }, [getAuthHeaders, logout])

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      "Delete Account",
      "This permanently deletes your account and signs you out. Your posts and comments will stay visible but will no longer be linked to you. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Are you absolutely sure?",
              "There is no way to recover your account after this.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete Account",
                  style: "destructive",
                  onPress: performDelete,
                },
              ],
            )
          },
        },
      ],
    )
  }, [performDelete])

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <View style={styles.content}>
        {user?.email && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Account</Text>
            <View style={styles.card}>
              <Text style={styles.email}>{user.email}</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <TouchableOpacity style={styles.rowButton} onPress={handleLogout}>
            <Text style={styles.rowButtonText}>Log Out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Danger Zone</Text>
          <TouchableOpacity
            style={[styles.rowButton, styles.dangerButton]}
            onPress={handleDeleteAccount}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator color="#d32f2f" />
            ) : (
              <Text style={styles.dangerButtonText}>Delete Account</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.dangerHint}>
            Permanently deletes your account. This cannot be undone.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f8f8",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#000",
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 28,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888",
    textTransform: "uppercase",
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  email: {
    fontSize: 15,
    color: "#333",
  },
  rowButton: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  rowButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#007AFF",
  },
  dangerButton: {
    borderWidth: 1,
    borderColor: "#f5c2c2",
  },
  dangerButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#d32f2f",
  },
  dangerHint: {
    fontSize: 12,
    color: "#999",
    marginTop: 8,
    marginLeft: 4,
  },
})

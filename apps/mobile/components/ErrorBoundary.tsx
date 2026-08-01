import React from "react"
import { View, Text, TouchableOpacity, StyleSheet } from "react-native"

interface Props {
  children: React.ReactNode
  /**
   * Optional custom fallback renderer. Receives the error and a reset
   * function that clears the boundary's error state and re-renders children.
   * If omitted, a default fallback UI is used.
   */
  fallback?: (error: Error, reset: () => void) => React.ReactNode
  /**
   * Optional label used in the default fallback UI and in logs, to identify
   * which boundary caught the error (e.g. "Map", "TileDetailsModal").
   */
  label?: string
  /**
   * Optional hook for wiring up real error reporting later (issue #31).
   * Defaults to console.error.
   */
  onError?: (error: Error, info: React.ErrorInfo) => void
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const { label, onError } = this.props
    if (onError) {
      onError(error, info)
    } else {
      console.error(
        `[ErrorBoundary${label ? `:${label}` : ""}]`,
        error,
        info.componentStack,
      )
    }
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    const { children, fallback, label } = this.props

    if (error) {
      if (fallback) {
        return fallback(error, this.reset)
      }
      return (
        <View style={styles.container}>
          <Text style={styles.title}>
            {label ? `${label} ran into a problem` : "Something went wrong"}
          </Text>
          <Text style={styles.message}>{error.message}</Text>
          <TouchableOpacity style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )
    }

    return children
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fafafa",
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  message: {
    fontSize: 13,
    color: "#666",
    marginBottom: 16,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#222",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
})

import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/utils/auth";

export default function LoginScreen() {
  const { login, signup } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      Alert.alert("Missing fields", "Please enter both email and password.");
      return;
    }

    if (isSignUp && password.length < 6) {
      Alert.alert("Weak password", "Password must be at least 6 characters.");
      return;
    }

    setIsLoading(true);

    const error = isSignUp
      ? await signup(trimmedEmail, password)
      : await login(trimmedEmail, password);

    setIsLoading(false);

    if (error) {
      Alert.alert(isSignUp ? "Sign up failed" : "Login failed", error);
      return;
    }

    if (isSignUp) {
      // Supabase may require email confirmation depending on settings.
      // If email confirmation is disabled, this will auto-login.
      // If enabled, show a message.
      Alert.alert(
        "Account created",
        "Check your email to confirm your account, then log in.",
        [{ text: "OK", onPress: () => setIsSignUp(false) }]
      );
      return;
    }

    // Login success — navigate to main app
    router.replace("/(tabs)");
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.inner}>
        {/* Branding */}
        <View style={styles.header}>
          <Text style={styles.logo}>loba</Text>
          <Text style={styles.tagline}>posts pinned to the real world</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#999"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#999"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType={isSignUp ? "newPassword" : "password"}
          />

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.buttonText}>
                {isSignUp ? "Create Account" : "Log In"}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Toggle sign in / sign up */}
        <TouchableOpacity
          style={styles.toggle}
          onPress={() => setIsSignUp(!isSignUp)}
        >
          <Text style={styles.toggleText}>
            {isSignUp
              ? "Already have an account? Log in"
              : "Don't have an account? Sign up"}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  header: {
    alignItems: "center",
    marginBottom: 48,
  },
  logo: {
    fontSize: 48,
    fontWeight: "700",
    color: "#007AFF",
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 16,
    color: "#888",
    marginTop: 8,
  },
  form: {
    gap: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  button: {
    backgroundColor: "#007AFF",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "white",
    fontSize: 17,
    fontWeight: "600",
  },
  toggle: {
    alignItems: "center",
    marginTop: 24,
  },
  toggleText: {
    color: "#007AFF",
    fontSize: 15,
  },
});

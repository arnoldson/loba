/**
 * Auth context for the Loba app.
 *
 * Wraps the app and provides:
 * - session / user state
 * - login, signup, logout functions
 * - getAuthHeaders() for API calls
 *
 * Uses the Supabase client from utils/supabase.ts.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react"
import { AppState } from "react-native"
import { supabase } from "@/utils/supabase"
import { API_URL } from "@/utils/api"
import type { Session, User } from "@supabase/supabase-js"

/**
 * Minimum time between two real ban-check requests to the backend,
 * regardless of what triggers the check (app resume, manual retry
 * button on the suspended screen, etc.) — a banned client shouldn't be
 * able to hammer the backend by backgrounding/foregrounding repeatedly
 * or mashing "Try Again". See #24 design discussion.
 */
const BAN_CHECK_COOLDOWN_MS = 30_000

interface AuthState {
  session: Session | null
  user: User | null
  isLoading: boolean
  /**
   * null = not checked yet. AuthGate (app/_layout.tsx) treats a session
   * existing with isBanned still null as a loading state — it does NOT
   * optimistically let the user into the app while this is unresolved,
   * to avoid a window where a banned user could briefly see real data
   * before the check catches up. See #24 design discussion.
   */
  isBanned: boolean | null
}

interface AuthContextType extends AuthState {
  /** Sign in with email + password. Returns error string or null on success. */
  login: (email: string, password: string) => Promise<string | null>
  /** Create account with email + password. Returns error string or null. */
  signup: (email: string, password: string) => Promise<string | null>
  /** Sign out and clear session. */
  logout: () => Promise<void>
  /** Get Authorization header for API calls. Returns empty object if not logged in. */
  getAuthHeaders: () => Record<string, string>
  /**
   * Re-checks ban status against the backend, subject to
   * BAN_CHECK_COOLDOWN_MS — a no-op if called again too soon. Used by
   * the suspended screen's "Try Again" button.
   */
  retryBanCheck: () => void
}

interface LoginResponse {
  success: boolean
  access_token?: string
  refresh_token?: string
  error?: string
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    isLoading: true,
    isBanned: null,
  })

  // Authoritative cooldown gate — a ref (not state) so it's checked
  // synchronously and can't be raced by rapid taps/resumes the way a
  // state read inside an async callback could be.
  const lastBanCheckAtRef = useRef<number>(0)
  // Lets the AppState resume listener (set up once, empty dep array)
  // reach the current session without needing session in its deps.
  const sessionRef = useRef<Session | null>(null)

  // Global ban detection — catches a ban surfacing from ANY API call
  // (map fetch, react, comment, etc.), not just the dedicated ping.
  // There's no shared HTTP client in this codebase (every screen does
  // its own raw fetch()), so this patches global.fetch once here
  // instead of touching every call site individually. Clones the
  // response before reading it, so the original caller still gets an
  // unconsumed body to read normally — this is purely observing, never
  // altering, the response.
  useEffect(() => {
    const originalFetch = global.fetch

    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input as RequestInfo, init)

      if (response.status === 403) {
        try {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url

          if (
            url.startsWith(API_URL) &&
            !url.startsWith(`${API_URL}/api/auth/login`)
          ) {
            const body = await response.clone().json()
            if (body?.code === "banned") {
              setState((prev) => ({ ...prev, isBanned: true }))
            }
          }
        } catch {
          // Never let interception break the real response
        }
      }

      return response
    }) as typeof fetch

    return () => {
      global.fetch = originalFetch
    }
  }, [])

  const checkBanStatus = useCallback(
    async (accessToken: string | undefined): Promise<void> => {
      if (!accessToken) return

      const now = Date.now()
      if (now - lastBanCheckAtRef.current < BAN_CHECK_COOLDOWN_MS) {
        return // still cooling down — silently skip, don't hit the backend
      }
      lastBanCheckAtRef.current = now

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      // Fail-open helper: if this is the FIRST time we're resolving ban
      // status (still null), a failure defaults to "not banned" rather
      // than leaving AuthGate waiting forever — a connectivity hiccup
      // shouldn't be able to hard-lock a legitimate user out of the
      // whole app. requireAuth/optionalAuth/the global interceptor all
      // still enforce independently of this check succeeding, so this
      // is purely about not getting stuck, not a real security gap.
      // If we already have a resolved value (known banned or known
      // clean), a transient failure leaves it alone rather than
      // clobbering a real answer.
      const failOpenIfUnresolved = () => {
        setState((prev) =>
          prev.isBanned === null ? { ...prev, isBanned: false } : prev,
        )
      }

      try {
        const res = await fetch(`${API_URL}/api/auth/ping`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        })

        if (res.status === 403) {
          setState((prev) => ({ ...prev, isBanned: true }))
        } else if (res.ok) {
          setState((prev) => ({ ...prev, isBanned: false }))
        } else {
          failOpenIfUnresolved()
        }
      } catch {
        // Network error or timeout — same fail-open reasoning
        failOpenIfUnresolved()
      } finally {
        clearTimeout(timeout)
      }
    },
    [],
  )

  const retryBanCheck = useCallback(() => {
    void checkBanStatus(sessionRef.current?.access_token)
  }, [checkBanStatus])

  // Listen for auth state changes (login, logout, token refresh)
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState((prev) => ({
        ...prev,
        session,
        user: session?.user ?? null,
        isLoading: false,
      }))
      if (session) void checkBanStatus(session.access_token)
    })

    // Subscribe to changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((prev) => ({
        ...prev,
        session,
        user: session?.user ?? null,
        isLoading: false,
      }))
      if (session) void checkBanStatus(session.access_token)
    })

    return () => subscription.unsubscribe()
  }, [checkBanStatus])

  // Keep sessionRef current for the AppState listener below, which is
  // set up once and can't depend on session directly.
  useEffect(() => {
    sessionRef.current = state.session
  }, [state.session])

  // Re-check on app foreground/resume — catches a ban applied mid-
  // session, or a temp ban that's since expired, without polling.
  // checkBanStatus's own cooldown gate prevents this from spamming the
  // backend on rapid background/foreground cycling.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void checkBanStatus(sessionRef.current?.access_token)
      }
    })
    return () => subscription.remove()
  }, [checkBanStatus])

  const login = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      try {
        const res = await fetch(`${API_URL}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        })
        const data: LoginResponse = await res.json()

        if (!res.ok || !data.success) {
          return data.error || "Failed to sign in"
        }

        if (!data.access_token || !data.refresh_token) {
          // Backend said success but didn't include tokens — treat as
          // a failure rather than passing undefined to setSession
          return "Failed to sign in"
        }

        // Hand the backend-issued tokens to the Supabase client so
        // everything downstream (onAuthStateChange, getSession, etc.)
        // keeps working exactly as if signInWithPassword had been
        // called directly — the only difference is a banned account
        // never reaches this line at all.
        const { error } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        })
        return error ? error.message : null
      } catch {
        return "Could not connect to server"
      }
    },
    [],
  )

  const signup = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: "https://arnoldson.github.io/loba/verified.html",
        },
      })
      if (error) return error.message
      return null
    },
    [],
  )

  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    setState((prev) => ({ ...prev, isBanned: null }))
    // Also reset the cooldown gate — it's scoped to the app session, not
    // to a particular account. Without this, a recent check on the
    // account being logged out of could silently suppress the next
    // account's legitimate check right after logging in, leaving
    // isBanned stuck at null with no check ever actually running.
    lastBanCheckAtRef.current = 0
  }, [])

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = state.session?.access_token
    if (!token) return {}
    return { Authorization: `Bearer ${token}` }
  }, [state.session])

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        signup,
        logout,
        getAuthHeaders,
        retryBanCheck,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

/**
 * Hook to access auth state and actions.
 * Must be used within an <AuthProvider>.
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

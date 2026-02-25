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
} from "react";
import { supabase } from "@/utils/supabase";
import type { Session, User } from "@supabase/supabase-js";

interface AuthState {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  /** Sign in with email + password. Returns error string or null on success. */
  login: (email: string, password: string) => Promise<string | null>;
  /** Create account with email + password. Returns error string or null. */
  signup: (email: string, password: string) => Promise<string | null>;
  /** Sign out and clear session. */
  logout: () => Promise<void>;
  /** Get Authorization header for API calls. Returns empty object if not logged in. */
  getAuthHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    isLoading: true,
  });

  // Listen for auth state changes (login, logout, token refresh)
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({
        session,
        user: session?.user ?? null,
        isLoading: false,
      });
    });

    // Subscribe to changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        session,
        user: session?.user ?? null,
        isLoading: false,
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return error ? error.message : null;
    },
    []
  );

  const signup = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
      });
      if (error) return error.message;
      return null;
    },
    []
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = state.session?.access_token;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [state.session]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        signup,
        logout,
        getAuthHeaders,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth state and actions.
 * Must be used within an <AuthProvider>.
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

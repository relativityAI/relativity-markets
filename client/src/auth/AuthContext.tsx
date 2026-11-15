import { useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { AuthContext, type AuthContextValue } from "./context";

/**
 * Two modes (mirrors the API's AUTH_MODE):
 *  - local (default): no sign-in. Every session is the single default local
 *    user the server assigns; signOut is a no-op. Supabase is never touched —
 *    leftover VITE_SUPABASE_* env vars are ignored.
 *  - supabase (VITE_AUTH_MODE=supabase): the legacy Google login path, kept
 *    working verbatim for the cloud deployment.
 */
const SUPABASE_AUTH = import.meta.env.VITE_AUTH_MODE === "supabase";

const LOCAL_USER: User = {
  id: "local",
  aud: "local",
  email: "default@localhost",
  user_metadata: { name: "Default User" },
} as unknown as User;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(SUPABASE_AUTH);

  useEffect(() => {
    if (!SUPABASE_AUTH) return; // local mode: default user, nothing to load

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const value: AuthContextValue = SUPABASE_AUTH
    ? {
        user: session?.user ?? null,
        session,
        loading,
        async signOut() {
          await supabase.auth.signOut();
        },
      }
    : {
        user: LOCAL_USER,
        session: null,
        loading: false,
        async signOut() {
          /* local mode: nothing to sign out of */
        },
      };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** True when the app runs without sign-in (drives UI affordances). */
export const LOCAL_AUTH = !SUPABASE_AUTH;

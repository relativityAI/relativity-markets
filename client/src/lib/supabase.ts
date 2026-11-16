import { createClient } from "@supabase/supabase-js";

/**
 * Cloud auth is opt-in (VITE_AUTH_MODE="supabase"); local-first is the default.
 * Single owner of the mode check — AuthContext and the db interceptor import it.
 */
export const SUPABASE_AUTH = import.meta.env.VITE_AUTH_MODE === "supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Local mode never touches Supabase — leftover VITE_SUPABASE_* env vars are ignored.
if (SUPABASE_AUTH && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
  console.error(
    "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  );
}

export const supabase = createClient(
  SUPABASE_URL || "https://placeholder.supabase.co",
  SUPABASE_ANON_KEY || "placeholder",
);

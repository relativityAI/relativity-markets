import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui class combiner. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Turn an axios/MCP/server error into a sentence a user can act on. The raw
 *  message stays in the `title` for support, never in the body copy. */
export function errorCopy(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
  const raw = e?.response?.data?.error || e?.message || "";
  if (!raw) return fallback;
  if (/fetch failed|ECONNREFUSED|ETIMEDOUT|Network Error|ENOTFOUND/i.test(raw)) {
    return "Couldn't reach the server — is it running?";
  }
  if (/streamable HTTP server|Failed to connect to|mcp/i.test(raw)) {
    return "A data source isn't responding — it's off for this run.";
  }
  // Server-authored messages are already human ("plugin_ids is required — …").
  if (e?.response?.data?.error) return raw;
  return fallback;
}

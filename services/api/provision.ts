import { decrypt } from "./crypto.js";
import { log } from "./logger.js";
import { getUserSettings, upsertUserSettings } from "../db/settings.js";
import { CUSTOM_KEY } from "../harness/model.js";

/** Ensure the user_settings row exists (LLM key store). */
export async function ensureUserSettings(userId: string): Promise<void> {
  try {
    const rowData = await getUserSettings(userId);
    if (!rowData) {
      await upsertUserSettings(userId, { llm_keys_encrypted: {} });
      log.info("[provision]", `Created user_settings for ${userId}`);
    }
  } catch (e: any) {
    log.error("[provision]", `ensureUserSettings failed for ${userId}: ${e?.message || e}`);
  }
}

/** Fetch decrypted user LLM keys (+ raw prefs, for the MCP enable/disable
 *  and custom-server list). */
export async function fetchUserKeys(
  userId: string,
): Promise<{ llmKeys: Record<string, string>; prefs: Record<string, string> }> {
  const fallback = { llmKeys: {}, prefs: {} as Record<string, string> };
  try {
    const data = await getUserSettings(userId);
    if (!data) return fallback;

    const llmKeys: Record<string, string> = {};
    if (data.llm_keys_encrypted && typeof data.llm_keys_encrypted === "object") {
      for (const [k, v] of Object.entries(data.llm_keys_encrypted)) {
        // Legacy orphan: Tavily support is gone — never surface or route its key.
        if (k === "tavily") continue;
        try { llmKeys[k] = decrypt(v); } catch { llmKeys[k] = ""; }
      }
    }
    // User-added OpenAI-compatible providers ride on the keys record: it is
    // the one object every model call already carries, so custom routing needs
    // no extra parameter threaded through the call graph.
    if (data.prefs?.custom_providers) llmKeys[CUSTOM_KEY] = data.prefs.custom_providers;
    return { llmKeys, prefs: data.prefs ?? {} };
  } catch (e: any) {
    log.error("[provision]", `fetchUserKeys failed for ${userId}: ${e?.message || e}`);
    return fallback;
  }
}

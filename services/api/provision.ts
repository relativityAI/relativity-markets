import { decrypt } from "./crypto.js";
import { log } from "./logger.js";
import { getUserSettings, upsertUserSettings } from "../db/settings.js";

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

/** Fetch decrypted user LLM keys from the local DB. */
export async function fetchUserKeys(userId: string): Promise<{ llmKeys: Record<string, string> }> {
  try {
    const data = await getUserSettings(userId);
    if (!data) return { llmKeys: {} };

    const llmKeys: Record<string, string> = {};
    if (data.llm_keys_encrypted && typeof data.llm_keys_encrypted === "object") {
      for (const [k, v] of Object.entries(data.llm_keys_encrypted)) {
        try { llmKeys[k] = decrypt(v); } catch { llmKeys[k] = ""; }
      }
    }
    return { llmKeys };
  } catch (e: any) {
    log.error("[provision]", `fetchUserKeys failed for ${userId}: ${e?.message || e}`);
    return { llmKeys: {} };
  }
}

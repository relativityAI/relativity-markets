import { getStockPull } from "../db/repo.js";

// ── Freshness thresholds ─────────────────────────────────────────────────
// Fundamental XBRL data (financials, ratios, margins). Re-pull if older than this.
export const FRESHNESS_FUNDAMENTAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Local freshness check (fast, hits SQLite only) ───────────────────────

export async function isDataFresh(
  userId: string,
  symbol: string,
  source: string,
): Promise<boolean> {
  const pull = await getStockPull(userId, symbol, source);

  if (!pull) return false;
  if (pull.status !== "completed" || !pull.last_pulled_at) return false;

  const pulledAt = new Date(pull.last_pulled_at).getTime();
  return Date.now() - pulledAt < FRESHNESS_FUNDAMENTAL_MS;
}

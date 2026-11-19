import { describe, expect, it, vi, beforeEach } from "vitest";
import { evaluateAlert } from "../schedule.js";
import type { AlertRuleRow } from "../../db/repo.js";

// The repo layer is the DB — mock it so evaluateAlert's decision table can be
// exercised without SQLite: which run states alert, and when dedupe kicks in.
const repo = vi.hoisted(() => ({
  getRunRow: vi.fn(),
  lastAlertVerdict: vi.fn(),
  insertAlertRow: vi.fn(),
  listAllAlertRuleRows: vi.fn(async () => []),
  claimAlertRule: vi.fn(() => false),
  setAlertRuleRun: vi.fn(),
}));

vi.mock("../../db/repo.js", () => repo);

const RULE = {
  id: "r1",
  user_id: "u1",
  symbol: "RELIANCE",
  share_name: "Reliance",
  source: "NSE",
  agent_id: "a1",
  model: null,
  system_prompt: null,
  skill_ids: null,
  max_steps: null,
  max_tokens: null,
  time: "09:00",
  timezone: "Asia/Kolkata",
  frequency: "daily",
  start_date: "2026-11-01",
  last_fired_date: null,
  last_run_id: "run1",
  enabled: 1,
  created_at: "2026-11-01T00:00:00.000Z",
} as AlertRuleRow;

function run(status: string, verdict?: string) {
  return {
    id: "run1",
    user_id: "u1",
    status,
    symbol: "RELIANCE",
    share_name: "Reliance",
    agent_name: "Nifty Observer",
    report: verdict ? { verdict } : null,
    created_at: "2026-11-19T00:00:00.000Z",
    updated_at: "2026-11-19T00:05:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.getRunRow.mockResolvedValue(null);
  repo.lastAlertVerdict.mockReturnValue(null);
  repo.insertAlertRow.mockResolvedValue({});
});

describe("evaluateAlert", () => {
  it("alerts when the completed run's verdict is new for the rule", async () => {
    repo.getRunRow.mockResolvedValue(run("COMPLETED", "Accumulate"));
    repo.lastAlertVerdict.mockReturnValue("Reduce");

    await evaluateAlert(RULE);

    expect(repo.insertAlertRow).toHaveBeenCalledWith(
      expect.objectContaining({ rule_id: "r1", run_id: "run1", verdict: "Accumulate", symbol: "RELIANCE" }),
    );
  });

  it("dedupes: same verdict as the last alert means no new alert", async () => {
    repo.getRunRow.mockResolvedValue(run("COMPLETED", "Accumulate"));
    repo.lastAlertVerdict.mockReturnValue("Accumulate");

    await evaluateAlert(RULE);

    expect(repo.insertAlertRow).not.toHaveBeenCalled();
  });

  it("waits while the run is still going", async () => {
    repo.getRunRow.mockResolvedValue(run("RUNNING"));

    await evaluateAlert(RULE);

    expect(repo.insertAlertRow).not.toHaveBeenCalled();
  });

  it("never alerts on a failed run", async () => {
    repo.getRunRow.mockResolvedValue(run("ERROR"));

    await evaluateAlert(RULE);

    expect(repo.insertAlertRow).not.toHaveBeenCalled();
  });

  it("waits for a COMPLETED run whose background grade hasn't landed", async () => {
    repo.getRunRow.mockResolvedValue(run("COMPLETED"));

    await evaluateAlert(RULE);

    expect(repo.insertAlertRow).not.toHaveBeenCalled();
  });

  it("does nothing when the rule never fired", async () => {
    await evaluateAlert({ ...RULE, last_run_id: null });

    expect(repo.getRunRow).not.toHaveBeenCalled();
    expect(repo.insertAlertRow).not.toHaveBeenCalled();
  });

  it("first verdict for a rule always alerts", async () => {
    repo.getRunRow.mockResolvedValue(run("COMPLETED", "Hold"));
    repo.lastAlertVerdict.mockReturnValue(null);

    await evaluateAlert(RULE);

    expect(repo.insertAlertRow).toHaveBeenCalledWith(expect.objectContaining({ verdict: "Hold" }));
  });
});

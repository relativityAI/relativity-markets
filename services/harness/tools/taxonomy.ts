/**
 * resolve_group — group-run support: one taxonomy key ("IN:SECTOR:IN01",
 * "US:SUB_INDUSTRY:major-banks") resolves to the group's name, breadcrumb and
 * constituent list. Reuses the API's in-memory taxonomy loader (one parse of
 * the CSVs per process). ponytail: no stats/aggregates here — constituents
 * only; the agent pulls per-stock data via its existing tools.
 */
import { tool } from "langchain";
import { z } from "zod";
import type { StructuredTool } from "@langchain/core/tools";
import { getGroup } from "../../api/taxonomy.js";

export function resolveGroupTool(): StructuredTool {
  return tool(
    async ({ key }) => {
      const k = String(key).trim();
      const g = getGroup(k);
      if (!g) {
        return {
          error: `no group for key ${k}`,
          hint: "Group keys look like IN:SECTOR:IN01, IN:BASIC_INDUSTRY:IN010101001 or US:SECTOR:technology. They are only valid when the run's entity is a sector/industry group, not a single stock.",
        };
      }
      return {
        key: g.key,
        name: g.name,
        market: g.market,
        level: g.level,
        path: g.path,
        constituents: g.constituents.map((c) => ({ symbol: c.symbol, name: c.name, source: c.source })),
      };
    },
    {
      name: "resolve_group",
      description:
        "Resolve a sector/industry group key to its name, breadcrumb path and constituent stocks. " +
        "Use this FIRST on group runs (when the symbol is a group key like IN:SECTOR:IN01) to see what the group covers.",
      schema: z.object({
        key: z.string().describe("Group key, e.g. IN:SECTOR:IN01 or US:SECTOR:technology"),
      }),
    },
  );
}

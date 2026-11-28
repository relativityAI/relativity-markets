/**
 * Sectors — /sectors — the browsable groups index. Market toggle (India/US,
 * with flags), then a level select below — sector / industry group / industry /
 * basic industry for India, sector / industry group / sub-industry for the US.
 * One card per group at the chosen level: mark, name, what lives under it and
 * how many stocks — a card is a link into the group page.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Box, Flex, Spinner, Text } from "@/compat/ui";
import { TaxonomyService, type SectorRow } from "@/db";
import { FlagLogo } from "@/lib/sourceLogos";
import { cn } from "@/lib/utils";
import { GroupMark } from "@/components/search/EntitySearch";

const MARKETS = [
    { id: "NSE", label: "India" },
    { id: "SEC", label: "United States" },
] as const;

const LEVELS: Record<string, { value: string; label: string; child: string }> = {
    NSE: {
        sector: { value: "sector", label: "Sector", child: "industries" },
        industry_group: { value: "industry_group", label: "Industry group", child: "industries" },
        industry: { value: "industry", label: "Industry", child: "basic industries" },
        basic_industry: { value: "basic_industry", label: "Basic industry", child: "" },
    },
    SEC: {
        sector: { value: "sector", label: "Sector", child: "industries" },
        industry_group: { value: "industry_group", label: "Industry group", child: "sub-industries" },
        sub_industry: { value: "sub_industry", label: "Sub-industry", child: "" },
    },
};

export default function Sectors() {
    const [market, setMarket] = useState<"NSE" | "SEC">("NSE");
    const [level, setLevel] = useState("sector");
    const [rows, setRows] = useState<SectorRow[] | null>(null);

    const levels = Object.values(LEVELS[market]);
    const childWord = levels.find((l) => l.value === level)?.child || "";

    useEffect(() => {
        setRows(null);
        TaxonomyService.sectors(market, level)
            .then(setRows)
            .catch(() => setRows([]));
    }, [market, level]);

    const switchMarket = (m: "NSE" | "SEC") => {
        setMarket(m);
        setLevel("sector"); // levels differ per market — start at the top
    };

    return (
        <Box bg="var(--surface-canvas)" minH="100vh" fontFamily="var(--font-body)">
            <Box py={{ base: 4, md: 6 }} maxW="1200px" mx="auto" px={4}>
                <div className="px-2">
                    <h1 className="font-app-body text-[30px] leading-none font-light tracking-tight text-console-ink">
                        Sectors &amp; Industries
                    </h1>
                    <p className="mt-2 font-app-body text-[13px] font-normal text-console-ink-2">
                        Every sector and industry, with its constituents — run analyses or build watchlists from them.
                    </p>
                </div>

                {/* Market toggle with flags, then the level pills below it —
                    same pill treatment as the market buttons. */}
                <div className="mt-5 flex max-w-[560px] flex-col gap-2 px-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {MARKETS.map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => switchMarket(m.id)}
                                aria-pressed={market === m.id}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-app-body text-[13px] transition-colors",
                                    market === m.id
                                        ? "bg-[var(--ink-primary)] text-[var(--surface-canvas)]"
                                        : "bg-[var(--surface-recessed)] text-console-ink-2 hover:text-console-ink",
                                )}
                            >
                                <FlagLogo source={m.id} size={14} />
                                {m.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {levels.map((l) => (
                            <button
                                key={l.value}
                                type="button"
                                onClick={() => setLevel(l.value)}
                                aria-pressed={level === l.value}
                                data-testid={`level-${l.value}`}
                                className={cn(
                                    "rounded-full px-3.5 py-1.5 font-app-body text-[13px] transition-colors",
                                    level === l.value
                                        ? "bg-[var(--ink-primary)] text-[var(--surface-canvas)]"
                                        : "bg-[var(--surface-recessed)] text-console-ink-2 hover:text-console-ink",
                                )}
                            >
                                {l.label}
                            </button>
                        ))}
                    </div>
                </div>

                {!rows && (
                    <Flex justify="center" align="center" gap={3} py={16} color="var(--ink-secondary)">
                        <Spinner size="sm" borderWidth="2px" />
                        <Text fontSize="13px">Loading groups…</Text>
                    </Flex>
                )}

                {rows && (
                    <div className="mt-5 grid gap-3 px-2 sm:grid-cols-2 lg:grid-cols-3">
                        {rows.map((s) => (
                            <Link
                                key={s.key}
                                to={`/group/${encodeURIComponent(s.key)}`}
                                data-testid={`sector-card-${s.code}`}
                                className="group/card rounded-xl border border-[color:var(--hairline)] p-4 transition-colors hover:bg-[color-mix(in_srgb,var(--ink-primary)_4%,transparent)]"
                                style={{ textDecoration: "none" }}
                            >
                                <div className="flex items-start gap-3">
                                    <GroupMark level={s.level} market={s.market} size={38} variant="compact" />
                                    <div className="min-w-0">
                                        <div className="truncate font-app-body text-[15px] font-normal text-console-ink group-hover/card:text-console-ink">
                                            {s.name}
                                        </div>
                                        <div className="mt-1 font-app-body text-[12px] text-console-ink-3">
                                            {childWord && s.children > 0
                                                ? `${s.children} ${childWord} · ${s.count} stocks`
                                                : `${s.count} stocks`}
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))}
                        {rows.length === 0 && (
                            <p className="col-span-full rounded-xl border border-dashed border-[color:var(--hairline)] px-4 py-6 text-center font-app-body text-[13px] font-normal text-console-ink-3">
                                No groups at this level for this market.
                            </p>
                        )}
                    </div>
                )}
            </Box>
        </Box>
    );
}

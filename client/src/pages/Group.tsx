/**
 * Group page — /group/:key — one sector/industry group's constituent listing.
 * Deliberately NOT a watchlist: logo + name only; a row click goes to that
 * stock's page. The two actions are "Create a watchlist" (the whole group, in
 * one click) and "Run analysis" (the New Run form with the group preselected).
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ListPlus, Play } from "lucide-react";
import { Box, Flex, Spinner, Text } from "@/compat/ui";
import { TaxonomyService, WatchlistService, type GroupDetail } from "@/db";
import { TickerLogo, FlagLogo } from "@/lib/sourceLogos";
import { toaster } from "@/compat/ui";
import { GroupMark } from "@/components/search/EntitySearch";

const LEVEL_WORD: Record<string, string> = {
    sector: "Sector",
    industry_group: "Industry group",
    industry: "Industry",
    basic_industry: "Basic industry",
    sub_industry: "Sub-industry",
};

export default function Group() {
    const { key } = useParams();
    const navigate = useNavigate();
    const [group, setGroup] = useState<GroupDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        setGroup(null);
        setError(null);
        TaxonomyService.group(String(key || ""))
            .then(setGroup)
            .catch((e) => setError(e?.response?.data?.error || e?.message || "Couldn't load this group."));
    }, [key]);

    const createWatchlist = async () => {
        if (!group || creating) return;
        setCreating(true);
        try {
            await WatchlistService.create(
                group.name,
                group.constituents.map((c) => ({ symbol: c.symbol, source: c.source, name: c.name })),
            );
            toaster.create({
                title: `Watchlist "${group.name}" created`,
                description: `${group.count} stocks — open it from Watchlists.`,
                type: "success",
            });
            navigate("/watchlists");
        } catch (e: any) {
            toaster.create({
                title: "Couldn't create the watchlist",
                description: e?.response?.data?.error || e?.message,
                type: "error",
            });
        } finally {
            setCreating(false);
        }
    };

    return (
        <Box bg="var(--surface-canvas)" minH="100vh" fontFamily="var(--font-body)">
            <Box py={{ base: 4, md: 6 }} maxW="1200px" mx="auto" px={4}>
                {error && (
                    <Text fontSize="13px" color="var(--signal-negative-text)" px={2}>
                        {error}
                    </Text>
                )}
                {!error && !group && (
                    <Flex justify="center" align="center" gap={3} py={16} color="var(--ink-secondary)">
                        <Spinner size="sm" borderWidth="2px" />
                        <Text fontSize="13px">Loading group…</Text>
                    </Flex>
                )}
                {group && (
                    <>
                        {/* Header — mark, name, breadcrumb, counts, the two actions. */}
                        <Flex align="flex-start" gap={3} flexWrap="wrap">
                            <GroupMark level={group.level} market={group.market} size={96} />
                            <Box minW={0} flex={1}>
                                <h1 className="font-app-body text-[30px] leading-none font-light tracking-tight text-console-ink">
                                    {group.name}
                                </h1>
                                <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-app-body text-[12.5px] text-console-ink-2">
                                    <FlagLogo source={group.market} size={13} />
                                    <span>{LEVEL_WORD[group.level] || group.level}</span>
                                    <span aria-hidden className="text-console-ink-4">·</span>
                                    <span className="truncate">
                                        {group.path.join(" › ")}
                                    </span>
                                    <span aria-hidden className="text-console-ink-4">·</span>
                                    <span>{group.count} stocks</span>
                                </div>
                            </Box>
                            <Flex gap={2} align="center">
                                <Link to={`/new-run?group=${encodeURIComponent(group.key)}`} style={{ textDecoration: "none" }}>
                                    <button
                                        type="button"
                                        data-testid="group-run"
                                        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-4 font-app-body text-[13px] font-normal text-[var(--primary-foreground,var(--surface-canvas))] transition-opacity hover:opacity-90"
                                        style={{ background: "var(--primary)" }}
                                    >
                                        <Play size={14} aria-hidden /> Run analysis
                                    </button>
                                </Link>
                                <button
                                    type="button"
                                    data-testid="group-watchlist"
                                    onClick={() => void createWatchlist()}
                                    disabled={creating}
                                    aria-busy={creating || undefined}
                                    className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-[color:var(--hairline)] px-4 font-app-body text-[13px] font-normal text-console-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink-primary)_5%,transparent)] disabled:cursor-default disabled:opacity-60"
                                >
                                    {creating ? <Spinner size="xs" borderWidth="2px" /> : <ListPlus size={14} aria-hidden />}
                                    Create a watchlist
                                </button>
                            </Flex>
                        </Flex>

                        {/* Constituents — the watchlist table's look: hairline
                            dividers, quiet header, hover-recessed rows; logo +
                            name, and a row is a link to the stock page. */}
                        <div className="mt-6 w-full overflow-x-auto">
                            <table className="w-full border-collapse text-left">
                                <thead>
                                    <tr className="border-b border-[var(--hairline)]">
                                        <th scope="col" className="py-2 pr-2 font-app-body text-[11px] font-light text-[var(--ink-tertiary)]">Symbol</th>
                                        <th scope="col" aria-hidden="true" className="py-2" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {group.constituents.map((c) => (
                                        <tr
                                            key={`${c.source}:${c.symbol}`}
                                            className="border-b border-[var(--hairline)] transition-colors last:border-b-0 hover:bg-[var(--surface-recessed)]"
                                        >
                                            <th scope="row" className="py-2.5 pr-2 align-middle font-light">
                                                <Link
                                                    to={`/stock/${encodeURIComponent(c.symbol)}?source=${c.source}`}
                                                    data-testid={`group-stock-${c.symbol}`}
                                                    className="flex min-w-0 items-center gap-2.5 hover:opacity-80"
                                                    style={{ textDecoration: "none" }}
                                                >
                                                    <TickerLogo symbol={c.symbol} size={40} />
                                                    <span className="truncate font-app-body text-[15px] font-normal text-[var(--ink-primary)]">
                                                        {c.name}
                                                    </span>
                                                </Link>
                                            </th>
                                            <td className="py-2.5 text-right align-middle font-app-body text-[13px] text-[var(--ink-tertiary)]">
                                                {c.symbol}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </Box>
        </Box>
    );
}

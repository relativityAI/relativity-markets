import { useEffect, useState } from "react";
import { AnalysisService, PluginService, type PluginSummary } from "@/db";
import WatchlistPanel from "@/components/WatchlistPanel";

/** Full-page watchlist — the same panel as the homepage rail, at page width. */
export default function Watchlists() {
    const [runs, setRuns] = useState<any[]>([]);
    const [plugins, setPlugins] = useState<PluginSummary[]>([]);

    useEffect(() => {
        Promise.allSettled([AnalysisService.listAnalyses(), PluginService.list()]).then(([r, p]) => {
            if (r.status === "fulfilled" && Array.isArray(r.value)) setRuns(r.value);
            if (p.status === "fulfilled" && Array.isArray(p.value)) setPlugins(p.value);
        });
    }, []);

    return (
        <div className="min-h-full bg-[var(--surface-canvas)] pb-12 text-[var(--ink-primary)]">
            <WatchlistPanel runs={runs} plugins={plugins} page />
        </div>
    );
}

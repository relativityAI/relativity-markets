import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnalysisService } from "@/db";
import { toaster } from "@/components/ui/toaster";

const TERMINAL = new Set(["completed", "complete", "success", "error", "failed", "cancelled", "timeout"]);

/**
 * Tells you when a run finishes while you're somewhere else. Polls the runs
 * list every 10s while the tab is visible; the first response is the baseline
 * (anything already finished counts as seen, not as news) and every later
 * transition into a terminal status fires exactly one toast.
 */
export default function RunWatcher() {
    const location = useLocation();
    const navigate = useNavigate();
    const seenRef = useRef<Map<string, string> | null>(null);

    useEffect(() => {
        let alive = true;

        const tick = async () => {
            if (document.hidden) return;
            try {
                const rows = await AnalysisService.listAnalyses();
                if (!alive || !Array.isArray(rows)) return;

                const idOf = (r: any) => String(r.analysis_id || r._id || r.id || "");
                const statusOf = (r: any) => String(r.status || "").toLowerCase();

                if (seenRef.current === null) {
                    seenRef.current = new Map(rows.map((r: any) => [idOf(r), statusOf(r)]));
                    return;
                }
                const seen = seenRef.current;
                for (const r of rows) {
                    const id = idOf(r);
                    if (!id) continue;
                    const status = statusOf(r);
                    const prev = seen.get(id);
                    seen.set(id, status);
                    if (prev === status || !TERMINAL.has(status)) continue;
                    // The run you're looking at reports for itself.
                    if (location.pathname.includes(id)) continue;
                    const name = r.share_name || r.symbol || "Run";
                    const failed = status === "error" || status === "failed";
                    toaster.create({
                        type: failed ? "error" : "success",
                        title: failed ? `${name} — run failed` : `${name} — run finished`,
                        description: failed ? "Open the run for the cause, or check Settings → keys." : undefined,
                        action: { label: "Open", onClick: () => navigate(`/analysis-result/${encodeURIComponent(id)}`) },
                    });
                }
            } catch {
                // Transient — the next tick retries.
            }
        };

        void tick();
        const timer = setInterval(() => void tick(), 10_000);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [location.pathname, navigate]);

    return null;
}

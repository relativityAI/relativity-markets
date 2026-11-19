import { useEffect, useRef, useState } from "react";
import { API_BASE } from "@/db";
import { supabase } from "@/lib/supabase";
import type { TraceEvent } from "@/pages/shared/TracePanel";

/**
 * Live SSE trace stream with automatic reconnect — the one implementation
 * shared by the activity feed and the trace panel (both used to carry their
 * own copy, and neither reconnected after a drop, so the UI sat on
 * "Warming up…" forever).
 *
 * Frames are blank-line separated `data:` lines; a `trace` payload is handed
 * to `onEvent`. Any stream end — clean close, proxy timeout, network error —
 * retries with exponential backoff (1s → 30s cap).
 *
 * ponytail: gives up after 6 consecutive reconnect cycles that deliver no
 * data (~1 min of backoff), so a finished run doesn't poll forever; reset the
 * `misses` ceiling in `schedule()` if a caller ever knows the run is live and
 * wants endless retries.
 */
export function useSseTrace(url: string | undefined, onEvent: (ev: TraceEvent) => void): boolean {
    const [connected, setConnected] = useState(false);
    const cbRef = useRef(onEvent);
    cbRef.current = onEvent;

    useEffect(() => {
        if (!url) return;
        let cancelled = false;
        let attempt = 0;
        /** Reconnect cycles with no data since the last frame. */
        let misses = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let controller = new AbortController();

        const schedule = () => {
            if (cancelled || misses >= 6) return;
            timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
        };

        const connect = async () => {
            if (cancelled) return;
            controller = new AbortController();
            try {
                const { data } = await supabase.auth.getSession();
                const token = data.session?.access_token;
                const res = await fetch(`${API_BASE}${url}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                    signal: controller.signal,
                });
                if (!res.ok || !res.body) {
                    setConnected(false);
                    misses += 1;
                    schedule();
                    return;
                }
                setConnected(true);
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const frames = buffer.split("\n\n");
                    buffer = frames.pop() || "";
                    for (const frame of frames) {
                        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
                        if (!dataLine) continue;
                        try {
                            const payload = JSON.parse(dataLine.slice(5).trim());
                            if (payload?.type === "trace" && payload.event) {
                                // Progress resets the backoff and the miss ceiling.
                                misses = 0;
                                attempt = 0;
                                cbRef.current(payload.event);
                            }
                            if (payload?.type === "ready") setConnected(true);
                        } catch {
                            // ignore malformed frames
                        }
                    }
                }
                if (!cancelled) {
                    setConnected(false);
                    misses += 1;
                    schedule();
                }
            } catch {
                if (!cancelled) {
                    setConnected(false);
                    misses += 1;
                    schedule();
                }
            }
        };

        void connect();
        return () => {
            cancelled = true;
            clearTimeout(timer);
            controller.abort();
            setConnected(false);
        };
    }, [url]);

    return connected;
}

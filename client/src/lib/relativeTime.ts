/** Smart relative label for a schedule instant: "in 45m" / "in 3h" / "in 2d"
 *  ahead, "45m ago" behind, "now" inside the minute. Floor-based, so a label
 *  never claims more time than is left. */
export function timeUntil(iso: number | string, now: number = Date.now()): string {
    const t = typeof iso === "number" ? iso : new Date(iso).getTime();
    if (!Number.isFinite(t)) return "";
    const diff = t - now;
    const mins = Math.floor(Math.abs(diff) / 60000);
    const body =
        mins < 1
            ? ""
            : mins < 60
              ? `${mins}m`
              : mins < 1440
                ? `${Math.floor(mins / 60)}h`
                : `${Math.floor(mins / 1440)}d`;
    if (!body) return "now";
    return diff > 0 ? `in ${body}` : `${body} ago`;
}

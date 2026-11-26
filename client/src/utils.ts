export function formatSeconds(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function hasRequiredKeys(settings: { llm_keys?: Record<string, string> }): { hasLlm: boolean } {
    const keys = settings.llm_keys || {};
    // Any stored value counts — the server never surfaces legacy orphans.
    const hasLlm = Object.values(keys).some(Boolean);
    return { hasLlm };
}

export function agentDisplayName(raw: string | undefined, agents: any[]): string {
    if (!raw) return "";
    const hit = agents.find((a) => a.name === raw || a._id === raw || a.id === raw);
    return hit?.name || raw;
}

export function formatSeconds(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
}

export function hasRequiredKeys(settings: { llm_keys?: Record<string, string> }): { hasLlm: boolean; hasTavily: boolean } {
    const keys = settings.llm_keys || {};
    const hasTavily = !!keys.tavily;
    const hasLlm = Object.entries(keys).some(([k, v]) => k !== "tavily" && !!v);
    return { hasLlm, hasTavily };
}

export function agentDisplayName(raw: string | undefined, agents: any[]): string {
    if (!raw) return "";
    const hit = agents.find((a) => a.name === raw || a._id === raw || a.id === raw);
    return hit?.name || raw;
}

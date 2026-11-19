import axios from "axios";
import { supabase, SUPABASE_AUTH } from "@/lib/supabase";
import type { ReportDocument } from "@/lib/reportContract";

export const API_BASE = import.meta.env.VITE_RELATIVITY_API || "/api";

// Attach the Supabase auth token only in cloud mode — keys are stored server-side.
axios.interceptors.request.use(async (config) => {
    if (!SUPABASE_AUTH) return config; // local mode: server treats the request as the default user
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

/** An alert rule (alert_rules table): the agent checks one symbol on this
 *  cadence and its verdict becomes an alert. `time` is wall clock in
 *  `timezone`; `frequency` picks daily / weekly / biweekly / monthly;
 *  `start_date` ("YYYY-MM-DD") anchors the recurrence. */
export interface AlertRuleRow {
    enabled: number;
    last_run_id: string | null;
    id: string;
    symbol: string;
    share_name: string;
    source: string;
    agent_id: string | null;
    model: string | null;
    system_prompt: string | null;
    skill_ids: string[] | null;
    max_steps: number | null;
    max_tokens: number | null;
    time: string;
    timezone: string;
    frequency: string;
    start_date: string | null;
    last_fired_date: string | null;
    created_at: string;
}

/** A named watchlist and its watched symbols (persisted in SQLite). */
export interface WatchlistItem {
    symbol: string;
    source?: string;
    name?: string;
}

export interface WatchlistRow {
    id: string;
    user_id: string;
    name: string;
    items: WatchlistItem[];
    created_at: string;
    updated_at: string;
}

/** The local API restarts under `tsx watch`; a write in that window should
 *  retry briefly instead of reporting a lost change. */
async function retryWatchlistWrite<T>(write: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await write();
        } catch (e: any) {
            const status = e?.response?.status;
            const retryable = !status || status >= 500 || status === 429;
            if (!retryable || attempt >= 2) throw e;
            await new Promise((resolve) => setTimeout(resolve, 600));
        }
    }
}

/** Watchlists — persisted per user, CRUD via /watchlists. */
export const WatchlistService = {
    async list(): Promise<WatchlistRow[]> {
        const response = await axios.get(`${API_BASE}/watchlists`);
        return response.data as WatchlistRow[];
    },

    async create(name: string, items: WatchlistItem[] = []): Promise<WatchlistRow> {
        return retryWatchlistWrite(async () => {
            const response = await axios.post(`${API_BASE}/watchlists`, { name, items });
            return response.data as WatchlistRow;
        });
    },

    async update(id: string, patch: { name?: string; items?: WatchlistItem[] }): Promise<WatchlistRow> {
        return retryWatchlistWrite(async () => {
            const response = await axios.put(`${API_BASE}/watchlists/${encodeURIComponent(id)}`, patch);
            return response.data as WatchlistRow;
        });
    },

    async delete(id: string): Promise<void> {
        await retryWatchlistWrite(async () => {
            await axios.delete(`${API_BASE}/watchlists/${encodeURIComponent(id)}`);
        });
    },
};

/**
 * Global Agent Service - delegates to the backend API
 */
export const AgentService = {
    async listAgents() {
        const response = await axios.get(`${API_BASE}/agents`);
        return response.data;
    },

    /** File-defined default agents (services/harness/agents/defaults/*.md). */
    async listDefaultAgents() {
        const response = await axios.get(`${API_BASE}/agents/defaults`);
        return response.data;
    },

    /** Agent class/category list (services/config/categories.yaml). */
    async listCategories() {
        const response = await axios.get(`${API_BASE}/agents/categories`);
        return response.data;
    },

    async readAgent(id: string) {
        const response = await axios.get(`${API_BASE}/agents/${encodeURIComponent(id)}`);
        return response.data;
    },

    async createAgent(payload?: string | Record<string, unknown>) {
        const body = typeof payload === "string" ? { name: payload } : payload || {};
        const response = await axios.post(`${API_BASE}/agents`, body);
        return response.data;
    },

    async updateAgent(agent: any) {
        const id = agent?._id ?? agent?.id;
        if (!id) throw new Error("Agent id required for update");
        const { id: _id, _id: _id2, ...payload } = agent;
        const response = await axios.put(`${API_BASE}/agents/${encodeURIComponent(id)}`, payload);
        return response.data;
    },

    async deleteAgent(id: string) {
        const response = await axios.delete(`${API_BASE}/agents/${encodeURIComponent(id)}`);
        return response.data;
    },

    async searchAgents(query: string) {
        const response = await axios.get(`${API_BASE}/agents/search`, {
            params: { query }
        });
        return response.data;
    },

    async validateMd(md: string): Promise<{ valid: boolean; parsed?: any; issues: { line: number; message: string; severity: "warn" | "error" }[]; fixed?: string | null }> {
        const response = await axios.post(`${API_BASE}/agents/validate-md`, { md });
        return response.data;
    },

    async getRubric(id: string) {
        const response = await axios.get(`${API_BASE}/agents/${encodeURIComponent(id)}/rubric`);
        return response.data;
    },

    async compileRubric(id: string) {
        const response = await axios.post(`${API_BASE}/agents/${encodeURIComponent(id)}/rubric/compile`);
        return response.data;
    },

    async approveRubric(id: string, rubricId: string) {
        const response = await axios.post(`${API_BASE}/agents/${encodeURIComponent(id)}/rubric/${encodeURIComponent(rubricId)}/approve`);
        return response.data;
    },
};

export const AnalysisService = {
    async listAnalyses() {
        const response = await axios.get(`${API_BASE}/analysis`);
        return response.data;
    },

    async readAnalysis(id: string) {
        const response = await axios.get(`${API_BASE}/analysis/${encodeURIComponent(id)}`);
        return response.data;
    },

    /** Auth is a Bearer token, so a plain <a href> cannot download — fetch as a blob. */
    async downloadArtifact(analysisId: string, artifactId: string): Promise<Blob> {
        const response = await axios.get(
            `${API_BASE}/analysis/${encodeURIComponent(analysisId)}/artifact/${encodeURIComponent(artifactId)}`,
            { responseType: "blob" },
        );
        return response.data as Blob;
    },

    async createAnalysis() {
        return { id: null };
    },

    async deleteAnalysis(id: string) {
        const response = await axios.delete(`${API_BASE}/analysis/${encodeURIComponent(id)}`);
        return response.data;
    },

    /** Run a harness agent against a symbol; resolves with the typed ReportDocument. */
    async runAnalysis(config: {
        symbol: string;
        agent_id?: string;
        model?: string;
        source?: string;
        share_name?: string;
        skills?: string[];
        max_steps?: number;
        max_tokens?: number;
        /** Named system prompt (agent.yaml prompts.<name>); omitted = default. */
        system_prompt?: string;
    }) {
        const response = await axios.post(`${API_BASE}/analysis`, config);
        return response.data as {
            id: string;
            status: string;
            document: ReportDocument;
            errors?: string[];
        };
    },

    /** Create an alert rule: run config + frequency + anchor date +
     *  wall-clock time in an IANA timezone. */
    async createAlertRule(config: {
        symbol: string;
        share_name?: string;
        source?: string;
        agent_id?: string;
        model?: string;
        system_prompt?: string;
        max_steps?: number;
        max_tokens?: number;
        frequency?: string;
        start_date?: string;
        time: string;
        timezone: string;
    }) {
        const response = await axios.post(`${API_BASE}/alert-rules`, config);
        return response.data as AlertRuleRow;
    },

    async listAlertRules() {
        const response = await axios.get(`${API_BASE}/alert-rules`);
        return response.data as AlertRuleRow[];
    },

    async setAlertRuleEnabled(id: string, enabled: boolean) {
        const response = await axios.patch(`${API_BASE}/alert-rules/${encodeURIComponent(id)}`, { enabled });
        return response.data as { ok: boolean; enabled: boolean };
    },

    async deleteAlertRule(id: string) {
        const response = await axios.delete(`${API_BASE}/alert-rules/${encodeURIComponent(id)}`);
        return response.data;
    },

    async getAvailableSources() {
        const response = await axios.get(`${API_BASE}/sources`);
        return response.data;
    },

    async getAvailableModels() {
        const response = await axios.get(`${API_BASE}/models`);
        return response.data;
    },

    async validateModel(modelId: string): Promise<{ valid: boolean; error?: string }> {
        const response = await axios.post(`${API_BASE}/models/validate`, { model_id: modelId });
        return response.data;
    },

    async getDefaultModel(): Promise<{ model_id: string }> {
        const response = await axios.get(`${API_BASE}/models/default`);
        return response.data;
    }
};

/**
 * Skill library — built-ins plus the user's own custom skills.
 * A SkillSummary is the list payload (no markdown); readSkill returns the
 * full document for editors. Mirrors the API's SkillDefinition.
 */
export interface SkillSummary {
    id: string;
    name: string;
    description: string;
    category: string;
    version: number;
    source: "builtin" | "custom";
    /** Full-definition fields the list payload carries (API SkillDefinition). */
    purpose?: string;
    anchors?: { label: string; weight?: number }[];
    /** User labels from frontmatter metadata.tags — search + display. */
    tags?: string[];
    /** ISO created-at from the skill file's birthtime. */
    created_at?: string;
}

export const SkillService = {
    async listSkills(): Promise<SkillSummary[]> {
        const response = await axios.get(`${API_BASE}/skills`);
        return response.data;
    },

    async readSkill(id: string): Promise<SkillSummary & { markdown: string; files?: Record<string, string> }> {
        const response = await axios.get(`${API_BASE}/skills/${encodeURIComponent(id)}`);
        return response.data;
    },

    async validateMarkdown(markdown: string, fallbackName?: string): Promise<{ valid: boolean; issues: { line: number; message: string; severity: string }[]; fixed?: string | null }> {
        const response = await axios.post(`${API_BASE}/skills/validate`, { markdown, fallbackName });
        return response.data;
    },

    async saveSkill(markdown: string, files?: Record<string, string>): Promise<{ skill: SkillSummary; issues: { line: number; message: string; severity: string }[] }> {
        const response = await axios.post(`${API_BASE}/skills`, files ? { markdown, files } : { markdown });
        return response.data;
    },

    async updateSkill(id: string, markdown: string, files?: Record<string, string>): Promise<{ skill: SkillSummary; issues: { line: number; message: string; severity: string }[] }> {
        const response = await axios.put(`${API_BASE}/skills/${encodeURIComponent(id)}`, files ? { markdown, files } : { markdown });
        return response.data;
    },

    async deleteSkill(id: string): Promise<{ deleted: boolean }> {
        const response = await axios.delete(`${API_BASE}/skills/${encodeURIComponent(id)}`);
        return response.data;
    },

    async draftSkill(params: {
        messages: { role: string; content: string }[];
        requirements: string;
        current_draft: string;
        web_search?: boolean;
        model_id?: string;
    }): Promise<{ message: string; valid?: boolean; skill_markdown?: string; issues?: { line: number; message: string; severity: string }[]; search_results?: { query: string; title: string; url: string }[] }> {
        const response = await axios.post(`${API_BASE}/skills/draft`, params);
        return response.data;
    }
};

/** A GitHub repository configured as a skill source (services/config/skill-repos.json). */
export interface SkillRepo {
    id: string;
    label: string;
    owner: string;
    repo: string;
    branch?: string;
    pathPrefix?: string;
}

/** One downloadable SKILL.md in a configured repo. */
export interface RepoSkill {
    id: string;
    name: string;
    description: string;
    path: string;
    html_url: string;
}

export const SkillRepoService = {
    async listRepos(): Promise<SkillRepo[]> {
        const response = await axios.get(`${API_BASE}/skills/repos`);
        return response.data;
    },

    async listRepoSkills(repoId: string): Promise<RepoSkill[]> {
        const response = await axios.get(`${API_BASE}/skills/repos/${encodeURIComponent(repoId)}/skills`);
        return response.data;
    },

    async importSkill(repoId: string, path: string): Promise<{ skill: SkillSummary; issues?: { line: number; message: string; severity: string }[]; repaired?: boolean }> {
        const response = await axios.post(`${API_BASE}/skills/repos/${encodeURIComponent(repoId)}/import`, { path });
        return response.data;
    },
};

export const ToolService = {
    async getCatalog(): Promise<{ name: string; description: string }[]> {
        const response = await axios.get(`${API_BASE}/tool-catalog`);
        return response.data;
    }
};

/**
 * Providers offered as server-side free-tier keys / pools. With no user keys,
 * these are the models worth showing; everything else needs a user key first.
 */
const SERVER_FREE_PROVIDERS = new Set(["groq", "gemini", "cerebras", "openrouter", "mistral", "nvidia", "cohere", "zai"]);

export function isServerFreeModel(modelId: string): boolean {
    return SERVER_FREE_PROVIDERS.has(String(modelId).split("/")[0]);
}

export const VoyagerService = {
    async getAvailableMetrics(source: string) {
        const response = await axios.get(`${API_BASE}/metrics/fields?source=${encodeURIComponent(source)}`);
        return response.data;
    },

    async draftParameters(payload: { persona: string; section: string }): Promise<{ parameters: { parameter: string; content: string; weightage: number }[] }> {
        const response = await axios.post(`${API_BASE}/agents/draft-parameters`, payload);
        return response.data;
    }
};

export const SettingsService = {
    async getSettings() {
        const response = await axios.get(`${API_BASE}/user/settings`);
        return response.data as { llm_keys: Record<string, string>; prefs: Record<string, string> };
    },

    async updateSettings(payload: { llm_keys?: Record<string, string> | null; prefs?: Record<string, string> }) {
        const response = await axios.put(`${API_BASE}/user/settings`, payload);
        return response.data;
    },

    async deleteLLMKey(keyName: string) {
        const response = await axios.delete(`${API_BASE}/user/settings/llm-key/${encodeURIComponent(keyName)}`);
        return response.data;
    }
};

export const BuilderService = {
    async getSchema() {
        const response = await axios.get(`${API_BASE}/agent-schema`);
        return response.data;
    },

    async getPresets() {
        const response = await axios.get(`${API_BASE}/builder/presets`);
        return response.data;
    },

    async getPreset(key: string) {
        const response = await axios.get(`${API_BASE}/builder/preset/${encodeURIComponent(key)}`);
        return response.data;
    },

    async draft(params: {
        session_id: string;
        messages: { role: string; content: string }[];
        agent_draft: Record<string, unknown>;
        metrics: { id: string; name: string; type: string }[];
        document_texts: { filename: string; text: string }[];
        user_response?: string;
        model_id?: string;
    }) {
        const response = await axios.post(`${API_BASE}/builder/draft`, params);
        return response.data as {
            message: string;
            options?: { id: string; label: string; description?: string }[];
            agent_draft_update?: Record<string, unknown>;
            sources?: string[];
            search_results?: { query: string; title: string; url: string }[];
            annotations?: { what: string; basis: string }[];
        };
    },

    async uploadDocuments(files: File[]) {
        const form = new FormData();
        files.forEach((f) => form.append("files", f));
        const response = await axios.post(`${API_BASE}/builder/upload`, form, {
            headers: { "Content-Type": "multipart/form-data" },
        });
        return response.data as {
            documents: { filename: string; mime_type: string; text: string; char_count: number }[];
        };
    },

    async extractSignals(documents: { filename: string; text: string }[]) {
        const response = await axios.post(`${API_BASE}/builder/extract-signals`, { documents });
        return response.data as {
            style: string;
            philosophy: string;
            horizon: string;
            risk: number;
            qualitative_params: { parameter: string; content: string; weightage: number }[];
            quantitative_rules: { metric: string; metric_name: string; metric_type: string; operator: string; value: number; weightage: number }[];
        };
    },
};

/** Fired verdicts — the navbar bell and homepage feed off these. */
export interface AlertRow {
    id: string;
    rule_id: string;
    run_id: string | null;
    symbol: string;
    share_name: string;
    agent_name: string | null;
    verdict: string;
    created_at: string;
    read_at: string | null;
}

export const AlertService = {
    async listAlerts() {
        const response = await axios.get(`${API_BASE}/alerts`);
        return response.data as AlertRow[];
    },

    async markRead(id: string) {
        const response = await axios.post(`${API_BASE}/alerts/${encodeURIComponent(id)}/read`);
        return response.data;
    },

    async markAllRead() {
        const response = await axios.post(`${API_BASE}/alerts/read-all`);
        return response.data;
    },
};

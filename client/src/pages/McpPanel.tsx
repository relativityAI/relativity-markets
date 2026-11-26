import { useState, useEffect, useCallback } from "react";
import { Box } from "@/compat/ui";
import { Check, X, Trash2, Plus, Pencil, Wrench, ChevronRight, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button as UIButton } from "@/components/ui/button";
import { toaster } from "@/components/ui/toaster";
import { PluginService, SettingsService, type McpSource } from "@/db";
import { mcpServerState, MCP_STATE_DOT, MCP_STATE_LABEL, MCP_LOGOS } from "@/lib/mcp";
import { useColorMode } from "@/components/ui/color-mode";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";

/** One entry of prefs.mcp_servers: a preconfigured server's on/off state,
 *  or a user-added remote server (custom + url + optional key name). */
interface McpPref {
    name: string;
    url?: string;
    enabled?: boolean;
    custom?: boolean;
    keyName?: string;
}

function parseMcpPrefs(prefs: Record<string, string>): McpPref[] {
    try {
        const list = JSON.parse(prefs.mcp_servers || "[]");
        return Array.isArray(list) ? list.filter((e) => e && typeof e.name === "string" && e.name) : [];
    } catch {
        return [];
    }
}

/**
 * Add/edit a remote MCP server - the custom-connector form: name, url and
 * an optional API key (sent as the standard static `Authorization: Bearer`
 * credential), validated the way custom providers are (http(s), unique, no
 * shadowing a preconfigured server).
 */
function McpServerDialog({
    open, onOpenChange, initial, existing, onSave, onDelete,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Server being edited, or null to add one. */
    initial: McpSource | null;
    existing: string[];
    onSave: (name: string, url: string, key: string) => Promise<void>;
    onDelete: (name: string) => Promise<void>;
}) {
    const [name, setName] = useState(initial?.name || "");
    const [url, setUrl] = useState(initial?.url || "");
    const [apiKey, setApiKey] = useState("");
    const [busy, setBusy] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

    const reset = () => {
        setName(initial?.name || "");
        setUrl(initial?.url || "");
        setApiKey("");
        setConfirmDelete(false);
        setTestResult(null);
    };
    const close = () => {
        reset();
        onOpenChange(false);
    };
    const fail = (title: string) => toaster.create({ title, type: "error" });

    const handleSave = async () => {
        const id = name.trim();
        const target = url.trim();
        if (!id) return fail("Give the server a name");
        if (/\s/.test(id)) return fail("The name can't contain spaces");
        if (existing.includes(id) && id !== initial?.name) return fail(`"${id}" is already in use`);
        let parsed: URL;
        try {
            parsed = new URL(target);
        } catch {
            return fail("URL must be a full URL, e.g. https://example.com/mcp");
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("URL must be http:// or https://");
        setBusy(true);
        try {
            await onSave(id, target, apiKey.trim());
            close();
        } finally {
            setBusy(false);
        }
    };

    /** One fresh probe of the url being saved — same validation, honest result. */
    const runTest = async () => {
        const target = url.trim();
        try {
            const parsed = new URL(target);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("URL must be http:// or https://");
        } catch {
            return fail("URL must be a full URL, e.g. https://example.com/mcp");
        }
        setTestResult(null);
        setBusy(true);
        try {
            const r = await PluginService.testMcpSource(target, apiKey.trim() || undefined);
            setTestResult(
                r.status === "up"
                    ? { ok: true, msg: `Connected — ${r.tools.length} tool${r.tools.length === 1 ? "" : "s"}` }
                    : { ok: false, msg: r.error || "Connection failed" },
            );
        } catch (e) {
            const err = e as { response?: { data?: { error?: string } }; message?: string };
            setTestResult({ ok: false, msg: err?.response?.data?.error || err?.message || "Connection failed" });
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async () => {
        if (!initial) return;
        setBusy(true);
        try {
            await onDelete(initial.name);
            close();
        } finally {
            setBusy(false);
        }
    };

    const field = "h-9 w-full rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2.5 text-[13.5px] text-[var(--ink-primary)] shadow-none placeholder:text-[var(--ink-tertiary)] focus-visible:ring-1 focus-visible:ring-console-accent/40";
    const legend = "font-app-body text-[11px] font-light tracking-[0.08em] text-console-ink-3 uppercase";

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
            <DialogContent showCloseButton={false} className="sm:max-w-xl">
                <DialogTitle className="flex items-center gap-2.5 font-app-body text-[14px] font-light text-console-ink">
                    <span className="truncate">{initial ? initial.name : "Add custom connector"}</span>
                    <span className="ml-auto text-[11px] font-light text-console-ink-3">
                        {initial ? "Edit server" : "Remote MCP"}
                    </span>
                </DialogTitle>

                {confirmDelete ? (
                    <div className="flex flex-col gap-2 rounded-[6px] border-[0.5px] border-[color:color-mix(in_srgb,var(--signal-negative)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--signal-negative)_6%,transparent)] p-3">
                        <p className="text-[12.5px] text-console-ink">
                            Remove {initial?.name}? Runs lose its tools immediately.
                        </p>
                        <div className="flex gap-2">
                            <UIButton size="sm" variant="destructive" onClick={handleDelete} disabled={busy}>
                                {busy ? "Removing..." : <><Trash2 size={14} /> Confirm remove</>}
                            </UIButton>
                            <UIButton size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                                <X size={14} /> Cancel
                            </UIButton>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <p className="text-[12.5px] leading-relaxed text-[var(--ink-tertiary)]">
                            Connect the agent to your data and tools. Only add connectors from developers you trust.
                        </p>

                        <div className="flex flex-col gap-1.5">
                            <label className={legend} htmlFor="mcp-name">Name</label>
                            <input
                                id="mcp-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="my-notes"
                                autoFocus
                                className={field}
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className={legend} htmlFor="mcp-url">Remote MCP server URL</label>
                            <input
                                id="mcp-url"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="https://example.com/mcp"
                                className={field}
                            />
                            <span className="text-[11.5px] text-console-ink-4">
                                Streamable HTTP endpoint - http:// or https://.
                            </span>
                            <div className="flex items-center gap-2">
                                <UIButton size="sm" variant="ghost" onClick={runTest} disabled={busy || !url.trim()}>
                                    Test connection
                                </UIButton>
                            </div>
                            {/* Own line, wraps anywhere: a nowrap result would
                                inflate the dialog's intrinsic width and spill
                                out of it (min-w-0 can't help — width here is
                                content-derived, not definite). */}
                            {testResult && (
                                <p
                                    className="text-[11.5px] [overflow-wrap:anywhere]"
                                    style={{ color: testResult.ok ? "var(--signal-positive)" : "var(--signal-negative)" }}
                                    role={testResult.ok ? undefined : "alert"}
                                >
                                    {testResult.msg}
                                </p>
                            )}
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className={legend} htmlFor="mcp-key">API key (optional)</label>
                            <input
                                id="mcp-key"
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder={initial?.hasKey ? "Key saved — type to replace" : "Bearer token, if the server needs one"}
                                autoComplete="off"
                                className={field}
                            />
                            <span className="text-[11.5px] text-console-ink-4">
                                Sent as Authorization: Bearer — leave blank for open servers.
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            <UIButton size="sm" onClick={handleSave} disabled={busy}>
                                {busy ? "Saving..." : <><Check size={14} /> {initial ? "Save server" : "Add server"}</>}
                            </UIButton>
                            <UIButton size="sm" variant="ghost" onClick={close} disabled={busy}>
                                Cancel
                            </UIButton>
                            {initial && (
                                <UIButton
                                    size="sm"
                                    variant="ghost"
                                    className="ml-auto text-console-ink-3 hover:text-[var(--signal-negative)]"
                                    onClick={() => setConfirmDelete(true)}
                                    disabled={busy}
                                >
                                    <Trash2 size={14} /> Remove
                                </UIButton>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

/**
 * The MCP section: every server the agent can reach - the preconfigured ones
 * (harness config) plus the user's own - with an on/off switch, the tools it
 * exposes and its endpoint. Only deltas go into prefs.mcp_servers; the server
 * re-merges them with the config on every read.
 */
export function McpPanel({ prefs, savePrefs }: {
    prefs: Record<string, string>;
    savePrefs: (patch: Record<string, string>) => Promise<void>;
}) {
    const [servers, setServers] = useState<McpSource[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [query, setQuery] = useState("");
    const [dlg, setDlg] = useState<{ open: boolean; initial: McpSource | null }>({ open: false, initial: null });
    /** Tool lists start collapsed — a 15-tool server would drown the card. */
    const [openTools, setOpenTools] = useState<Record<string, boolean>>({});
    /** Per-server key drafts (blank = nothing typed). */
    const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
    const { colorMode } = useColorMode();

    const load = useCallback((refresh = false) => {
        PluginService.mcpSources(refresh)
            .then((c) => {
                setServers(c.servers);
                setFailed(false);
            })
            .catch(() => {
                setServers((prev) => prev ?? []);
                setFailed(true);
            });
    }, []);

    useEffect(() => {
        load();
    }, [prefs.mcp_servers, load]);

    const write = async (list: McpPref[]) => {
        try {
            await savePrefs({ mcp_servers: JSON.stringify(list) });
        } catch {
            // savePrefs already toasted; without a prefs change no refetch
            // runs, so the shown list stays the last good server response.
        }
    };

    const toggle = async (s: McpSource) => {
        const list = parseMcpPrefs(prefs);
        const i = list.findIndex((e) => e.name === s.name);
        const enabled = !s.enabled;
        await write(
            i >= 0
                ? list.map((e, j) => (j === i ? { ...e, enabled } : e))
                : [...list, { name: s.name, enabled }],
        );
    };

    /** Store/remove a server's API key in llm_keys (encrypted at rest),
     *  then re-probe with a cache bust — the new key changes the status. */
    const persistKey = async (keyName: string, key: string | null) => {
        try {
            if (key) await SettingsService.updateSettings({ llm_keys: { [keyName]: key } });
            else await SettingsService.deleteLLMKey(keyName);
            load(true);
        } catch {
            toaster.create({ title: key ? "Key not saved" : "Key not removed", type: "error" });
        }
    };

    const removeKey = async (s: McpSource) => {
        if (!s.keyName) return;
        await persistKey(s.keyName, null);
    };

    const saveCustom = async (initial: McpSource | null, name: string, url: string, key: string) => {
        const before = parseMcpPrefs(prefs);
        const kept = initial ? before.filter((e) => e.name !== initial.name) : before;
        const was = before.find((e) => e.name === name);
        // keyName is minted once and survives renames — llm_keys hold the secret.
        const keyName = was?.keyName ?? initial?.keyName ?? `mcpkey_${name}`;
        kept.push({ name, url, custom: true, enabled: was?.enabled ?? initial?.enabled ?? true, keyName });
        await write(kept);
        if (key) await persistKey(keyName, key);
    };

    const removeCustom = async (name: string) => {
        await write(parseMcpPrefs(prefs).filter((e) => e.name !== name));
    };

    const q = query.trim().toLowerCase();
    const visible = (servers ?? []).filter(
        (s) =>
            !q ||
            s.name.toLowerCase().includes(q) ||
            s.label.toLowerCase().includes(q) ||
            s.tools.some((t) => t.includes(q)),
    );

    return (
        <Box
            as={motion.div}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.base, ease }}
            className="py-5 md:py-6"
        >
            {/* Card header - identical geometry to the AI Providers button */}
            <div className="flex items-start justify-between gap-x-4">
                <div className="min-w-0 flex-1">
                    <h2 className="font-app-body text-[26px] leading-[1.1] font-light tracking-[-0.02em] text-[var(--ink-primary)] md:text-[30px]">
                        MCP Servers
                    </h2>
                </div>
                <button
                    type="button"
                    onClick={() => setDlg({ open: true, initial: null })}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] bg-[var(--surface-inverse)] px-4 font-app-body text-[13.5px] font-light text-[var(--ink-inverse-primary)] transition-opacity hover:opacity-90"
                >
                    <Plus size={15} /> Add MCP server
                </button>
            </div>

            {/* Toolbar - the same search field as the AI Providers table */}
            <div className="relative mt-4 mb-3">
                <Search
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--ink-tertiary)]"
                />
                <input
                    type="search"
                    placeholder="Search servers..."
                    aria-label="Search MCP servers"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="h-9 w-[230px] max-w-full rounded-[8px] border border-[var(--hairline)] bg-transparent pr-3 pl-8 text-[13.5px] text-[var(--ink-primary)] transition-colors placeholder:text-[var(--ink-tertiary)] focus:border-[var(--accent-primary)] focus:outline-none"
                />
            </div>

            {failed && (
                <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 bg-[var(--surface-recessed)] px-3 py-2.5">
                    <span className="font-app-body text-[13px] text-[var(--signal-negative)]">
                        Couldn't load MCP servers - the list below may be out of date.
                    </span>
                    <button
                        type="button"
                        onClick={() => load(true)}
                        className="font-app-body ml-auto cursor-pointer text-[13px] font-light text-[var(--ink-primary)] underline underline-offset-2"
                    >
                        Retry
                    </button>
                </div>
            )}

            {servers === null && !failed && (
                <p className="text-[13.5px] text-[var(--ink-tertiary)]">Loading...</p>
            )}
            {servers && visible.length === 0 && !failed && (
                <p className="text-[13.5px] text-[var(--ink-tertiary)]">
                    {servers.length === 0 ? "No MCP servers configured." : "No servers match."}
                </p>
            )}

            {visible.length > 0 && (
                <div className="flex flex-col gap-3">
                    {visible.map((s) => {
                        const state = mcpServerState(s);
                        return (
                        <div key={s.name} className="rounded-[8px] border border-[var(--hairline)] px-4 py-3.5">
                            <div className="flex items-center gap-2.5">
                                {MCP_LOGOS[s.name] ? (
                                    <img
                                        src={MCP_LOGOS[s.name]}
                                        alt=""
                                        aria-hidden="true"
                                        className={`size-5 shrink-0 object-contain${s.name === "tradingview" && colorMode === "dark" ? " invert" : ""}`}
                                    />
                                ) : (
                                    <span
                                        aria-hidden="true"
                                        className="flex size-5 shrink-0 items-center justify-center rounded-full border border-[var(--hairline)] font-app-body text-[10px] text-[var(--ink-tertiary)]"
                                    >
                                        {s.name.slice(0, 1).toUpperCase()}
                                    </span>
                                )}
                                <span
                                    aria-hidden
                                    className="size-2 shrink-0 rounded-full"
                                    style={{ background: MCP_STATE_DOT[state] }}
                                />
                                <span className="truncate font-app-body text-[14.5px] font-light text-[var(--ink-primary)]">
                                    {s.name}
                                </span>
                                <span className="shrink-0 rounded-full border border-[var(--hairline)] px-1.5 py-px font-app-body text-[10px] leading-[1.4] text-[var(--ink-tertiary)]">
                                    {s.custom ? "Custom" : "Preconfigured"}
                                </span>
                                <span className="shrink-0 font-app-body text-[11px] font-light" style={{ color: MCP_STATE_DOT[state] }}>
                                    {MCP_STATE_LABEL[state]}
                                </span>

                                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                                    {state === "down" && (
                                        <button
                                            type="button"
                                            onClick={() => load(true)}
                                            className="rounded-[6px] px-2 py-1 font-app-body text-[12.5px] text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-recessed)] hover:text-[var(--ink-primary)]"
                                        >
                                            Retry
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={s.enabled}
                                        aria-label={`${s.enabled ? "Disable" : "Enable"} ${s.name}`}
                                        onClick={() => toggle(s)}
                                        className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 font-app-body text-[12.5px] transition-colors hover:bg-[var(--surface-recessed)]"
                                        // Icon + state color only: the words live in
                                        // the state label, so a not-connected server
                                        // never claims "Enabled" next to "Needs key".
                                        style={{ color: MCP_STATE_DOT[state] }}
                                    >
                                        {s.enabled ? <Check size={13} /> : <X size={13} />}
                                    </button>
                                    {s.custom && (
                                        <>
                                            <button
                                                type="button"
                                                aria-label={`Edit ${s.name}`}
                                                onClick={() => setDlg({ open: true, initial: s })}
                                                className="rounded-[6px] p-1.5 text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--ink-primary)]"
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={`Remove ${s.name}`}
                                                onClick={() => removeCustom(s.name)}
                                                className="rounded-[6px] p-1.5 text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--signal-negative)]"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {s.tools.length > 0 && (
                                <div className="mt-3">
                                    <button
                                        type="button"
                                        aria-expanded={!!openTools[s.name]}
                                        onClick={() => setOpenTools((v) => ({ ...v, [s.name]: !v[s.name] }))}
                                        className="flex items-center gap-1.5 font-app-body text-[11px] tracking-[0.08em] text-[var(--ink-tertiary)] uppercase transition-colors hover:text-[var(--ink-primary)]"
                                    >
                                        <ChevronRight
                                            size={12}
                                            className={`transition-transform ${openTools[s.name] ? "rotate-90" : ""}`}
                                        />
                                        <Wrench size={12} /> Tools ({s.tools.length})
                                    </button>
                                    {openTools[s.name] && (
                                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                                            {s.tools.map((t) => (
                                                <span
                                                    key={t}
                                                    className="rounded-full border border-[var(--hairline)] px-2 py-0.5 font-app-mono text-[11px] text-[var(--ink-secondary)]"
                                                >
                                                    {t}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="mt-3 flex items-center gap-2 text-[11.5px] text-[var(--ink-tertiary)]">
                                <span className="shrink-0 tracking-[0.08em] uppercase">
                                    {s.custom ? "URL" : "Endpoint"}
                                </span>
                                <span className="truncate font-app-mono">
                                    {s.url || (s.urlEnv ? `$${s.urlEnv}` : "-")}
                                </span>
                            </div>

                            {s.keyName && (
                                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
                                    <span className="shrink-0 tracking-[0.08em] uppercase text-[var(--ink-tertiary)]">API key</span>
                                    <input
                                        type="password"
                                        aria-label={`API key for ${s.name}`}
                                        value={keyDrafts[s.name] ?? ""}
                                        onChange={(e) => setKeyDrafts((prev) => ({ ...prev, [s.name]: e.target.value }))}
                                        placeholder={s.hasKey ? "Saved — type to replace" : "Enter key"}
                                        autoComplete="off"
                                        className="h-7 w-[190px] min-w-0 rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2 text-[12.5px] text-[var(--ink-primary)] shadow-none placeholder:text-[var(--ink-tertiary)] focus-visible:ring-1 focus-visible:ring-console-accent/40"
                                    />
                                    <button
                                        type="button"
                                        disabled={!(keyDrafts[s.name] ?? "").trim()}
                                        onClick={async () => {
                                            const v = (keyDrafts[s.name] ?? "").trim();
                                            if (!v || !s.keyName) return;
                                            await persistKey(s.keyName, v);
                                            setKeyDrafts((prev) => {
                                                const next = { ...prev };
                                                delete next[s.name];
                                                return next;
                                            });
                                        }}
                                        className="rounded-[6px] px-2 py-1 font-app-body text-[12.5px] text-[var(--ink-primary)] transition-colors hover:bg-[var(--surface-recessed)] disabled:cursor-default disabled:text-[var(--ink-tertiary)] disabled:opacity-60"
                                    >
                                        Save
                                    </button>
                                    {s.hasKey && (
                                        <button
                                            type="button"
                                            onClick={() => removeKey(s)}
                                            className="rounded-[6px] px-2 py-1 font-app-body text-[12.5px] text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-recessed)] hover:text-[var(--signal-negative)]"
                                        >
                                            Remove
                                        </button>
                                    )}
                                </div>
                            )}

                            {s.error && state !== "active" && state !== "disabled" && (
                                <div className="mt-2 font-app-mono text-[11.5px] [overflow-wrap:anywhere]" style={{ color: MCP_STATE_DOT[state] }}>
                                    {s.error}
                                </div>
                            )}
                        </div>
                        );
                    })}
                </div>
            )}

            <McpServerDialog
                key={dlg.initial?.name ?? "new"}
                open={dlg.open}
                onOpenChange={(o) => setDlg((s) => ({ ...s, open: o }))}
                initial={dlg.initial}
                existing={(servers ?? []).map((s) => s.name)}
                onSave={(name, url, key) => saveCustom(dlg.initial, name, url, key)}
                onDelete={removeCustom}
            />
        </Box>
    );
}


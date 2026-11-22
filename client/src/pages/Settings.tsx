import { useState, useEffect } from "react";
import {
    Flex, Text, Box, VStack
} from "@/compat/ui";
import {
    Check, Eye, EyeOff, X, Trash2, Plus, Pencil, ExternalLink,
    Search, CircleArrowDown, SlidersHorizontal,
    ChevronsUpDown, ArrowUp, ArrowDown,
    ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button as UIButton } from "@/components/ui/button";
import { Input as UIInput } from "@/components/ui/input";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
    DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { toaster } from "@/components/ui/toaster";
import { SettingsService } from "@/db";
import { useAuth } from "@/auth/useAuth";
import UserAvatar from "@/components/shared/UserAvatar";
import { ModelLogo } from "@/lib/modelLogos";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";

// One card per provider. Every provider the backend can actually route a model
// to is listed here — model_id -> provider is a fixed map server-side, so a
// free-text "custom provider" would be stored but never used.
const MODEL_PROVIDERS = [
    { value: "openai", label: "OpenAI", url: "https://platform.openai.com/api-keys" },
    { value: "gemini", label: "Gemini", url: "https://aistudio.google.com/apikey" },
    { value: "cerebras", label: "Cerebras", url: "https://cloud.cerebras.ai" },
    { value: "groq", label: "Groq", url: "https://console.groq.com/keys" },
    { value: "openrouter", label: "OpenRouter", url: "https://openrouter.ai/keys" },
    { value: "anthropic", label: "Anthropic", url: "https://console.anthropic.com/settings/keys" },
    { value: "mistral", label: "Mistral", url: "https://console.mistral.ai/api-keys" },
    { value: "nvidia", label: "NVIDIA", url: "https://build.nvidia.com/settings/api-keys" },
    { value: "cohere", label: "Cohere", url: "https://dashboard.cohere.com/api-keys" },
    { value: "zai", label: "Z.ai", url: "https://z.ai/manage-apikey/apikey-list" },
    { value: "opencode", label: "OpenCode", url: "https://opencode.ai/auth" },
];

const providerLabel = (value: string) =>
    value === "tavily" ? "Tavily" : MODEL_PROVIDERS.find((p) => p.value === value)?.label || value;

function StatusPill({ connected }: { connected: boolean }) {
    return (
        <Flex
            align="center"
            gap={1.5}
            px={2}
            py={0.5}
            borderRadius="full"
            w="full"
            flexShrink={0}
            bg={connected ? "color-mix(in srgb, var(--signal-positive) 12%, transparent)" : "var(--surface-recessed)"}
        >
            <Box
                w="6px"
                h="6px"
                borderRadius="full"
                bg={connected ? "var(--signal-positive)" : "var(--ink-tertiary)"}
            />
            <Text fontSize="10.5px" color={connected ? "var(--signal-positive)" : "var(--ink-tertiary)"}>
                {connected ? "Connected" : "Not connected"}
            </Text>
        </Flex>
    );
}

interface ProviderCardProps {
    value: string;
    label: string;
    /** Where to get an API key for this provider — shown as a subtle icon link. */
    url?: string;
    savedKey?: string;
    onSave: (value: string, key: string) => Promise<void>;
    onRemove: (value: string) => Promise<void>;
}

/**
 * One provider row: logo + name + link, full-width status badge, Add/Edit.
 * Clicking opens the key editor as a popup — same shell as the agent editor.
 */
interface KeyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    value: string;
    label: string;
    connected: boolean;
    onSave: (value: string, key: string) => Promise<void>;
    onRemove: (value: string) => Promise<void>;
}

/**
 * Key editor popup — one component shared by the AI Providers table and the
 * Web Search row. Draft state lives here and is cleared on close, so opening
 * a different provider always starts clean.
 */
function KeyDialog({ open, onOpenChange, value, label, connected, onSave, onRemove }: KeyDialogProps) {
    const [draft, setDraft] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);

    // Clearing a half-typed draft happens on close rather than in an effect.
    const reset = () => {
        setDraft("");
        setShowKey(false);
        setConfirmRemove(false);
    };
    const close = () => {
        reset();
        onOpenChange(false);
    };

    const handleSave = async () => {
        if (!draft.trim()) {
            toaster.create({ title: "API key is empty", type: "error" });
            return;
        }
        setBusy(true);
        try {
            await onSave(value, draft.trim());
            close(); // collapse on success
        } finally {
            setBusy(false);
        }
    };

    const handleRemove = async () => {
        setBusy(true);
        try {
            await onRemove(value);
            close();
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
            <DialogContent showCloseButton={false} className="sm:max-w-xl">
                <DialogTitle className="flex items-center gap-2.5 font-app-body text-[14px] font-normal text-console-ink">
                    <ModelLogo model={value} size={22} />
                    <span className="truncate">{label}</span>
                    <span className="ml-auto text-[11px] font-medium text-console-ink-3">
                        {connected ? "Key stored" : "No key"}
                    </span>
                </DialogTitle>

                {confirmRemove ? (
                    <div className="flex flex-col gap-2 rounded-[6px] border-[0.5px] border-[color:color-mix(in_srgb,var(--signal-negative)_35%,transparent)] bg-[color-mix(in_srgb,var(--signal-negative)_6%,transparent)] p-3">
                        <p className="text-[12.5px] text-console-ink">
                            Remove the {label} key? Runs will stop using it immediately.
                        </p>
                        <div className="flex gap-2">
                            <UIButton size="sm" variant="destructive" onClick={handleRemove} disabled={busy}>
                                {busy ? "Removing…" : <><Trash2 size={14} /> Confirm remove</>}
                            </UIButton>
                            <UIButton size="sm" variant="ghost" onClick={() => setConfirmRemove(false)} disabled={busy}>
                                <X size={14} /> Cancel
                            </UIButton>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1.5">
                            <span className="font-app-body text-[11px] font-medium tracking-[0.08em] text-console-ink-3 uppercase">
                                API key
                            </span>
                            <div className="relative">
                                <UIInput
                                    type={showKey ? "text" : "password"}
                                    placeholder={connected ? `New ${label} key to replace the saved one` : `Paste your ${label} API key`}
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                                    autoFocus
                                    className="h-9 rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2.5 pr-9 text-sm shadow-none placeholder:text-console-ink-4 focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent"
                                />
                                <button
                                    type="button"
                                    aria-label={showKey ? "Hide key" : "Show key"}
                                    onClick={() => setShowKey((v) => !v)}
                                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-[4px] p-1 text-console-ink-3 hover:text-console-ink"
                                >
                                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                            </div>
                            <span className="text-[11.5px] text-console-ink-4">
                                Stored locally on this device.
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <UIButton size="sm" onClick={handleSave} disabled={busy || !draft.trim()}>
                                {busy ? "Saving…" : <><Check size={14} /> Save key</>}
                            </UIButton>
                            <UIButton size="sm" variant="ghost" onClick={close} disabled={busy}>
                                Cancel
                            </UIButton>
                            {connected && (
                                <UIButton
                                    size="sm"
                                    variant="ghost"
                                    className="ml-auto text-console-ink-3 hover:text-[var(--signal-negative)]"
                                    onClick={() => setConfirmRemove(true)}
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

/** A user-added OpenAI-compatible provider — mirrors the server's CustomProvider. */
interface CustomProvider {
    id: string;
    name: string;
    baseURL: string;
    models: string[];
}

/** Built-in ids a custom provider may not shadow, plus the web-search key. */
const RESERVED_IDS = new Set([...MODEL_PROVIDERS.map((p) => p.value), "tavily"]);

function parseCustoms(prefs: Record<string, string>): CustomProvider[] {
    try {
        const list = JSON.parse(prefs.custom_providers || "[]");
        return Array.isArray(list) ? list.filter((c) => c && c.id && c.baseURL) : [];
    } catch {
        return [];
    }
}

const slugify = (name: string) =>
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * Add or edit a custom OpenAI-compatible provider (Ollama, vLLM, LiteLLM, a
 * company gateway). Model IDs are typed rather than probed from /models: the
 * server would have to fetch a user-supplied URL, which is an SSRF hole for no
 * gain — anyone adding a local endpoint knows its model names.
 */
function CustomProviderDialog({
    open, onOpenChange, initial, existing, onSave, onDelete,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Provider being edited, or null to create one. */
    initial: CustomProvider | null;
    existing: CustomProvider[];
    onSave: (custom: CustomProvider, apiKey: string) => Promise<void>;
    onDelete: (custom: CustomProvider) => Promise<void>;
}) {
    const [name, setName] = useState(initial?.name || "");
    const [baseURL, setBaseURL] = useState(initial?.baseURL || "");
    const [apiKey, setApiKey] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [models, setModels] = useState(initial?.models.join("\n") || "");
    const [busy, setBusy] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const reset = () => {
        setName(initial?.name || "");
        setBaseURL(initial?.baseURL || "");
        setApiKey("");
        setShowKey(false);
        setModels(initial?.models.join("\n") || "");
        setConfirmDelete(false);
    };
    const close = () => {
        reset();
        onOpenChange(false);
    };
    const fail = (title: string) => toaster.create({ title, type: "error" });

    const handleSave = async () => {
        const id = initial?.id || slugify(name);
        if (!name.trim()) return fail("Give the provider a name");
        if (!id) return fail("Name needs at least one letter or digit");
        if (RESERVED_IDS.has(id) || existing.some((c) => c.id === id && c.id !== initial?.id)) {
            return fail(`"${id}" is already taken — pick another name`);
        }
        let url: URL;
        try {
            url = new URL(baseURL.trim());
        } catch {
            return fail("Base URL must be a full URL, e.g. http://localhost:11434/v1");
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return fail("Base URL must be http:// or https://");
        }
        const modelList = models.split(/[\n,]+/).map((m) => m.trim()).filter(Boolean);
        if (!modelList.length) return fail("Add at least one model ID");

        setBusy(true);
        try {
            await onSave({ id, name: name.trim(), baseURL: baseURL.trim(), models: modelList }, apiKey.trim());
            close();
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async () => {
        if (!initial) return;
        setBusy(true);
        try {
            await onDelete(initial);
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
                    <span className="truncate">{initial ? initial.name : "Add provider"}</span>
                    <span className="ml-auto text-[11px] font-light text-console-ink-3">
                        {initial ? "Custom provider" : "OpenAI-compatible"}
                    </span>
                </DialogTitle>

                {confirmDelete ? (
                    <div className="flex flex-col gap-2 rounded-[6px] border-[0.5px] border-[color:color-mix(in_srgb,var(--signal-negative)_35%,transparent)] bg-[color-mix(in_srgb,var(--signal-negative)_6%,transparent)] p-3">
                        <p className="text-[12.5px] text-console-ink">
                            Remove {initial?.name}? Its models disappear from every model picker.
                        </p>
                        <div className="flex gap-2">
                            <UIButton size="sm" variant="destructive" onClick={handleDelete} disabled={busy}>
                                {busy ? "Removing…" : <><Trash2 size={14} /> Confirm remove</>}
                            </UIButton>
                            <UIButton size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                                <X size={14} /> Cancel
                            </UIButton>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1.5">
                            <label className={legend} htmlFor="cp-name">Name</label>
                            <input
                                id="cp-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="My local Llama"
                                autoFocus
                                className={field}
                            />
                            {!initial && (
                                <span className="text-[11.5px] text-console-ink-4">
                                    Provider id: <span className="font-app-mono">{slugify(name) || "…"}</span> — models route as{" "}
                                    <span className="font-app-mono">{slugify(name) || "…"}/model-id</span>
                                </span>
                            )}
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className={legend} htmlFor="cp-url">Base URL</label>
                            <input
                                id="cp-url"
                                value={baseURL}
                                onChange={(e) => setBaseURL(e.target.value)}
                                placeholder="http://localhost:11434/v1"
                                className={field}
                            />
                            <span className="text-[11.5px] text-console-ink-4">
                                Any OpenAI-compatible endpoint — Ollama, vLLM, LM Studio, LiteLLM, OpenRouter…
                            </span>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className={legend} htmlFor="cp-key">API key</label>
                            <div className="relative">
                                <input
                                    id="cp-key"
                                    type={showKey ? "text" : "password"}
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder={initial ? "Leave blank to keep the stored key" : "Optional — local servers need none"}
                                    className={`${field} pr-9`}
                                />
                                <button
                                    type="button"
                                    aria-label={showKey ? "Hide key" : "Show key"}
                                    onClick={() => setShowKey((v) => !v)}
                                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-[4px] p-1 text-console-ink-3 hover:text-console-ink"
                                >
                                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                            </div>
                            <span className="text-[11.5px] text-console-ink-4">Stored locally on this device.</span>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className={legend} htmlFor="cp-models">Model IDs</label>
                            <textarea
                                id="cp-models"
                                value={models}
                                onChange={(e) => setModels(e.target.value)}
                                rows={3}
                                placeholder={"llama3.2\nqwen2.5:14b"}
                                className="w-full rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2.5 py-2 font-app-mono text-[12.5px] text-[var(--ink-primary)] shadow-none placeholder:text-[var(--ink-tertiary)] focus-visible:ring-1 focus-visible:ring-console-accent/40"
                            />
                            <span className="text-[11.5px] text-console-ink-4">
                                One per line or comma-separated — the names the endpoint serves.
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            <UIButton size="sm" onClick={handleSave} disabled={busy}>
                                {busy ? "Saving…" : <><Check size={14} /> {initial ? "Save provider" : "Add provider"}</>}
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

/** One provider row of the legacy flat list — still used by Web Search. */
function ProviderCard({ value, label, url, savedKey, onSave, onRemove }: ProviderCardProps) {
    const [open, setOpen] = useState(false);
    const connected = !!savedKey;

    return (
        <Box w="full">
            {/* Row — click Add/Edit to open the key popup */}
            <Flex
                as="button"
                type="button"
                onClick={() => setOpen(true)}
                align="center"
                gap={3}
                w="100%"
                minH="56px"
                textAlign="left"
                cursor="pointer"
                px={1}
                borderRadius="2px"
                _hover={{ bg: "var(--surface-recessed)" }}
            >
                <Box w="fit-content" maxW="full">
                    <Flex align="center" gap={2.5} minW={0} w="fit-content" maxW="full">
                        <ModelLogo model={value} size={30} />
                        <Text fontSize="14px" color="var(--ink-primary)" noOfLines={1}>
                            {label}
                        </Text>
                        {url && (
                            <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Get your ${label} API key`}
                                aria-label={`Get your ${label} API key`}
                                onClick={(e) => e.stopPropagation()}
                                style={{ display: "flex", color: "var(--ink-tertiary)", flexShrink: 0 }}
                            >
                                <ExternalLink size={14} />
                            </a>
                        )}
                    </Flex>
                    {/* Badge spans icon → end of name/link */}
                    <Box mt={1.5} w="full">
                        <StatusPill connected={connected} />
                    </Box>
                </Box>
                <Box
                    as="span"
                    display="inline-flex"
                    align="center"
                    gap={1}
                    flexShrink={0}
                    ml="auto"
                    px={2.5}
                    py={1.5}
                    borderRadius="2px"
                    fontSize="12px"
                    color="var(--accent-primary)"
                    _hover={{ bg: "var(--surface-recessed)" }}
                >
                    {connected ? <Pencil size={13} /> : <Plus size={13} />}
                    {connected ? "Edit" : "Add"}
                </Box>
            </Flex>

            <KeyDialog
                open={open}
                onOpenChange={setOpen}
                value={value}
                label={label}
                connected={connected}
                onSave={onSave}
                onRemove={onRemove}
            />
        </Box>
    );
}

type SortKey = "name" | "models" | "status" | "updated";

interface ProviderRow {
    value: string;
    label: string;
    url?: string;
    connected: boolean;
    /** Curated catalog size; undefined = catalog not loaded yet. */
    models?: number;
    /** ISO timestamp of the last key save; "" when never saved. */
    updated: string;
    /** Set when the row is a user-added OpenAI-compatible provider. */
    custom?: CustomProvider;
}

function SortTh({
    label, k, sort, onSort, className,
}: {
    label: string;
    k: SortKey;
    sort: { key: SortKey; dir: "asc" | "desc" } | null;
    onSort: (k: SortKey) => void;
    className?: string;
}) {
    const active = sort?.key === k;
    return (
        <th
            scope="col"
            aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
            className={`px-4 py-2.5 text-left align-bottom ${className || ""}`}
        >
            <button
                type="button"
                onClick={() => onSort(k)}
                className="inline-flex items-center gap-1 text-[13px] font-light text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
            >
                {label}
                {active ? (
                    sort.dir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />
                ) : (
                    <ChevronsUpDown size={13} className="opacity-45" />
                )}
            </button>
        </th>
    );
}

/**
 * The app zeroes --radius-sm/md (client's square-controls brief), so dropdown
 * panels and their rows opt back into rounded corners here.
 */
const MENU_ROUNDED =
    "rounded-[8px] [&_[data-slot=dropdown-menu-item]]:rounded-[6px] [&_[data-slot=dropdown-menu-checkbox-item]]:rounded-[6px] [&_[data-slot=dropdown-menu-radio-item]]:rounded-[6px]";

/**
 * The "AI Providers" card: toolbar + sortable, filterable, paginated table of
 * every provider the backend can route to, each row opening the shared key
 * editor. Mirrors the reference design; type and colour stay in app tokens.
 */
function ModelProvidersPanel({
    savedKeys, prefs, catalog, onSave, onRemove, onSaveCustom, onDeleteCustom,
}: {
    savedKeys: Record<string, string>;
    prefs: Record<string, string>;
    catalog: Record<string, number>;
    onSave: (value: string, key: string) => Promise<void>;
    onRemove: (value: string) => Promise<void>;
    onSaveCustom: (custom: CustomProvider, apiKey: string) => Promise<void>;
    onDeleteCustom: (custom: CustomProvider) => Promise<void>;
}) {
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState<"all" | "connected" | "pending">("all");
    const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
    const [page, setPage] = useState(0);
    const [perPage, setPerPage] = useState(10);
    const [cols, setCols] = useState({ models: true, status: true, updated: true });
    const [editing, setEditing] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [customDlg, setCustomDlg] = useState<{ open: boolean; initial: CustomProvider | null }>({
        open: false,
        initial: null,
    });

    const customs = parseCustoms(prefs);

    const rows: ProviderRow[] = [
        ...MODEL_PROVIDERS.map((p) => ({
            ...p,
            connected: !!savedKeys[p.value],
            models: catalog[p.value],
            updated: prefs[`key_ts_${p.value}`] || "",
        })),
        // A custom provider is configured by virtue of existing: you do not
        // add a base URL you never intend to call.
        ...customs.map((c) => ({
            value: c.id,
            label: c.name,
            connected: true,
            models: c.models.length,
            updated: prefs[`key_ts_${c.id}`] || "",
            custom: c,
        })),
    ];

    const q = query.trim().toLowerCase();
    const filtered = rows.filter(
        (r) =>
            (!q || r.label.toLowerCase().includes(q) || r.value.includes(q)) &&
            (status === "all" || r.connected === (status === "connected")),
    );

    // Connected providers ride the top by default; an explicit column sort
    // runs over this base order (Array#sort is stable, so ties keep it).
    filtered.sort((a, b) => Number(b.connected) - Number(a.connected));

    if (sort) {
        const dir = sort.dir === "asc" ? 1 : -1;
        const cmp = (a: ProviderRow, b: ProviderRow) => {
            switch (sort.key) {
                case "models": return (a.models ?? -1) - (b.models ?? -1);
                case "status": return Number(a.connected) - Number(b.connected);
                case "updated": return (a.updated || "").localeCompare(b.updated || "");
                default: return a.label.localeCompare(b.label);
            }
        };
        filtered.sort((a, b) => cmp(a, b) * dir);
    }

    const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
    const safePage = Math.min(page, pageCount - 1);
    const pageRows = filtered.slice(safePage * perPage, safePage * perPage + perPage);
    const colCount = 1 + Number(cols.models) + Number(cols.status) + Number(cols.updated) + 1;

    const onSort = (key: SortKey) =>
        setSort((s) =>
            s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null,
        );
    const openEditor = (row: ProviderRow) => {
        // Custom rows edit their own config; built-ins open the key editor.
        if (row.custom) {
            setCustomDlg({ open: true, initial: row.custom });
            return;
        }
        setEditing(row.value);
        setOpen(true);
    };

    const target = editing ? MODEL_PROVIDERS.find((p) => p.value === editing) : null;

    return (
        <Box
            as={motion.div}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.base, ease }}
            className="p-5 md:p-6"
        >
            {/* Card header — title + subtitle + Add provider */}
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                <div className="min-w-0">
                    <h2 className="font-app-body text-[26px] leading-[1.1] font-light tracking-[-0.02em] text-[var(--ink-primary)] md:text-[30px]">
                        AI Providers
                    </h2>
                    <p className="mt-1 text-[13.5px] text-[var(--ink-tertiary)]">
                        Set the API keys that unlock each AI provider.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setCustomDlg({ open: true, initial: null })}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] bg-[var(--surface-inverse)] px-4 font-app-body text-[13.5px] font-light text-[var(--ink-inverse-primary)] transition-opacity hover:opacity-90"
                >
                    <Plus size={15} /> Add provider
                </button>
            </div>

            {/* Section intro */}
            <div className="mt-6">
                <h3 className="font-app-body text-[17px] leading-[1.2] font-light tracking-[-0.01em] text-[var(--ink-primary)]">
                    Connected AI sources
                </h3>
                <p className="mt-1.5 max-w-[64ch] text-[13.5px] leading-relaxed text-[var(--ink-tertiary)]">
                    Keys here become available as model choices when starting an analysis.
                </p>
            </div>

            <div className="mt-4 mb-3 h-px bg-[var(--hairline)]" />

            {/* Toolbar — search, status filter, view toggles */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                    <Search
                        aria-hidden
                        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--ink-tertiary)]"
                    />
                    <input
                        type="search"
                        placeholder="Search providers..."
                        aria-label="Search providers"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="h-9 w-[230px] max-w-full rounded-[8px] border border-[var(--hairline)] bg-transparent pr-3 pl-8 text-[13.5px] text-[var(--ink-primary)] transition-colors placeholder:text-[var(--ink-tertiary)] focus:border-[var(--accent-primary)] focus:outline-none"
                    />
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--hairline)] px-3 text-[13.5px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--surface-recessed)]"
                        >
                            <CircleArrowDown size={15} className="text-[var(--ink-tertiary)]" />
                            {status === "all" ? "Status" : status === "connected" ? "Connected" : "Not configured"}
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className={MENU_ROUNDED}>
                        <DropdownMenuRadioGroup
                            value={status}
                            onValueChange={(v) => { setStatus(v as typeof status); setPage(0); }}
                        >
                            <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="connected">Connected</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="pending">Not configured</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                </DropdownMenu>

                <div className="ml-auto">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--hairline)] px-3 text-[13.5px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--surface-recessed)]"
                            >
                                <SlidersHorizontal size={15} className="text-[var(--ink-tertiary)]" />
                                View
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className={MENU_ROUNDED}>
                            <DropdownMenuCheckboxItem
                                checked={cols.models}
                                onCheckedChange={(c) => setCols((s) => ({ ...s, models: !!c }))}
                            >
                                Models
                            </DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem
                                checked={cols.status}
                                onCheckedChange={(c) => setCols((s) => ({ ...s, status: !!c }))}
                            >
                                Status
                            </DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem
                                checked={cols.updated}
                                onCheckedChange={(c) => setCols((s) => ({ ...s, updated: !!c }))}
                            >
                                Last updated
                            </DropdownMenuCheckboxItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Table */}
            <div className="mt-3 overflow-x-auto rounded-[8px] border border-[var(--hairline)]">
                <table className="w-full min-w-[620px] border-collapse text-[14px]">
                    <thead>
                        <tr className="border-b border-[var(--hairline)]">
                            <SortTh label="Name" k="name" sort={sort} onSort={onSort} />
                            {cols.models && <SortTh label="Models" k="models" sort={sort} onSort={onSort} className="w-[110px]" />}
                            {cols.status && <SortTh label="Status" k="status" sort={sort} onSort={onSort} className="w-[180px]" />}
                            {cols.updated && <SortTh label="Last updated" k="updated" sort={sort} onSort={onSort} className="w-[130px]" />}
                            <th scope="col" className="w-[52px] px-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.length === 0 ? (
                            <tr>
                                <td colSpan={colCount} className="px-4 py-10 text-center text-[13.5px] text-[var(--ink-tertiary)]">
                                    No providers match.
                                </td>
                            </tr>
                        ) : (
                            pageRows.map((r) => (
                                <tr
                                    key={r.value}
                                    onClick={() => openEditor(r)}
                                    className="cursor-pointer border-b border-[var(--hairline)] transition-colors last:border-0 hover:bg-[var(--surface-recessed)]"
                                >
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2.5">
                                            <ModelLogo model={r.value} size={26} />
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="truncate font-app-body text-[14.5px] font-light text-[var(--ink-primary)]">
                                                        {r.label}
                                                    </span>
                                                    {r.custom && (
                                                        <span className="shrink-0 rounded-full border border-[var(--hairline)] px-1.5 py-px font-app-body text-[10px] leading-[1.4] font-light text-[var(--ink-tertiary)]">
                                                            Custom
                                                        </span>
                                                    )}
                                                    {r.url && (
                                                        <a
                                                            href={r.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title={`Get your ${r.label} API key`}
                                                            aria-label={`Get your ${r.label} API key`}
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="text-[var(--ink-tertiary)] transition-colors hover:text-[var(--ink-primary)]"
                                                        >
                                                            <ExternalLink size={13} />
                                                        </a>
                                                    )}
                                                </div>
                                                <div className="truncate font-app-mono text-[10.5px] tracking-[0.06em] text-[var(--ink-tertiary)] uppercase">
                                                    {r.custom ? r.custom.baseURL : `${r.value.toUpperCase()}_API_KEY`}
                                                </div>
                                            </div>
                                        </div>
                                    </td>

                                    {cols.models && (
                                        <td className="px-4 py-3 text-[14px] tabular-nums text-[var(--ink-secondary)]">
                                            {r.models != null ? `${r.models} model${r.models === 1 ? "" : "s"}` : "—"}
                                        </td>
                                    )}

                                    {cols.status && (
                                        <td className="px-4 py-3">
                                            {r.connected ? (
                                                <span
                                                    className="inline-flex items-center rounded-full px-2.5 py-0.5 font-app-body text-[12.5px] font-light"
                                                    style={{
                                                        background: "color-mix(in srgb, var(--signal-positive) 14%, transparent)",
                                                        color: "var(--signal-positive-text)",
                                                    }}
                                                >
                                                    Connected
                                                </span>
                                            ) : (
                                                <span className="text-[13.5px] text-[var(--ink-tertiary)]">
                                                    Not configured yet
                                                </span>
                                            )}
                                        </td>
                                    )}

                                    {cols.updated && (
                                        <td className="px-4 py-3 text-[13.5px] tabular-nums text-[var(--ink-secondary)]">
                                            {r.connected && r.updated
                                                ? new Date(r.updated).toLocaleDateString("en-GB")
                                                : "–"}
                                        </td>
                                    )}

                                    <td className="px-2 py-3 text-right">
                                        <button
                                            type="button"
                                            aria-label={`Edit ${r.label} key`}
                                            onClick={(e) => { e.stopPropagation(); openEditor(r); }}
                                            className="rounded-[6px] p-1.5 text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--ink-primary)]"
                                        >
                                            <Pencil size={15} />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Footer — count, rows per page, pagination */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[13px] text-[var(--ink-tertiary)]">
                <span className="tabular-nums">
                    {filtered.length} of {rows.length} row(s)
                </span>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <label className="flex items-center gap-2">
                        Rows per page
                        <select
                            value={perPage}
                            onChange={(e) => { setPerPage(Number(e.target.value)); setPage(0); }}
                            className="h-8 rounded-[6px] border border-[var(--hairline)] bg-transparent px-2 text-[13px] text-[var(--ink-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                        >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                        </select>
                    </label>
                    <span className="text-[var(--ink-primary)]">
                        Page <span className="font-light tabular-nums">{safePage + 1}</span> of{" "}
                        <span className="font-light tabular-nums">{pageCount}</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                        {([
                            { label: "First page", icon: ChevronsLeft, to: 0, disabled: safePage === 0 },
                            { label: "Previous page", icon: ChevronLeft, to: safePage - 1, disabled: safePage === 0 },
                            { label: "Next page", icon: ChevronRight, to: safePage + 1, disabled: safePage >= pageCount - 1 },
                            { label: "Last page", icon: ChevronsRight, to: pageCount - 1, disabled: safePage >= pageCount - 1 },
                        ]).map(({ label, icon: Icon, to, disabled }) => (
                            <button
                                key={label}
                                type="button"
                                aria-label={label}
                                disabled={disabled}
                                onClick={() => setPage(to)}
                                className="inline-flex size-8 items-center justify-center rounded-[6px] border border-[var(--hairline)] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--surface-recessed)] disabled:pointer-events-none disabled:opacity-40"
                            >
                                <Icon size={15} />
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <KeyDialog
                open={open}
                onOpenChange={setOpen}
                value={target?.value ?? ""}
                label={target?.label ?? ""}
                connected={target ? !!savedKeys[target.value] : false}
                onSave={onSave}
                onRemove={onRemove}
            />

            <CustomProviderDialog
                key={customDlg.initial?.id ?? "new"}
                open={customDlg.open}
                onOpenChange={(o) => setCustomDlg((s) => ({ ...s, open: o }))}
                initial={customDlg.initial}
                existing={customs}
                onSave={onSaveCustom}
                onDelete={onDeleteCustom}
            />
        </Box>
    );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <Box
            as={motion.div}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.base, ease }}
            p={{ base: 4, md: 5 }}
        >
            <Text fontSize="13.5px" color="var(--ink-primary)">{title}</Text>
            {subtitle && <Text fontSize="12px" color="var(--ink-tertiary)" mt={0.5}>{subtitle}</Text>}
            <Box mt={4}>{children}</Box>
        </Box>
    );
}

function GridSkeleton() {
    return (
        <Box display="grid" gridTemplateColumns={{ base: "1fr", sm: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }} gap={5}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
                <Box key={i} h="96px">
                    <Flex gap={3} align="center">
                        <Box boxSize="34px" borderRadius="2px" bg="var(--surface-recessed)" />
                        <Box h="13px" w="90px" borderRadius="2px" bg="var(--surface-recessed)" />
                    </Flex>
                </Box>
            ))}
        </Box>
    );
}

function GroupHeader({ title, purpose }: { title: string; purpose: string }) {
    return (
        <Box mb={3} mt={1}>
            <Text
                fontSize="10.5px"
                color="var(--ink-tertiary)"
                textTransform="uppercase"
                letterSpacing="0.06em"
            >
                {title}
            </Text>
            <Text fontSize="12px" color="var(--ink-tertiary)" mt={0.5}>
                {purpose}
            </Text>
        </Box>
    );
}

export default function Settings() {
    const { user } = useAuth();
    const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});
    const [prefs, setPrefs] = useState<Record<string, string>>({});
    const [catalog, setCatalog] = useState<Record<string, number>>({});
    const [webProvider, setWebProvider] = useState<"searxng" | "tavily">("searxng");
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    const loadSettings = () => {
        setLoading(true);
        setLoadError(false);
        SettingsService.getSettings()
            .then((data) => {
                setSavedKeys({ ...(data.llm_keys || {}) });
                setPrefs({ ...(data.prefs || {}) });
                setWebProvider(data.prefs?.web_search_provider === "tavily" ? "tavily" : "searxng");
            })
            // Fail loudly: a silent catch here painted every provider
            // "Not connected" with no hint that the fetch never landed.
            .catch(() => setLoadError(true))
            .finally(() => setLoading(false));
        // Model counts are cosmetic — a failed catalog fetch leaves the
        // column blank rather than blocking the page.
        SettingsService.getModelCatalog()
            .then(setCatalog)
            .catch(() => undefined);
    };

    useEffect(() => {
        loadSettings();
    }, []);

    const handleSaveKey = async (provider: string, key: string) => {
        try {
            const savedAt = new Date().toISOString();
            await SettingsService.updateSettings({
                llm_keys: { [provider]: key },
                prefs: { [`key_ts_${provider}`]: savedAt },
            });
            setSavedKeys((prev) => ({ ...prev, [provider]: key }));
            setPrefs((prev) => ({ ...prev, [`key_ts_${provider}`]: savedAt }));
            toaster.create({ title: `${providerLabel(provider)} API key saved`, type: "success" });
        } catch (e) {
            toaster.create({ title: `Failed to save: ${(e as Error).message}`, type: "error" });
        }
    };

    const handleRemoveKey = async (keyName: string) => {
        try {
            await SettingsService.deleteLLMKey(keyName);
            setSavedKeys((prev) => {
                const next = { ...prev };
                delete next[keyName];
                return next;
            });
            // Timestamp stays in prefs; the row hides it once disconnected.
            setPrefs((prev) => ({ ...prev, [`key_ts_${keyName}`]: "" }));
            // ponytail: no Tavily key → keep the toggle honest; the backend
            // falls back to SearXNG too, but stale UI would re-enable it later.
            if (keyName === "tavily" && webProvider === "tavily") {
                await SettingsService.updateSettings({ prefs: { web_search_provider: "searxng" } });
                setWebProvider("searxng");
            }
            toaster.create({ title: `${providerLabel(keyName)} key removed`, type: "info" });
        } catch (e) {
            toaster.create({ title: `Failed to remove: ${(e as Error).message}`, type: "error" });
        }
    };

    const handleSaveCustom = async (custom: CustomProvider, apiKey: string) => {
        try {
            const savedAt = new Date().toISOString();
            const list = prefs.custom_providers ? parseCustoms(prefs) : [];
            const exists = list.some((c) => c.id === custom.id);
            const next = exists ? list.map((c) => (c.id === custom.id ? custom : c)) : [...list, custom];
            await SettingsService.updateSettings({
                // A blank key on edit means "keep the stored one" — never send
                // an empty string, which the API would write over the real key.
                ...(apiKey ? { llm_keys: { [custom.id]: apiKey } } : {}),
                prefs: { custom_providers: JSON.stringify(next), [`key_ts_${custom.id}`]: savedAt },
            });
            setPrefs((prev) => ({
                ...prev,
                custom_providers: JSON.stringify(next),
                [`key_ts_${custom.id}`]: savedAt,
            }));
            if (apiKey) setSavedKeys((prev) => ({ ...prev, [custom.id]: apiKey }));
            toaster.create({
                title: `${custom.name} ${exists ? "updated" : "added"}`,
                type: "success",
            });
        } catch (e) {
            toaster.create({ title: `Failed to save: ${(e as Error).message}`, type: "error" });
        }
    };

    const handleDeleteCustom = async (custom: CustomProvider) => {
        try {
            const next = parseCustoms(prefs).filter((c) => c.id !== custom.id);
            await SettingsService.updateSettings({
                prefs: { custom_providers: JSON.stringify(next), [`key_ts_${custom.id}`]: "" },
            });
            setPrefs((prev) => ({ ...prev, custom_providers: JSON.stringify(next) }));
            // The key is stored separately from the definition; drop it too.
            if (savedKeys[custom.id]) await SettingsService.deleteLLMKey(custom.id);
            setSavedKeys((prev) => {
                const copy = { ...prev };
                delete copy[custom.id];
                return copy;
            });
            toaster.create({ title: `${custom.name} removed`, type: "info" });
        } catch (e) {
            toaster.create({ title: `Failed to remove: ${(e as Error).message}`, type: "error" });
        }
    };

    const handleWebProvider = async (value: "searxng" | "tavily") => {
        try {
            await SettingsService.updateSettings({ prefs: { web_search_provider: value } });
            setWebProvider(value);
        } catch (e) {
            toaster.create({ title: `Failed to save preference: ${(e as Error).message}`, type: "error" });
        }
    };

    const email = user?.email ?? "";
    const displayName =
        (user?.user_metadata?.name as string | undefined) ??
        (user?.user_metadata?.full_name as string | undefined) ??
        email.split("@")[0] ??
        "User";

    const connectedCount = Object.keys(savedKeys).length;

    return (
        <Box bg="var(--surface-canvas)" minH="100%">
            <Flex direction="column" gap={6} w="full" px={{ base: 4, md: 8 }} py={6}>
                {/* Header — flat masthead, same title/subtitle treatment as the Runs and New Run pages */}
                <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-0.5">
                    <h1 className="font-app-body min-w-0 text-[26px] leading-[1.1] font-light tracking-[-0.02em] text-[var(--ink-primary)] md:text-[30px]">
                        Settings
                    </h1>
                    <Text fontSize="11.5px" color="var(--ink-tertiary)" whiteSpace="nowrap">
                        {connectedCount} KEY{connectedCount === 1 ? "" : "S"} STORED
                    </Text>
                </header>

                {/* Two-column: account rail on the left, keys on the right */}
                <Box display="grid" gridTemplateColumns={{ base: "1fr", lg: "minmax(280px, 340px) 1fr" }} gap={6} alignItems="start">
                    {/* LEFT RAIL */}
                    <VStack gap={6} align="stretch">
                        <SectionCard title="Account">
                            <Flex align="center" gap={4}>
                                <Box border="1px solid var(--hairline)" borderRadius="2px" overflow="hidden" flexShrink={0}>
                                    <UserAvatar seed={email || displayName} size={{ base: 52, md: 60 }} />
                                </Box>
                                <Box minW={0}>
                                    <Text fontSize="15px" color="var(--ink-primary)" noOfLines={1}>
                                        {displayName}
                                    </Text>
                                    <Text fontSize="12.5px" color="var(--ink-tertiary)" noOfLines={1}>{email}</Text>
                                </Box>
                            </Flex>
                            <Text fontSize="12px" color="var(--ink-tertiary)" mt={4}>
                                Local-first: all your data lives on this machine.
                            </Text>
                        </SectionCard>
                    </VStack>

                    {/* RIGHT MAIN — AI providers */}
                    <Box
                        as={motion.div}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: dur.base, ease }}
                        display="flex"
                        flexDirection="column"
                        gap={6}
                    >
                        {loading ? (
                            <GridSkeleton />
                        ) : (
                            <>
                                {loadError && (
                                    <div role="alert" className="flex flex-wrap items-center gap-3 bg-[var(--surface-recessed)] px-3 py-2.5">
                                        <span className="font-app-body text-[13px] text-[var(--signal-negative)]">
                                            Couldn't load your settings — the statuses below may be out of date.
                                        </span>
                                        <button
                                            type="button"
                                            onClick={loadSettings}
                                            className="font-app-body ml-auto cursor-pointer text-[13px] font-medium text-[var(--ink-primary)] underline underline-offset-2 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-primary)]"
                                        >
                                            Retry
                                        </button>
                                    </div>
                                )}
                                <ModelProvidersPanel
                                    savedKeys={savedKeys}
                                    prefs={prefs}
                                    catalog={catalog}
                                    onSave={handleSaveKey}
                                    onRemove={handleRemoveKey}
                                    onSaveCustom={handleSaveCustom}
                                    onDeleteCustom={handleDeleteCustom}
                                />

                                <Box>
                                    <GroupHeader
                                        title="Web Search"
                                        purpose="Powers the optional web-search step during analysis."
                                    />
                                    <Box display="flex" flexDirection="column" gap={1}>
                                        <ProviderCard
                                            value="tavily"
                                            label="Tavily"
                                            url="https://app.tavily.com"
                                            savedKey={savedKeys.tavily}
                                            onSave={handleSaveKey}
                                            onRemove={handleRemoveKey}
                                        />
                                    </Box>
                                    {!!savedKeys.tavily && (
                                        <Box mt={4}>
                                            <Text fontSize="12px" color="var(--ink-tertiary)" mb={2}>
                                                Default web search — SearXNG is self-hosted and free; Tavily uses the key above.
                                            </Text>
                                            <Flex gap={1} p={1} bg="var(--surface-recessed)" borderRadius="2px" w="fit-content">
                                                {(["searxng", "tavily"] as const).map((v) => {
                                                    const active = webProvider === v;
                                                    return (
                                                        <Flex
                                                            key={v}
                                                            as="button"
                                                            type="button"
                                                            onClick={() => handleWebProvider(v)}
                                                            aria-pressed={active}
                                                            px={4}
                                                            py={1.5}
                                                            borderRadius="2px"
                                                            cursor="pointer"
                                                            bg={active ? "var(--surface-panel)" : "transparent"}
                                                            boxShadow={active ? "0 1px 2px rgba(0,0,0,0.08)" : "none"}
                                                        >
                                                            <Text fontSize="12.5px" color={active ? "var(--accent-primary)" : "var(--ink-tertiary)"}>
                                                                {v === "searxng" ? "SearXNG" : "Tavily"}
                                                            </Text>
                                                        </Flex>
                                                    );
                                                })}
                                            </Flex>
                                        </Box>
                                    )}
                                </Box>
                            </>
                        )}
                    </Box>
                </Box>
            </Flex>
        </Box>
    );
}

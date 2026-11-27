import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BadgeCheck, ChevronRight, Plus, Search, Upload, Link2 } from "lucide-react";
import { PluginService, type PluginSummary } from "@/db";
import PluginAvatar from "@/components/shared/PluginAvatar";
import { MarketFlags } from "@/lib/sourceLogos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toaster } from "@/compat/ui";
import { cn } from "@/lib/utils";

/**
 * Workspace — the Plugins directory (Claude's layout): title, search + filter
 * chips + Add ▾, "Your plugins" as flat rows, "Relativity plugins" as a
 * two-column card grid. Active runs and scheduled agents live on the New Run
 * page now (the "Scheduled Agents" section).
 *
 * Your plugins = custom/imported (editable on their page); Relativity
 * plugins = shipped, verified, read-only. Every run is powered by one or
 * more — the run form picks them, this page manages them.
 */

const FIELD_INPUT =
    "h-9 rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2.5 text-sm shadow-none placeholder:text-console-ink-4 focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent";
const CHIP_CLS = "cursor-pointer rounded-full px-3 py-1 font-app-body text-[13px] font-light transition-colors";

type Filter = "all" | "relativity" | "custom";
const FILTERS: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "relativity", label: "Relativity" },
    { value: "custom", label: "Custom" },
];

/** The muted source line: `Skills · 🇮🇳 🇺🇸 · ⌓ github.com/owner/repo`.
 *  Relativity plugins carry no source word — the flags say where they apply. */
function SourceLine({ plugin }: { plugin: PluginSummary }) {
    const src =
        plugin.origin === "relativity"
            ? ""
            : plugin.install_source?.startsWith("http")
                ? plugin.install_source.replace(/^https?:\/\//, "").replace(/\.git$/, "")
                : plugin.install_source === "upload"
                    ? "Uploaded zip"
                    : "Custom";
    return (
        <span className="flex min-w-0 items-center gap-1.5 font-app-body text-[13px] font-light text-console-ink-3">
            <span className="shrink-0">{plugin.skill_count} skill{plugin.skill_count === 1 ? "" : "s"}</span>
            <span aria-hidden className="shrink-0">·</span>
            <MarketFlags country={plugin.country} />
            {src && (
                <>
                    <span aria-hidden className="shrink-0">·</span>
                    <span aria-hidden className="shrink-0 text-console-ink-4">⌓</span>
                    <span className="truncate">{src}</span>
                </>
            )}
        </span>
    );
}

function PluginNameLine({ plugin, size = "md" }: { plugin: PluginSummary; size?: "md" | "lg" }) {
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            <span
                className={cn(
                    "truncate font-normal text-console-ink",
                    size === "lg" ? "text-[20px] leading-tight" : "text-[16px] leading-tight",
                )}
            >
                {plugin.display_name}
            </span>
            {!!plugin.verified && <BadgeCheck className="size-4 shrink-0 text-[var(--gh-blue)]" aria-label="Verified" />}
        </span>
    );
}

export default function PluginLibrary() {
    const navigate = useNavigate();
    const [plugins, setPlugins] = useState<PluginSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("all");
    const [showAllYours, setShowAllYours] = useState(false);
    const [urlOpen, setUrlOpen] = useState(false);
    const [importUrl, setImportUrl] = useState("");
    const [importing, setImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadPlugins = useCallback(() => {
        setLoading(true);
        setFetchError(false);
        PluginService.list()
            .then(setPlugins)
            .catch(() => {
                setPlugins([]);
                setFetchError(true);
            })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        loadPlugins();
    }, [loadPlugins]);

    const runImport = async () => {
        const url = importUrl.trim();
        if (!url || importing) return;
        setImporting(true);
        try {
            const plugin = await PluginService.importUrl(url);
            toaster.create({
                title: `Imported ${plugin.display_name}`,
                description: plugin.warning,
                type: plugin.warning ? "info" : "success",
            });
            setImportUrl("");
            setUrlOpen(false);
            loadPlugins();
            if (plugin.id) navigate(`/plugins/${plugin.id}`);
        } catch (e: any) {
            toaster.create({
                title: "Import failed",
                description: e?.response?.data?.error || e?.message || "That plugin could not be imported.",
                type: "error",
            });
        } finally {
            setImporting(false);
        }
    };

    const runUpload = async (file: File | undefined) => {
        if (!file || importing) return;
        setImporting(true);
        try {
            const plugin = await PluginService.importZip(file);
            toaster.create({
                title: `Imported ${plugin.display_name}`,
                description: plugin.warning,
                type: plugin.warning ? "info" : "success",
            });
            loadPlugins();
            if (plugin.id) navigate(`/plugins/${plugin.id}`);
        } catch (e: any) {
            toaster.create({
                title: "Import failed",
                description: e?.response?.data?.error || e?.message || "That zip could not be read.",
                type: "error",
            });
        } finally {
            setImporting(false);
        }
    };

    const lower = query.trim().toLowerCase();
    const match = (p: PluginSummary) =>
        !lower || `${p.display_name} ${p.description} ${p.categories.join(" ")}`.toLowerCase().includes(lower);
    const yours = useMemo(
        () => plugins.filter((p) => p.origin === "custom" && match(p)),
        [plugins, lower],
    );
    const relativity = useMemo(
        () => plugins.filter((p) => p.origin === "relativity" && match(p)),
        [plugins, lower],
    );
    const showYours = filter !== "relativity";
    const showRelativity = filter !== "custom";
    // Five rows, then "Show all" — the screenshot's fold.
    const yoursVisible = showAllYours ? yours : yours.slice(0, 5);

    const rows = (list: PluginSummary[]) =>
        list.map((p) => (
            <div key={p.id} className="border-b border-[color:var(--hairline)] last:border-b-0">
                <Link
                    to={`/plugins/${encodeURIComponent(p.id)}`}
                    className="flex w-full min-w-0 items-center gap-3.5 px-1 py-3.5 transition-colors hover:bg-[color-mix(in_srgb,var(--ink-primary)_4%,transparent)] focus-visible:outline-none focus-visible:[outline-offset:-2px]"
                >
                    <PluginAvatar plugin={p} size={40} />
                    <span className="min-w-0 flex-1">
                        <PluginNameLine plugin={p} />
                        <span className="mt-0.5 block">
                            <SourceLine plugin={p} />
                        </span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-console-ink-4" />
                </Link>
            </div>
        ));

    return (
        <div className="w-full py-8">
            {/* ── Title row ── */}
            <div className="flex items-start justify-between">
                <h1 className="font-[family-name:var(--font-display)] text-[34px] leading-none font-normal tracking-[-0.01em] text-console-ink">
                    Plugins
                </h1>
            </div>

            {/* ── Search + filter chips + Add ▾ ── */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
                <div className="relative min-w-[220px] flex-1">
                    <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-console-ink-4" />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search"
                        aria-label="Search plugins"
                        data-testid="plugin-search"
                        className="h-10 w-full rounded-[10px] border border-[color:var(--hairline)] bg-transparent pr-3 pl-9 font-app-body text-[14px] text-console-ink placeholder:text-console-ink-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40"
                    />
                </div>
                <div className="flex shrink-0 items-center rounded-[10px] border border-[color:var(--hairline)] p-0.5">
                    {FILTERS.map((f) => (
                        <button
                            key={f.value}
                            type="button"
                            aria-pressed={filter === f.value}
                            onClick={() => setFilter(f.value)}
                            className={cn(
                                CHIP_CLS,
                                filter === f.value
                                    ? "bg-[var(--surface-recessed)] text-console-ink"
                                    : "text-console-ink-3 hover:text-console-ink",
                            )}
                            data-testid={`plugin-filter-${f.value}`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="sm" className="h-10 shrink-0 gap-1.5 px-4" data-testid="add-plugin">
                            <Plus className="size-4" /> Add
                            <ChevronRight aria-hidden className="size-3 rotate-90" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        className="min-w-[210px] rounded-[8px] [&_[data-slot=dropdown-menu-item]]:rounded-[6px]"
                    >
                        <DropdownMenuItem className="text-[14px]" onSelect={() => setUrlOpen(true)}>
                            <Link2 className="mr-2 size-4" /> Import from GitHub URL…
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-[14px]" onSelect={() => fileInputRef.current?.click()}>
                            <Upload className="mr-2 size-4" /> Upload a plugin.zip…
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip"
                    className="sr-only"
                    aria-hidden
                    tabIndex={-1}
                    onChange={(e) => {
                        void runUpload(e.target.files?.[0]);
                        e.target.value = "";
                    }}
                />
            </div>

            {/* ── Import from URL — one field ── */}
            <Dialog open={urlOpen} onOpenChange={(open) => { if (!open) setUrlOpen(false); }}>
                <DialogContent className="sm:max-w-lg" data-testid="add-plugin-form">
                    <DialogTitle className="font-app-body text-lg font-light text-console-ink">Import from GitHub</DialogTitle>
                    <p className="font-app-body text-[13px] font-light text-console-ink-3">
                        Claude plugin layout — a repo with plugin.json and/or skills/.
                    </p>
                    <div className="flex items-center gap-2">
                        <Input
                            value={importUrl}
                            onChange={(e) => setImportUrl(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") void runImport(); }}
                            placeholder="https://github.com/owner/repo"
                            aria-label="Plugin repository URL"
                            className={FIELD_INPUT}
                            data-testid="plugin-url-input"
                        />
                        <Button size="sm" className="shrink-0 px-4" disabled={!importUrl.trim() || importing} onClick={runImport} data-testid="plugin-url-import">
                            {importing ? "Importing…" : "Import"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <div className="mt-8">
                {/* ── Directory ── */}
                <div className="min-w-0">
                    {loading ? (
                        <div className="space-y-4">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="h-16 animate-pulse rounded-none bg-console-recessed/30" />
                            ))}
                        </div>
                    ) : fetchError ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <p className="font-app-body text-lg font-light text-console-ink">The Workspace could not reach the server.</p>
                            <Button className="mt-4" variant="outline" onClick={loadPlugins}>Retry</Button>
                        </div>
                    ) : (
                        <>
                            {showRelativity && (
                                <section>
                                    <div className="flex items-baseline justify-between gap-4">
                                        <h2 className="font-app-body text-[17px] font-light text-console-ink">Relativity plugins</h2>
                                        <span className="font-app-body text-[13px] font-light text-console-ink-3">
                                            Shipped, verified, read-only
                                        </span>
                                    </div>
                                    {relativity.length === 0 ? (
                                        <p className="mt-3 py-6 text-center font-app-body text-sm text-console-ink-3">
                                            {lower ? "No Relativity plugins match that search." : "No built-in plugins found."}
                                        </p>
                                    ) : (
                                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                            {relativity.map((p) => (
                                                <div
                                                    key={p.id}
                                                    className="group relative rounded-xl border border-[color:var(--hairline)] transition-colors hover:bg-[color-mix(in_srgb,var(--ink-primary)_5%,transparent)]"
                                                >
                                                    <Link
                                                        to={`/plugins/${encodeURIComponent(p.id)}`}
                                                        className="flex min-w-0 items-start gap-3.5 p-4 focus-visible:outline-none focus-visible:[outline-offset:-2px]"
                                                    >
                                                        <PluginAvatar plugin={p} className="size-16 sm:size-20 xl:size-24" />
                                                        <span className="min-w-0 flex-1">
                                                            {/* Newsreader regular — the display face never drops to the
                                                                app's light (300) body weight on this page. */}
                                                            <span className="font-[family-name:var(--font-display)] font-normal">
                                                                <PluginNameLine plugin={p} size="lg" />
                                                            </span>
                                                            {/* Fades out where the copy runs past the card instead of a hard clamp line. */}
                                                            <span className="mt-1 block max-h-[3.2em] overflow-hidden font-[family-name:var(--font-body)] text-[13px] font-light leading-snug text-console-ink-2 [mask-image:linear-gradient(to_bottom,#000_62%,transparent)]">
                                                                {p.description}
                                                            </span>
                                                            <span className="mt-1.5 block">
                                                                <SourceLine plugin={p} />
                                                            </span>
                                                        </span>
                                                    </Link>
                                                    {/* The screenshot's “+” — use in a new run, preselected. */}
                                                    <button
                                                        type="button"
                                                        aria-label={`Start a run with ${p.display_name}`}
                                                        onClick={() => navigate(`/new-run?plugin=${encodeURIComponent(p.id)}`)}
                                                        className="absolute top-3 right-3 hidden size-8 items-center justify-center rounded-[8px] border border-[color:var(--hairline)] bg-[var(--surface-panel)] text-console-ink transition hover:border-console-ink-3 group-hover:flex focus-visible:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40 sm:flex sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                                                    >
                                                        <Plus className="size-4" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            )}

                            {showYours && (
                                <section className={cn(showRelativity && "mt-9")}>
                                    <div className="flex items-baseline justify-between gap-4">
                                        <h2 className="font-app-body text-[17px] font-light text-console-ink">Your plugins</h2>
                                        {yours.length > 5 && (
                                            <button
                                                type="button"
                                                onClick={() => setShowAllYours((v) => !v)}
                                                className="flex shrink-0 items-center gap-1 font-app-body text-[13px] text-console-ink-2 hover:text-console-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:ring-offset-2"
                                            >
                                                {showAllYours ? "Show less" : "Show all"}
                                                <ArrowRight className="size-3.5" aria-hidden />
                                            </button>
                                        )}
                                    </div>
                                    <div className="mt-2">
                                        {yours.length === 0 ? (
                                            <div className="flex flex-col items-start rounded-xl border border-dashed border-[color:var(--hairline)] px-5 py-8 text-center">
                                                <p className="font-app-body text-[15px] font-light text-console-ink">
                                                    {lower ? "No custom plugins match that search." : "No custom plugins yet."}
                                                </p>
                                                {!lower && (
                                                    <p className="mx-auto mt-1.5 max-w-[46ch] font-app-body text-[13px] font-light text-console-ink-2">
                                                        Import one from GitHub or upload a zip — its skills become available to every run.
                                                    </p>
                                                )}
                                                {!lower && (
                                                    <Button className="mt-4" size="sm" onClick={() => setUrlOpen(true)}>
                                                        <Plus className="size-4" /> Add plugin
                                                    </Button>
                                                )}
                                            </div>
                                        ) : (
                                            rows(yoursVisible)
                                        )}
                                    </div>
                                </section>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

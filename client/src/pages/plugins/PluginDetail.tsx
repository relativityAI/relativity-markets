import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BadgeCheck, ChevronDown, ExternalLink, FileText, Pencil, Trash2, X } from "lucide-react";
import { PluginService, type PluginDetail as PluginDetailPayload } from "@/db";
import PluginAvatar from "@/components/shared/PluginAvatar";
import { CountryFlag, MarketFlags } from "@/lib/sourceLogos";
import PluginFiles from "@/components/plugins/PluginFiles";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { toaster } from "@/compat/ui";
import { cn } from "@/lib/utils";

/**
 * Plugin detail — its own page (never a popup), two tabs:
 *
 *  Overview: description + skill list left, the metadata sidebar right
 *           (Listed, Safety and access, Sources, Categories, Version,
 *           License, More info) — inline-editable for custom plugins,
 *           read-only for Relativity ones.
 *  Files:   the navigator — plugin.json, skills/, scripts/…
 *
 * Skill rows drill into Files with that SKILL.md open.
 */

type Tab = "overview" | "files";

const FIELD_INPUT =
    "h-8 w-full rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2 font-app-body text-[13px] text-console-ink shadow-none placeholder:text-console-ink-4 focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent";
const LABEL_CLS = "font-app-body text-[11px] font-medium tracking-[0.12em] text-console-ink-3 uppercase";

function SidebarField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <p className={LABEL_CLS}>{label}</p>
            <div className="mt-1.5">{children}</div>
        </div>
    );
}

export default function PluginDetail() {
    const { id = "" } = useParams();
    const navigate = useNavigate();
    const [plugin, setPlugin] = useState<PluginDetailPayload | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [tab, setTab] = useState<Tab>("overview");
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [focusPath, setFocusPath] = useState<string | undefined>(undefined);
    const [showAllSkills, setShowAllSkills] = useState(false);
    // Edit draft — plain strings; sources/categories round-trip through text.
    const [draft, setDraft] = useState({
        display_name: "",
        description: "",
        listed_date: "",
        version: "",
        version_date: "",
        license: "",
        safety: "",
        sourcesText: "",
        categoriesText: "",
        developer_url: "",
        country: "",
        avatar: "",
    });

    const load = useCallback(() => {
        setLoadError(false);
        PluginService.read(id)
            .then(setPlugin)
            .catch(() => {
                setPlugin(null);
                setLoadError(true);
            });
    }, [id]);

    useEffect(load, [load]);

    const editable = plugin?.origin === "custom";

    const startEdit = () => {
        if (!plugin) return;
        setDraft({
            display_name: plugin.display_name,
            description: plugin.description,
            listed_date: plugin.listed_date ?? "",
            version: plugin.version ?? "",
            version_date: plugin.version_date ?? "",
            license: plugin.license ?? "",
            safety: plugin.safety ?? "",
            sourcesText: plugin.sources.map((s) => s.url).join("\n"),
            categoriesText: plugin.categories.join(", "),
            developer_url: plugin.developer_url ?? "",
            country: plugin.country ?? "",
            avatar: plugin.avatar ?? "",
        });
        setEditing(true);
    };

    const saveMeta = async () => {
        if (!plugin || saving) return;
        setSaving(true);
        try {
            const urls = draft.sourcesText
                .split(/\n+/)
                .map((u) => u.trim())
                .filter((u) => /^https?:\/\//.test(u));
            const updated = await PluginService.updateMeta(plugin.id, {
                display_name: draft.display_name.trim() || plugin.display_name,
                description: draft.description.trim(),
                listed_date: draft.listed_date.trim() || null,
                version: draft.version.trim() || null,
                version_date: draft.version_date.trim() || null,
                license: draft.license.trim() || null,
                safety: draft.safety.trim(),
                sources: urls.map((u) => ({ label: u.replace(/^https?:\/\//, "").replace(/\/$/, ""), url: u })),
                categories: draft.categoriesText.split(",").map((c) => c.trim()).filter(Boolean),
                developer_url: draft.developer_url.trim() || null,
                country: draft.country.trim() || null,
                avatar: draft.avatar.trim() || null,
            });
            setPlugin((prev) => (prev ? { ...prev, ...updated, skills: prev.skills } : prev));
            setEditing(false);
            toaster.create({ title: "Plugin details saved", type: "success" });
        } catch (e: any) {
            toaster.create({
                title: "Couldn't save",
                description: e?.response?.data?.error || e?.message || "The metadata could not be updated.",
                type: "error",
            });
        } finally {
            setSaving(false);
        }
    };

    const openSkill = (skillId: string) => {
        setFocusPath(`skills/${skillId}/SKILL.md`);
        setTab("files");
    };

    if (loadError) {
        return (
            <div className="w-full py-16 text-center">
                <p className="font-app-body text-lg font-light text-console-ink">Plugin not found.</p>
                <Button className="mt-4" variant="outline" onClick={() => navigate("/my-workspace")}>
                    Back to Workspace
                </Button>
            </div>
        );
    }
    if (!plugin) {
        return <p className="w-full py-16 text-center font-app-body text-[13px] text-console-ink-3" role="status">Loading…</p>;
    }

    const originLine =
        plugin.origin === "relativity"
            ? `Relativity plugin · ${plugin.skill_count} skill${plugin.skill_count === 1 ? "" : "s"}`
            : plugin.install_source?.startsWith("http")
                ? `${plugin.install_source.replace(/^https?:\/\//, "")} · ${plugin.skill_count} skill${plugin.skill_count === 1 ? "" : "s"}`
                : `${plugin.install_source === "upload" ? "Uploaded" : "Custom"} · ${plugin.skill_count} skill${plugin.skill_count === 1 ? "" : "s"}`;

    return (
        <div className="w-full py-8">
            {/* Back + header */}
            <Link
                to="/my-workspace"
                className="inline-flex items-center gap-1.5 font-app-body text-[13px] text-console-ink-2 transition hover:text-console-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:ring-offset-2"
            >
                <ArrowLeft className="size-4" /> Plugins
            </Link>

            <div className="mt-4 flex flex-wrap items-start gap-4">
                <PluginAvatar plugin={plugin} size={64} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h1 className="truncate font-app-body text-[30px] leading-none font-light tracking-tight text-console-ink">
                            {plugin.display_name}
                        </h1>
                        {!!plugin.verified && <BadgeCheck className="size-5 shrink-0 text-[var(--gh-blue)]" aria-label="Verified" />}
                        <MarketFlags country={plugin.country} size={18} />
                    </div>
                    <p className="mt-2 flex min-w-0 items-baseline gap-1.5 font-app-body text-[13px] font-light text-console-ink-3">
                        <span className="shrink-0">{originLine}</span>
                        {plugin.description && (
                            <>
                                <span aria-hidden className="shrink-0">·</span>
                                <span className="truncate">{plugin.description}</span>
                            </>
                        )}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {editable && !editing && (
                        <Button size="sm" variant="outline" className="px-4" onClick={startEdit} data-testid="plugin-edit">
                            <Pencil className="size-4" /> Edit
                        </Button>
                    )}
                    {editable && (
                        <Button
                            size="sm"
                            variant="outline"
                            className="px-3 border-console-negative/40! text-console-negative"
                            aria-label="Delete plugin"
                            onClick={() => setDeleteOpen(true)}
                        >
                            <Trash2 className="size-4" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="mt-6 flex gap-6 border-b border-[color:var(--hairline)]" role="tablist" aria-label="Plugin sections">
                {(["overview", "files"] as Tab[]).map((t) => (
                    <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={tab === t}
                        onClick={() => setTab(t)}
                        className={cn(
                            "-mb-px border-b-2 pb-2 font-app-body text-[14px] capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40",
                            tab === t
                                ? "border-console-ink text-console-ink"
                                : "border-transparent text-console-ink-3 hover:text-console-ink",
                        )}
                        data-testid={`plugin-tab-${t}`}
                    >
                        {t}
                    </button>
                ))}
            </div>

            {tab === "overview" ? (
                <div className="mt-6 grid gap-10 lg:grid-cols-3">
                    {/* ── Left: description + skills ── */}
                    <div className="lg:col-span-2">
                        {editing ? (
                            <div className="flex flex-col gap-3 rounded-xl border-[0.5px] border-[color:var(--hairline)] p-4">
                                <div>
                                    <label className={LABEL_CLS} htmlFor="plugin-display-name">Display name</label>
                                    <input
                                        id="plugin-display-name"
                                        value={draft.display_name}
                                        onChange={(e) => setDraft((d) => ({ ...d, display_name: e.target.value }))}
                                        className={cn(FIELD_INPUT, "mt-1.5 h-9")}
                                    />
                                </div>
                                <div>
                                    <label className={LABEL_CLS} htmlFor="plugin-description">Description</label>
                                    <textarea
                                        id="plugin-description"
                                        value={draft.description}
                                        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                                        rows={3}
                                        className={cn(FIELD_INPUT, "mt-1.5 h-auto resize-y py-2 leading-relaxed")}
                                    />
                                </div>
                            </div>
                        ) : (
                            <p className="max-w-[70ch] font-app-body text-[16px] font-light leading-relaxed text-console-ink-2">
                                {plugin.description || "No description yet."}
                            </p>
                        )}

                        <h2 className="mt-8 font-app-body text-[20px] leading-none font-light tracking-tight text-console-ink">
                            Skills
                        </h2>
                        <div className="mt-3 overflow-hidden rounded-xl border border-[color:var(--hairline)]">
                            {plugin.skills.length === 0 ? (
                                <p className="px-4 py-6 font-app-body text-[13px] text-console-ink-3">
                                    No skills in this plugin.
                                </p>
                            ) : (
                                (showAllSkills ? plugin.skills : plugin.skills.slice(0, 5)).map((s, i, list) => (
                                    <button
                                        key={s.id}
                                        type="button"
                                        onClick={() => openSkill(s.id)}
                                        className={cn(
                                            "flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[color-mix(in_srgb,var(--ink-primary)_5%,transparent)] focus-visible:outline-none focus-visible:[outline-offset:-2px]",
                                            i < list.length - 1 && "border-b border-[color:var(--hairline)]",
                                        )}
                                        data-testid={`skill-row-${s.id}`}
                                    >
                                        <FileText className="size-4 shrink-0 text-console-ink-4" aria-hidden />
                                        <span className="w-[34%] max-w-[210px] shrink-0 truncate font-app-mono text-[13px] text-console-ink">
                                            {s.id}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate font-app-body text-[13px] font-light text-console-ink-3">
                                            {s.description}
                                        </span>
                                        <span className="shrink-0 text-console-ink-4" aria-hidden>›</span>
                                    </button>
                                ))
                            )}
                        </div>
                        {plugin.skills.length > 5 && (
                            <div className="mt-2 flex justify-end">
                                <button
                                    type="button"
                                    onClick={() => setShowAllSkills((v) => !v)}
                                    aria-expanded={showAllSkills}
                                    className="flex items-center gap-1 rounded px-1 py-0.5 font-app-body text-[13px] text-console-ink-2 transition hover:text-console-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:ring-offset-2"
                                    data-testid="skills-show-all"
                                >
                                    {showAllSkills ? "Show fewer" : `Show all ${plugin.skills.length}`}
                                    <ChevronDown className={cn("size-3.5 transition-transform", showAllSkills && "rotate-180")} aria-hidden />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── Right: metadata sidebar ── */}
                    <aside className="flex flex-col gap-5">
                        <SidebarField label="Developer tier">
                            {plugin.verified ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-recessed)] px-2.5 py-1 font-app-body text-[13px] text-console-ink">
                                    <BadgeCheck className="size-4 text-[var(--gh-blue)]" /> Verified
                                </span>
                            ) : (
                                <span className="font-app-body text-[14px] text-console-ink-2">Community</span>
                            )}
                        </SidebarField>

                        <SidebarField label="Safety and access">
                            {editing ? (
                                <textarea
                                    value={draft.safety}
                                    onChange={(e) => setDraft((d) => ({ ...d, safety: e.target.value }))}
                                    rows={4}
                                    aria-label="Safety disclaimer"
                                    className={cn(FIELD_INPUT, "h-auto resize-y py-2 leading-relaxed")}
                                />
                            ) : (
                                <p className="font-app-body text-[13.5px] font-light leading-relaxed text-console-ink-2">
                                    {plugin.safety}
                                </p>
                            )}
                        </SidebarField>

                        <SidebarField label="Sources">
                            {editing ? (
                                <textarea
                                    value={draft.sourcesText}
                                    onChange={(e) => setDraft((d) => ({ ...d, sourcesText: e.target.value }))}
                                    rows={3}
                                    aria-label="Sources, one URL per line"
                                    placeholder={"https://github.com/owner/repo"}
                                    className={cn(FIELD_INPUT, "h-auto resize-y py-2 font-app-mono")}
                                />
                            ) : plugin.sources.length ? (
                                <ul className="flex flex-col gap-1.5">
                                    {plugin.sources.map((s) => (
                                        <li key={s.url}>
                                            <a
                                                href={s.url}
                                                target="_blank"
                                                rel="noreferrer noopener"
                                                className="inline-flex items-center gap-1 font-app-body text-[13.5px] text-[var(--gh-blue)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                                            >
                                                {s.label || s.url}
                                                <ExternalLink className="size-3.5" aria-hidden />
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="font-app-body text-[13.5px] text-console-ink-4">No sources listed.</p>
                            )}
                        </SidebarField>

                        <SidebarField label="Categories">
                            {editing ? (
                                <input
                                    value={draft.categoriesText}
                                    onChange={(e) => setDraft((d) => ({ ...d, categoriesText: e.target.value }))}
                                    aria-label="Categories, comma separated"
                                    placeholder="Technical analysis, India"
                                    className={FIELD_INPUT}
                                />
                            ) : plugin.categories.length ? (
                                <div className="flex flex-wrap gap-1.5">
                                    {plugin.categories.map((c) => (
                                        <span
                                            key={c}
                                            className="rounded-[6px] bg-[var(--surface-recessed)] px-2 py-1 font-app-body text-[12.5px] text-console-ink-2"
                                        >
                                            {c}
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <p className="font-app-body text-[13.5px] text-console-ink-4">No categories.</p>
                            )}
                        </SidebarField>

                        <SidebarField label="Version">
                            {editing ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        value={draft.version}
                                        onChange={(e) => setDraft((d) => ({ ...d, version: e.target.value }))}
                                        aria-label="Version"
                                        placeholder="v7.0.2"
                                        className={FIELD_INPUT}
                                    />
                                    <input
                                        value={draft.version_date}
                                        onChange={(e) => setDraft((d) => ({ ...d, version_date: e.target.value }))}
                                        aria-label="Version date"
                                        placeholder="Nov 12"
                                        className={FIELD_INPUT}
                                    />
                                </div>
                            ) : (
                                <p className="font-app-body text-[14px] text-console-ink">
                                    {plugin.version || "—"}
                                    {plugin.version_date ? <span className="text-console-ink-3"> ({plugin.version_date})</span> : null}
                                </p>
                            )}
                        </SidebarField>

                        <SidebarField label="License">
                            {editing ? (
                                <input
                                    value={draft.license}
                                    onChange={(e) => setDraft((d) => ({ ...d, license: e.target.value }))}
                                    aria-label="License"
                                    placeholder="MIT"
                                    className={FIELD_INPUT}
                                />
                            ) : (
                                <p className="font-app-body text-[14px] text-console-ink">{plugin.license || "—"}</p>
                            )}
                        </SidebarField>

                        <SidebarField label="Listed">
                            {editing ? (
                                <input
                                    value={draft.listed_date}
                                    onChange={(e) => setDraft((d) => ({ ...d, listed_date: e.target.value }))}
                                    aria-label="Listed date"
                                    placeholder="January 2026"
                                    className={FIELD_INPUT}
                                />
                            ) : (
                                <p className="font-app-body text-[14px] text-console-ink">{plugin.listed_date || "—"}</p>
                            )}
                        </SidebarField>

                        <SidebarField label="More info">
                            {editing ? (
                                <input
                                    value={draft.developer_url}
                                    onChange={(e) => setDraft((d) => ({ ...d, developer_url: e.target.value }))}
                                    aria-label="Developer website"
                                    placeholder="https://…"
                                    className={cn(FIELD_INPUT, "font-app-mono")}
                                />
                            ) : plugin.developer_url ? (
                                <a
                                    href={plugin.developer_url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="inline-flex items-center gap-1 font-app-body text-[13.5px] text-[var(--gh-blue)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                                >
                                    Developer website
                                    <ExternalLink className="size-3.5" aria-hidden />
                                </a>
                            ) : (
                                <p className="font-app-body text-[13.5px] text-console-ink-4">—</p>
                            )}
                        </SidebarField>

                        <SidebarField label="Country">
                            {editing ? (
                                <input
                                    value={draft.country}
                                    onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) }))}
                                    aria-label="Country code, two letters"
                                    placeholder="IN — blank means all countries"
                                    maxLength={2}
                                    className={FIELD_INPUT}
                                />
                            ) : plugin.country ? (
                                <span className="inline-flex items-center gap-2 font-app-body text-[14px] text-console-ink">
                                    <CountryFlag country={plugin.country} size={16} />
                                    {plugin.country}
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-2 font-app-body text-[14px] text-console-ink-3">
                                    <MarketFlags country={plugin.country} size={16} />
                                    All markets
                                </span>
                            )}
                        </SidebarField>

                        <SidebarField label="Custom image">
                            {editing ? (
                                <>
                                    <input
                                        value={draft.avatar}
                                        onChange={(e) => setDraft((d) => ({ ...d, avatar: e.target.value }))}
                                        aria-label="Custom image URL"
                                        placeholder="https://…/icon.png — blank means generated"
                                        className={cn(FIELD_INPUT, "font-app-mono")}
                                    />
                                    <span className="mt-2 flex items-center gap-2.5">
                                        <span className="inline-flex size-10 items-center justify-center overflow-hidden rounded-full">
                                            {draft.avatar.trim() ? (
                                                <img src={draft.avatar.trim()} alt="" className="size-10 rounded-full object-cover" />
                                            ) : (
                                                <PluginAvatar plugin={plugin.id} size={40} />
                                            )}
                                        </span>
                                        <span className="font-app-body text-[12.5px] text-console-ink-3">
                                            {draft.avatar.trim() ? "Preview" : "No image — the generated avatar is used"}
                                        </span>
                                    </span>
                                </>
                            ) : plugin.avatar ? (
                                <img
                                    src={plugin.avatar}
                                    alt=""
                                    className="size-10 rounded-full object-cover"
                                    onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                                />
                            ) : (
                                <p className="font-app-body text-[14px] text-console-ink-3">Generated avatar</p>
                            )}
                        </SidebarField>

                        {editing && (
                            <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-[color:var(--hairline)] pt-4">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditing(false)}
                                    aria-label="Cancel editing"
                                >
                                    <X className="size-4" /> Cancel
                                </Button>
                                <Button size="sm" className="px-4" disabled={saving} onClick={saveMeta} data-testid="plugin-save-meta">
                                    {saving ? "Saving…" : "Save details"}
                                </Button>
                            </div>
                        )}
                    </aside>
                </div>
            ) : (
                <div className="mt-6">
                    <PluginFiles key={focusPath ?? "root"} pluginId={plugin.id} editable={!!editable} initialPath={focusPath} />
                </div>
            )}

            <ConfirmDialog
                open={deleteOpen}
                title="Delete this plugin?"
                message={`“${plugin.display_name}” and its ${plugin.skill_count} skill${plugin.skill_count === 1 ? "" : "s"} will be removed. This can't be undone.`}
                confirmLabel="Delete"
                onCancel={() => setDeleteOpen(false)}
                onConfirm={() => {
                    setDeleteOpen(false);
                    PluginService.remove(plugin.id)
                        .then(() => {
                            toaster.create({ title: `Deleted ${plugin.display_name}`, type: "success" });
                            navigate("/my-workspace");
                        })
                        .catch((e: any) =>
                            toaster.create({
                                title: "Couldn't delete",
                                description: e?.response?.data?.error || e?.message,
                                type: "error",
                            }),
                        );
                }}
            />
        </div>
    );
}

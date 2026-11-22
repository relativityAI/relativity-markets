import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, ChevronRight, ExternalLink } from "lucide-react";
import PluginAvatar from "@/components/shared/PluginAvatar";
import { MenuDropdown } from "@/pages/shared/AnalysisControls";
import { PluginService, type PluginSummary, type SkillSummary } from "@/db";
import { cn } from "@/lib/utils";

/**
 * Plugin picker — the Claude/ChatGPT composer menu, adapted for the run form.
 *
 * One dropdown: search + a toggle row per plugin (avatar, name, verified
 * badge, description, skill count), an expandable skill list per plugin
 * (fetched on first expand), and a "Manage plugins" exit to the workspace.
 * Selection is multi — every selected plugin's skills load into the run.
 */
export interface PluginPickerProps {
    plugins: PluginSummary[];
    selected: string[];
    onToggle: (id: string) => void;
    loading?: boolean;
    error?: boolean;
    onRetry?: () => void;
}

type Expanded = { open: boolean; loading: boolean; skills?: { id: string; name: string; description: string }[] };

export default function PluginPicker({ plugins, selected, onToggle, loading, error, onRetry }: PluginPickerProps) {
    const navigate = useNavigate();
    const [query, setQuery] = useState("");
    const [expanded, setExpanded] = useState<Record<string, Expanded>>({});

    const lower = query.trim().toLowerCase();
    const visible = lower
        ? plugins.filter((p) => `${p.display_name} ${p.description}`.toLowerCase().includes(lower))
        : plugins;

    const toggleExpand = (id: string) => {
        const cur = expanded[id];
        if (cur?.open) {
            setExpanded((prev) => ({ ...prev, [id]: { ...prev[id], open: false } }));
            return;
        }
        setExpanded((prev) => ({ ...prev, [id]: { open: true, loading: !prev[id]?.skills } }));
        if (cur?.skills) return;
        PluginService.read(id)
            .then((d) => {
                const skills = (d.skills ?? []).map((s: SkillSummary) => ({
                    id: s.id,
                    name: s.name,
                    description: s.description || "",
                }));
                setExpanded((prev) => ({ ...prev, [id]: { open: true, loading: false, skills } }));
            })
            .catch(() => setExpanded((prev) => ({ ...prev, [id]: { open: true, loading: false, skills: [] } })));
    };

    if (loading) {
        return <p className="px-1 py-2 font-app-body text-[12px] text-console-ink-3">Loading plugins…</p>;
    }
    if (error) {
        return (
            <div className="flex flex-col items-start gap-2">
                <p className="font-app-body text-[12px] text-[var(--signal-negative)]">Couldn&apos;t load plugins.</p>
                {onRetry && (
                    <button
                        type="button"
                        onClick={onRetry}
                        className="rounded-[6px] border border-[color:var(--hairline)] px-3 py-1 font-app-body text-[12px] text-console-ink hover:text-console-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40"
                    >
                        Retry
                    </button>
                )}
            </div>
        );
    }
    if (!plugins.length) {
        return (
            <div className="flex flex-col items-center py-6 text-center">
                <p className="font-app-body text-lg font-light text-console-ink">No plugins yet.</p>
                <p className="mx-auto mt-1.5 max-w-[46ch] font-app-body text-sm text-console-ink-2">
                    A plugin bundles the skills a run uses. Add one to start.
                </p>
                <button
                    type="button"
                    onClick={() => navigate("/my-workspace")}
                    className="mt-4 rounded-full bg-[var(--primary)] px-4 py-2 font-app-body text-[13px] text-[var(--primary-foreground)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/50"
                >
                    Open plugins
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2.5">
            <MenuDropdown
                value={selected.length ? `${selected.length} plugin${selected.length === 1 ? "" : "s"} selected` : null}
                placeholder="Add plugins…"
                search={{ value: query, onChange: setQuery, placeholder: "Search plugins…" }}
            >
                {(close) => (
                    <div>
                        {!visible.length && (
                            <p className="px-3 py-2.5 font-app-body text-[12px] text-console-ink-3">
                                {query ? `Nothing matches “${query}”.` : "No plugins yet."}
                            </p>
                        )}
                        {visible.map((p) => {
                            const isOn = selected.includes(p.id);
                            const exp = expanded[p.id];
                            return (
                                <div key={p.id}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={isOn}
                                        tabIndex={-1}
                                        onClick={() => onToggle(p.id)}
                                        className="group flex w-full items-center gap-2.5 px-2.5 py-2 text-left focus-visible:outline-none focus-visible:[outline-offset:-2px] hover:bg-[color-mix(in_srgb,var(--ink-primary)_5%,transparent)]"
                                    >
                                        {/* The toggle box — checked state is the only selection cue. */}
                                        <span
                                            aria-hidden
                                            className={cn(
                                                "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                                                isOn
                                                    ? "border-[var(--signal-positive)] bg-[var(--signal-positive)] text-white"
                                                    : "border-[color:var(--hairline)]",
                                            )}
                                        >
                                            {isOn && (
                                                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M2.5 6.5L5 9l4.5-6" />
                                                </svg>
                                            )}
                                        </span>
                                        <PluginAvatar plugin={p.id} size={20} />
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-1.5">
                                                <span className="truncate font-app-body text-[13px] font-medium text-console-ink">
                                                    {p.display_name}
                                                </span>
                                                {!!p.verified && (
                                                    <BadgeCheck className="size-3.5 shrink-0 text-[var(--gh-blue)]" aria-label="Verified" />
                                                )}
                                            </span>
                                            <span className="block truncate font-app-body text-[11px] font-light text-console-ink-3">
                                                {p.description || (p.origin === "relativity" ? "Relativity plugin" : "Custom plugin")}
                                            </span>
                                        </span>
                                        <span className="shrink-0 font-app-body text-[11px] font-light text-console-ink-3">
                                            {p.skill_count} skill{p.skill_count === 1 ? "" : "s"}
                                        </span>
                                    </button>
                                    {/* Skill flyout — click the chevron to see what's inside. */}
                                    <div className="flex items-center justify-end pr-3 -mt-1">
                                        <button
                                            type="button"
                                            aria-expanded={!!exp?.open}
                                            aria-label={`${exp?.open ? "Hide" : "Show"} skills of ${p.display_name}`}
                                            onClick={() => toggleExpand(p.id)}
                                            className="flex items-center gap-1 rounded px-1.5 py-0.5 font-app-body text-[11px] text-console-ink-3 hover:text-console-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40"
                                        >
                                            {exp?.open ? "Hide" : "Skills"}
                                            <ChevronRight className={cn("size-3 transition-transform", exp?.open && "rotate-90")} />
                                        </button>
                                    </div>
                                    {exp?.open && (
                                        <div className="mx-2.5 mb-2 rounded-[8px] border border-[color:var(--hairline)] bg-[color-mix(in_srgb,var(--ink-primary)_3%,transparent)] px-2 py-1.5">
                                            {exp.loading && (
                                                <p className="px-1 py-1 font-app-body text-[11px] text-console-ink-3">Loading skills…</p>
                                            )}
                                            {!exp.loading && !exp.skills?.length && (
                                                <p className="px-1 py-1 font-app-body text-[11px] text-console-ink-3">No skills in this plugin.</p>
                                            )}
                                            {exp.skills?.map((s) => (
                                                <div key={s.id} className="rounded-[6px] px-1.5 py-1">
                                                    <p className="truncate font-app-mono text-[11.5px] text-console-ink">{s.id}</p>
                                                    <p className="line-clamp-2 font-app-body text-[11px] font-light text-console-ink-3">{s.description}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        <div className="mt-1 border-t border-[color:var(--hairline)] px-2.5 py-2">
                            <button
                                type="button"
                                onClick={() => {
                                    close();
                                    navigate("/my-workspace");
                                }}
                                className="flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 font-app-body text-[12px] text-console-ink-2 hover:text-console-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40"
                            >
                                Manage plugins
                                <ExternalLink className="size-3.5" />
                            </button>
                        </div>
                    </div>
                )}
            </MenuDropdown>

            {/* Selected plugins — chips under the picker. */}
            {selected.map((id) => {
                const p = plugins.find((x) => x.id === id);
                if (!p) return null;
                return (
                    <span
                        key={id}
                        className="flex w-fit max-w-full items-center gap-2 rounded-[6px] border border-[color:var(--hairline)] px-2 py-1"
                    >
                        <PluginAvatar plugin={p.id} size={18} />
                        <span className="truncate font-app-body text-[12px] text-console-ink">{p.display_name}</span>
                        <span className="shrink-0 font-app-body text-[11px] font-light text-console-ink-3">
                            {p.skill_count} skill{p.skill_count === 1 ? "" : "s"}
                        </span>
                        <button
                            type="button"
                            aria-label={`Remove ${p.display_name}`}
                            onClick={() => onToggle(p.id)}
                            className="rounded p-0.5 text-console-ink-3 hover:text-[var(--signal-negative)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40"
                        >
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                                <path d="M3 3l6 6M9 3l-6 6" />
                            </svg>
                        </button>
                    </span>
                );
            })}
            {/* Screen-reader summary — the chips are visual only. */}
            <p className="sr-only" role="status">
                {selected.length
                    ? `${selected.length} plugin${selected.length === 1 ? "" : "s"} selected for this run`
                    : "No plugins selected"}
            </p>
        </div>
    );
}

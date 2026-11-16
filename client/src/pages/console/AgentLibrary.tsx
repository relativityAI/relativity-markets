import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2, X, BadgeCheck, Square } from "lucide-react";
import { AnalysisService, AgentService, SkillService, type ScheduleRow, type SkillSummary } from "@/db";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toaster } from "@/compat/ui";
import { cn } from "@/lib/utils";
import { tagsFor, putTags, finalTags } from "@/lib/agentTags";
import TagInput from "@/components/shared/TagInput";
import { SectionSearch } from "@/components/console/SectionSearch";
import AgentSkills from "./AgentSkills";

/**
 * Agents & Skills — one workspace page. Default agents and My agents side by
 * side; clicking a row opens the editor (name, category, ONE skill, tags) in
 * a popup, as does "New agent" — there is no separate editor page. A blank
 * name is never persisted: the last saved text is restored on blur, so a
 * stray select-all-delete can't wipe it. The skill library sits underneath.
 */

interface Agent {
    _id?: string;
    id?: string;
    name: string;
    category?: string;
    created_at?: string;
    persona?: { philosophy?: string; philosophy_and_mindset?: string };
    skills?: { skill_id: string; weight: number }[];
}

interface Draft {
    name: string;
    category: string;
    skill: string;
    tags: string[];
    /** Text still in the tag box — becomes one more tag on comma or save. */
    tagText: string;
}

function toDraft(a: Agent): Draft {
    const id = a.id || a._id || "";
    return { name: a.name || "", category: a.category || "", skill: a.skills?.[0]?.skill_id || "", tags: tagsFor(id), tagText: "" };
}

function formatDate(dateStr?: string): string {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One skill per agent — native select, the platform's own picker. */
const SELECT_CLS = "h-9 w-full max-w-64 cursor-pointer rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2 text-sm text-console-ink shadow-none outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent";

function SkillSelect({ value, onChange, skills }: { value: string; onChange: (id: string) => void; skills: SkillSummary[] }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Agent skill"
            className={SELECT_CLS}
        >
            <option value="">No skill</option>
            {skills.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
            ))}
        </select>
    );
}

/** One class/category per agent (services/config/categories.yaml via the API). */
function CategorySelect({ value, onChange, categories }: { value: string; onChange: (c: string) => void; categories: string[] }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Agent category"
            className={SELECT_CLS}
        >
            <option value="">Select…</option>
            {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
            ))}
        </select>
    );
}

const FIELD_INPUT =
    "h-9 rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2.5 text-sm shadow-none placeholder:text-console-ink-4 focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent";

/** One bordered, rounded list panel — default agents, my agents. Kept close
 *  to the page canvas so the panels read as soft groupings, not cards. */
const SECTION_BOX = "rounded-xl border-[0.5px] border-[color:var(--hairline)] bg-console-surface/30 p-5";

/** Mobile: hug the listed rows, capped. Laptop (md+): the original fixed
 *  height so all boxes stay uniform. */
const SECTION_LIST = "max-h-[22rem] overflow-x-hidden overflow-y-auto pr-1 md:h-[22rem]";

/** The run form's label | control row, in console styles. */
function FormRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1 md:flex-row md:items-center">
            <div className="w-full shrink-0 md:w-36 md:px-1 md:py-2">
                <span className="font-app-body text-[11px] font-medium tracking-[0.08em] text-console-ink-3 uppercase">{label}</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-1 py-1">{children}</div>
        </div>
    );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="pt-3">
            <p className="px-1 pb-1 font-app-body text-[13px] font-medium text-console-ink-2">{title}</p>
            {children}
        </div>
    );
}

/** A default agent as served by GET /agents/defaults (from agents/defaults/*.md). */
type DefaultAgentRow = { name: string; skill_name?: string };

export default function AgentLibrary() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [skills, setSkills] = useState<SkillSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);
    const [query, setQuery] = useState("");
    const [expanded, setExpanded] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [createOpen, setCreateOpen] = useState(() => searchParams.get("new") === "1");
    const [newDraft, setNewDraft] = useState<Draft>({ name: "", category: "", skill: "", tags: [], tagText: "" });
    const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [defaults, setDefaults] = useState<DefaultAgentRow[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
    const [stopping, setStopping] = useState<string | null>(null);
    const [defaultQuery, setDefaultQuery] = useState("");

    /* ── Load ─────────────────────────────────────────────────────────── */

    useEffect(() => {
        let cancelled = false;
        AgentService.listAgents()
            .then((data) => {
                if (cancelled) return;
                setAgents(Array.isArray(data) ? data : []);
                setFetchError(!Array.isArray(data));
            })
            .catch(() => { if (!cancelled) { setAgents([]); setFetchError(true); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        SkillService.listSkills()
            .then((data) => { if (!cancelled && Array.isArray(data)) setSkills(data); })
            .catch(() => {});
        AgentService.listDefaultAgents()
            .then((data) => { if (!cancelled && Array.isArray(data)) setDefaults(data); })
            .catch(() => {});
        AgentService.listCategories()
            .then((data) => { if (!cancelled && Array.isArray(data)) setCategories(data); })
            .catch(() => {});
        AnalysisService.listSchedules()
            .then((data) => { if (!cancelled && Array.isArray(data)) setSchedules(data); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Old deep links (/my-workspace/agent/:id, builder hand-off) open that row.
    useEffect(() => {
        const want = searchParams.get("agent");
        if (!want || loading) return;
        const a = agents.find((x) => (x.id || x._id) === want);
        if (!a) return;
        setExpanded(want);
        setDraft(toDraft(a));
        setDirty(false);
        setCreateOpen(false);
        setSearchParams({}, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, agents, loading]);

    const nameOf = (id: string) => skills.find((s) => s.id === id)?.name || id;

    /* ── Inline editor: debounced autosave, never a blank prompt ──────── */

    const saveDraft = async (id: string, d: Draft): Promise<boolean> => {
        if (!d.name.trim()) return false; // blank → keep the last saved version
        setSaving(true);
        try {
            const payload = {
                id,
                _id: id,
                name: d.name.trim(),
                ...(d.category ? { category: d.category } : {}),
                skills: d.skill ? [{ skill_id: d.skill, weight: 5 }] : [],
            };
            await AgentService.updateAgent(payload);
            putTags(id, finalTags(d.tags, d.tagText));
            setAgents((prev) =>
                prev.map((a) => ((a.id || a._id) === id ? { ...a, name: payload.name, skills: payload.skills, category: d.category || a.category } : a)),
            );
            setDirty(false);
            return true;
        } catch (e: any) {
            toaster.create({
                title: "Couldn't save",
                description: e?.response?.data?.error || e?.message || "Please try again.",
                type: "error",
            });
            return false;
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        if (!dirty || !expanded || !draft) return;
        if (!draft.name.trim()) return; // never persist a blank name
        const t = setTimeout(() => { void saveDraft(expanded, draft); }, 700);
        return () => clearTimeout(t);
    }, [dirty, expanded, draft]);

    /** Leaving a blank name puts the last saved text back — an accidental
     *  select-all-delete can't stick. */
    const restoreIfBlank = () => {
        if (!expanded || !draft) return;
        if (draft.name.trim()) return;
        const saved = agents.find((x) => (x.id || x._id) === expanded);
        if (!saved) return;
        setDraft({ ...draft, name: saved.name || "" });
        toaster.create({
            title: "Blank name restored",
            description: "An agent's name can't be empty — the last saved name came back.",
            type: "info",
        });
    };

    const patchDraft = (p: Partial<Draft>) => {
        setDraft((d) => (d ? { ...d, ...p } : d));
        setDirty(true);
    };

    /** Closing the editor flushes the pending debounce — never drop typing. */
    const closeEditor = () => {
        if (expanded && dirty && draft && draft.name.trim()) void saveDraft(expanded, draft);
        setExpanded(null);
        setDraft(null);
        setDirty(false);
    };

    const toggleAgent = (a: Agent) => {
        const id = a.id || a._id || "";
        if (expanded === id) {
            closeEditor();
        } else {
            setExpanded(id);
            setDraft(toDraft(a));
            setDirty(false);
            setCreateOpen(false);
        }
    };

    /* ── Create (popup form) ──────────────────────────────────────────── */

    const openCreate = () => {
        setCreateOpen(true);
        setExpanded(null);
        setDraft(null);
        setDirty(false);
        setNewDraft({ name: "", category: "", skill: skills[0]?.id || "", tags: [], tagText: "" });
    };

    const adoptAgent = (created: Agent, d: Draft) => {
        const id = created.id || created._id || "";
        if (id) {
            setAgents((prev) => [{ ...created, id, _id: id }, ...prev]);
            putTags(id, finalTags(d.tags, d.tagText));
        }
        setCreateOpen(false);
        setNewDraft({ name: "", category: "", skill: skills[0]?.id || "", tags: [], tagText: "" });
        if (id) {
            setExpanded(id);
            setDraft(d);
            setDirty(false);
        }
    };

    const submitCreate = async () => {
        const name = newDraft.name.trim();
        if (!name) {
            toaster.create({ title: "Name required", description: "Give this agent a name.", type: "error" });
            return;
        }
        if (!newDraft.category) {
            toaster.create({ title: "Category required", description: "Pick one class/category for this agent.", type: "error" });
            return;
        }
        try {
            const created = await AgentService.createAgent({
                name,
                category: newDraft.category,
                skills: newDraft.skill ? [{ skill_id: newDraft.skill, weight: 5 }] : [],
            });
            adoptAgent(created || {}, { name, category: newDraft.category, skill: newDraft.skill, tags: newDraft.tags, tagText: newDraft.tagText });
            toaster.create({ title: "Agent created", type: "success" });
        } catch (e: any) {
            toaster.create({
                title: "Couldn't create the agent",
                description: e?.response?.data?.error || e?.message || "Please try again.",
                type: "error",
            });
        }
    };

    /* ── Delete ───────────────────────────────────────────────────────── */

    const handleDelete = async (id: string | undefined) => {
        if (!id) return;
        setDeleting(true);
        try {
            await AgentService.deleteAgent(id);
            setDeleteTarget(null);
            setAgents((prev) => prev.filter((a) => (a._id || a.id) !== id));
            if (expanded === id) { setExpanded(null); setDraft(null); setDirty(false); }
        } catch (e: any) {
            toaster.create({
                title: "Delete failed",
                description: e?.response?.data?.error || e?.message || "The agent could not be deleted. Please try again.",
                type: "error",
            });
        } finally {
            setDeleting(false);
        }
    };

    /* ── Stop a scheduled run ─────────────────────────────────────────── */

    const handleStop = async (id: string) => {
        setStopping(id);
        try {
            await AnalysisService.deleteSchedule(id);
            setSchedules((prev) => prev.filter((s) => s.id !== id));
            toaster.create({ title: "Schedule stopped", type: "success" });
        } catch (e: any) {
            toaster.create({
                title: "Couldn't stop the schedule",
                description: e?.response?.data?.error || e?.message || "Please try again.",
                type: "error",
            });
        } finally {
            setStopping(null);
        }
    };

    /* ── Derived ──────────────────────────────────────────────────────── */

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return agents;
        return agents.filter(
            (a) =>
                a.name?.toLowerCase().includes(q) ||
                (a.skills || []).some((s) => nameOf(s.skill_id).toLowerCase().includes(q)),
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agents, query, skills]);

    const filteredDefaults = useMemo(() => {
        const q = defaultQuery.trim().toLowerCase();
        if (!q) return defaults;
        return defaults.filter(
            (d) =>
                d.name?.toLowerCase().includes(q) ||
                (d.skill_name || "").toLowerCase().includes(q),
        );
    }, [defaults, defaultQuery]);

    const blank = !!draft && !draft.name.trim();
    const FLASH = "bg-console-negative animate-[pulse_3s_ease-in-out_infinite]";
    const saveState = saving
        ? { label: "Saving…", cls: "bg-console-accent animate-pulse" }
        : blank
            ? { label: "Blank — last saved version kept", cls: FLASH }
            : dirty
                ? { label: "Unsaved changes", cls: FLASH }
                : { label: "Saved", cls: "bg-console-positive" };

    return (
        <div className="w-full py-8">
            {/* Header — title only; the New agent action lives in My agents */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                    <h1 className="font-app-body shrink-0 text-[30px] leading-none font-light tracking-tight text-console-ink">
                        Agents
                    </h1>
                    <p className="mt-1.5 font-app-body text-[12px] font-normal text-console-ink-3">
                        Investment agents to analyze, track and monitor the markets.
                    </p>
                </div>
            </div>

            {/* ── Create agent — popup ── */}
            <Dialog open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false); }}>
                <DialogContent showCloseButton={false} className="sm:max-w-2xl" data-testid="agent-create-form">
                    <DialogTitle className="sr-only">New agent</DialogTitle>
                    {/* Information — the agent's identity: avatar + name, live as you type */}
                    <div className="flex items-center gap-5 pt-1">
                        <AgentAvatar agent={newDraft.name.trim() || "New agent"} size={112} label="New agent" />
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-app-display text-[28px] leading-[1.1] font-normal tracking-[-0.015em] text-console-ink">
                                {newDraft.name.trim() || "New agent"}
                            </p>
                            <p className="mt-1.5 font-app-body text-[12px] font-normal text-console-ink-3">
                                Investment agent — one category, one skill.
                            </p>
                        </div>
                    </div>
                    <FormSection title="Details">
                        <FormRow label="Name">
                            <Input
                                value={newDraft.name}
                                onChange={(e) => setNewDraft((d) => ({ ...d, name: e.target.value }))}
                                placeholder="Untitled agent"
                                aria-label="Agent name"
                                className={FIELD_INPUT}
                                data-testid="agent-name-input"
                            />
                        </FormRow>
                        <FormRow label="Category">
                            <CategorySelect
                                value={newDraft.category}
                                onChange={(c) => setNewDraft((d) => ({ ...d, category: c }))}
                                categories={categories}
                            />
                        </FormRow>
                        <FormRow label="Skill">
                            <SkillSelect
                                value={newDraft.skill}
                                onChange={(id) => setNewDraft((d) => ({ ...d, skill: id }))}
                                skills={skills}
                            />
                        </FormRow>
                        <FormRow label="Tags">
                            <TagInput
                                value={newDraft.tags}
                                text={newDraft.tagText}
                                onText={(v) => setNewDraft((d) => ({ ...d, tagText: v }))}
                                onTags={(v) => setNewDraft((d) => ({ ...d, tags: v }))}
                            />
                        </FormRow>
                    </FormSection>
                    <div className="mt-2 flex items-center justify-end gap-2 border-t-[0.5px] border-[color:var(--hairline)] pt-4">
                        <Button size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>
                            <X /> Cancel
                        </Button>
                        <Button size="sm" onClick={submitCreate} data-testid="agent-create-submit">
                            <Plus /> Create agent
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ── Three boxes side by side: defaults, yours, scheduled runs ── */}
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
                {/* ── Default agents — file-defined, listed from the API ── */}
                <section className={SECTION_BOX}>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0">
                            <h2 className="font-app-body text-[20px] leading-none font-light tracking-tight text-console-ink">
                                Default agents
                            </h2>
                            <p className="mt-1.5 flex items-center gap-1.5 font-app-body text-[12px] font-normal text-console-ink-3">
                                Relativity verified agents
                                <BadgeCheck className="size-3.5 shrink-0 text-console-accent" aria-hidden />
                            </p>
                        </div>
                        <SectionSearch
                            label="Search default agents"
                            placeholder="Search default agents…"
                            value={defaultQuery}
                            onChange={setDefaultQuery}
                        />
                    </div>
                    <div className={cn("mt-2 w-full", SECTION_LIST)}>
                        {filteredDefaults.length === 0 && (
                            <p className="py-6 text-center font-app-body text-sm text-console-ink-3">
                                {defaults.length === 0 ? "No default agents found." : "No default agents match that search."}
                            </p>
                        )}
                        {filteredDefaults.map((d) => (
                            <div key={d.name} className="-mx-2 ws-row flex w-full cursor-pointer items-center gap-3 rounded-[8px] px-2 py-3">
                                <AgentAvatar agent={d.name} size={48} />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-app-display text-[22px] leading-[1.1] font-normal tracking-[-0.015em] text-console-ink">{d.name}</p>
                                    <p className="truncate font-app-body text-[12px] font-normal text-console-ink-3">
                                        {d.skill_name ? `Skill · ${d.skill_name}` : "No skill attached"}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ── My agents ── */}
                <section className={SECTION_BOX}>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0">
                            <h2 className="font-app-body text-[20px] leading-none font-light tracking-tight text-console-ink">
                                My agents
                            </h2>
                            <p className="mt-1.5 font-app-body text-[12px] font-normal text-console-ink-3">
                                Your own — click a row to edit.
                            </p>
                        </div>
                        <SectionSearch
                            label="Search my agents"
                            placeholder="Search my agents…"
                            value={query}
                            onChange={setQuery}
                        />
                        <Button
                            size="sm"
                            variant="outline"
                            className="px-4"
                            onClick={openCreate}
                            data-testid="new-agent"
                        >
                            <Plus /> New agent
                        </Button>
                    </div>
                    {loading ? (
                        <div className="mt-4 max-h-[22rem] space-y-4 overflow-hidden md:h-[22rem]">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="h-16 animate-pulse rounded-none bg-console-recessed/30" />
                            ))}
                        </div>
                    ) : fetchError ? (
                        <div className="mt-4 flex max-h-[22rem] flex-col items-center justify-center py-12 text-center md:h-[22rem] md:py-0">
                            <p className="font-app-display text-lg font-normal text-console-ink">The Agent Console could not reach the server.</p>
                            <p className="mt-1 font-app-body text-sm text-console-ink-2">The agent API may be unavailable. Reload to try again.</p>
                        </div>
                    ) : agents.length === 0 ? (
                        <div className="mt-4 flex max-h-[22rem] flex-col items-center justify-center py-12 text-center md:h-[22rem] md:py-0">
                            <p className="font-app-display text-lg font-normal text-console-ink">No agents yet.</p>
                            <p className="mx-auto mt-1.5 max-w-[46ch] font-app-body text-sm text-console-ink-2">
                                An agent is a name, a category and a skill. Create one to start.
                            </p>
                            <Button className="mt-5" onClick={openCreate}>
                                <Plus /> Create an agent
                            </Button>
                        </div>
                    ) : (
                        <div className={cn("mt-1 w-full", SECTION_LIST)}>
                            {filtered.length === 0 && (
                                <p className="py-6 text-center text-sm text-console-ink-3">No agents match that search.</p>
                            )}
                            {filtered.map((agent) => {
                                const id = agent._id || agent.id || "";
                                const isOpen = expanded === id && !!draft;
                                return (
                                    <div key={id} className="-mx-2 ws-row group w-full cursor-pointer rounded-[8px] px-2 py-3">
                                        <div className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={() => toggleAgent(agent)}
                                                aria-label={`Edit ${agent.name || "agent"}`}
                                                className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                                            >
                                                <AgentAvatar agent={agent} size={48} label={agent.name || "Agent"} />
                                                {/* Left: name over the created date */}
                                                <span className="flex min-w-0 flex-1 flex-col gap-1">
                                                    <span className="block truncate font-app-display text-[22px] font-normal leading-[1.1] tracking-[-0.015em] text-console-ink">
                                                        {agent.name || "Untitled agent"}
                                                    </span>
                                                    <span className="block font-app-body text-[12px] font-normal text-console-ink-4">
                                                        Created {formatDate(agent.created_at)}
                                                    </span>
                                                    {tagsFor(id).length > 0 && (
                                                        <span className="flex flex-wrap gap-1.5">
                                                            {tagsFor(id).map((t) => (
                                                                <Badge key={t} className="bg-console-recessed font-app-body text-[11px] font-normal text-console-ink-2">
                                                                    {t}
                                                                </Badge>
                                                            ))}
                                                        </span>
                                                    )}
                                                </span>
                                            </button>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label={`Delete ${agent.name || "agent"}`}
                                                className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                                onClick={() => setDeleteTarget(agent)}
                                            >
                                                <Trash2 className="text-console-ink-3" />
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* ── Scheduled runs — transparent panel with a light border ── */}
                <section className="rounded-xl border-[0.5px] border-[color:var(--hairline)] p-5">
                    <div className="flex items-center gap-3">
                        <h2 className="min-w-0 font-app-body text-[20px] leading-none font-light tracking-tight text-console-ink">
                            Scheduled runs
                        </h2>
                        <Button
                            size="sm"
                            variant="outline"
                            className="ml-auto shrink-0 px-4"
                            onClick={() => navigate("/new-analysis?mode=schedule")}
                        >
                            <Plus /> Schedule another
                        </Button>
                    </div>
                    <p className="mt-1.5 font-app-body text-[12px] font-normal text-console-ink-3">
                        Agent runs that fire on a schedule.
                    </p>
                    <div className={cn("mt-2 w-full", SECTION_LIST)}>
                        {schedules.length === 0 ? (
                            <p className="flex h-full items-center justify-center text-center font-app-body text-sm text-console-ink-3">
                                No scheduled runs.
                            </p>
                        ) : (
                            <div className="h-full">
                            {schedules.map((s) => {
                                const agent = agents.find((a) => (a._id || a.id) === s.agent_id);
                                return (
                                    <div key={s.id} className="-mx-2 flex w-full items-center gap-3 rounded-[8px] px-2 py-3">
                                        <AgentAvatar agent={agent?.name || s.agent_id || "Agent"} size={48} label={agent?.name} />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-app-display text-[22px] leading-[1.1] font-normal tracking-[-0.015em] text-console-ink">
                                                {agent?.name || s.agent_id || "Scheduled agent"}
                                            </p>
                                            <p className="truncate font-app-body text-[12px] font-normal text-console-ink-3">
                                                {{ daily: "Daily", weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly" }[s.frequency] || "Daily"} {s.time} ({s.timezone}) · {s.share_name || s.symbol || "General"}
                                            </p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="shrink-0 border-console-negative/40! text-console-negative"
                                            disabled={stopping === s.id}
                                            onClick={() => handleStop(s.id)}
                                        >
                                            <Square /> Stop
                                        </Button>
                                    </div>
                                );
                            })}
                            </div>
                        )}
                    </div>
                </section>
            </div>

            {/* ── Edit my agent — popup ── */}
            <Dialog open={!!expanded && !!draft} onOpenChange={(open) => { if (!open) closeEditor(); }}>
                {draft && (
                    <DialogContent showCloseButton={false} className="sm:max-w-2xl" data-testid="agent-inline-editor">
                        <DialogTitle className="sr-only">Edit agent</DialogTitle>
                        {/* Information — the agent's identity: avatar + name + save state */}
                        <div className="flex items-center gap-5 pt-1">
                            <AgentAvatar agent={draft.name.trim() || "Agent"} size={112} label="Agent" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-app-display text-[28px] leading-[1.1] font-normal tracking-[-0.015em] text-console-ink">
                                    {draft.name.trim() || "Untitled agent"}
                                </p>
                                <p className="mt-1.5 font-app-body text-[12px] font-normal text-console-ink-3">
                                    Created {formatDate(agents.find((a) => (a.id || a._id) === expanded)?.created_at)}
                                </p>
                            </div>
                            <span className="flex shrink-0 items-center gap-1.5 self-start pt-2">
                                <span className={cn("size-1.5 rounded-full", saveState.cls)} />
                                <span className="font-app-body text-[11px] font-medium text-console-ink-3">{saveState.label}</span>
                            </span>
                        </div>
                        <FormSection title="Details">
                            <FormRow label="Name">
                                <Input
                                    value={draft.name}
                                    onChange={(e) => patchDraft({ name: e.target.value })}
                                    onBlur={restoreIfBlank}
                                    placeholder="Untitled agent"
                                    aria-label="Agent name"
                                    className={FIELD_INPUT}
                                />
                            </FormRow>
                            <FormRow label="Category">
                                <CategorySelect
                                    value={draft.category}
                                    onChange={(c) => patchDraft({ category: c })}
                                    categories={categories}
                                />
                            </FormRow>
                            <FormRow label="Skill">
                                <SkillSelect value={draft.skill} onChange={(sid) => patchDraft({ skill: sid })} skills={skills} />
                            </FormRow>
                            <FormRow label="Tags">
                                <TagInput
                                    value={draft.tags}
                                    text={draft.tagText}
                                    onText={(v) => patchDraft({ tagText: v })}
                                    onTags={(v) => patchDraft({ tags: v })}
                                />
                            </FormRow>
                        </FormSection>
                        <div className="mt-2 flex items-center justify-end gap-2 border-t-[0.5px] border-[color:var(--hairline)] pt-4">
                            <Button size="sm" onClick={closeEditor}>
                                Done
                            </Button>
                        </div>
                    </DialogContent>
                )}
            </Dialog>

            {/* ── Skills, as they are (its own py-8 separates the sections) ── */}
            <div className="mt-10">
                <AgentSkills />
            </div>

            <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete agent?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteTarget
                                ? `“${deleteTarget.name || "this agent"}” will be permanently removed and cannot be undone.`
                                : ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={deleting}
                            className="bg-console-negative hover:bg-console-negative/85"
                            onClick={(e) => { e.preventDefault(); handleDelete(deleteTarget?._id || deleteTarget?.id); }}
                        >
                            <Trash2 /> Delete agent
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

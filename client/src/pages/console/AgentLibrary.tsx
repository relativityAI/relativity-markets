import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Trash2, ChevronDown, ChevronRight, X, BadgeCheck } from "lucide-react";
import { AgentService, SkillService, type SkillSummary } from "@/db";
import AgentAvatar from "@/components/shared/AgentAvatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
 * side; clicking a row opens the editor (name, ONE skill, tags, raw-markdown
 * system prompt with debounced autosave) in a popup, as does "New agent" —
 * there is no separate editor page. Blank name/prompt fields are never
 * persisted: the last saved text is restored on blur, so a stray select-all-
 * delete can't wipe a soul. The skill library sits underneath.
 */

interface Agent {
    _id?: string;
    id?: string;
    name: string;
    created_at?: string;
    persona?: { philosophy?: string; philosophy_and_mindset?: string };
    skills?: { skill_id: string; weight: number }[];
}

interface Draft {
    name: string;
    soul: string;
    skill: string;
    tags: string[];
    /** Text still in the tag box — becomes one more tag on comma or save. */
    tagText: string;
}

function soulOf(a: Agent): string {
    return a.persona?.philosophy || a.persona?.philosophy_and_mindset || "";
}

function toDraft(a: Agent): Draft {
    const id = a.id || a._id || "";
    return { name: a.name || "", soul: soulOf(a), skill: a.skills?.[0]?.skill_id || "", tags: tagsFor(id), tagText: "" };
}

/** First sentence of the prompt — the agent's full one-line description. */
function creedOf(a: Agent): string {
    return soulOf(a).replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] || "";
}

function formatDate(dateStr?: string): string {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One skill per agent — native select, the platform's own picker. */
function SkillSelect({ value, onChange, skills }: { value: string; onChange: (id: string) => void; skills: SkillSummary[] }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Agent skill"
            className="h-9 w-full max-w-64 cursor-pointer rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2 text-sm text-console-ink shadow-none outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent"
        >
            <option value="">No skill</option>
            {skills.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
            ))}
        </select>
    );
}

const SOUL_TEXTAREA =
    "min-h-56 w-full resize-y rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2.5 py-2 font-mono text-[13px] leading-relaxed shadow-none placeholder:text-console-ink-4 focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent";

const FIELD_INPUT =
    "h-9 rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2.5 text-sm shadow-none placeholder:text-console-ink-4 focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent";

/** One bordered, rounded list panel — default agents, my agents, skills. */
const SECTION_BOX = "rounded-xl border-[0.5px] border-[color:var(--hairline)] bg-console-surface/60 p-5";

/** Fixed height: filtering never grows or shrinks the section. */
const SECTION_LIST = "h-[22rem] overflow-x-hidden overflow-y-auto pr-1";

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
    const [newDraft, setNewDraft] = useState<Draft>({ name: "", soul: "", skill: "", tags: [], tagText: "" });
    const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [defaults, setDefaults] = useState<DefaultAgentRow[]>([]);

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
        if (!d.name.trim() || !d.soul.trim()) return false; // blank → keep the last saved version
        setSaving(true);
        try {
            const payload = {
                id,
                _id: id,
                name: d.name.trim(),
                persona: { philosophy: d.soul },
                skills: d.skill ? [{ skill_id: d.skill, weight: 5 }] : [],
            };
            await AgentService.updateAgent(payload);
            putTags(id, finalTags(d.tags, d.tagText));
            setAgents((prev) =>
                prev.map((a) => ((a.id || a._id) === id ? { ...a, name: payload.name, persona: payload.persona, skills: payload.skills } : a)),
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
        if (!draft.name.trim() || !draft.soul.trim()) return; // never persist a blank field
        const t = setTimeout(() => { void saveDraft(expanded, draft); }, 700);
        return () => clearTimeout(t);
    }, [dirty, expanded, draft]);

    /** Leaving a blank field puts the last saved text back — raw markdown
     *  stays editable, but an accidental select-all-delete can't stick. */
    const restoreIfBlank = () => {
        if (!expanded || !draft) return;
        if (draft.name.trim() && draft.soul.trim()) return;
        const saved = agents.find((x) => (x.id || x._id) === expanded);
        if (!saved) return;
        const base = toDraft(saved);
        setDraft({
            ...draft,
            name: draft.name.trim() ? draft.name : base.name,
            soul: draft.soul.trim() ? draft.soul : base.soul,
        });
        toaster.create({
            title: "Blank field restored",
            description: "An agent's name and prompt can't be empty — the last saved text came back.",
            type: "info",
        });
    };

    const patchDraft = (p: Partial<Draft>) => {
        setDraft((d) => (d ? { ...d, ...p } : d));
        setDirty(true);
    };

    /** Closing the editor flushes the pending debounce — never drop typing. */
    const closeEditor = () => {
        if (expanded && dirty && draft && draft.name.trim() && draft.soul.trim()) void saveDraft(expanded, draft);
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
        setNewDraft({ name: "", soul: "", skill: skills[0]?.id || "", tags: [], tagText: "" });
    };

    const adoptAgent = (created: Agent, d: Draft) => {
        const id = created.id || created._id || "";
        if (id) {
            setAgents((prev) => [{ ...created, id, _id: id }, ...prev]);
            putTags(id, finalTags(d.tags, d.tagText));
        }
        setCreateOpen(false);
        setNewDraft({ name: "", soul: "", skill: skills[0]?.id || "", tags: [], tagText: "" });
        if (id) {
            setExpanded(id);
            setDraft(d);
            setDirty(false);
        }
    };

    const submitCreate = async () => {
        const name = newDraft.name.trim();
        const soul = newDraft.soul.trim();
        if (!name) {
            toaster.create({ title: "Name required", description: "Give this agent a name.", type: "error" });
            return;
        }
        if (!soul) {
            toaster.create({ title: "Prompt required", description: "An agent is its system prompt — write one to create it.", type: "error" });
            return;
        }
        try {
            const created = await AgentService.createAgent({
                name,
                persona: { philosophy: soul },
                skills: newDraft.skill ? [{ skill_id: newDraft.skill, weight: 5 }] : [],
            });
            adoptAgent(created || {}, { name, soul, skill: newDraft.skill, tags: newDraft.tags, tagText: newDraft.tagText });
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

    /* ── Derived ──────────────────────────────────────────────────────── */

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return agents;
        return agents.filter(
            (a) =>
                a.name?.toLowerCase().includes(q) ||
                creedOf(a).toLowerCase().includes(q) ||
                (a.skills || []).some((s) => nameOf(s.skill_id).toLowerCase().includes(q)),
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agents, query, skills]);

    const blank = !!draft && (!draft.name.trim() || !draft.soul.trim());
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
            {/* Header — title, action on one line */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                    <h1 className="font-app-body shrink-0 text-[30px] leading-none font-light tracking-tight text-console-ink">
                        Agents
                    </h1>
                    <p className="mt-1.5 font-app-body text-[12px] font-normal text-console-ink-3">
                        Investment agents to analyze, track and monitor the markets.
                    </p>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto px-4"
                    onClick={openCreate}
                    data-testid="new-agent"
                >
                    <Plus /> New agent
                </Button>
            </div>

            {/* ── Create agent — popup ── */}
            <Dialog open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false); }}>
                <DialogContent showCloseButton={false} className="sm:max-w-xl" data-testid="agent-create-form">
                    <DialogTitle className="font-app-body text-[14px] font-normal text-console-ink">New agent</DialogTitle>
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
                    <FormSection title="System prompt">
                        <FormRow label="Raw markdown">
                            <Textarea
                                value={newDraft.soul}
                                onChange={(e) => setNewDraft((d) => ({ ...d, soul: e.target.value }))}
                                placeholder={"You are an analyst who…\n\n## Beliefs\n- …\n\n## Rules\n- …"}
                                aria-label="Agent system prompt"
                                className={SOUL_TEXTAREA}
                                data-testid="agent-soul-input"
                            />
                        </FormRow>
                    </FormSection>
                    <div className="flex items-center justify-end gap-2 pt-2">
                        <Button size="sm" onClick={submitCreate} data-testid="agent-create-submit">
                            <Plus /> Create agent
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>
                            <X /> Cancel
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ── Agents side by side: defaults left, yours right ── */}
            <div className="mt-6 grid gap-x-12 gap-y-10 lg:grid-cols-2">
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
                    </div>
                    <div className={cn("mt-2 w-full", SECTION_LIST)}>
                        {defaults.length === 0 && (
                            <p className="py-6 text-center font-app-body text-sm text-console-ink-3">No default agents found.</p>
                        )}
                        {defaults.map((d) => (
                            <div key={d.name} className="-mx-2 flex w-full cursor-pointer items-center gap-3 rounded-[8px] px-2 py-3 transition-colors hover:bg-[var(--surface-raised-hover)]">
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
                    </div>
                    {loading ? (
                        <div className="mt-4 h-[22rem] space-y-4">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="h-16 animate-pulse rounded-none bg-console-recessed/30" />
                            ))}
                        </div>
                    ) : fetchError ? (
                        <div className="mt-4 flex h-[22rem] flex-col items-center justify-center text-center">
                            <p className="font-app-display text-lg font-normal text-console-ink">The Agent Console could not reach the server.</p>
                            <p className="mt-1 font-app-body text-sm text-console-ink-2">The agent API may be unavailable. Reload to try again.</p>
                        </div>
                    ) : agents.length === 0 ? (
                        <div className="mt-4 flex h-[22rem] flex-col items-center justify-center text-center">
                            <p className="font-app-display text-lg font-normal text-console-ink">No agents yet.</p>
                            <p className="mx-auto mt-1.5 max-w-[46ch] font-app-body text-sm text-console-ink-2">
                                An agent is a system prompt and a skill. Write the prompt and pick a skill to start.
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
                                    <div key={id} className="-mx-2 w-full cursor-pointer rounded-[8px] px-2 py-3 transition-colors hover:bg-[var(--surface-raised-hover)]">
                                        <div className="group flex items-start gap-3">
                                            <button
                                                type="button"
                                                onClick={() => toggleAgent(agent)}
                                                aria-expanded={isOpen}
                                                aria-label={`${isOpen ? "Close" : "Edit"} ${agent.name || "agent"}`}
                                                className="flex w-full min-w-0 flex-wrap items-start gap-x-5 gap-y-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                                            >
                                                <AgentAvatar agent={agent} size={48} label={agent.name || "Agent"} />
                                                {/* Left: name over the created date */}
                                                <span className="flex min-w-0 shrink flex-col gap-1">
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
                                                className="mt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                                onClick={() => setDeleteTarget(agent)}
                                            >
                                                <Trash2 className="text-console-ink-3" />
                                            </Button>
                                            {isOpen ? <ChevronDown className="mt-2 size-4 shrink-0 text-console-ink-4" /> : <ChevronRight className="mt-2 size-4 shrink-0 text-console-ink-4" />}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>

            {/* ── Edit my agent — popup ── */}
            <Dialog open={!!expanded && !!draft} onOpenChange={(open) => { if (!open) closeEditor(); }}>
                {draft && (
                    <DialogContent showCloseButton={false} className="sm:max-w-xl" data-testid="agent-inline-editor">
                        <DialogTitle className="flex items-center justify-between gap-3 font-app-body text-[14px] font-normal text-console-ink">
                            <span className="truncate">{draft.name || "Untitled agent"}</span>
                            <span className="flex shrink-0 items-center gap-1.5">
                                <span className={cn("size-1.5 rounded-full", saveState.cls)} />
                                <span className="text-[11px] font-medium text-console-ink-3">{saveState.label}</span>
                            </span>
                        </DialogTitle>
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
                        <FormSection title="System prompt">
                            <FormRow label="Raw markdown">
                                <Textarea
                                    value={draft.soul}
                                    onChange={(e) => patchDraft({ soul: e.target.value })}
                                    onBlur={restoreIfBlank}
                                    aria-label="Agent system prompt"
                                    className={SOUL_TEXTAREA}
                                    data-testid="agent-soul-editor"
                                />
                            </FormRow>
                        </FormSection>
                        <div className="flex items-center justify-end gap-2 pt-2">
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

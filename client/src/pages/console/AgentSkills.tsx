import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Trash2, Globe, BadgeCheck } from "lucide-react";
import { SkillService, type SkillSummary } from "@/db";
import { useSkillLibrary } from "@/components/skills/SkillBrowser";
import SkillAvatar from "@/components/shared/SkillAvatar";
import SkillWorkspace from "@/components/skills/SkillWorkspace";
import SkillImportPane from "@/components/skills/SkillImportPane";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toaster } from "@/compat/ui";
import { SkillSourceBadge } from "@/components/console/SkillSourceBadge";
import { SectionSearch } from "@/components/console/SectionSearch";
import { cn } from "@/lib/utils";

/**
 * Agent Skills — one full-width console page. Title and the create actions
 * share one line on top; below, Default skills and My skills sit side by side
 * as bordered rows (logo, name left; the start of the description right).
 * Opening a skill swaps in the SkillWorkspace, and creating one opens it in a
 * popup: a navigable file tree beside the editor, so references/ and assets/
 * are just files you click.
 */

type Mode = "inspect" | "create" | "download";

/** One bordered, rounded list panel — default skills, my skills. */
/** Thin hairline box with medium (12px) corners — the Default skills section
 *  only; My skills sits straight on the canvas. */
const SECTION_BOX = "rounded-xl border-[0.5px] border-[color:var(--hairline)] p-5";

/** Fixed height: filtering never grows or shrinks the section. */
/** Mobile: hug the listed rows, capped. Laptop (md+): the original fixed
 *  height. */
const SECTION_LIST = "max-h-[22rem] overflow-x-hidden overflow-y-auto pr-1 md:h-[22rem]";

function formatDate(dateStr?: string): string {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function matches(s: SkillSummary, q: string): boolean {
    if (!q) return true;
    return s.name.toLowerCase().includes(q)
        || s.description.toLowerCase().includes(q)
        || (s.tags || []).some((t) => t.toLowerCase().includes(q));
}

export default function AgentSkills({ heading: Heading = "h1" }: { heading?: "h1" | "h2" }) {
    const [searchParams, setSearchParams] = useSearchParams();
    const { library, loading, error: libraryError, setLibrary } = useSkillLibrary();
    const [selected, setSelected] = useState<SkillSummary | null>(null);
    const [mode, setMode] = useState<Mode>("inspect");
    const [qDefault, setQDefault] = useState("");
    const [qMine, setQMine] = useState("");

    const requestedSkill = searchParams.get("skill");

    // Deep link: /my-workspace?skill=<id> (navbar search + agent settings page).
    // The sidebar link clears the param — that must close the open skill too,
    // otherwise clicking "Agent Skills" while a skill is open goes nowhere.
    useEffect(() => {
        if (requestedSkill && library.length) {
            const s = library.find((x) => x.id === requestedSkill);
            if (s) { setSelected(s); setMode("inspect"); }
        } else if (!requestedSkill) {
            setSelected(null);
        }
    }, [requestedSkill, library]);

    // Shipped defaults (services/config/skills) on one side, the user's own on the other.
    const defaults = useMemo(() => {
        const q = qDefault.trim().toLowerCase();
        return library.filter((s) => s.source === "builtin" && matches(s, q));
    }, [library, qDefault]);

    const mine = useMemo(() => {
        const q = qMine.trim().toLowerCase();
        return library.filter((s) => s.source !== "builtin" && matches(s, q));
    }, [library, qMine]);

    const openSkill = (s: SkillSummary) => {
        setSelected(s);
        setMode("inspect");
        setSearchParams({ skill: s.id }, { replace: true });
    };

    const backToGrid = () => {
        setSelected(null);
        setMode("inspect");
        setSearchParams({}, { replace: true });
    };

    const startCreate = () => {
        setMode("create");
        setSelected(null);
        setSearchParams({}, { replace: true });
    };

    const startDownload = () => {
        setMode("download");
        setSelected(null);
        setSearchParams({}, { replace: true });
    };

    const isDetail = mode === "inspect" && !!selected;

    const rowOf = (s: SkillSummary) => (
        <button
            key={s.id}
            onClick={() => openSkill(s)}
            className="group -mx-2 flex w-full cursor-pointer flex-wrap items-start gap-x-5 gap-y-2 rounded-[8px] px-2 py-4 text-left transition-colors hover:bg-[var(--surface-raised-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
        >
            <SkillAvatar skill={s} size={48} round />
            <span className="flex min-w-0 shrink flex-col gap-1">
                <span className="block truncate font-app-body text-[18px] leading-tight font-light text-console-ink">
                    {s.name}
                </span>
                <span className="block font-app-body text-[13px] font-light text-console-ink-4">
                    Created {formatDate(s.created_at)}
                </span>
                {s.tags?.length ? (
                    <span className="flex flex-wrap gap-1.5">
                        {s.tags.map((t) => (
                            <span key={t} className="font-app-body text-[13px] font-light text-console-ink-3">
                                {t}
                            </span>
                        ))}
                    </span>
                ) : null}
            </span>
        </button>
    );

    /* ── Main pane: detail > grid (create lives in a popup) ───────────── */

    const body = (() => {
        if (mode === "download") {
            return (
                <SkillImportPane
                    library={library}
                    onCancel={() => setMode("inspect")}
                    onSaved={(skill) =>
                        setLibrary((lib) => [...lib.filter((s) => s.id !== skill.id), skill])
                    }
                />
            );
        }

        // Two lists side by side: shipped defaults, then the user's own.
        if (loading) {
            return (
                <div className="mt-6 flex max-h-[27rem] flex-col gap-4 overflow-hidden md:h-[27rem]" role="status" aria-label="Loading skills">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-14 animate-pulse rounded-none bg-console-recessed/30" />
                    ))}
                </div>
            );
        }
        if (libraryError) {
            return (
                <p className="mt-6 flex items-center justify-center py-12 font-app-body text-[13px] text-console-negative md:h-[27rem] md:py-0">
                    The skill library could not be loaded. Reload to retry.
                </p>
            );
        }

        return (
            <div className="mt-6 grid gap-x-10 gap-y-8 lg:grid-cols-2">
                <section className={SECTION_BOX}>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0">
                            <h2 className="font-app-body text-[20px] leading-none font-light tracking-tight text-console-ink">
                                Default skills
                            </h2>
                            <p className="mt-1.5 flex items-center gap-1.5 font-app-body text-[13px] font-light text-console-ink-3">
                                Relativity verified skills
                                <BadgeCheck className="size-3.5 shrink-0 text-console-accent" aria-hidden />
                            </p>
                        </div>
                        <SectionSearch label="Search default skills" placeholder="Search defaults…" value={qDefault} onChange={setQDefault} />
                    </div>
                    <div className={cn("mt-1 w-full", SECTION_LIST)}>
                        {defaults.length === 0 && (
                            <p className="py-6 text-center font-app-body text-sm text-console-ink-3">No default skills match that search.</p>
                        )}
                        {defaults.map(rowOf)}
                    </div>
                </section>

                {/* My skills sits straight on the canvas — no box */}
                <section>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0">
                            <h2 className="font-app-body text-[20px] leading-none font-light tracking-tight text-console-ink">
                                My skills
                            </h2>
                            <p className="mt-1.5 font-app-body text-[13px] font-light text-console-ink-3">
                                Your own — click one to edit.
                            </p>
                        </div>
                        <SectionSearch label="Search my skills" placeholder="Search my skills…" value={qMine} onChange={setQMine} />
                    </div>
                    <div className={cn("mt-1 w-full", SECTION_LIST)}>
                        {mine.length === 0 && (
                            <p className="py-6 text-center font-app-body text-sm text-console-ink-3">
                                {library.length === 0
                                    ? "No skills yet — download one from GitHub or create it manually."
                                    : "No skills match that search."}
                            </p>
                        )}
                        {mine.map(rowOf)}
                    </div>
                </section>
            </div>
        );
    })();

    return (
        <div className="w-full py-8">
            <div className="flex flex-wrap items-center gap-3">
                <Heading className="font-app-body shrink-0 text-[30px] leading-none font-light tracking-tight text-console-ink">
                    Skills
                </Heading>
                {mode === "inspect" && (
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="px-4"
                            onClick={startCreate}
                            data-testid="new-skill"
                        >
                            <Plus /> Create new skill
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={startDownload}
                            className="bg-transparent font-light text-console-accent hover:bg-transparent hover:text-console-ink!"
                        >
                            <Globe /> Download skills
                        </Button>
                    </div>
                )}
            </div>
            <p className="mt-2 font-app-body text-[13px] font-light text-console-ink-3">
                Add on capabilities for your agents.
            </p>

            {body}

            {/* ── Skill editor — popup, near full-screen ── */}
            <Dialog
                open={mode === "create" || isDetail}
                onOpenChange={(open) => {
                    if (open) return;
                    if (mode === "create") setMode("inspect");
                    else backToGrid();
                }}
            >
                <DialogContent
                    showCloseButton={false}
                    className="flex h-[90vh] w-[88vw] max-w-[1280px] flex-col overflow-hidden border-0 bg-console-surface p-0 sm:max-w-[1280px]"
                >
                    {mode === "create" ? (
                        <SkillWorkspace
                            library={library}
                            onCancel={() => setMode("inspect")}
                            onSaved={(skill) => {
                                setLibrary((lib) => [...lib.filter((s) => s.id !== skill.id), skill]);
                                setSelected(skill); setMode("inspect");
                                setSearchParams({ skill: skill.id }, { replace: true });
                            }}
                            asideHeader={
                                <DialogTitle className="truncate font-app-body text-[17px] font-light text-console-ink">
                                    New skill
                                </DialogTitle>
                            }
                        />
                    ) : selected ? (
                        <SkillWorkspace
                            key={selected.id}
                            skill={selected}
                            library={library}
                            onCancel={backToGrid}
                            onSaved={(s) => {
                                setLibrary((lib) => lib.map((x) => (x.id === s.id ? s : x)));
                                setSelected(s);
                            }}
                            asideHeader={
                                <div className="flex items-center gap-2">
                                    <SkillAvatar skill={selected} size={26} round />
                                    <DialogTitle className="min-w-0 flex-1 truncate font-app-body text-[16px] font-light text-console-ink">
                                        {selected.name}
                                    </DialogTitle>
                                    <SkillSourceBadge source={selected.source} />
                                    {selected.source === "custom" && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label="Delete skill"
                                            onClick={async () => {
                                                try {
                                                    await SkillService.deleteSkill(selected.id);
                                                    setLibrary((lib) => lib.filter((s) => s.id !== selected.id));
                                                    backToGrid();
                                                } catch (e: any) {
                                                    toaster.create({ title: "Couldn't delete", description: e?.message, type: "error" });
                                                }
                                            }}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </Button>
                                    )}
                                </div>
                            }
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}

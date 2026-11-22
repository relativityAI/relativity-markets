import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    FileText, FilePlus, Folder, FolderOpen, ChevronRight, Trash2, Save,
} from "lucide-react";
import { PluginService } from "@/db";
import { buildTree, deletePath, parentDir, type SkillFiles, type TreeNode } from "@/lib/skillFiles";
import { SkillMarkdown } from "@/components/skills/SkillMarkdown";
import { toaster } from "@/compat/ui";
import { cn } from "@/lib/utils";

/**
 * The plugin navigator — the skill workspace's file tree, plugin-scoped.
 *
 * Left: the plugin directory (plugin.json, skills dirs, scripts…) with
 * add/delete. Right: the selected file, rendered as markdown when it is one,
 * raw otherwise. Edits live in one in-memory map; Save merge-writes only the
 * changed paths (and `deleted`) — the API keeps the rest untouched.
 * Relativity plugins open read-only.
 */
export interface PluginFilesProps {
    pluginId: string;
    editable: boolean;
    /** Open this path first (skill drill-in from the Overview). */
    initialPath?: string;
}

type Issue = { line: number; message: string };

function cleanPath(raw: string): string | null {
    const path = raw.trim().replace(/^\/+/, "");
    if (!path || path.includes("..") || path.includes("\\")) return null;
    const segments = path.split("/");
    if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
    return path;
}

export default function PluginFiles({ pluginId, editable, initialPath }: PluginFilesProps) {
    const [files, setFiles] = useState<SkillFiles | null>(null);
    const [saved, setSaved] = useState("{}");
    const [active, setActive] = useState("");
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [preview, setPreview] = useState(true);
    const [adding, setAdding] = useState<null | "file">(null);
    const [newPath, setNewPath] = useState("");
    const [confirmDel, setConfirmDel] = useState<string | null>(null);
    const [issues, setIssues] = useState<Issue[]>([]);

    useEffect(() => {
        let cancelled = false;
        PluginService.readFiles(pluginId)
            .then(({ files: map }) => {
                if (cancelled) return;
                const next = { ...map };
                setFiles(next);
                setSaved(JSON.stringify(next));
                // Requested file first (skill drill-in), else the manifest.
                setActive(
                    initialPath && next[initialPath] !== undefined
                        ? initialPath
                        : next["plugin.json"] !== undefined
                            ? "plugin.json"
                            : Object.keys(next)[0] || "",
                );
                setLoadError(false);
            })
            .catch(() => { if (!cancelled) setLoadError(true); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pluginId, initialPath]);

    const tree = useMemo(() => buildTree(files || {}), [files]);
    const content = files?.[active] ?? "";
    const isFolder = active.endsWith("/");
    const canPreview = !isFolder && active.endsWith(".md");
    const dirty = files !== null && JSON.stringify(files) !== saved;

    const toggleDir = (path: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });

    const setActiveFile = (path: string) => {
        setActive(path);
        if (!path.endsWith("/")) {
            setCollapsed((prev) => {
                const next = new Set(prev);
                parentDir(path).split("/").filter(Boolean).reduce<string>((acc, seg) => {
                    const dir = `${acc}${seg}/`;
                    next.delete(dir);
                    return dir;
                }, "");
                return next;
            });
        }
    };

    const commitAdd = () => {
        if (!files) return;
        const path = cleanPath(newPath);
        if (!path) {
            toaster.create({ title: "Invalid file path", description: "Use a relative path — no leading / or ..", type: "error" });
            return;
        }
        if (files[path] !== undefined) {
            toaster.create({ title: "Already exists", description: path, type: "error" });
            return;
        }
        setFiles({ ...files, [path]: "" });
        setActive(path);
        setAdding(null);
        setNewPath("");
    };

    const remove = (node: TreeNode) => {
        if (!files) return;
        setFiles(deletePath(files, node.path));
        const prefix = node.path.endsWith("/") ? node.path : node.path + "/";
        if (active === node.path || active.startsWith(prefix)) {
            setActive(files["plugin.json"] !== undefined ? "plugin.json" : "");
        }
        setConfirmDel(null);
    };

    const save = async () => {
        if (!files || saving) return;
        setSaving(true);
        setIssues([]);
        try {
            // Only what actually changed — merge-write on the server.
            const prev: SkillFiles = JSON.parse(saved);
            const changed: SkillFiles = {};
            for (const [path, content] of Object.entries(files)) {
                if (prev[path] !== content) changed[path] = content;
            }
            const deleted = Object.keys(prev).filter((path) => files[path] === undefined);
            if (!Object.keys(changed).length && !deleted.length) {
                setSaving(false);
                return;
            }
            const res = await PluginService.writeFiles(pluginId, changed, deleted);
            const next = { ...res.files };
            setFiles(next);
            setSaved(JSON.stringify(next));
            if (next[active] === undefined) setActive("plugin.json");
        } catch (e: any) {
            const data = typeof e === "object" && e !== null && "response" in e
                ? (e as { response?: { data?: { error?: string; issues?: Issue[] } } }).response?.data
                : undefined;
            if (data?.issues) setIssues(data.issues);
            toaster.create({
                title: "Save failed",
                description: data?.error || e?.message || "The files could not be written.",
                type: "error",
            });
        } finally {
            setSaving(false);
        }
    };

    const renderNodes = (nodes: TreeNode[], depth: number): ReactNode =>
        nodes.map((node) => (
            <li key={node.path}>
                <div
                    className={cn(
                        "group flex items-center gap-1 rounded pr-1",
                        active === node.path ? "text-console-ink" : "text-console-ink-2 hover:text-console-ink",
                    )}
                    style={{ paddingLeft: 8 + depth * 14 }}
                >
                    <button
                        type="button"
                        onClick={() => (node.kind === "dir" ? (toggleDir(node.path), setActive(node.path)) : setActiveFile(node.path))}
                        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left focus-visible:outline-none"
                        aria-current={active === node.path}
                    >
                        {node.kind === "dir" ? (
                            <>
                                <ChevronRight
                                    aria-hidden
                                    className={cn("size-3.5 shrink-0 text-console-ink-4 transition-transform", !collapsed.has(node.path) && "rotate-90")}
                                />
                                {collapsed.has(node.path) ? (
                                    <Folder aria-hidden className="size-3.5 shrink-0 text-console-ink-4" />
                                ) : (
                                    <FolderOpen aria-hidden className="size-3.5 shrink-0 text-console-ink-4" />
                                )}
                            </>
                        ) : (
                            <FileText aria-hidden className="size-3.5 shrink-0 text-console-ink-4" />
                        )}
                        <span className="truncate font-app-mono text-[12px]">{node.name}</span>
                    </button>
                    {editable && (
                        <button
                            type="button"
                            onClick={() => setConfirmDel(node.path)}
                            aria-label={`Delete ${node.name}`}
                            className="rounded p-1 text-console-ink-4 opacity-0 transition hover:text-console-negative group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                        >
                            <Trash2 className="size-3.5" />
                        </button>
                    )}
                </div>
                {confirmDel === node.path && (
                    <div className="my-1 ml-6 flex items-center gap-2 rounded-[6px] border-[0.5px] border-[color:var(--hairline)] px-2 py-1">
                        <span className="min-w-0 flex-1 truncate font-app-body text-[11px] text-console-ink-3">
                            Delete {node.name}{node.kind === "dir" ? " and everything inside it?" : "?"}
                        </span>
                        <button
                            type="button"
                            onClick={() => remove(node)}
                            className="rounded px-1.5 py-0.5 font-app-body text-[11px] text-console-negative transition hover:text-console-ink focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                        >
                            Delete
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirmDel(null)}
                            aria-label="Cancel delete"
                            className="rounded p-0.5 font-app-body text-[11px] text-console-ink-4 transition hover:text-console-ink focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                        >
                            ✕
                        </button>
                    </div>
                )}
                {node.kind === "dir" && !collapsed.has(node.path) && node.children.length > 0 && (
                    <ul>{renderNodes(node.children, depth + 1)}</ul>
                )}
            </li>
        ));

    if (loadError) {
        return <p className="py-8 text-[13px] text-console-negative">Couldn&apos;t load this plugin&apos;s files.</p>;
    }
    if (files === null) {
        return <p className="py-8 text-[13px] text-console-ink-3" role="status">Loading…</p>;
    }

    return (
        <div className="flex h-full min-h-[520px] overflow-hidden rounded-xl border border-border bg-console-surface">
            {/* ── File tree ── */}
            <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-console-surface">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <span className="font-app-mono text-[10px] font-semibold tracking-[0.14em] text-console-ink-3 uppercase">Files</span>
                    {editable && (
                        <button
                            type="button"
                            onClick={() => { setAdding("file"); setNewPath(""); }}
                            aria-label="New file"
                            className="rounded p-1 text-console-ink-3 transition hover:text-console-ink focus-visible:ring-2 focus-visible:ring-console-accent/40 focus-visible:outline-none"
                        >
                            <FilePlus className="size-3.5" />
                        </button>
                    )}
                </div>
                {adding && (
                    <div className="border-b border-border px-2 py-1.5">
                        <input
                            autoFocus
                            value={newPath}
                            onChange={(e) => setNewPath(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") commitAdd();
                                else if (e.key === "Escape") setAdding(null);
                            }}
                            onBlur={() => setAdding(null)}
                            placeholder="path/to/file.md"
                            aria-label="New file path"
                            className="h-7 w-full rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-console-surface px-2 font-app-mono text-[12px] text-console-ink outline-none focus-visible:ring-1 focus-visible:ring-console-accent/40"
                        />
                    </div>
                )}
                <ul className="flex-1 overflow-y-auto py-1.5">
                    {renderNodes(tree, 0)}
                </ul>
            </aside>

            {/* ── Viewer / editor ── */}
            <section className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <span className="min-w-0 flex-1 truncate font-app-mono text-[12px] text-console-ink-2">{active || "—"}</span>
                    {canPreview && (
                        <div className="flex shrink-0 items-center gap-1 rounded-[8px] border border-border p-0.5">
                            <button
                                type="button"
                                aria-label="Rendered"
                                aria-pressed={preview}
                                onClick={() => setPreview(true)}
                                className={cn("rounded-[6px] px-2 py-1 font-app-body text-[11px]", preview ? "bg-console-surface text-console-ink" : "text-console-ink-3")}
                            >
                                Rendered
                            </button>
                            <button
                                type="button"
                                aria-label="Source"
                                aria-pressed={!preview}
                                onClick={() => setPreview(false)}
                                className={cn("rounded-[6px] px-2 py-1 font-app-body text-[11px]", !preview ? "bg-console-surface text-console-ink" : "text-console-ink-3")}
                            >
                                Source
                            </button>
                        </div>
                    )}
                    {editable && (
                        <span className="flex shrink-0 items-center gap-1.5">
                            <span className={cn("size-1.5 rounded-full", dirty ? "bg-console-negative animate-[pulse_3s_ease-in-out_infinite]" : "bg-console-positive")} />
                            <span className="text-[11px] font-medium text-console-ink-3">{dirty ? "Unsaved" : "Saved"}</span>
                            <button
                                type="button"
                                onClick={save}
                                disabled={saving || !dirty}
                                className="ml-1 inline-flex items-center gap-1 rounded-[6px] border border-border px-2.5 py-1 font-app-body text-[12px] text-console-ink transition hover:bg-console-recessed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/40"
                            >
                                <Save className="size-3.5" /> {saving ? "Saving…" : "Save"}
                            </button>
                        </span>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto">
                    {isFolder ? (
                        <p className="px-4 py-6 text-[13px] text-console-ink-3">Folder — pick a file.</p>
                    ) : !active ? (
                        <p className="px-4 py-6 text-[13px] text-console-ink-3">No files in this plugin.</p>
                    ) : canPreview && preview && content.trim() ? (
                        <div
                            onClick={() => editable && setPreview(false)}
                            title={editable ? "Click to edit" : undefined}
                            className={cn("min-h-[420px] px-4 py-3", editable && "cursor-text")}
                        >
                            <SkillMarkdown>{content}</SkillMarkdown>
                        </div>
                    ) : editable ? (
                        <textarea
                            value={content}
                            onChange={(e) => setFiles((prev) => (prev ? { ...prev, [active]: e.target.value } : prev))}
                            spellCheck={false}
                            aria-label={`Editing ${active}`}
                            className="min-h-[420px] w-full resize-none bg-transparent px-4 py-3 font-app-mono text-[12.5px] leading-relaxed text-console-ink-2 focus:outline-none"
                        />
                    ) : (
                        <pre className="min-h-[420px] whitespace-pre-wrap px-4 py-3 font-app-mono text-[12.5px] leading-relaxed text-console-ink-2">
                            {content || "(empty file)"}
                        </pre>
                    )}
                </div>

                {issues.length > 0 && (
                    <div className="border-t border-border px-4 py-2">
                        {issues.map((iss, i) => (
                            <p key={i} className="text-[11.5px] text-console-negative">
                                ✗ line {iss.line}: {iss.message}
                            </p>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

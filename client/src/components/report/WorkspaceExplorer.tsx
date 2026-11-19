import { useMemo, useState } from "react";
import { Box, Flex, Text } from "@/compat/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DownloadIcon } from "lucide-react";
import { FileRoot, FileIconDisplay, FileName, FileSize } from "@/components/assistant-ui/elements/file";

/**
 * Navigable view of the run's in-memory research workspace (the compacted
 * snapshot persisted in analysis_runs.workspace). The file list is built from
 * the assistant-ui File element (ghost rows in the sidebar, exactly the docs'
 * "restyle the row" composition); clicking one renders its content in the
 * file view — a thin border, no other chrome. `live` marks a snapshot the run
 * is still updating.
 */

/** MIME per extension — drives the File element's type-aware icon. */
function mimeTypeFor(path: string): string {
    if (path.endsWith(".md")) return "text/markdown";
    if (path.endsWith(".json")) return "application/json";
    if (path.endsWith(".txt")) return "text/plain";
    if (path.endsWith(".html") || path.endsWith(".htm")) return "text/html";
    if (path.endsWith(".csv")) return "text/csv";
    return "application/octet-stream";
}

/** Snapshot download: builds a one-off blob URL and clicks it away. */
function downloadFile(name: string, content: string): void {
    const blob = new Blob([content], { type: mimeTypeFor(name) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name.split("/").pop() || name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WorkspaceExplorer({ workspace, live = false }: { workspace: Record<string, string>; live?: boolean }) {
    const paths = useMemo(() => Object.keys(workspace).sort(sortPaths), [workspace]);
    const [selected, setSelected] = useState(paths[0] ?? "");
    const content = workspace[selected] ?? "";

    if (!paths.length) {
        return (
            <Text fontSize="13px" color="var(--ink-tertiary)">
                No workspace snapshot for this run.
            </Text>
        );
    }

    const groups = groupPaths(paths);
    return (
        <Flex gap={{ base: 4, md: 5 }} minH="360px" minW={0} flexDirection={{ base: "column", md: "row" }}>
            {/* File list — the default assistant-ui File row: bordered card,
                name with size under it, download button on its side. Stacks
                above the file view on mobile. */}
            <Box
                w={{ base: "full", md: "300px" }}
                flexShrink={0}
                overflowY="auto"
                maxH={{ base: "320px", md: "560px" }}
                data-print-hide
            >
                {groups.map((g) => (
                    <Box key={g.label} py={1}>
                        <Text px={2} py={1} fontSize="11px" fontWeight={600} textTransform="uppercase" letterSpacing="0.04em" color="var(--ink-tertiary)">
                            {g.label}
                            <Text as="span" ml={1.5} fontWeight={400}>({g.paths.length})</Text>
                        </Text>
                        {g.paths.map((p) => (
                            <Box
                                key={p}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelected(p)}
                                onKeyDown={(e: React.KeyboardEvent) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        setSelected(p);
                                    }
                                }}
                                aria-pressed={selected === p}
                                cursor="pointer"
                                mb={1.5}
                            >
                                <FileRoot variant="outline" size="sm" className="w-full">
                                    <FileIconDisplay mimeType={mimeTypeFor(p)} />
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <FileName
                                            className={selected === p ? "text-foreground text-[12px] font-medium" : "text-muted-foreground text-[12px] font-normal"}
                                        >
                                            {displayPath(p, g.label)}
                                        </FileName>
                                        <FileSize bytes={workspace[p]?.length ?? 0} className="text-xs" />
                                    </span>
                                    {/* Same button chrome as the element's own
                                        File.Download — a click-built blob URL so
                                        text snapshots download verbatim. */}
                                    <button
                                        type="button"
                                        aria-label={`Download ${displayPath(p, g.label)}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            downloadFile(p, workspace[p] ?? "");
                                        }}
                                        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground shrink-0 rounded-md p-1 transition-colors"
                                    >
                                        <DownloadIcon className="size-4" />
                                    </button>
                                </FileRoot>
                            </Box>
                        ))}
                    </Box>
                ))}
            </Box>
            {/* File view — a thin, rounded border, nothing else. */}
            <Box flex="1" minW={0} border="1px solid var(--hairline)" borderRadius="xl" overflowY="auto" maxH="560px" px={4} py={3}>
                <Flex align="center" gap={2} mb={3}>
                    <Text fontSize="12px" fontFamily="var(--font-mono, monospace)" color="var(--ink-secondary)" lineClamp={1}>
                        {selected}
                    </Text>
                    <Text fontSize="11px" color="var(--ink-tertiary)">· {(content.length / 1024).toFixed(1)} KB</Text>
                    {live && <Text fontSize="11px" color="var(--signal-positive)">live</Text>}
                </Flex>
                <WorkspaceFileBody path={selected} content={content} />
            </Box>
        </Flex>
    );
}

function WorkspaceFileBody({ path, content }: { path: string; content: string }) {
    if (path.endsWith(".md")) {
        return (
            <Box fontSize="13px" color="var(--ink-primary)" className="skill-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </Box>
        );
    }
    let text = content;
    if (path.endsWith(".json")) {
        try {
            text = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
            // truncated snapshot — render as-is
        }
    }
    return (
        <Box
            as="pre"
            fontSize="12px"
            fontFamily="var(--font-mono, monospace)"
            color="var(--ink-secondary)"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            m={0}
        >
            {text}
        </Box>
    );
}

interface Group {
    label: string;
    paths: string[];
}

function groupPaths(paths: string[]): Group[] {
    const map = new Map<string, string[]>();
    const root: string[] = [];
    for (const p of paths) {
        const rest = p.replace(/^\//, "");
        const slash = rest.indexOf("/");
        if (slash === -1) {
            root.push(p);
            continue;
        }
        const dir = rest.slice(0, slash);
        if (!map.has(dir)) map.set(dir, []);
        map.get(dir)!.push(p);
    }
    const groups: Group[] = [];
    if (root.length) groups.push({ label: "root", paths: root });
    for (const [dir, ps] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        groups.push({ label: dir, paths: ps });
    }
    return groups;
}

/** index.md first, then control, then everything else alphabetically. */
function sortPaths(a: string, b: string): number {
    const rank = (p: string) => (p === "/index.md" ? 0 : p.startsWith("/control/") ? 1 : p.startsWith("/knowledge_base/") ? 2 : p.startsWith("/sources/") ? 3 : 4);
    return rank(a) - rank(b) || a.localeCompare(b);
}

function displayPath(path: string, group: string): string {
    const rest = path.replace(/^\//, "");
    return group === "root" ? rest : rest.slice(group.length + 1);
}

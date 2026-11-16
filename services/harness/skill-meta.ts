import { parse as parseYaml } from "yaml";

export function humanizeName(name: string): string {
  return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function slugifySkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "") || "skill";
}

/** SKILL.md frontmatter peek — id/name/description/category for repo listings. */
export function peekSkillMeta(src: string): { id: string; name: string; description: string; category: string } | null {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return null;
  try {
    const fm = (parseYaml(m[1]) ?? {}) as Record<string, unknown>;
    const id = typeof fm.name === "string" ? fm.name : "";
    if (!id) return null;
    const metadata = (fm.metadata && typeof fm.metadata === "object" ? fm.metadata : {}) as Record<string, unknown>;
    return {
      id,
      name: typeof metadata.title === "string" ? metadata.title : humanizeName(id),
      description: typeof fm.description === "string" ? fm.description : "",
      category: typeof metadata.category === "string" ? metadata.category : "custom",
    };
  } catch {
    return null;
  }
}

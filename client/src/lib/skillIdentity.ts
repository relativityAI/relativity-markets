/**
 * Deterministic skill identity — a unique DiceBear avatar per skill.
 *
 * Mirrors agentIdentity.ts: the seed is the skill's stable id, so a skill
 * looks identical on every screen. The palette (color/tint) is shared with
 * agents via agentIdentity(); only the portrait style differs (Loops).
 */
import { Avatar, Style } from "@dicebear/core";
import loopsDefinition from "@dicebear/styles/loops.json";

const loops = new Style(loopsDefinition);

export interface SkillSeedLike {
    id?: string;
    skill_id?: string;
    name?: string;
}

/** Seed precedence: id → skill_id → name → fallback. */
export function skillSeed(skill?: SkillSeedLike | string | null): string {
    if (!skill) return "skill";
    if (typeof skill === "string") return skill.trim() || "skill";
    return skill.id || skill.skill_id || skill.name?.trim() || "skill";
}

const svgCache = new Map<string, string>();

/** Inline SVG string for the skill's avatar. Memoized per seed. */
export function skillAvatarSvg(seed: string): string {
    const cached = svgCache.get(seed);
    if (cached) return cached;
    const svg = new Avatar(loops, {
        seed,
        // Only the fastest animation variant — same as the agent portraits.
        animationVariant: "fastest",
    })
        .toString()
        .replace("<svg ", '<svg width="100%" height="100%" ');
    if (svgCache.size < 512) svgCache.set(seed, svg);
    return svg;
}

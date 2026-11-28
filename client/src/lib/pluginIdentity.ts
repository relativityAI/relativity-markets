/**
 * Deterministic plugin identity — a unique DiceBear avatar per plugin.
 *
 * Same shape as the old agent/skill identities: the seed is the plugin's
 * stable id, so a plugin looks identical on every screen. Style = Slice,
 * transparent background (the card/page supplies the surface). The built-in
 * Slice palette is used — there is no "electric" preset in the installed
 * DiceBear styles.
 */
import { Avatar, Style } from "@dicebear/core";
import sliceDefinition from "@dicebear/styles/slice.json";

const slice = new Style(sliceDefinition);

export interface PluginSeedLike {
    id?: string;
    plugin_id?: string;
    display_name?: string;
    name?: string;
    /** Custom image URL — when set it replaces the generated mark. */
    avatar?: string | null;
}

/** Seed precedence: id → plugin_id → display_name → name → fallback. */
export function pluginSeed(plugin?: PluginSeedLike | string | null): string {
    if (!plugin) return "plugin";
    if (typeof plugin === "string") return plugin.trim() || "plugin";
    return plugin.id || plugin.plugin_id || plugin.display_name?.trim() || plugin.name?.trim() || "plugin";
}

const svgCache = new Map<string, string>();

/** Inline SVG string for the plugin's avatar. Memoized per seed. */
export function pluginAvatarSvg(seed: string): string {
    const cached = svgCache.get(seed);
    if (cached) return cached;
    const svg = new Avatar(slice, {
        seed,
        // No background — the surface behind the chip stays the design's.
        backgroundColor: [],
    })
        .toString()
        .replace("<svg ", '<svg width="100%" height="100%" ');
    if (svgCache.size < 512) svgCache.set(seed, svg);
    return svg;
}

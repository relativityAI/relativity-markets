import { useMemo, type CSSProperties } from "react";
import { Box } from "@/compat/ui";
import { pluginAvatarSvg, pluginSeed, type PluginSeedLike } from "@/lib/pluginIdentity";

export interface PluginAvatarProps {
    /** Plugin object, or a raw id/name string. */
    plugin: PluginSeedLike | string | null | undefined;
    /** Chip size in px. Default 24. */
    size?: number;
    /** Sizing classes (e.g. "size-16 sm:size-20") — overrides `size` so the
     *  chip can respond to the space its container has. */
    className?: string;
    /**
     * Accessible label. Pass the plugin name when the chip stands alone;
     * omit when the name renders right beside it (the chip then becomes
     * decorative and aria-hidden).
     */
    label?: string;
}

/**
 * A plugin's identity chip: a DiceBear Slice mark on the bare surface
 * (no background). Deterministic — same plugin, same chip, everywhere.
 */
export default function PluginAvatar({ plugin, size = 24, label, className }: PluginAvatarProps) {
    const seed = useMemo(() => pluginSeed(plugin), [plugin]);
    const svg = useMemo(() => pluginAvatarSvg(seed), [seed]);

    return (
        <Box
            as="span"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            flexShrink={0}
            w={className ? undefined : `${size}px`}
            h={className ? undefined : `${size}px`}
            overflow="hidden"
            className={className}
            role={label ? "img" : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        >
            <span
                style={{ width: "90%", height: "90%", display: "block" } as CSSProperties}
                dangerouslySetInnerHTML={{ __html: svg }}
            />
        </Box>
    );
}

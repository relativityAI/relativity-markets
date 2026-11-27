import { useMemo, useState, type CSSProperties } from "react";
import { Box } from "@/compat/ui";
import { cn } from "@/lib/utils";
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
 * A plugin's identity chip: the DiceBear Slice mark on the bare surface (no
 * background), deterministic — same plugin, same chip, everywhere. When the
 * plugin carries a custom image it sits behind the mark and fans out beside
 * it on hover (transform/width only — the chip's box never grows, so nothing
 * around it moves).
 */
export default function PluginAvatar({ plugin, size = 24, label, className }: PluginAvatarProps) {
    const seed = useMemo(() => pluginSeed(plugin), [plugin]);
    const svg = useMemo(() => pluginAvatarSvg(seed), [seed]);
    const custom = typeof plugin === "object" ? plugin?.avatar?.trim() : "";
    // A dead image URL falls back to the generated mark instead of a broken box.
    const [imgFailed, setImgFailed] = useState(false);
    const opened = !!custom && !imgFailed;

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
            className={cn(className, opened && "group/av")}
            role={label ? "img" : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        >
            {opened ? (
                <span className="flex h-full w-full items-center justify-center transition-[gap] duration-300 ease-out group-hover/av:gap-[8%]">
                    {/* The mark stays in front; it makes room as the logo opens out. */}
                    <span className="flex h-full w-full shrink-0 items-center justify-center transition-[width] duration-300 ease-out group-hover/av:w-[46%]">
                        <span
                            style={{ width: "90%", height: "90%", display: "block" } as CSSProperties}
                            dangerouslySetInnerHTML={{ __html: svg }}
                        />
                    </span>
                    {/* The custom logo — hidden behind the mark until hover opens it. */}
                    <img
                        src={custom}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        onError={() => setImgFailed(true)}
                        className="h-full w-0 shrink-0 rounded-full object-cover opacity-0 transition-all duration-300 ease-out group-hover/av:w-[46%] group-hover/av:opacity-100"
                    />
                </span>
            ) : (
                <span
                    style={{ width: "90%", height: "90%", display: "block" } as CSSProperties}
                    dangerouslySetInnerHTML={{ __html: svg }}
                />
            )}
        </Box>
    );
}

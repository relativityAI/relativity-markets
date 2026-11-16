import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Box-header search: a magnifier icon that expands right→left into a field
 *  (the right edge stays put), and collapses back 5s after typing stops while
 *  the field is empty. The field is ALWAYS rendered and clipped by the
 *  wrapper (.section-search in index.css) — display:none would kill the fade,
 *  since a hidden element has no prior computed style to transition from. */
export function SectionSearch({ label, placeholder, value, onChange }: {
    label: string; placeholder: string; value: string; onChange: (v: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open || value) return;
        const t = setTimeout(() => {
            setOpen(false);
            ref.current?.blur();
        }, 5000);
        return () => clearTimeout(t);
    }, [open, value]);

    useEffect(() => {
        if (open) ref.current?.focus();
    }, [open]);

    return (
        <div data-open={open} className="section-search relative ml-auto flex shrink-0 items-center justify-end">
            <Input
                ref={ref}
                className="section-search-field h-9 rounded-[6px] pl-3 pr-9"
                placeholder={placeholder}
                aria-label={label}
                aria-hidden={!open}
                tabIndex={open ? 0 : -1}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); ref.current?.blur(); } }}
            />
            <button
                type="button"
                aria-label={label}
                onClick={() => setOpen(true)}
                className="absolute top-0 right-0 flex size-9 items-center justify-center rounded-[6px] text-console-ink-4 hover:text-console-ink-2"
            >
                <Search className="size-4" />
            </button>
        </div>
    );
}

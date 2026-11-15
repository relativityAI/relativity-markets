import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Box-header search: a magnifier icon that expands right→left into a field
 *  (the right edge stays put), and collapses back 5s after typing stops while
 *  the field is empty. */
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

    // Focus after the open render: while collapsed the field is display:none,
    // and focus() on a hidden element is a no-op.
    useEffect(() => {
        if (open) ref.current?.focus();
    }, [open]);

    return (
        <div
            className="relative ml-auto flex shrink-0 items-center"
            style={{ width: open ? "192px" : "36px", transition: "width 300ms cubic-bezier(0.22, 1, 0.36, 1)" }}
        >
            <Input
                ref={ref}
                className="h-9 w-auto min-w-0 flex-1 rounded-[6px] pl-3 pr-9 transition-opacity duration-200"
                style={{ opacity: open ? 1 : 0, display: open ? "block" : "none" }}
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
                className="absolute top-0 right-0 flex size-9 items-center justify-center rounded-[6px] text-console-ink-4 transition-colors hover:text-console-ink-2"
            >
                <Search className="size-4" />
            </button>
        </div>
    );
}

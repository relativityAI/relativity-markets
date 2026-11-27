import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Calendar } from "lucide-react";
import {
    Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Date & time picker in the boxed-panel style: a month calendar card
 * (‹ month year ›, day grid, Cancel/OK), a time card (hour/min steppers with
 * boxed arrows, AM/PM segmented control), and a scrollable year card.
 * Value is a local datetime; `onChange` fires on OK only.
 */

export interface DateTimeValue {
    /** "YYYY-MM-DD" local calendar date. */
    date: string;
    /** "HH:MM" 24h wall-clock time. */
    time: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Local "YYYY-MM-DD" for a Date (no UTC shifting). */
export function toDateKey(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function fromDateKey(key: string): Date {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
}

const CARD = "rounded-xl border-[0.5px] border-[color:var(--hairline)] bg-white dark:bg-[var(--surface-panel)] p-4";
const BOXED = "inline-flex size-7 items-center justify-center rounded-lg border-[0.5px] border-[color:var(--hairline)] bg-white shadow-sm transition-colors hover:bg-[var(--surface-recessed)] dark:bg-transparent cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
const OK_BTN = "h-9 flex-1 rounded-lg bg-[#2563EB] text-[13px] font-medium text-white shadow-none transition-colors hover:bg-[#1d4fd8] cursor-pointer";
const CANCEL_BTN = "h-9 flex-1 rounded-lg border-[0.5px] border-[color:var(--hairline)] bg-white text-[13px] font-medium text-[var(--ink-primary)] shadow-none transition-colors hover:bg-[var(--surface-recessed)] dark:bg-transparent cursor-pointer";

/** Six week-rows (42 cells) covering the visible month, first cell = Sunday. */
function monthGrid(year: number, month: number): { day: Date; inMonth: boolean }[] {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        return { day, inMonth: day.getMonth() === month };
    });
}

export function DateTimePicker({ value, onChange }: { value: DateTimeValue; onChange: (v: DateTimeValue) => void }) {
    const [open, setOpen] = useState(false);
    // Draft state while the popover is open — committed only on OK.
    const [draft, setDraft] = useState<DateTimeValue>(value);
    const [view, setView] = useState(() => fromDateKey(value.date));
    const [hour12, setHour12] = useState(() => {
        const h = Number(value.time.split(":")[0]);
        return h % 12 === 0 ? 12 : h % 12;
    });
    const [pm, setPm] = useState(() => Number(value.time.split(":")[0]) >= 12);

    useEffect(() => {
        if (open) {
            setDraft(value);
            setView(fromDateKey(value.date));
            const h = Number(value.time.split(":")[0]);
            setHour12(h % 12 === 0 ? 12 : h % 12);
            setPm(h >= 12);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const minutes = Number(draft.time.split(":")[1]);
    const hours24 = useMemo(() => {
        const h = hour12 % 12;
        return pm ? h + 12 : h;
    }, [hour12, pm]);

    const commit = () => {
        // draft holds both halves: the clicked day (date) and the steppers'
        // time. `view` is only the month cursor — committing it (the old bug)
        // silently discarded the selected day.
        const next = { ...draft };
        onChange(next);
        setOpen(false);
    };

    const setTime = (h24: number, m: number) => {
        setHour12(h24 % 12 === 0 ? 12 : h24 % 12);
        setPm(h24 >= 12);
        setDraft((d) => ({ ...d, time: `${pad2(h24)}:${pad2(m)}` }));
    };

    const todayKey = toDateKey(new Date());
    const grid = monthGrid(view.getFullYear(), view.getMonth());
    // Render from the committed `value`, never from `view`/steppers — those
    // only move while the popover is open, so the button would keep showing
    // the previous pick after OK.
    const summary = (() => {
        const [y, m, d] = value.date.split("-").map(Number);
        const h24 = Number(value.time.split(":")[0]);
        const h = h24 % 12 === 0 ? 12 : h24 % 12;
        return `${pad2(m)}/${pad2(d)}/${y} · ${h}:${value.time.split(":")[1]} ${h24 >= 12 ? "PM" : "AM"}`;
    })();

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-testid="schedule-datetime"
                    className="flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-full border border-transparent bg-[var(--surface-raised)] px-3.5 text-sm text-console-ink shadow-[0_8px_24px_rgba(0,0,0,0.14)] outline-none transition-shadow focus-visible:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                >
                    <Calendar className="size-4 shrink-0 text-[var(--ink-tertiary)]" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
                    <span className="shrink-0 font-app-body text-[11px] text-[var(--ink-tertiary)]">Change</span>
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="w-auto max-w-[calc(100vw-2rem)] border-none bg-transparent p-0 shadow-none">
                <div className="flex max-w-[calc(100vw-2rem)] flex-col gap-3 sm:flex-row">
                    {/* ── Calendar card ── */}
                    <div className={CARD} data-testid="schedule-calendar">
                        <div className="flex items-center justify-between">
                            <button type="button" aria-label="Previous month" className={BOXED} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>
                                <ChevronLeft className="size-4" />
                            </button>
                            <p className="font-app-body text-[14px] font-medium text-[var(--ink-primary)]">
                                {MONTHS[view.getMonth()]} {view.getFullYear()}
                            </p>
                            <button type="button" aria-label="Next month" className={BOXED} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>
                                <ChevronRight className="size-4" />
                            </button>
                        </div>
                        <div className="mt-3 grid grid-cols-7 gap-1 text-center">
                            {WEEKDAYS.map((w) => (
                                <span key={w} className="font-app-body text-[11px] font-normal text-[var(--ink-tertiary)]">{w}</span>
                            ))}
                            {grid.map(({ day, inMonth }, i) => {
                                const key = toDateKey(day);
                                const selected = key === draft.date;
                                const disabled = key < todayKey;
                                return (
                                    <button
                                        type="button"
                                        key={i}
                                        disabled={disabled}
                                        onClick={() => setDraft((d) => ({ ...d, date: key }))}
                                        aria-pressed={selected}
                                        aria-label={key}
                                        className={cn(
                                            "mx-auto flex size-7 cursor-pointer items-center justify-center rounded-lg text-[12px] transition-colors",
                                            selected
                                                ? "bg-[#2563EB] font-medium text-white"
                                                : disabled
                                                    ? "cursor-not-allowed text-[var(--ink-tertiary)] opacity-40"
                                                    : cn("text-[var(--ink-primary)] hover:bg-[var(--surface-recessed)]", !inMonth && "text-[var(--ink-tertiary)] opacity-50"),
                                            )}
                                    >
                                        {day.getDate()}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="mt-4 flex gap-2">
                            <button type="button" className={CANCEL_BTN} onClick={() => setOpen(false)}>Cancel</button>
                            <button type="button" className={OK_BTN} onClick={commit} data-testid="schedule-datetime-ok">OK</button>
                        </div>
                    </div>

                    {/* ── Time card ── */}
                    <div className={CARD} data-testid="schedule-time">
                        <p className="text-center font-app-body text-[14px] font-medium text-[var(--ink-primary)]">Time</p>
                        <div className="mt-3 flex items-start justify-center gap-5">
                            {([
                                { label: "hour", value: hour12, up: () => setTime((hours24 + 1) % 24, minutes), down: () => setTime((hours24 + 23) % 24, minutes) },
                                { label: "min", value: minutes, up: () => setTime(hours24, (minutes + 15) % 60), down: () => setTime(hours24, (minutes + 45) % 60) },
                            ] as const).map((f) => (
                                <div key={f.label} className="flex flex-col items-center gap-1">
                                    <button type="button" aria-label={`Increase ${f.label}`} className={BOXED} onClick={f.up}><ChevronUp className="size-4" /></button>
                                    <span className="font-app-body text-[22px] font-light leading-none text-[var(--ink-primary)]" style={{ fontVariantNumeric: "tabular-nums" }}>
                                        {pad2(f.value)}
                                    </span>
                                    <span className="font-app-body text-[11px] text-[var(--ink-tertiary)]">{f.label}</span>
                                    <button type="button" aria-label={`Decrease ${f.label}`} className={BOXED} onClick={f.down}><ChevronDown className="size-4" /></button>
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 flex justify-center">
                            <div className="flex overflow-hidden rounded-lg border-[0.5px] border-[color:var(--hairline)]">
                                {(["AM", "PM"] as const).map((m) => {
                                    const on = pm === (m === "PM");
                                    return (
                                        <button
                                            type="button"
                                            key={m}
                                            aria-pressed={on}
                                            onClick={() => { setPm(m === "PM"); setDraft((d) => ({ ...d, time: `${pad2(m === "PM" ? (hour12 % 12) + 12 : hour12 % 12)}:${pad2(minutes)}` })); }}
                                            className={cn(
                                                "px-4 py-1.5 text-[12px] font-medium transition-colors cursor-pointer",
                                                on ? "bg-[var(--surface-recessed)] text-[var(--ink-primary)]" : "bg-white text-[var(--ink-tertiary)] hover:bg-[var(--surface-recessed)] dark:bg-transparent",
                                            )}
                                        >
                                            {m}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <p className="mt-3 text-center font-app-body text-[12px] text-[var(--ink-tertiary)]">
                            {(() => { const h = hours24 % 12 === 0 ? 12 : hours24 % 12; return `${h}:${pad2(minutes)} ${pm ? "PM" : "AM"}`; })()}
                        </p>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

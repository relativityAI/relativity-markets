"use client";

import type { ComponentProps, ReactNode } from "react";
import { CheckIcon, PauseIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { mono, paper } from "./surfaces";

export type AgentState = "working" | "waiting" | "done" | "failed";

export interface StatusStep {
  state: AgentState;
  label: string;
}

export function AgentStatus({
  state,
  label,
  elapsed,
  trailing,
  onRetry,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children" | "state" | "label" | "elapsed"> & {
  state: AgentState;
  label: string;
  elapsed?: string | undefined;
  trailing?: ReactNode | undefined;
  /** Failed state: the round arrow becomes a real button that relaunches the run. */
  onRetry?: (() => void) | undefined;
}) {
  // A focusable button must not sit inside an aria-hidden node.
  const retryable = state === "failed" && onRetry != null;
  return (
    <span
      data-slot="agent-status"
      className={cn(
        paper,
        "flex items-center gap-2.5 rounded-full py-1.5 ps-3.5 pe-1.5",
        className,
      )}
      {...props}
    >
      {state === "done" ? (
        <CheckIcon aria-hidden className="size-3 shrink-0 text-emerald-500" />
      ) : state === "failed" ? (
        <XIcon aria-hidden className="text-destructive size-3 shrink-0" />
      ) : (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full motion-reduce:animate-none",
            state === "working"
              ? "animate-pulse bg-blue-500 dark:bg-blue-400"
              : "border-foreground/35 border",
          )}
        />
      )}
      <span className="sr-only">{state}</span>
      <span
        key={label}
        className="fade-in blur-in-[2px] animate-in max-w-44 truncate text-xs duration-300 motion-reduce:animate-none"
      >
        {label}
      </span>
      {elapsed !== undefined && state !== "done" && state !== "failed" && (
        <span className={cn(mono, "text-muted-foreground tabular-nums")}>
          {elapsed}
        </span>
      )}
      <span
        aria-hidden={retryable ? undefined : "true"}
        data-slot="agent-status-trailing"
        className="text-muted-foreground flex size-6 items-center justify-center rounded-full"
      >
        {trailing !== undefined ? (
          trailing
        ) : retryable ? (
          <button
            type="button"
            onClick={onRetry}
            title="Retry run"
            aria-label="Retry run"
            className="flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-[var(--signal-negative)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
          >
            <RotateCcwIcon className="size-3" />
          </button>
        ) : state === "done" || state === "failed" ? (
          <RotateCcwIcon className="size-3" />
        ) : (
          <PauseIcon className="size-3" />
        )}
      </span>
    </span>
  );
}

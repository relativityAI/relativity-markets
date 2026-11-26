"use client";

import type { ComponentProps } from "react";
import { AlertCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { field, mono, paper } from "./surfaces";

/** A failed tool call in the reasoning feed — the error, stated plainly.
 *  No Retry/Skip controls: a trace has no live session to re-run a single
 *  tool against; the run-level Retry on the result page is the real do-over. */
export function ToolError({
  name,
  target,
  message,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "name" | "target" | "message"> & {
  name: string;
  target: string;
  message: string;
}) {
  return (
    <div
      data-slot="tool-error"
      className={cn(
        paper,
        "flex w-full max-w-sm flex-col gap-3 rounded-2xl p-3.5",
        className,
      )}

      {...props}
    >
      <div className="flex items-center gap-2.5">
        <AlertCircleIcon className="size-3.5 shrink-0 text-red-500" />
        <span
          className={cn(mono, "text-muted-foreground min-w-0 wrap-anywhere")}
        >
          {name}
        </span>
        <span className="text-foreground/80 min-w-0 flex-1 truncate text-[13px]">
          {target}
        </span>
      </div>

      <div
        className={cn(
          field,
          "rounded-xl px-3 py-2 font-mono text-[11px] leading-relaxed break-words text-red-700 dark:text-red-300",
        )}
      >
        {message}
      </div>
    </div>
  );
}

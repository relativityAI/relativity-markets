import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    /** Confirm is in flight — disables confirm (and blocks double-fire). */
    busy?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

/**
 * Confirm sheet in the console popup shell — same Dialog the agent editor
 * uses on My Workspace (title style, footer button pair). Props unchanged,
 * so every caller keeps working.
 */
export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = "Delete",
    busy = false,
    onCancel,
    onConfirm,
}: ConfirmDialogProps) {
    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
            <DialogContent showCloseButton={false} className="sm:max-w-xl">
                <DialogTitle className="font-app-body text-[14px] font-normal text-console-ink">
                    {title}
                </DialogTitle>
                <DialogDescription className="font-app-body text-[13px] leading-relaxed font-light text-console-ink-2">
                    {message}
                </DialogDescription>
                <div className="flex items-center justify-end gap-2 pt-2">
                    <Button size="sm" variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        aria-busy={busy || undefined}
                        onClick={() => { if (!busy) onConfirm(); }}
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

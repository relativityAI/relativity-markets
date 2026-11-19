import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ConfirmDialog from "@/components/ConfirmDialog";

describe("ConfirmDialog", () => {
    it("renders in the console popup shell with cancel/confirm actions", () => {
        const onCancel = vi.fn();
        const onConfirm = vi.fn();
        render(
            <ConfirmDialog
                open
                title="Delete run?"
                message="This run will be permanently removed."
                onCancel={onCancel}
                onConfirm={onConfirm}
            />
        );
        // Same shell as the agent editor popup: dialog role + title text.
        expect(screen.getByRole("dialog")).toBeTruthy();
        expect(screen.getByText("Delete run?")).toBeTruthy();
        screen.getByText("Cancel").click();
        screen.getByText("Delete").click();
        expect(onCancel).toHaveBeenCalled();
        expect(onConfirm).toHaveBeenCalled();
    });

    it("disables confirm while busy so the action cannot double-fire", () => {
        const onConfirm = vi.fn();
        render(
            <ConfirmDialog
                open
                busy
                title="Delete run?"
                message="This run will be permanently removed."
                onCancel={vi.fn()}
                onConfirm={onConfirm}
            />
        );
        const confirm = screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);
        confirm.click();
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

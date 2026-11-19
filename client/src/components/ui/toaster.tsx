"use client"

/**
 * Toaster — the Chakra Toast API (`toaster.create({ title, description, type })`)
 * backed by sonner, which the app already ships. The Chakra runtime is gone;
 * App.tsx still mounts <Toaster /> in the same place.
 */
import { toast, Toaster as SonnerToaster } from "sonner";

interface ToastInput {
    title?: string;
    description?: string;
    type?: "info" | "success" | "warning" | "error" | "loading";
    duration?: number;
    action?: { label: string; onClick: () => void };
}

type ToastTitle = Parameters<typeof toast.info>[0];
type ToastData = Parameters<typeof toast.info>[1];
type Emit = (message: ToastTitle, data?: ToastData) => string | number;

const EMIT: Record<string, Emit> = {
    success: toast.success,
    error: toast.error,
    warning: toast.warning,
    info: toast.info,
    loading: toast.loading,
};

export const toaster = {
    create(input: ToastInput) {
        const emit = EMIT[input.type ?? "info"] ?? toast;
        return emit(input.title, {
            description: input.description,
            duration: input.duration,
            action: input.action,
        });
    },
};

export function Toaster() {
    return <SonnerToaster position="bottom-right" richColors closeButton />;
}

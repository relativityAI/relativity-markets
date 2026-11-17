/**
 * @/compat/ui toaster — the Chakra-shaped API, backed by the toaster instance
 * App.tsx actually mounts. A separate sonner shim used to swallow every
 * `toaster.create()` call here (no sonner provider exists), so form validation
 * looked like a dead button.
 */
export { toaster, Toaster } from "@/components/ui/toaster";

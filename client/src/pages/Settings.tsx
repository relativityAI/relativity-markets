import { useState, useEffect } from "react";
import {
    Flex, Text, Box, VStack
} from "@chakra-ui/react";
import { Check, Eye, EyeOff, X, Trash2, Plus, Pencil, ExternalLink, Lock, Sun, Moon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button as UIButton } from "@/components/ui/button";
import { Input as UIInput } from "@/components/ui/input";
import { toaster } from "@/components/ui/toaster";
import { SettingsService } from "@/db";
import { useAuth } from "@/auth/useAuth";
import { useColorMode } from "@/components/ui/color-mode";
import UserAvatar from "@/components/shared/UserAvatar";
import { ModelLogo } from "@/lib/modelLogos";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";

// One card per provider. Every provider the backend can actually route a model
// to is listed here — model_id -> provider is a fixed map server-side, so a
// free-text "custom provider" would be stored but never used.
const MODEL_PROVIDERS = [
    { value: "openai", label: "OpenAI", url: "https://platform.openai.com/api-keys" },
    { value: "gemini", label: "Gemini", url: "https://aistudio.google.com/apikey" },
    { value: "cerebras", label: "Cerebras", url: "https://cloud.cerebras.ai" },
    { value: "groq", label: "Groq", url: "https://console.groq.com/keys" },
    { value: "openrouter", label: "OpenRouter", url: "https://openrouter.ai/keys" },
    { value: "anthropic", label: "Anthropic", url: "https://console.anthropic.com/settings/keys" },
    { value: "mistral", label: "Mistral", url: "https://console.mistral.ai/api-keys" },
    { value: "nvidia", label: "NVIDIA", url: "https://build.nvidia.com/settings/api-keys" },
    { value: "cohere", label: "Cohere", url: "https://dashboard.cohere.com/api-keys" },
    { value: "zai", label: "Z.ai", url: "https://z.ai/manage-apikey/apikey-list" },
];

const providerLabel = (value: string) =>
    value === "tavily" ? "Tavily" : MODEL_PROVIDERS.find((p) => p.value === value)?.label || value;

function StatusPill({ connected }: { connected: boolean }) {
    return (
        <Flex
            align="center"
            gap={1.5}
            px={2}
            py={0.5}
            borderRadius="full"
            w="full"
            flexShrink={0}
            bg={connected ? "color-mix(in srgb, var(--signal-positive) 12%, transparent)" : "var(--surface-recessed)"}
        >
            <Box
                w="6px"
                h="6px"
                borderRadius="full"
                bg={connected ? "var(--signal-positive)" : "var(--ink-tertiary)"}
            />
            <Text fontSize="10.5px" color={connected ? "var(--signal-positive)" : "var(--ink-tertiary)"}>
                {connected ? "Connected" : "Not connected"}
            </Text>
        </Flex>
    );
}

interface ProviderCardProps {
    value: string;
    label: string;
    /** Where to get an API key for this provider — shown as a subtle icon link. */
    url?: string;
    savedKey?: string;
    onSave: (value: string, key: string) => Promise<void>;
    onRemove: (value: string) => Promise<void>;
}

/**
 * One provider row: logo + name + link, full-width status badge, Add/Edit.
 * Clicking opens the key editor as a popup — same shell as the agent editor.
 */
function ProviderCard({ value, label, url, savedKey, onSave, onRemove }: ProviderCardProps) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);

    const connected = !!savedKey;

    // Clearing a half-typed draft happens on close rather than in an effect.
    const reset = () => {
        setDraft("");
        setShowKey(false);
        setConfirmRemove(false);
    };
    const close = () => {
        reset();
        setOpen(false);
    };
    const openEditor = () => {
        reset();
        setOpen(true);
    };

    const handleSave = async () => {
        if (!draft.trim()) {
            toaster.create({ title: "API key is empty", type: "error" });
            return;
        }
        setBusy(true);
        try {
            await onSave(value, draft.trim());
            close(); // collapse on success
        } finally {
            setBusy(false);
        }
    };

    const handleRemove = async () => {
        setBusy(true);
        try {
            await onRemove(value);
            close();
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box w="full">
            {/* Row — click Add/Edit to open the key popup */}
            <Flex
                as="button"
                type="button"
                onClick={openEditor}
                align="center"
                gap={3}
                w="100%"
                minH="56px"
                textAlign="left"
                cursor="pointer"
                px={1}
                borderRadius="2px"
                _hover={{ bg: "var(--surface-recessed)" }}
            >
                <Box w="fit-content" maxW="full">
                    <Flex align="center" gap={2.5} minW={0} w="fit-content" maxW="full">
                        <ModelLogo model={value} size={30} />
                        <Text fontSize="14px" color="var(--ink-primary)" noOfLines={1}>
                            {label}
                        </Text>
                        {url && (
                            <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Get your ${label} API key`}
                                aria-label={`Get your ${label} API key`}
                                onClick={(e) => e.stopPropagation()}
                                style={{ display: "flex", color: "var(--ink-tertiary)", flexShrink: 0 }}
                            >
                                <ExternalLink size={14} />
                            </a>
                        )}
                    </Flex>
                    {/* Badge spans icon → end of name/link */}
                    <Box mt={1.5} w="full">
                        <StatusPill connected={connected} />
                    </Box>
                </Box>
                <Box
                    as="span"
                    display="inline-flex"
                    align="center"
                    gap={1}
                    flexShrink={0}
                    ml="auto"
                    px={2.5}
                    py={1.5}
                    borderRadius="2px"
                    fontSize="12px"
                    color="var(--accent-primary)"
                    _hover={{ bg: "var(--surface-recessed)" }}
                >
                    {connected ? <Pencil size={13} /> : <Plus size={13} />}
                    {connected ? "Edit" : "Add"}
                </Box>
            </Flex>

            {/* Key editor — popup, same shell as the agent editor on My Workspace */}
            <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
                <DialogContent showCloseButton={false} className="sm:max-w-xl">
                    <DialogTitle className="flex items-center gap-2.5 font-app-body text-[14px] font-normal text-console-ink">
                        <ModelLogo model={value} size={22} />
                        <span className="truncate">{label}</span>
                        <span className="ml-auto text-[11px] font-medium text-console-ink-3">
                            {connected ? "Key stored" : "No key"}
                        </span>
                    </DialogTitle>

                    {confirmRemove ? (
                        <div className="flex flex-col gap-2 rounded-[6px] border-[0.5px] border-[color:color-mix(in_srgb,var(--signal-negative)_35%,transparent)] bg-[color-mix(in_srgb,var(--signal-negative)_6%,transparent)] p-3">
                            <p className="text-[12.5px] text-console-ink">
                                Remove the {label} key? Analyses will stop using it immediately.
                            </p>
                            <div className="flex gap-2">
                                <UIButton size="sm" variant="destructive" onClick={handleRemove} disabled={busy}>
                                    {busy ? "Removing…" : <><Trash2 size={14} /> Confirm remove</>}
                                </UIButton>
                                <UIButton size="sm" variant="ghost" onClick={() => setConfirmRemove(false)} disabled={busy}>
                                    <X size={14} /> Cancel
                                </UIButton>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1.5">
                                <span className="font-app-body text-[11px] font-medium tracking-[0.08em] text-console-ink-3 uppercase">
                                    API key
                                </span>
                                <div className="relative">
                                    <UIInput
                                        type={showKey ? "text" : "password"}
                                        placeholder={connected ? `New ${label} key to replace the saved one` : `Paste your ${label} API key`}
                                        value={draft}
                                        onChange={(e) => setDraft(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                                        autoFocus
                                        className="h-9 rounded-[6px] border-[0.5px] border-[color:var(--hairline)] bg-transparent px-2.5 pr-9 text-sm shadow-none placeholder:text-console-ink-4 focus-visible:ring-1 focus-visible:ring-console-accent/40 dark:bg-transparent"
                                    />
                                    <button
                                        type="button"
                                        aria-label={showKey ? "Hide key" : "Show key"}
                                        onClick={() => setShowKey((v) => !v)}
                                        className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-[4px] p-1 text-console-ink-3 hover:text-console-ink"
                                    >
                                        {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                                    </button>
                                </div>
                                <span className="text-[11.5px] text-console-ink-4">
                                    Stored locally on this device.
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <UIButton size="sm" onClick={handleSave} disabled={busy || !draft.trim()}>
                                    {busy ? "Saving…" : <><Check size={14} /> Save key</>}
                                </UIButton>
                                <UIButton size="sm" variant="ghost" onClick={close} disabled={busy}>
                                    Cancel
                                </UIButton>
                                {connected && (
                                    <UIButton
                                        size="sm"
                                        variant="ghost"
                                        className="ml-auto text-console-ink-3 hover:text-[var(--signal-negative)]"
                                        onClick={() => setConfirmRemove(true)}
                                        disabled={busy}
                                    >
                                        <Trash2 size={14} /> Remove
                                    </UIButton>
                                )}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </Box>
    );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <Box
            as={motion.div}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: dur.base, ease }}
            p={{ base: 4, md: 5 }}
        >
            <Text fontSize="13.5px" color="var(--ink-primary)">{title}</Text>
            {subtitle && <Text fontSize="12px" color="var(--ink-tertiary)" mt={0.5}>{subtitle}</Text>}
            <Box mt={4}>{children}</Box>
        </Box>
    );
}

function GridSkeleton() {
    return (
        <Box display="grid" gridTemplateColumns={{ base: "1fr", sm: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }} gap={5}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
                <Box key={i} h="96px">
                    <Flex gap={3} align="center">
                        <Box boxSize="34px" borderRadius="2px" bg="var(--surface-recessed)" />
                        <Box h="13px" w="90px" borderRadius="2px" bg="var(--surface-recessed)" />
                    </Flex>
                </Box>
            ))}
        </Box>
    );
}

function GroupHeader({ title, purpose }: { title: string; purpose: string }) {
    return (
        <Box mb={3} mt={1}>
            <Text
                fontSize="10.5px"
                color="var(--ink-tertiary)"
                textTransform="uppercase"
                letterSpacing="0.06em"
            >
                {title}
            </Text>
            <Text fontSize="12px" color="var(--ink-tertiary)" mt={0.5}>
                {purpose}
            </Text>
        </Box>
    );
}

export default function Settings() {
    const { user } = useAuth();
    const { colorMode, setColorMode } = useColorMode();
    const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        SettingsService.getSettings()
            .then((data) => {
                setSavedKeys({ ...(data.llm_keys || {}) });
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const handleSaveKey = async (provider: string, key: string) => {
        try {
            await SettingsService.updateSettings({ llm_keys: { [provider]: key } });
            setSavedKeys((prev) => ({ ...prev, [provider]: key }));
            toaster.create({ title: `${providerLabel(provider)} API key saved`, type: "success" });
        } catch (e) {
            toaster.create({ title: `Failed to save: ${(e as Error).message}`, type: "error" });
        }
    };

    const handleRemoveKey = async (keyName: string) => {
        try {
            await SettingsService.deleteLLMKey(keyName);
            setSavedKeys((prev) => {
                const next = { ...prev };
                delete next[keyName];
                return next;
            });
            toaster.create({ title: `${providerLabel(keyName)} key removed`, type: "info" });
        } catch (e) {
            toaster.create({ title: `Failed to remove: ${(e as Error).message}`, type: "error" });
        }
    };

    const email = user?.email ?? "";
    const displayName =
        (user?.user_metadata?.name as string | undefined) ??
        (user?.user_metadata?.full_name as string | undefined) ??
        email.split("@")[0] ??
        "User";

    const connectedCount = Object.keys(savedKeys).length;
    const isDark = colorMode === "dark";

    return (
        <Box bg="var(--surface-canvas)" minH="100%">
            <Flex direction="column" gap={6} w="full" px={{ base: 4, md: 8 }} py={6}>
                {/* Header — flat masthead, same title/subtitle treatment as the Runs and New Run pages */}
                <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-0.5">
                    <h1 className="font-app-body min-w-0 text-[26px] leading-[1.1] font-light tracking-[-0.02em] text-[var(--ink-primary)] md:text-[30px]">
                        Settings
                    </h1>
                    <Text fontSize="11.5px" color="var(--ink-tertiary)" whiteSpace="nowrap">
                        {connectedCount} KEY{connectedCount === 1 ? "" : "S"} STORED
                    </Text>
                </header>

                {/* Two-column: account rail on the left, keys on the right */}
                <Box display="grid" gridTemplateColumns={{ base: "1fr", lg: "minmax(280px, 340px) 1fr" }} gap={6} alignItems="start">
                    {/* LEFT RAIL */}
                    <VStack gap={6} align="stretch">
                        <SectionCard title="Account">
                            <Flex align="center" gap={4}>
                                <Box border="1px solid var(--hairline)" borderRadius="2px" overflow="hidden" flexShrink={0}>
                                    <UserAvatar seed={email || displayName} size={{ base: 52, md: 60 }} />
                                </Box>
                                <Box minW={0}>
                                    <Text fontSize="15px" color="var(--ink-primary)" noOfLines={1}>
                                        {displayName}
                                    </Text>
                                    <Text fontSize="12.5px" color="var(--ink-tertiary)" noOfLines={1}>{email}</Text>
                                </Box>
                            </Flex>
                            <Text fontSize="12px" color="var(--ink-tertiary)" mt={4}>
                                Local-first: all your data lives on this machine.
                            </Text>
                        </SectionCard>

                        <SectionCard title="Appearance" subtitle="Choose how Relativity looks on this device.">
                            <Flex gap={1} p={1} bg="var(--surface-recessed)" borderRadius="2px">
                                {[
                                    { v: "light" as const, icon: Sun, label: "Light" },
                                    { v: "dark" as const, icon: Moon, label: "Dark" },
                                ].map((opt) => {
                                    const active = (opt.v === "dark") === isDark;
                                    return (
                                        <Flex
                                            key={opt.v}
                                            as="button"
                                            type="button"
                                            onClick={() => setColorMode(opt.v)}
                                            align="center"
                                            justify="center"
                                            gap={2}
                                            flex={1}
                                            py={2}
                                            borderRadius="2px"
                                            cursor="pointer"
                                            aria-pressed={active}
                                            bg={active ? "var(--surface-panel)" : "transparent"}
                                            boxShadow={active ? "0 1px 2px rgba(0,0,0,0.08)" : "none"}
                                        >
                                            <opt.icon size={14} color={active ? "var(--accent-primary)" : "var(--ink-tertiary)"} />
                                            <Text fontSize="12.5px" color={active ? "var(--ink-primary)" : "var(--ink-tertiary)"}>
                                                {opt.label}
                                            </Text>
                                        </Flex>
                                    );
                                })}
                            </Flex>
                        </SectionCard>
                    </VStack>

                    {/* RIGHT MAIN — API keys */}
                    <Box
                        as={motion.div}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: dur.base, ease }}
                        p={{ base: 4, md: 6 }}
                    >
                        <Flex align="center" gap={2} mb={5}>
                            <Lock size={14} color="var(--ink-tertiary)" />
                            <Text fontSize="12px" color="var(--ink-tertiary)">
                                All keys stored locally.
                            </Text>
                        </Flex>

                        {loading ? (
                            <GridSkeleton />
                        ) : (
                            <>
                                <div className="mb-4">
                                    <h2 className="font-app-body text-[20px] leading-none font-light tracking-tight text-console-ink">
                                        Model Providers
                                    </h2>
                                    <p className="mt-1.5 font-app-body text-[12px] font-normal text-console-ink-3">
                                        Keys here become available as model choices when starting an analysis.
                                    </p>
                                </div>
                                <Box display="flex" flexDirection="column" gap={1} mb={8}>
                                    {MODEL_PROVIDERS.map((p) => (
                                        <ProviderCard
                                            key={p.value}
                                            value={p.value}
                                            label={p.label}
                                            url={p.url}
                                            savedKey={savedKeys[p.value]}
                                            onSave={handleSaveKey}
                                            onRemove={handleRemoveKey}
                                        />
                                    ))}
                                </Box>

                                <GroupHeader
                                    title="Web Search"
                                    purpose="Powers the optional web-search step during analysis."
                                />
                                <Box display="flex" flexDirection="column" gap={1}>
                                    <ProviderCard
                                        value="tavily"
                                        label="Tavily"
                                        url="https://app.tavily.com"
                                        savedKey={savedKeys.tavily}
                                        onSave={handleSaveKey}
                                        onRemove={handleRemoveKey}
                                    />
                                </Box>
                            </>
                        )}
                    </Box>
                </Box>
            </Flex>
        </Box>
    );
}

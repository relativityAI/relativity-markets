import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button as UIButton } from "@/components/ui/button";
import { SettingsService } from "@/db";
import { hasRequiredKeys } from "@/utils";
import { KeyRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

const warnedFlag = (userId: string) => `relativity_keys_warned_${userId}`;

export default function ApiKeySetupDialog({ user }: { user: any }) {
  const [dismissed, setDismissed] = useState<boolean>(() => !!user?.id && !!localStorage.getItem(warnedFlag(user.id)));
  const [isOpen, setIsOpen] = useState(false);
  // null until the settings fetch answers — a failed check must not read as "has a key".
  const [hasLlm, setHasLlm] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user || dismissed) return;

    // Check if keys are set — LLM key is the only hard requirement;
    // web search works without Tavily (SearXNG), Tavily is an upgrade.
    SettingsService.getSettings()
      .then((settings) => {
        const missing = !hasRequiredKeys(settings).hasLlm;
        setHasLlm(!missing);
        if (missing) setIsOpen(true);
      })
      .catch(() => {
        // Fail open: couldn't verify, so ask instead of staying silent.
        setHasLlm(null);
        setIsOpen(true);
      });
  }, [user, dismissed]);

  if (dismissed) return null;

  // Closing (Esc/overlay) hides it for this session only; the "warned" flag is
  // written when the user explicitly skips — one-shot, but never fail-silent.
  const skip = () => {
    if (user?.id) localStorage.setItem(warnedFlag(user.id), "1");
    setDismissed(true);
    setIsOpen(false);
  };

  // Same console popup shell as the agent editor / settings key editor:
  // app-body title with a leading icon, status tag on the right, description
  // below, and a ghost + primary button pair in the footer.
  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) setIsOpen(false); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-xl">
        <DialogTitle className="flex items-center gap-2.5 font-app-body text-[14px] font-normal text-console-ink">
          <KeyRound size={18} className="shrink-0 text-console-ink-3" />
          <span className="truncate">Add your own API keys (optional)</span>
          <span className="ml-auto text-[11px] font-medium text-console-ink-3">
            {hasLlm === null ? "Couldn't check keys" : "No LLM key"}
          </span>
        </DialogTitle>

        <DialogDescription className="font-app-body text-[13px] leading-relaxed font-light text-console-ink-2">
          Runs execute on this machine. Adding your own LLM key lets you use a preferred model and unlocks provider-specific models. Web search works without any key (local SearXNG); a Tavily key upgrades it when you want one.
        </DialogDescription>

        <div className="flex items-center justify-end gap-2 pt-2">
          <UIButton size="sm" variant="ghost" onClick={skip}>
            Skip for now
          </UIButton>
          <UIButton size="sm" onClick={() => { skip(); navigate("/settings"); }}>
            Go to Settings
          </UIButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

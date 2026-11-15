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
  const navigate = useNavigate();

  useEffect(() => {
    if (!user || dismissed) return;

    // Check if keys are set — LLM key is the only hard requirement;
    // web search works without Tavily (SearXNG), Tavily is an upgrade.
    SettingsService.getSettings().then((settings) => {
      const { hasLlm } = hasRequiredKeys(settings);
      if (!hasLlm) {
        setIsOpen(true);
      }
    }).catch(console.error);
  }, [user, dismissed]);

  if (dismissed) return null;

  const dismiss = () => {
    if (user?.id) localStorage.setItem(warnedFlag(user.id), "1");
    setDismissed(true);
    setIsOpen(false);
  };

  // Same console popup shell as the agent editor / settings key editor:
  // app-body title with a leading icon, status tag on the right, description
  // below, and a ghost + primary button pair in the footer.
  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-xl">
        <DialogTitle className="flex items-center gap-2.5 font-app-body text-[14px] font-normal text-console-ink">
          <KeyRound size={18} className="shrink-0 text-console-ink-3" />
          <span className="truncate">Add your own API keys (optional)</span>
          <span className="ml-auto text-[11px] font-medium text-console-ink-3">No LLM key</span>
        </DialogTitle>

        <DialogDescription className="font-app-body text-[13px] leading-relaxed font-light text-console-ink-2">
          Runs execute on this machine. Adding your own LLM key lets you use a preferred model and unlocks provider-specific models. Web search works without any key (local SearXNG); a Tavily key upgrades it when you want one.
        </DialogDescription>

        <div className="flex items-center justify-end gap-2 pt-2">
          <UIButton size="sm" variant="ghost" onClick={dismiss}>
            Skip for now
          </UIButton>
          <UIButton size="sm" onClick={() => { dismiss(); navigate("/settings"); }}>
            Go to Settings
          </UIButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const DISMISSED_KEY = "ahava-pwa-install-dismissed";

// The `beforeinstallprompt` event isn't in the DOM lib typings.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    /* localStorage may be unavailable (private mode); ignore. */
  }
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports as Mac but is touch-capable.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // iOS Safari exposes this non-standard flag when launched from the home screen.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Small, dismissible "Install app" affordance shown in the app header for every
 * role. On Android/Chrome it triggers the native install prompt; on iOS Safari
 * (which fires no such event) it shows a one-line Add-to-Home-Screen hint. It
 * never blocks the UI and remembers a dismissal in localStorage.
 */
export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone() || readDismissed()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowIosHint(false);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // iOS never fires beforeinstallprompt, so surface a manual hint instead.
    if (isIosSafari()) {
      setShowIosHint(true);
      setVisible(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    writeDismissed();
    setVisible(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      /* user closed the prompt; nothing to do */
    }
    setDeferredPrompt(null);
    setVisible(false);
  };

  if (showIosHint) {
    return (
      <div className="flex items-center gap-1" data-testid="pwa-install-ios">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Download className="size-4" />
              <span className="hidden sm:inline">Install app</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-64 text-sm">
            <p className="flex items-center gap-1.5">
              <Share className="size-4 shrink-0" />
              <span>
                Add to Home Screen: tap the Share button, then{" "}
                <strong>Add to Home Screen</strong>.
              </span>
            </p>
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Dismiss install hint"
          onClick={dismiss}
          data-testid="pwa-install-dismiss"
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1" data-testid="pwa-install">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={install}
        data-testid="pwa-install-button"
      >
        <Download className="size-4" />
        <span className="hidden sm:inline">Install app</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label="Dismiss install prompt"
        onClick={dismiss}
        data-testid="pwa-install-dismiss"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

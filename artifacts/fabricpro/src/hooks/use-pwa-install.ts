import { useState, useEffect } from "react";

const DISMISSED_KEY = "fabricpro_pwa_dismissed";

export function usePWAInstall() {
  const [prompt, setPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    const val = localStorage.getItem(DISMISSED_KEY);
    if (!val) return false;
    // Reset dismiss after 3 days so they see it again
    const dismissedAt = Number(val);
    return Date.now() - dismissedAt < 3 * 24 * 60 * 60 * 1000;
  });

  useEffect(() => {
    // Already running as installed PWA
    if (
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true
    ) {
      setIsInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
    };

    const installedHandler = () => {
      setIsInstalled(true);
      setPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const install = async () => {
    if (!prompt) return false;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      setPrompt(null);
      setIsInstalled(true);
    }
    return outcome === "accepted";
  };

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setDismissed(true);
    setPrompt(null);
  };

  const canInstall = !!prompt && !isInstalled && !dismissed;

  return { canInstall, install, dismiss };
}

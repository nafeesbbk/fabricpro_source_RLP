import { usePWAInstall } from "@/hooks/use-pwa-install";

export function PWAInstallBanner() {
  const { canInstall, install, dismiss } = usePWAInstall();

  if (!canInstall) return null;

  return (
    <div className="fixed bottom-16 left-0 right-0 z-40 p-4 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-primary text-primary-foreground rounded-2xl shadow-2xl p-4 flex items-center gap-3 max-w-md mx-auto">
        <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
          <img src="/icon-192.png" alt="FabricPro" className="h-9 w-9" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm leading-tight">FabricPro Install Karo</p>
          <p className="text-xs text-primary-foreground/80 leading-tight mt-0.5">
            Home screen pe add karo — bilkul app jaisi feel
          </p>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={install}
            className="bg-white text-primary font-bold text-xs px-3 py-1.5 rounded-lg hover:bg-white/90 active:scale-95 transition-all"
          >
            Install
          </button>
          <button
            onClick={dismiss}
            className="text-primary-foreground/70 text-xs px-3 py-1 rounded-lg hover:text-primary-foreground transition-colors"
          >
            Baad mein
          </button>
        </div>
      </div>
    </div>
  );
}

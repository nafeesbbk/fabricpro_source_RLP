import { useNetworkStatus } from "@/hooks/use-network-status";
import { cn } from "@/lib/utils";

const STATUS_CONFIG = {
  online: {
    color: "bg-green-500",
    glow: "shadow-[0_0_6px_2px_rgba(34,197,94,0.7)]",
    label: "Online",
    animate: "animate-pulse-slow",
  },
  offline: {
    color: "bg-red-500",
    glow: "shadow-[0_0_6px_2px_rgba(239,68,68,0.7)]",
    label: "Offline",
    animate: "animate-pulse",
  },
  syncing: {
    color: "bg-purple-500",
    glow: "shadow-[0_0_8px_3px_rgba(168,85,247,0.8)]",
    label: "Sync ho raha hai...",
    animate: "animate-pulse",
  },
};

export function NetworkStatusBar() {
  const status = useNetworkStatus();
  const cfg = STATUS_CONFIG[status];

  return (
    <div
      className={cn(
        "fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 py-1 transition-all duration-500",
        status === "online"
          ? "bg-green-950/80"
          : status === "offline"
          ? "bg-red-950/90"
          : "bg-purple-950/90"
      )}
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full inline-block",
          cfg.color,
          cfg.glow,
          cfg.animate
        )}
      />
      <span className="text-[10px] font-semibold text-white/90 uppercase tracking-widest">
        {cfg.label}
      </span>
    </div>
  );
}

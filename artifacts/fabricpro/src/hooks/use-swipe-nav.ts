import { useEffect } from "react";
import { useLocation } from "wouter";

// Main nav pages in display order (left → right)
const MAIN_TABS = [
  "/",
  "/slips",
  "/connections",
  "/chat",
  "/statement",
  "/payments",
  "/profile",
];

const SWIPE_MIN_PX = 70;       // minimum horizontal distance
const SWIPE_MAX_RATIO = 0.65;  // max vertical/horizontal ratio (prevents accidental triggers)
const SWIPE_MAX_MS = 450;      // max gesture duration

function isInsideHorizontalScrollContainer(target: EventTarget | null): boolean {
  let el = target as HTMLElement | null;
  while (el && el !== document.body) {
    const style = window.getComputedStyle(el);
    const overflowX = style.overflowX;
    if (
      (overflowX === "auto" || overflowX === "scroll") &&
      el.scrollWidth > el.clientWidth + 2
    ) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

export function useSwipeNav() {
  const [location, navigate] = useLocation();

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let inScrollContainer = false;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTime = Date.now();
      // If touch starts inside a horizontal scroll container, skip swipe nav
      inScrollContainer = isInsideHorizontalScrollContainer(e.target);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (inScrollContainer) return; // Don't navigate if scrolling inside a strip

      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = Date.now() - startTime;

      if (dt > SWIPE_MAX_MS) return;
      if (Math.abs(dx) < SWIPE_MIN_PX) return;
      if (Math.abs(dy) / Math.abs(dx) > SWIPE_MAX_RATIO) return;

      // Left edge (≤ 28px) swipe right → go back
      if (startX <= 28 && dx > SWIPE_MIN_PX) {
        window.history.back();
        return;
      }

      // Tab-to-tab navigation (only on main tab pages)
      const currentIdx = MAIN_TABS.indexOf(location);
      if (currentIdx === -1) return;

      if (dx < -SWIPE_MIN_PX && currentIdx < MAIN_TABS.length - 1) {
        navigate(MAIN_TABS[currentIdx + 1]);
      } else if (dx > SWIPE_MIN_PX && currentIdx > 0 && startX > 28) {
        navigate(MAIN_TABS[currentIdx - 1]);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [location, navigate]);
}

// Save last visited path to localStorage (called from Layout)
export function saveLastPath(path: string) {
  const SKIP = ["/login", "/verify-otp", "/kyc"];
  if (!SKIP.some((p) => path.startsWith(p))) {
    try { localStorage.setItem("fp_last_path", path); } catch {}
  }
}

export function getLastPath(): string | null {
  try { return localStorage.getItem("fp_last_path"); } catch { return null; }
}

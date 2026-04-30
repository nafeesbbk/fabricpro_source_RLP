import { cn } from "@/lib/utils";

const AVATAR_COLORS = [
  { bg: "bg-rose-100 dark:bg-rose-900/40", text: "text-rose-700 dark:text-rose-300" },
  { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300" },
  { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300" },
  { bg: "bg-lime-100 dark:bg-lime-900/40", text: "text-lime-700 dark:text-lime-300" },
  { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300" },
  { bg: "bg-teal-100 dark:bg-teal-900/40", text: "text-teal-700 dark:text-teal-300" },
  { bg: "bg-cyan-100 dark:bg-cyan-900/40", text: "text-cyan-700 dark:text-cyan-300" },
  { bg: "bg-sky-100 dark:bg-sky-900/40", text: "text-sky-700 dark:text-sky-300" },
  { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300" },
  { bg: "bg-violet-100 dark:bg-violet-900/40", text: "text-violet-700 dark:text-violet-300" },
  { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300" },
  { bg: "bg-fuchsia-100 dark:bg-fuchsia-900/40", text: "text-fuchsia-700 dark:text-fuchsia-300" },
  { bg: "bg-pink-100 dark:bg-pink-900/40", text: "text-pink-700 dark:text-pink-300" },
  { bg: "bg-indigo-100 dark:bg-indigo-900/40", text: "text-indigo-700 dark:text-indigo-300" },
];

export function getAvatarColor(userId: number | string): (typeof AVATAR_COLORS)[number] {
  const id = typeof userId === "string" ? userId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) : userId;
  return AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length];
}

export function getInitials(name?: string | null, code?: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.trim().slice(0, 2).toUpperCase();
  }
  if (code) return code.slice(0, 2).toUpperCase();
  return "??";
}

interface UserAvatarProps {
  userId: number | string;
  name?: string | null;
  code?: string | null;
  avatarUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  showOnline?: boolean;
  isOnline?: boolean;
}

const SIZE_MAP = {
  xs: { container: "h-7 w-7", text: "text-[10px]", dot: "h-1.5 w-1.5" },
  sm: { container: "h-9 w-9", text: "text-xs", dot: "h-2 w-2" },
  md: { container: "h-11 w-11", text: "text-sm font-bold", dot: "h-2.5 w-2.5" },
  lg: { container: "h-14 w-14", text: "text-base font-bold", dot: "h-3 w-3" },
  xl: { container: "h-20 w-20", text: "text-xl font-bold", dot: "h-3.5 w-3.5" },
};

export function UserAvatar({
  userId,
  name,
  code,
  avatarUrl,
  size = "md",
  className,
  showOnline = false,
  isOnline = false,
}: UserAvatarProps) {
  const color = getAvatarColor(userId);
  const initials = getInitials(name, code);
  const s = SIZE_MAP[size];

  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "rounded-full overflow-hidden flex items-center justify-center",
          s.container,
          !avatarUrl && color.bg
        )}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={name || code || ""} className="w-full h-full object-cover" />
        ) : (
          <span className={cn(s.text, color.text)}>{initials}</span>
        )}
      </div>
      {showOnline && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full border-2 border-background",
            s.dot,
            isOnline ? "bg-green-500" : "bg-muted-foreground/40"
          )}
        />
      )}
    </div>
  );
}

import { useState, useMemo } from "react";
import {
  useGetAllUsers,
  useAdminChangePassword,
  useAdminChangeMobile,
  useAdminToggleChat,
  useActivateUser,
  useGetAdminSettings,
  useUpdateAdminSettings,
  useCreateDummyUser,
  getGetAllUsersQueryKey,
  getGetAdminSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  BadgeCheck,
  Phone,
  Search,
  Info,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  MessageCircleOff,
  Crown,
  Settings,
  Zap,
  Save,
  UserCheck,
  Plus,
  Copy,
  MapPin,
  Trash2,
  Skull,
} from "lucide-react";
import { format, formatDistanceToNow, addMonths, addYears } from "date-fns";
import React from "react";
const LocationTrackingModal = React.lazy(() =>
  import("@/components/location-tracking-modal").then((m) => ({ default: m.LocationTrackingModal }))
);

type TabKey = "all" | "online" | "offline" | "incomplete" | "dead" | "settings" | "connections" | "database";

type UserRow = {
  id: number;
  code: string;
  name?: string | null;
  mobile: string;
  role: string;
  address?: string | null;
  hasPassword?: boolean;
  kycCompleted: boolean;
  isOnline?: boolean;
  lastSeen?: string | null;
  createdAt?: string;
  plan?: string | null;
  planExpiresAt?: string | null;
  trialStartedAt?: string | null;
  slipsUsed?: number | null;
  chatEnabled?: boolean;
};

export default function Admin() {
  const { data: users, isLoading } = useGetAllUsers({
    query: { queryKey: getGetAllUsersQueryKey(), refetchInterval: 30_000 },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name_asc" | "name_desc">("newest");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Dialog state
  const [pwDialog, setPwDialog] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
  const [mobileDialog, setMobileDialog] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
  const [newPassword, setNewPassword] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [newMobile, setNewMobile] = useState("");

  const [activateDialog, setActivateDialog] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
  const [activatePlan, setActivatePlan] = useState<"trial" | "basic" | "pro" | "inactive">("basic");
  const [activateMonths, setActivateMonths] = useState("1");

  // Image lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Database management
  const [dbBusy, setDbBusy] = useState<"backup" | "restore" | "clean" | null>(null);
  const [cleanStep, setCleanStep] = useState(0);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const lastBackupTs = typeof window !== "undefined" ? localStorage.getItem("fabricpro_admin_last_backup") : null;

  const { data: settings, isLoading: settingsLoading } = useGetAdminSettings({
    query: { queryKey: getGetAdminSettingsQueryKey(), enabled: tab === "settings" },
  });
  const [editedSettings, setEditedSettings] = useState<Record<string, string>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);

  // Location tracking modal state
  const [locationModal, setLocationModal] = useState<{
    open: boolean;
    userId: number;
    userName: string;
    lat: number;
    lng: number;
    updatedAt: string | null;
    isOnline: boolean;
  } | null>(null);

  // Dummy user creation state
  const [dummyMobile, setDummyMobile] = useState("");
  const [dummyPassword, setDummyPassword] = useState("");
  const [dummyName, setDummyName] = useState("");
  const [dummyRole, setDummyRole] = useState<"karigar" | "seth">("karigar");
  const [showDummyPw, setShowDummyPw] = useState(false);
  const [lastCreated, setLastCreated] = useState<any>(null);

  const changePasswordMutation = useAdminChangePassword();
  const changeMobileMutation = useAdminChangeMobile();
  const toggleChatMutation = useAdminToggleChat();
  const activateMutation = useActivateUser();
  const updateSettingsMutation = useUpdateAdminSettings();
  const createDummyMutation = useCreateDummyUser();

  // Admin connection review
  const { data: pendingConnections = [], isLoading: connLoading, refetch: refetchConns } = useQuery({
    queryKey: ["admin", "connections", "review"],
    queryFn: async () => {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch("/api/admin/connections/review", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return [];
      return res.json() as Promise<any[]>;
    },
    enabled: tab === "connections",
    refetchInterval: tab === "connections" ? 10_000 : false,
  });
  const [connActionLoading, setConnActionLoading] = useState<number | null>(null);

  const handleApproveConn = async (id: number) => {
    setConnActionLoading(id);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(`/api/admin/connections/${id}/approve`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) { toast({ title: "Connection approve ho gaya ✅" }); refetchConns(); }
      else toast({ title: "Error", variant: "destructive" });
    } finally { setConnActionLoading(null); }
  };

  const handleRejectConn = async (id: number) => {
    setConnActionLoading(id);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(`/api/admin/connections/${id}/reject`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) { toast({ title: "Connection reject ho gaya" }); refetchConns(); }
      else toast({ title: "Error", variant: "destructive" });
    } finally { setConnActionLoading(null); }
  };

  // Permanent (hard) delete mutation
  const [permDeleteConfirm, setPermDeleteConfirm] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
  const permDeleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/users/${id}/permanent`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("fabricpro_token") ?? ""}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Delete fail ho gaya");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetAllUsersQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["dead-users"] });
      setPermDeleteConfirm({ open: false, user: null });
      toast({ title: "User permanently delete ho gaya", description: "Ab wahi number se fresh registration ho sakti hai." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Manual KYC complete dialog state
  const [kycDialog, setKycDialog] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
  const [kycName, setKycName] = useState("");
  const [kycAddress, setKycAddress] = useState("");
  const [kycRole, setKycRole] = useState<"karigar" | "seth">("karigar");
  const kycCompleteMutation = useMutation({
    mutationFn: async ({ id, name, address, role }: { id: number; name: string; address: string; role: string }) => {
      const res = await fetch(`/api/admin/users/${id}/complete-kyc`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("fabricpro_token") ?? ""}`,
        },
        body: JSON.stringify({ name, address, role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "KYC complete nahi hua");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetAllUsersQueryKey() });
      setKycDialog({ open: false, user: null });
      setKycName(""); setKycAddress(""); setKycRole("karigar");
      toast({ title: "KYC Complete Ho Gayi!", description: "User ab app use kar sakta hai." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Delete (soft) user mutation
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("fabricpro_token") ?? ""}`,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Delete fail ho gaya");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetAllUsersQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["dead-users"] });
      setDeleteConfirm({ open: false, user: null });
      toast({ title: "User delete ho gaya", description: "Ab Dead Users list mein milega." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Dead users list
  const { data: deadUsers, isLoading: deadLoading } = useQuery<UserRow[]>({
    queryKey: ["dead-users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dead-users", {
        headers: { Authorization: `Bearer ${localStorage.getItem("fabricpro_token") ?? ""}` },
      });
      if (!res.ok) throw new Error("Load nahi hua");
      return res.json();
    },
    enabled: tab === "dead",
  });

  const onlineCount = (users ?? []).filter((u) => u.isOnline).length;
  const offlineCount = (users ?? []).filter((u) => !u.isOnline).length;
  const kycCount = (users ?? []).filter((u) => u.kycCompleted).length;
  const incompleteCount = (users ?? []).filter((u) => !u.kycCompleted).length;

  const filtered = useMemo(() => {
    let list = (users ?? []) as UserRow[];
    if (tab === "online") list = list.filter((u) => u.isOnline);
    if (tab === "offline") list = list.filter((u) => !u.isOnline);
    if (tab === "incomplete") list = list.filter((u) => !u.kycCompleted);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (u) =>
          (u.name ?? "").toLowerCase().includes(q) ||
          (u.mobile ?? "").includes(q) ||
          (u.code ?? "").toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      if (sort === "name_asc") return (a.name ?? "").localeCompare(b.name ?? "");
      if (sort === "name_desc") return (b.name ?? "").localeCompare(a.name ?? "");
      if (sort === "oldest") return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(); // newest
    });
    return list;
  }, [users, tab, search, sort]);

  const roleLabel = (role: string) => {
    if (role === "super_admin") return "Admin";
    if (role === "seth") return "Seth Ji";
    return "Karigar";
  };

  const roleBg = (role: string) => {
    if (role === "super_admin") return "bg-purple-100 text-purple-700";
    if (role === "seth") return "bg-amber-100 text-amber-700";
    return "bg-blue-100 text-blue-700";
  };

  const formatLastSeen = (lastSeen?: string | null, isOnline?: boolean) => {
    if (isOnline) return "Abhi Online";
    if (!lastSeen) return "Kabhi nahi aaya";
    try {
      return `${formatDistanceToNow(new Date(lastSeen))} pehle`;
    } catch {
      return "—";
    }
  };

  const openPwDialog = (user: UserRow) => {
    setNewPassword("");
    setShowNewPw(false);
    setPwDialog({ open: true, user });
  };

  const openMobileDialog = (user: UserRow) => {
    setNewMobile(user.mobile);
    setMobileDialog({ open: true, user });
  };

  const openActivateDialog = (user: UserRow) => {
    setActivatePlan((user.plan as any) || "basic");
    setActivateMonths("1");
    setActivateDialog({ open: true, user });
  };

  const planLabel = (plan?: string | null) => {
    if (plan === "pro") return "Pro";
    if (plan === "basic") return "Basic";
    if (plan === "inactive") return "Inactive";
    return "Trial";
  };

  const planBg = (plan?: string | null) => {
    if (plan === "pro") return "bg-purple-100 text-purple-700";
    if (plan === "basic") return "bg-blue-100 text-blue-700";
    if (plan === "inactive") return "bg-red-100 text-red-700";
    return "bg-amber-100 text-amber-700";
  };

  const submitActivate = () => {
    if (!activateDialog.user) return;
    let expiresAt: string | undefined;
    if (activatePlan === "pro" || activatePlan === "basic") {
      const months = parseInt(activateMonths, 10);
      if (!isNaN(months) && months > 0) {
        expiresAt = addMonths(new Date(), months).toISOString();
      }
    }
    activateMutation.mutate(
      { id: activateDialog.user.id, data: { plan: activatePlan, expiresAt } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAllUsersQueryKey() });
          setActivateDialog({ open: false, user: null });
          toast({
            title: `${activateDialog.user?.name ?? "User"} ka plan "${planLabel(activatePlan)}" set ho gaya!`,
            description: "User ko app band karke dobara kholna hoga taake plan update dikhe",
          });
        },
        onError: () => toast({ title: "Plan activate nahi hua", variant: "destructive" }),
      }
    );
  };

  const mergedSettings = { ...(settings ?? {}), ...editedSettings };

  const submitSettings = () => {
    if (!settingsDirty) return;
    updateSettingsMutation.mutate(
      { data: editedSettings },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
          setEditedSettings({});
          setSettingsDirty(false);
          toast({ title: "Settings save ho gayi!" });
        },
        onError: () => toast({ title: "Settings save nahi hui", variant: "destructive" }),
      }
    );
  };

  const submitDummyUser = () => {
    if (!/^\d{10}$/.test(dummyMobile)) {
      toast({ title: "Mobile 10 digit ka hona chahiye", variant: "destructive" });
      return;
    }
    if (!/^[a-zA-Z0-9]{6,}$/.test(dummyPassword)) {
      toast({ title: "Password 6+ letters/numbers hona chahiye", variant: "destructive" });
      return;
    }
    createDummyMutation.mutate(
      { data: { mobile: dummyMobile, password: dummyPassword, name: dummyName || undefined, role: dummyRole } as any },
      {
        onSuccess: (data: any) => {
          queryClient.invalidateQueries({ queryKey: getGetAllUsersQueryKey() });
          setLastCreated({ mobile: dummyMobile, password: dummyPassword, name: dummyName, code: data.code });
          setDummyMobile("");
          setDummyPassword("");
          setDummyName("");
          toast({ title: `User ban gaya! Phone: ${dummyMobile}` });
        },
        onError: (err: any) => toast({ title: err?.message ?? "User nahi bana", variant: "destructive" }),
      }
    );
  };

  const submitPasswordChange = () => {
    if (!pwDialog.user) return;
    if (!/^[a-zA-Z0-9]{6,}$/.test(newPassword)) {
      toast({ title: "Password 6+ letters/numbers hona chahiye", variant: "destructive" });
      return;
    }
    changePasswordMutation.mutate(
      { id: pwDialog.user.id, data: { password: newPassword } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAllUsersQueryKey() });
          setPwDialog({ open: false, user: null });
          toast({ title: `${pwDialog.user?.name ?? "User"} ka password change ho gaya` });
        },
        onError: () => toast({ title: "Password change fail", variant: "destructive" }),
      }
    );
  };

  const submitMobileChange = () => {
    if (!mobileDialog.user) return;
    if (!/^\d{10}$/.test(newMobile)) {
      toast({ title: "Mobile 10 digit hona chahiye", variant: "destructive" });
      return;
    }
    changeMobileMutation.mutate(
      { id: mobileDialog.user.id, data: { mobile: newMobile } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAllUsersQueryKey() });
          setMobileDialog({ open: false, user: null });
          toast({ title: `${mobileDialog.user?.name ?? "User"} ka mobile change ho gaya` });
        },
        onError: (err: any) => toast({ title: err?.message ?? "Mobile change fail", variant: "destructive" }),
      }
    );
  };

  return (
    <Layout>
      <div className="pb-24">
        {/* Header */}
        <header className="bg-purple-700 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-md">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-8 w-8" />
            <div>
              <h1 className="text-2xl font-bold">Admin Panel</h1>
              <p className="text-white/70 text-sm">Saare users ka full control</p>
            </div>
          </div>
        </header>

        <div className="px-4 pt-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Total", value: users?.length ?? 0, color: "text-purple-700" },
              { label: "Online", value: onlineCount, color: "text-green-600" },
              { label: "Offline", value: offlineCount, color: "text-gray-500" },
              { label: "KYC", value: kycCount, color: "text-blue-600" },
            ].map((s) => (
              <div key={s.label} className="bg-card border border-border rounded-2xl p-3 text-center shadow-sm">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground mt-1 font-medium uppercase">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Note */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex gap-2 text-sm">
            <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-amber-800">
              <p className="font-semibold">Password security</p>
              <p className="text-xs mt-0.5">
                Passwords encrypted hai — actual password dikha nahi sakte. Aap kisi bhi user ka password reset kar sakte ho.
                <br />Dev OTP: <span className="font-mono font-bold">123456</span>
              </p>
            </div>
          </div>

          {/* Search + Sort */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Naam, mobile ya ID se dhundo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-12 pl-10 rounded-xl text-base"
              />
            </div>
            <div className="flex gap-1.5">
              {(["newest", "oldest", "name_asc", "name_desc"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-all ${
                    sort === s ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border text-muted-foreground"
                  }`}
                >
                  {s === "newest" ? "Naye Pehle" : s === "oldest" ? "Purane Pehle" : s === "name_asc" ? "A→Z" : "Z→A"}
                </button>
              ))}
            </div>
          </div>

          {/* Tabs - row 1 */}
          <div className="grid grid-cols-3 gap-1 bg-muted p-1 rounded-2xl">
            {(["all", "online", "offline"] as TabKey[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`py-2 px-1 rounded-xl text-xs font-semibold transition-all ${
                  tab === t ? "bg-card text-purple-700 shadow-sm" : "text-muted-foreground"
                }`}
              >
                {t === "all" ? `Sab (${(users ?? []).length})` : t === "online" ? `Online (${onlineCount})` : `Offline (${offlineCount})`}
              </button>
            ))}
          </div>
          {/* Tabs - row 2 */}
          <div className="grid grid-cols-3 gap-1 bg-muted p-1 rounded-2xl">
            {(["incomplete", "dead", "settings"] as TabKey[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`py-2 px-1 rounded-xl text-xs font-semibold transition-all ${
                  tab === t
                    ? t === "dead"
                      ? "bg-card text-red-600 shadow-sm"
                      : t === "incomplete"
                      ? "bg-card text-orange-600 shadow-sm"
                      : "bg-card text-purple-700 shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                {t === "incomplete"
                  ? `⚠️ Adhuri (${incompleteCount})`
                  : t === "dead"
                  ? "🗑️ Band"
                  : "Settings"}
              </button>
            ))}
          </div>
          {/* Tabs - row 3 */}
          <div className="grid grid-cols-2 gap-1 bg-muted p-1 rounded-2xl">
            <button
              onClick={() => setTab("connections")}
              className={`py-2 px-1 rounded-xl text-xs font-semibold transition-all ${
                tab === "connections"
                  ? "bg-card text-blue-700 shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              🔗 Connections {pendingConnections.length > 0 ? `(${pendingConnections.length})` : ""}
            </button>
            <button
              onClick={() => { setTab("database"); setCleanStep(0); }}
              className={`py-2 px-1 rounded-xl text-xs font-semibold transition-all ${
                tab === "database"
                  ? "bg-card text-emerald-700 shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              🗄️ Database
            </button>
          </div>

          {/* Settings Panel */}
          {tab === "settings" && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex gap-2 text-sm">
                <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-blue-800 text-xs">Yahan se plan limits aur prices set kar sakte ho. Change ke baad Save karo.</p>
              </div>

              {settingsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-14 w-full rounded-xl" />
                  <Skeleton className="h-14 w-full rounded-xl" />
                  <Skeleton className="h-14 w-full rounded-xl" />
                </div>
              ) : (
                <div className="space-y-3">
                  {([
                    { section: "Trial Plan", items: [
                      { key: "trial_days", label: "Trial Days", unit: "din" },
                      { key: "trial_slips", label: "Trial Max Slips", unit: "slip" },
                      { key: "trial_chat_users", label: "Trial Chat Users", unit: "users" },
                    ]},
                    { section: "Basic Plan (₹/month)", items: [
                      { key: "basic_price_monthly", label: "Basic Price Monthly", unit: "₹" },
                      { key: "basic_chat_users", label: "Basic Chat Users", unit: "users" },
                    ]},
                    { section: "Pro Plan", items: [
                      { key: "pro_price_monthly", label: "Pro Price Monthly", unit: "₹" },
                      { key: "pro_price_yearly", label: "Pro Price Yearly", unit: "₹" },
                    ]},
                    { section: "Gallery Retention (plan wise)", items: [
                      { key: "trial_gallery_days", label: "Trial Plan Images", unit: "din" },
                      { key: "basic_gallery_days", label: "Basic Plan Images", unit: "din" },
                      { key: "gallery_daily_limit", label: "Daily Upload Limit (sabke liye)", unit: "images" },
                    ]},
                  ]).map(({ section, items }) => (
                    <div key={section} className="bg-card border border-border rounded-2xl p-4 space-y-3">
                      <p className="font-bold text-sm text-purple-700 uppercase tracking-wide">{section}</p>
                      {items.map(({ key, label, unit }) => (
                        <div key={key} className="flex items-center gap-3">
                          <Label className="flex-1 text-sm text-muted-foreground">{label}</Label>
                          <div className="flex items-center gap-1.5 w-32">
                            <Input
                              type="number"
                              value={mergedSettings[key] ?? ""}
                              onChange={(e) => {
                                setEditedSettings((prev) => ({ ...prev, [key]: e.target.value }));
                                setSettingsDirty(true);
                              }}
                              className="h-9 text-sm text-right"
                            />
                            <span className="text-xs text-muted-foreground w-8 shrink-0">{unit}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  {/* Connection Approval Section */}
                  <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
                    <p className="font-bold text-sm text-blue-700 uppercase tracking-wide">Connection Approval</p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <Label className="text-sm text-muted-foreground">Admin Approval Required?</Label>
                        <p className="text-xs text-muted-foreground/70 mt-0.5">
                          {mergedSettings["connection_approval"] === "true"
                            ? "ON — Har connection request pehle Admin approve karega"
                            : "OFF — Request seedha target user ke paas jaayegi accept/reject ke liye"}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          const cur = mergedSettings["connection_approval"] === "true";
                          setEditedSettings((prev) => ({ ...prev, connection_approval: cur ? "false" : "true" }));
                          setSettingsDirty(true);
                        }}
                        className={`relative h-6 w-11 rounded-full transition-colors shrink-0 ${mergedSettings["connection_approval"] === "true" ? "bg-blue-600" : "bg-gray-300"}`}
                      >
                        <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-transform ${mergedSettings["connection_approval"] === "true" ? "translate-x-5" : "translate-x-0.5"}`} />
                      </button>
                    </div>
                  </div>

                  {/* Registration Fee Section */}
                  <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
                    <p className="font-bold text-sm text-purple-700 uppercase tracking-wide">Registration Fee</p>
                    <div className="flex items-center gap-3">
                      <Label className="flex-1 text-sm text-muted-foreground">Fee Required?</Label>
                      <button
                        onClick={() => {
                          const cur = mergedSettings["registration_required"] === "true";
                          setEditedSettings((prev) => ({ ...prev, registration_required: cur ? "false" : "true" }));
                          setSettingsDirty(true);
                        }}
                        className={`relative h-6 w-11 rounded-full transition-colors ${mergedSettings["registration_required"] === "true" ? "bg-green-500" : "bg-gray-300"}`}
                      >
                        <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-transform ${mergedSettings["registration_required"] === "true" ? "translate-x-5" : "translate-x-0.5"}`} />
                      </button>
                    </div>
                    {/* Fee amount — always visible */}
                    <div className="flex items-center gap-3">
                      <Label className="flex-1 text-sm text-muted-foreground">Fee Amount (₹)</Label>
                      <div className="flex items-center gap-1.5 w-32">
                        <Input
                          type="number"
                          value={mergedSettings["registration_fee"] ?? "50"}
                          onChange={(e) => { setEditedSettings((prev) => ({ ...prev, registration_fee: e.target.value })); setSettingsDirty(true); }}
                          className="h-9 text-sm text-right"
                        />
                        <span className="text-xs text-muted-foreground w-8 shrink-0">₹</span>
                      </div>
                    </div>
                    {mergedSettings["registration_required"] === "true" && (
                      <>
                        <div className="space-y-1.5">
                          <Label className="text-sm text-muted-foreground">UPI ID</Label>
                          <Input
                            placeholder="yourname@upi"
                            value={mergedSettings["registration_upi_id"] ?? ""}
                            onChange={(e) => { setEditedSettings((prev) => ({ ...prev, registration_upi_id: e.target.value })); setSettingsDirty(true); }}
                            className="h-9 text-sm font-mono"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm text-muted-foreground">UPI Name (QR pe dikhega)</Label>
                          <Input
                            placeholder="Aapka naam"
                            value={mergedSettings["registration_upi_name"] ?? ""}
                            onChange={(e) => { setEditedSettings((prev) => ({ ...prev, registration_upi_name: e.target.value })); setSettingsDirty(true); }}
                            className="h-9 text-sm"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {/* OTP / Verification Mode */}
                  <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
                    <p className="font-bold text-sm text-purple-700 uppercase tracking-wide">Verification Mode</p>
                    <p className="text-xs text-muted-foreground">
                      Naye users aur password reset ke liye verify kaise hoga — choose karo
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {(["system", "whatsapp", "real"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => { setEditedSettings((prev) => ({ ...prev, otp_mode: mode })); setSettingsDirty(true); }}
                          className={`rounded-xl border-2 p-2 text-center transition-colors text-xs font-semibold ${mergedSettings["otp_mode"] === mode ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                        >
                          {mode === "system" ? "🔧 System" : mode === "whatsapp" ? "💬 WhatsApp" : "📱 SMS"}
                          <div className="text-[10px] font-normal mt-0.5 leading-tight">
                            {mode === "system" ? "Auto-fill (dev)" : mode === "whatsapp" ? "Admin approve" : "Fast2SMS"}
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className={`text-xs font-semibold px-3 py-2 rounded-lg ${
                      mergedSettings["otp_mode"] === "system" ? "bg-orange-50 text-orange-700 border border-orange-200"
                      : mergedSettings["otp_mode"] === "whatsapp" ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-blue-50 text-blue-700 border border-blue-200"}`}>
                      {mergedSettings["otp_mode"] === "system" ? "⚡ System mode — sirf development ke liye, OTP auto-fill hoga"
                        : mergedSettings["otp_mode"] === "whatsapp" ? "💬 WhatsApp mode — user aapko WhatsApp bhejega, aap approve karoge (FREE)"
                        : "📱 SMS mode — Fast2SMS se OTP jayega (₹4-5/SMS)"}
                    </div>
                    {/* Admin WhatsApp number — shown only in whatsapp mode */}
                    {mergedSettings["otp_mode"] === "whatsapp" && (
                      <div className="space-y-1.5 pt-1">
                        <Label className="text-xs font-semibold text-green-700">Aapka WhatsApp Number (Admin)</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">+91</span>
                          <Input
                            type="tel"
                            placeholder="9876543210"
                            className="pl-12 h-10 text-sm"
                            value={(mergedSettings["admin_whatsapp"] || "").replace(/^\+?91/, "")}
                            onChange={(e) => {
                              const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                              setEditedSettings((prev) => ({ ...prev, admin_whatsapp: `91${digits}` }));
                              setSettingsDirty(true);
                            }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">User ka WhatsApp message is number pe aayega</p>
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={submitSettings}
                    disabled={!settingsDirty || updateSettingsMutation.isPending}
                    className="w-full h-12 gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {updateSettingsMutation.isPending ? "Save ho raha hai..." : "Settings Save Karo"}
                  </Button>
                </div>
              )}

              {/* Dummy User Creation */}
              <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <UserCheck className="h-5 w-5 text-purple-700" />
                  <p className="font-bold text-sm text-purple-700 uppercase tracking-wide">Dummy User Banao</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Jab koi khud register na kar sake — aap unke liye account bana do. Woh apna phone number + yeh password se seedha login kar lengy.
                </p>

                {lastCreated && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-1">
                    <p className="text-xs font-bold text-green-700 flex items-center gap-1"><UserCheck className="h-3.5 w-3.5" /> Abhi banaya gaya account:</p>
                    <div className="text-xs text-green-800 space-y-0.5">
                      {lastCreated.name && <p><span className="font-medium">Naam:</span> {lastCreated.name}</p>}
                      <p><span className="font-medium">Mobile:</span> {lastCreated.mobile}</p>
                      <p><span className="font-medium">Password:</span> <span className="font-mono">{lastCreated.password}</span></p>
                      <p><span className="font-medium">Code:</span> <span className="font-mono">{lastCreated.code}</span></p>
                    </div>
                    <button
                      onClick={() => {
                        const txt = `FabricPro Login:\nMobile: ${lastCreated.mobile}\nPassword: ${lastCreated.password}`;
                        navigator.clipboard?.writeText(txt);
                        toast({ title: "Clipboard mein copy ho gaya!" });
                      }}
                      className="flex items-center gap-1 text-xs text-green-700 mt-1"
                    >
                      <Copy className="h-3 w-3" /> Copy karo
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Naam (optional)</Label>
                    <Input
                      placeholder="Jaise: Ramesh, Sonu..."
                      value={dummyName}
                      onChange={(e) => setDummyName(e.target.value)}
                      className="h-10 rounded-xl mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Mobile Number *</Label>
                    <Input
                      type="tel"
                      placeholder="10 digit"
                      maxLength={10}
                      value={dummyMobile}
                      onChange={(e) => setDummyMobile(e.target.value.replace(/\D/g, ""))}
                      className="h-10 rounded-xl mt-1 font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Password *</Label>
                    <div className="relative mt-1">
                      <Input
                        type={showDummyPw ? "text" : "password"}
                        placeholder="6+ characters"
                        value={dummyPassword}
                        onChange={(e) => setDummyPassword(e.target.value)}
                        className="h-10 rounded-xl pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDummyPw(!showDummyPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      >
                        {showDummyPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Role</Label>
                    <div className="flex gap-2 mt-1">
                      {(["karigar", "seth"] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => setDummyRole(r)}
                          className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${
                            dummyRole === r
                              ? "bg-purple-700 text-white border-purple-700"
                              : "bg-card text-muted-foreground border-border"
                          }`}
                        >
                          {r === "karigar" ? "Karigar" : "Seth Ji"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button
                    onClick={submitDummyUser}
                    disabled={createDummyMutation.isPending}
                    className="w-full h-10 rounded-xl gap-2 bg-purple-700 hover:bg-purple-800"
                  >
                    <Plus className="h-4 w-4" />
                    {createDummyMutation.isPending ? "Ban raha hai..." : "User Banao"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Connections Review Tab */}
          {tab === "connections" && (
            <div className="space-y-3">
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex gap-2 text-xs text-blue-800">
                <span>🔗</span>
                <span>Yahan aane wali sab connection requests dikhti hain. Approve karo toh dono users connect ho jaayenge, reject karo toh sender ko notification jaayegi.</span>
              </div>
              {connLoading
                ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)
                : pendingConnections.length === 0
                ? (
                  <div className="text-center py-10">
                    <p className="text-4xl mb-2">🔗</p>
                    <p className="text-muted-foreground text-sm">Koi pending connection request nahi</p>
                  </div>
                )
                : pendingConnections.map((conn: any) => (
                  <div key={conn.id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
                    {/* From → To */}
                    <div className="flex items-center gap-2 text-sm">
                      <div className="flex-1 bg-muted rounded-xl px-3 py-2">
                        <p className="text-xs text-muted-foreground mb-0.5">Se (Request Bheja)</p>
                        <p className="font-bold text-sm">{conn.fromUser?.name || conn.fromUser?.mobile || "?"}</p>
                        <p className="text-xs text-muted-foreground font-mono">{conn.fromUser?.mobile}</p>
                        <p className="text-xs text-blue-600 capitalize">{conn.fromUser?.role}</p>
                      </div>
                      <span className="text-muted-foreground text-lg shrink-0">→</span>
                      <div className="flex-1 bg-muted rounded-xl px-3 py-2">
                        <p className="text-xs text-muted-foreground mb-0.5">Ko (Connect Karna Hai)</p>
                        <p className="font-bold text-sm">{conn.toUser?.name || conn.toUser?.mobile || "?"}</p>
                        <p className="text-xs text-muted-foreground font-mono">{conn.toUser?.mobile}</p>
                        <p className="text-xs text-orange-600 capitalize">{conn.toUser?.role}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                      <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold capitalize">{conn.roleLabel}</span>
                      <span>{new Date(conn.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                    </div>
                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApproveConn(conn.id)}
                        disabled={connActionLoading === conn.id}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-all disabled:opacity-50"
                      >
                        ✅ Approve
                      </button>
                      <button
                        onClick={() => handleRejectConn(conn.id)}
                        disabled={connActionLoading === conn.id}
                        className="flex-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-xl py-2.5 text-sm font-semibold transition-all disabled:opacity-50"
                      >
                        ❌ Reject
                      </button>
                    </div>
                  </div>
                ))
              }
            </div>
          )}

          {/* Database Management Tab */}
          {tab === "database" && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 flex gap-2 text-sm">
                <span className="text-emerald-700 text-xs">🗄️ Yahan se poora database backup, restore aur clean kar sakte ho. Users, connections aur chat hamesha safe rahenge — sirf slips, payments aur notifications affect hote hain.</span>
              </div>

              {/* BACKUP */}
              <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
                <p className="font-bold text-sm text-emerald-700 uppercase tracking-wide">📥 Backup</p>
                {lastBackupTs && (
                  <p className="text-xs text-muted-foreground">
                    Aakhri backup: <span className="font-semibold text-foreground">{new Date(lastBackupTs).toLocaleString("hi-IN")}</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Poora data (slips, payments, users, connections, chat) ek JSON file mein download hoga. Timestamp file ke naam mein hogi.</p>
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={dbBusy !== null}
                  onClick={async () => {
                    setDbBusy("backup");
                    try {
                      const token = localStorage.getItem("fabricpro_token");
                      const res = await fetch("/api/admin/database/backup", {
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      if (!res.ok) throw new Error("Backup fail ho gayi");
                      const data = await res.json();
                      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
                      const filename = `fabricpro_backup_${ts}.json`;
                      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = filename;
                      a.click();
                      URL.revokeObjectURL(url);
                      localStorage.setItem("fabricpro_admin_last_backup", new Date().toISOString());
                      toast({ title: "Backup download ho gayi ✅", description: filename });
                    } catch (e: unknown) {
                      toast({ title: "Backup fail hui", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
                    } finally {
                      setDbBusy(null);
                    }
                  }}
                >
                  {dbBusy === "backup" ? "Backup ban rahi hai..." : "📥 Backup Download Karo"}
                </Button>
              </div>

              {/* RESTORE */}
              <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
                <p className="font-bold text-sm text-blue-700 uppercase tracking-wide">🔄 Restore</p>
                <p className="text-xs text-muted-foreground">Pehle se downloaded FabricPro backup JSON file select karo. Isse slips, payments aur notifications purani wali restore ho jayengi (current data replace ho jayega).</p>
                <input
                  type="file"
                  accept=".json,application/json"
                  className="block w-full text-xs text-muted-foreground file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                />
                {restoreFile && <p className="text-xs text-blue-700 font-medium">Selected: {restoreFile.name}</p>}
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={!restoreFile || dbBusy !== null}
                  onClick={async () => {
                    if (!restoreFile) return;
                    setDbBusy("restore");
                    try {
                      const text = await restoreFile.text();
                      const parsed = JSON.parse(text);
                      const token = localStorage.getItem("fabricpro_token");
                      const res = await fetch("/api/admin/database/restore", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify(parsed),
                      });
                      const result = await res.json();
                      if (!res.ok) throw new Error(result.error ?? "Restore fail ho gayi");
                      toast({ title: "Restore ho gaya ✅", description: result.message });
                      setRestoreFile(null);
                    } catch (e: unknown) {
                      toast({ title: "Restore fail hui", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
                    } finally {
                      setDbBusy(null);
                    }
                  }}
                >
                  {dbBusy === "restore" ? "Restore ho raha hai..." : "🔄 Restore Karo"}
                </Button>
              </div>

              {/* CLEAN DATA */}
              <div className="bg-card border border-red-200 rounded-2xl p-4 space-y-3">
                <p className="font-bold text-sm text-red-600 uppercase tracking-wide">🗑️ Clean Data</p>
                <p className="text-xs text-muted-foreground">Isse <strong>saare slips, job slips, return slips, payments aur notifications</strong> hamesha ke liye delete ho jayenge. Users, connections aur chat messages safe rahenge.</p>
                {!lastBackupTs ? (
                  <div className="bg-red-50 border border-red-300 rounded-xl p-3">
                    <p className="text-xs text-red-700 font-bold">⚠️ Koi backup nahi mila! Clean karne se pehle upar se backup zaroor download karo.</p>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-300 rounded-xl p-3">
                    <p className="text-xs text-amber-700">✅ Aakhri backup mila: <span className="font-bold">{new Date(lastBackupTs).toLocaleString("hi-IN")}</span></p>
                  </div>
                )}

                {cleanStep === 0 && (
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={dbBusy !== null}
                    onClick={() => setCleanStep(1)}
                  >
                    🗑️ Data Clean Karo
                  </Button>
                )}

                {cleanStep === 1 && (
                  <div className="bg-red-50 border border-red-300 rounded-xl p-3 space-y-3">
                    <p className="text-sm font-bold text-red-700">⚠️ Pehli baar confirm karo</p>
                    <p className="text-xs text-red-600">Kya aap sure ho? Saare slips aur payments delete ho jayenge. Yeh action undo nahi hoga.</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setCleanStep(0)}>Nahi, Wapas Jao</Button>
                      <Button size="sm" variant="destructive" className="flex-1" onClick={() => setCleanStep(2)}>Haan, Aage Badho</Button>
                    </div>
                  </div>
                )}

                {cleanStep === 2 && (
                  <div className="bg-red-100 border-2 border-red-500 rounded-xl p-3 space-y-3">
                    <p className="text-sm font-bold text-red-700">🚨 Doosri baar confirm karo</p>
                    <p className="text-xs text-red-600">Yeh FINAL confirmation hai. Iske baad koi wapsi nahi. Backup hai na? Tabhi aage badho.</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setCleanStep(0)}>Nahi, Rok Do</Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1"
                        disabled={dbBusy !== null}
                        onClick={async () => {
                          setDbBusy("clean");
                          try {
                            const token = localStorage.getItem("fabricpro_token");
                            const res = await fetch("/api/admin/database/clean", {
                              method: "DELETE",
                              headers: { Authorization: `Bearer ${token}` },
                            });
                            const result = await res.json();
                            if (!res.ok) throw new Error(result.error ?? "Clean fail ho gaya");
                            toast({ title: "Data clean ho gaya ✅", description: result.message });
                            setCleanStep(0);
                          } catch (e: unknown) {
                            toast({ title: "Clean fail hua", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
                          } finally {
                            setDbBusy(null);
                          }
                        }}
                      >
                        {dbBusy === "clean" ? "Delete ho raha hai..." : "🗑️ HAAN, DELETE KARO"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Dead Users Tab */}
          {tab === "dead" && (
            <div className="space-y-2">
              {deadLoading
                ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)
                : !deadUsers || deadUsers.length === 0
                ? (
                  <div className="text-center py-10">
                    <Skull className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-muted-foreground">Koi band user nahi hai</p>
                  </div>
                )
                : deadUsers.map((user) => (
                  <div key={user.id} className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 bg-red-100 rounded-full flex items-center justify-center shrink-0">
                        <span className="text-red-600 font-bold text-base">
                          {(user.name ?? user.mobile).charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-red-800">{user.name ?? "—"}</p>
                        <p className="text-xs text-red-600">📱 {user.mobile}</p>
                        <p className="text-xs text-red-500 mt-0.5">Code: {user.code} • {user.role}</p>
                      </div>
                      <div className="text-xs text-red-400 text-right shrink-0">
                        <p>Band kiya</p>
                        <p>{(user as any).deletedAt ? format(new Date((user as any).deletedAt), "dd MMM yy") : "—"}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="w-full gap-2 bg-red-700 hover:bg-red-800"
                      onClick={() => setPermDeleteConfirm({ open: true, user })}
                    >
                      <Skull className="h-4 w-4" />
                      Permanent Delete (Fresh Registration Allow Karo)
                    </Button>
                  </div>
                ))
              }
            </div>
          )}

          {/* User list */}
          <div className="space-y-2">
            {tab === "settings" || tab === "dead" || tab === "connections" || tab === "database" ? null : isLoading
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)
              : filtered.length === 0
              ? (
                <div className="text-center py-10">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground">Koi user nahi mila</p>
                </div>
              )
              : filtered.map((user) => {
                const isExpanded = expandedId === user.id;
                return (
                  <div key={user.id} className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                    {/* Main row */}
                    <div
                      className="p-4 cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : user.id)}
                    >
                      <div className="flex items-center gap-3">
                        {/* Avatar */}
                        <div className="relative shrink-0">
                          <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center">
                            <span className="text-primary font-bold text-base">
                              {(user.name ?? user.mobile).charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div
                            className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card ${
                              user.isOnline ? "bg-green-500" : "bg-gray-300"
                            }`}
                          />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold truncate">{user.name ?? "—"}</p>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${roleBg(user.role)}`}>
                              {roleLabel(user.role)}
                            </span>
                            {user.kycCompleted && (
                              <BadgeCheck className="h-4 w-4 text-green-600 shrink-0" />
                            )}
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${planBg(user.plan)}`}>
                              {planLabel(user.plan)}
                            </span>
                            {(user as any).activationStatus === "pending_payment" && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-300">
                                💳 Payment Pending
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span className="font-mono font-bold text-foreground">{user.code}</span>
                            <span>·</span>
                            <a href={`tel:+91${user.mobile}`} className="flex items-center gap-1 text-primary" onClick={e => e.stopPropagation()}>
                              <Phone className="h-3 w-3" />
                              {user.mobile}
                            </a>
                            <span>·</span>
                            <span className={user.isOnline ? "text-green-600 font-semibold" : ""}>{formatLastSeen(user.lastSeen, user.isOnline)}</span>
                            {(user as any).latitude && (user as any).longitude && (
                              <>
                                <span>·</span>
                                <button
                                  className="flex items-center gap-0.5 text-blue-600 font-semibold"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLocationModal({
                                      open: true,
                                      userId: user.id,
                                      userName: user.name || user.code,
                                      lat: (user as any).latitude,
                                      lng: (user as any).longitude,
                                      updatedAt: (user as any).locationUpdatedAt ?? null,
                                      isOnline: user.isOnline ?? false,
                                    });
                                  }}
                                  title="Map par dekho"
                                >
                                  <MapPin className="h-3 w-3" />
                                  {user.isOnline ? "Live" : "Location"}
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="border-t border-border px-4 py-4 space-y-4 bg-muted/30">
                        {/* Detail rows */}
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-muted-foreground text-xs font-medium uppercase mb-1">Mobile</p>
                            <p className="font-mono font-bold">+91 {user.mobile}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs font-medium uppercase mb-1">User ID</p>
                            <p className="font-mono font-bold">{user.code}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs font-medium uppercase mb-1">Password</p>
                            <div className="flex items-center gap-1.5">
                              {user.hasPassword ? (
                                <span className="text-green-700 font-semibold flex items-center gap-1">
                                  <KeyRound className="h-3.5 w-3.5" /> Set hai ✓
                                </span>
                              ) : (
                                <span className="text-red-600 font-semibold">Set nahi ✗</span>
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs font-medium uppercase mb-1">KYC</p>
                            <p className={user.kycCompleted ? "text-green-700 font-semibold" : "text-red-600 font-semibold"}>
                              {user.kycCompleted ? "Completed ✓" : "Pending ✗"}
                            </p>
                          </div>
                          {user.address && (
                            <div className="col-span-2">
                              <p className="text-muted-foreground text-xs font-medium uppercase mb-1">Address</p>
                              <p className="font-medium">{user.address}</p>
                            </div>
                          )}
                            {user.createdAt && (
                            <div className="col-span-2">
                              <p className="text-muted-foreground text-xs font-medium uppercase mb-1">Joined</p>
                              <p>{format(new Date(user.createdAt), "dd MMM yyyy, hh:mm a")}</p>
                            </div>
                          )}
                          {user.lastSeen && (
                            <div className="col-span-2">
                              <p className="text-muted-foreground text-xs font-medium uppercase mb-1">Last Seen</p>
                              <p>{format(new Date(user.lastSeen), "dd MMM yyyy, hh:mm a")}</p>
                            </div>
                          )}
                          {(user as any).latitude && (user as any).longitude && (
                            <div className="col-span-2">
                              <p className="text-muted-foreground text-xs font-medium uppercase mb-1">📍 Live Location</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLocationModal({
                                      open: true,
                                      userId: user.id,
                                      userName: user.name || user.code,
                                      lat: (user as any).latitude,
                                      lng: (user as any).longitude,
                                      updatedAt: (user as any).locationUpdatedAt ?? null,
                                      isOnline: user.isOnline ?? false,
                                    });
                                  }}
                                >
                                  <MapPin className="h-3.5 w-3.5" />
                                  Map par track karo
                                </button>
                                {(user as any).locationUpdatedAt && (
                                  <span className="text-xs text-muted-foreground">
                                    {user.isOnline ? "🟢 Live" : `⏱ ${format(new Date((user as any).locationUpdatedAt), "hh:mm a, dd MMM")}`}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                          <div className="col-span-2 border-t border-border pt-2 mt-1">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-muted-foreground text-xs font-medium uppercase mb-1">Plan</p>
                                <div className="flex items-center gap-2">
                                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${planBg(user.plan)}`}>
                                    {planLabel(user.plan)}
                                  </span>
                                  {user.slipsUsed != null && (
                                    <span className="text-xs text-muted-foreground">{user.slipsUsed} slips</span>
                                  )}
                                </div>
                                {user.planExpiresAt && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Expires: {format(new Date(user.planExpiresAt), "dd MMM yyyy")}
                                  </p>
                                )}
                              </div>
                              <Button
                                size="sm"
                                className="gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
                                onClick={() => openActivateDialog(user)}
                              >
                                <Crown className="h-3.5 w-3.5" />
                                Plan Set
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Payment Screenshot */}
                        {(user as any).paymentScreenshot && (
                          <div className="space-y-2">
                            <p className="text-xs font-bold text-orange-700 uppercase tracking-wide flex items-center gap-1.5">
                              💳 Payment Screenshot
                              {(user as any).activationStatus === "pending_payment" && (
                                <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full text-[10px]">Verify karein</span>
                              )}
                            </p>
                            <button
                              type="button"
                              className="relative w-full group cursor-zoom-in"
                              onClick={() => setLightboxSrc((user as any).paymentScreenshot)}
                            >
                              <img
                                src={(user as any).paymentScreenshot}
                                alt="Payment proof"
                                className="w-full max-h-32 object-contain rounded-xl border-2 border-orange-200 bg-orange-50 group-hover:border-orange-400 transition-colors"
                              />
                              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-xl">
                                <span className="bg-white text-orange-700 text-xs font-bold px-3 py-1 rounded-full shadow">🔍 Full Screen Dekho</span>
                              </div>
                              <p className="text-[10px] text-center text-orange-500 mt-1">👆 Tap karke bada karo — puri detail padhein</p>
                            </button>
                            {(user as any).activationStatus === "pending_payment" && (
                              <Button
                                size="sm"
                                className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
                                onClick={() => openActivateDialog(user)}
                              >
                                <UserCheck className="h-4 w-4" />
                                Payment Verify Karke Activate Karo
                              </Button>
                            )}
                          </div>
                        )}

                        {/* Chat permission toggle */}
                        <div className="flex items-center justify-between bg-background rounded-xl p-3 border border-border">
                          <div className="flex items-center gap-2">
                            {(user as any).chatEnabled !== false ? (
                              <MessageCircle className="h-4 w-4 text-green-600" />
                            ) : (
                              <MessageCircleOff className="h-4 w-4 text-red-500" />
                            )}
                            <div>
                              <p className="font-semibold text-sm">Chat Permission</p>
                              <p className="text-xs text-muted-foreground">
                                {(user as any).chatEnabled !== false ? "Chat enabled hai" : "Chat disabled hai"}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              toggleChatMutation.mutate(
                                { id: user.id, data: { chatEnabled: !(user as any).chatEnabled } },
                                {
                                  onSuccess: () => {
                                    queryClient.invalidateQueries({ queryKey: getGetAllUsersQueryKey() });
                                    toast({ title: `${user.name ?? "User"} ka chat ${(user as any).chatEnabled ? "disable" : "enable"} ho gaya` });
                                  },
                                  onError: () => toast({ title: "Change nahi hua", variant: "destructive" }),
                                }
                              );
                            }}
                            disabled={toggleChatMutation.isPending}
                            className={`relative h-6 w-11 rounded-full transition-colors ${
                              (user as any).chatEnabled !== false ? "bg-green-500" : "bg-gray-300"
                            }`}
                          >
                            <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-transform ${
                              (user as any).chatEnabled !== false ? "translate-x-5" : "translate-x-0.5"
                            }`} />
                          </button>
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 gap-2"
                            onClick={() => openPwDialog(user)}
                          >
                            <KeyRound className="h-4 w-4" />
                            Password Change
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 gap-2"
                            onClick={() => openMobileDialog(user)}
                          >
                            <Pencil className="h-4 w-4" />
                            Mobile Change
                          </Button>
                        </div>
                        {/* Manual KYC complete button — only for incomplete users */}
                        {!user.kycCompleted && (
                          <Button
                            size="sm"
                            className="w-full gap-2 bg-orange-500 hover:bg-orange-600 text-white"
                            onClick={() => {
                              setKycName(user.name ?? "");
                              setKycAddress(user.address ?? "");
                              setKycRole(user.role === "seth" ? "seth" : "karigar");
                              setKycDialog({ open: true, user });
                            }}
                          >
                            <BadgeCheck className="h-4 w-4" />
                            KYC Manually Complete Karo
                          </Button>
                        )}
                        {/* Delete user button */}
                        {user.role !== "super_admin" && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => setDeleteConfirm({ open: true, user })}
                            >
                              <Trash2 className="h-4 w-4" />
                              Band Karo
                            </Button>
                            {!user.kycCompleted && (
                              <Button
                                size="sm"
                                className="flex-1 gap-2 bg-red-900 hover:bg-red-950 text-white"
                                onClick={() => setPermDeleteConfirm({ open: true, user })}
                              >
                                <Skull className="h-4 w-4" />
                                Permanent Delete
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            }
          </div>
        </div>
      </div>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteConfirm.open} onOpenChange={(o) => !o && setDeleteConfirm({ open: false, user: null })}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <Trash2 className="h-5 w-5" /> User Band Karo
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
              <p className="font-bold mb-1">{deleteConfirm.user?.name ?? deleteConfirm.user?.mobile}</p>
              <p>Mobile: {deleteConfirm.user?.mobile}</p>
              <p className="mt-2 text-xs">Yeh user "Band Users" list mein chala jayega. Login nahi kar payega. Agar wahi number dobara register kare toh "user already exists" ka message aayega.</p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setDeleteConfirm({ open: false, user: null })}
              >
                Raho
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 text-white gap-2"
                disabled={deleteMutation.isPending}
                onClick={() => deleteConfirm.user && deleteMutation.mutate(deleteConfirm.user.id)}
              >
                <Trash2 className="h-4 w-4" />
                {deleteMutation.isPending ? "Ho raha hai..." : "Haan, Band Karo"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual KYC Complete Dialog */}
      <Dialog open={kycDialog.open} onOpenChange={(o) => !o && setKycDialog({ open: false, user: null })}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-orange-600 flex items-center gap-2">
              <BadgeCheck className="h-5 w-5" /> KYC Manually Complete Karo
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-xs text-orange-800">
              <p className="font-semibold mb-1">📱 Mobile: {kycDialog.user?.mobile}</p>
              <p>Yahan se is user ki KYC admin ki taraf se complete karo. User ab normally login kar sakta hai.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Naam *</Label>
              <Input
                placeholder="User ka pura naam"
                value={kycName}
                onChange={(e) => setKycName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Pata (Optional)</Label>
              <Input
                placeholder="Gaon / Shahar / Area"
                value={kycAddress}
                onChange={(e) => setKycAddress(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Role</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["karigar", "seth"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setKycRole(r)}
                    className={`py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
                      kycRole === r ? "border-orange-500 bg-orange-50 text-orange-700" : "border-border text-muted-foreground"
                    }`}
                  >
                    {r === "karigar" ? "Karigar" : "Seth Ji"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setKycDialog({ open: false, user: null })}>
                Raho
              </Button>
              <Button
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white gap-2"
                disabled={kycCompleteMutation.isPending || !kycName.trim()}
                onClick={() => kycDialog.user && kycCompleteMutation.mutate({
                  id: kycDialog.user.id,
                  name: kycName.trim(),
                  address: kycAddress.trim(),
                  role: kycRole,
                })}
              >
                <BadgeCheck className="h-4 w-4" />
                {kycCompleteMutation.isPending ? "Ho raha hai..." : "KYC Complete Karo"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Permanent Delete Confirm Dialog */}
      <Dialog open={permDeleteConfirm.open} onOpenChange={(o) => !o && setPermDeleteConfirm({ open: false, user: null })}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-red-900 flex items-center gap-2">
              <Skull className="h-5 w-5" /> Permanent Delete
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-300 rounded-xl p-3 text-sm text-red-900">
              <p className="font-bold mb-1">{permDeleteConfirm.user?.name ?? permDeleteConfirm.user?.mobile}</p>
              <p>Mobile: {permDeleteConfirm.user?.mobile}</p>
              <p className="mt-2 text-xs font-semibold">⚠️ Yeh action PERMANENT hai!</p>
              <p className="text-xs mt-1">User ka sab data (messages, connections, slips) hamesha ke liye delete ho jaayega. Wahi number se dobara fresh registration ho sakegi.</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setPermDeleteConfirm({ open: false, user: null })}>
                Raho
              </Button>
              <Button
                className="flex-1 bg-red-900 hover:bg-red-950 text-white gap-2"
                disabled={permDeleteMutation.isPending}
                onClick={() => permDeleteConfirm.user && permDeleteMutation.mutate(permDeleteConfirm.user.id)}
              >
                <Skull className="h-4 w-4" />
                {permDeleteMutation.isPending ? "Delete ho raha hai..." : "Haan, Permanently Delete Karo"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Password change dialog */}
      <Dialog open={pwDialog.open} onOpenChange={(o) => !o && setPwDialog({ open: false, user: null })}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
          <DialogHeader>
            <DialogTitle>Password Change</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 pb-1">
            <p className="text-sm text-muted-foreground">
              <span className="font-bold text-foreground">{pwDialog.user?.name ?? pwDialog.user?.mobile}</span> ka naya password set karo
            </p>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="font-semibold">Naya Password</Label>
              <div className="relative">
                <Input
                  type={showNewPw ? "text" : "password"}
                  placeholder="6+ character (letters/numbers)"
                  className="h-12 pr-12"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw(!showNewPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Kam se kam 6 characters — sirf A-Z, a-z, 0-9</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setPwDialog({ open: false, user: null })}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={submitPasswordChange}
                disabled={changePasswordMutation.isPending || newPassword.length < 6}
              >
                {changePasswordMutation.isPending ? "Change ho raha hai..." : "Password Set Karo"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Activate User dialog */}
      <Dialog open={activateDialog.open} onOpenChange={(o) => !o && setActivateDialog({ open: false, user: null })}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-purple-600" /> Plan Set Karo
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 pb-1">
            <p className="text-sm text-muted-foreground">
              <span className="font-bold text-foreground">{activateDialog.user?.name ?? activateDialog.user?.mobile}</span> ke liye plan set karo
            </p>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(["trial", "basic", "pro", "inactive"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setActivatePlan(p)}
                  className={`py-2 px-3 rounded-xl text-sm font-semibold border-2 transition-all capitalize ${
                    activatePlan === p
                      ? "border-purple-600 bg-purple-50 text-purple-700"
                      : "border-border bg-muted text-muted-foreground"
                  }`}
                >
                  {p === "trial" ? "Trial" : p === "basic" ? "Basic" : p === "pro" ? "Pro" : "Inactive"}
                </button>
              ))}
            </div>
            {(activatePlan === "basic" || activatePlan === "pro") && (
              <div className="space-y-2">
                <Label className="font-semibold text-sm">Kitne Mahine?</Label>
                <div className="flex gap-2">
                  {["1", "3", "6", "12"].map((m) => (
                    <button
                      key={m}
                      onClick={() => setActivateMonths(m)}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                        activateMonths === m
                          ? "border-purple-600 bg-purple-50 text-purple-700"
                          : "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      {m}M
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setActivateDialog({ open: false, user: null })}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-purple-600 hover:bg-purple-700"
                onClick={submitActivate}
                disabled={activateMutation.isPending}
              >
                {activateMutation.isPending ? "Set ho raha hai..." : "Plan Set Karo"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mobile change dialog */}
      <Dialog open={mobileDialog.open} onOpenChange={(o) => !o && setMobileDialog({ open: false, user: null })}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
          <DialogHeader>
            <DialogTitle>Mobile Number Change</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 pb-1">
            <p className="text-sm text-muted-foreground">
              <span className="font-bold text-foreground">{mobileDialog.user?.name ?? mobileDialog.user?.mobile}</span> ka naya mobile number daalo
            </p>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="font-semibold">Naya Mobile Number</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">+91</span>
                <Input
                  type="tel"
                  placeholder="9876543210"
                  className="h-12 pl-12 font-mono text-base"
                  value={newMobile}
                  onChange={(e) => setNewMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setMobileDialog({ open: false, user: null })}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={submitMobileChange}
                disabled={changeMobileMutation.isPending || newMobile.length < 10}
              >
                {changeMobileMutation.isPending ? "Change ho raha hai..." : "Mobile Set Karo"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {locationModal && (
        <React.Suspense fallback={null}>
          <LocationTrackingModal
            open={locationModal.open}
            onClose={() => setLocationModal(null)}
            userId={locationModal.userId}
            userName={locationModal.userName}
            initialLat={locationModal.lat}
            initialLng={locationModal.lng}
            initialUpdatedAt={locationModal.updatedAt}
            isOnline={locationModal.isOnline}
          />
        </React.Suspense>
      )}

      {/* Image Lightbox — full screen screenshot viewer */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center"
          onClick={() => setLightboxSrc(null)}
        >
          <div className="w-full flex justify-between items-center px-4 py-3">
            <span className="text-white text-sm font-semibold">💳 Payment Screenshot</span>
            <button
              className="text-white bg-white/20 hover:bg-white/30 rounded-full px-4 py-1.5 text-sm font-bold"
              onClick={() => setLightboxSrc(null)}
            >
              ✕ Band Karo
            </button>
          </div>
          <div
            className="flex-1 w-full flex items-center justify-center p-4 overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightboxSrc}
              alt="Payment proof full"
              className="max-w-full max-h-[80vh] rounded-xl shadow-2xl object-contain"
              style={{ touchAction: "pinch-zoom" }}
            />
          </div>
          <p className="text-white/50 text-xs pb-4">Bahar tap karo ya "Band Karo" dabao</p>
        </div>
      )}
    </Layout>
  );
}

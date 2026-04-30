import { Link, useLocation } from "wouter";
import { useGetMe, useGetDashboardSummary, getGetDashboardSummaryQueryKey, useGetRecentActivity, getGetRecentActivityQueryKey, useGetNotifications, getGetNotificationsQueryKey, useGetConnections, getGetConnectionsQueryKey, useAcceptConnection, useRejectConnection } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, PlusCircle, ArrowUpRight, ArrowDownRight, IndianRupee, FileText, Users, Lock, AlertTriangle, Crown, Clock, UserCheck, Check, X, Phone, Pencil, Trash2, RotateCcw, Share2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState, useCallback } from "react";

function getPlanStatus(user: any) {
  if (!user) return { plan: "trial", daysLeft: null as number | null, isLocked: false, isExpiringSoon: false };
  // super_admin is always unrestricted — no plan limits apply
  if (user.role === "super_admin") return { plan: "pro", daysLeft: null as number | null, isLocked: false, isExpiringSoon: false };
  const plan = (user.plan as string) ?? "trial";
  if (plan === "pro") return { plan, daysLeft: null as number | null, isLocked: false, isExpiringSoon: false };
  if (plan === "inactive") return { plan, daysLeft: null as number | null, isLocked: true, isExpiringSoon: false };
  let expiresAt: Date | null = null;
  if (user.planExpiresAt) {
    expiresAt = new Date(user.planExpiresAt);
  } else {
    // Use trialStartedAt, fallback to createdAt for older accounts
    const startRaw = user.trialStartedAt || user.createdAt;
    if (startRaw) expiresAt = new Date(new Date(startRaw).getTime() + 30 * 24 * 60 * 60 * 1000);
  }
  if (expiresAt) {
    const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    return { plan, daysLeft, isLocked: daysLeft === 0, isExpiringSoon: daysLeft <= 5 };
  }
  return { plan, daysLeft: null as number | null, isLocked: false, isExpiringSoon: false };
}

function PlanBadge({ plan, daysLeft, isExpiringSoon }: { plan: string; daysLeft: number | null; isExpiringSoon: boolean }) {
  if (plan === "pro") {
    return (
      <span className="inline-flex items-center gap-1 bg-yellow-400 text-yellow-900 rounded-full px-2.5 py-0.5 text-[11px] font-bold">
        <Crown className="w-3 h-3" /> Pro Plan
      </span>
    );
  }
  if (plan === "inactive") {
    return (
      <span className="inline-flex items-center gap-1 bg-red-500 text-white rounded-full px-2.5 py-0.5 text-[11px] font-bold">
        <Lock className="w-3 h-3" /> Locked
      </span>
    );
  }
  if (plan === "basic") {
    return (
      <span className="inline-flex items-center gap-1 bg-blue-500 text-white rounded-full px-2.5 py-0.5 text-[11px] font-bold">
        Basic{daysLeft !== null ? ` • ${daysLeft}d` : ""}
      </span>
    );
  }
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
      isExpiringSoon ? "bg-orange-400 text-orange-900" : "bg-white/20 text-white"
    )}>
      <Clock className="w-3 h-3" />
      Free Trial{daysLeft !== null ? ` • ${daysLeft} din baki` : ""}
    </span>
  );
}

function NetworkDot({ status }: { status: "online" | "offline" | "syncing" }) {
  return (
    <span
      className={cn(
        "inline-block w-2.5 h-2.5 rounded-full shrink-0",
        status === "online" && "bg-green-400 shadow-[0_0_5px_rgba(74,222,128,0.8)] animate-pulse",
        status === "offline" && "bg-red-400 shadow-[0_0_5px_rgba(248,113,113,0.8)]",
        status === "syncing" && "bg-purple-400 shadow-[0_0_5px_rgba(196,181,253,0.8)] animate-pulse"
      )}
      title={status === "online" ? "Online" : status === "offline" ? "Offline" : "Sync ho raha hai"}
    />
  );
}

const DISMISSED_KEY = "fp-dismissed-activities";

function getDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function saveDismissed(ids: Set<string>) {
  try {
    // Keep only last 200 dismissed IDs to avoid bloat
    const arr = Array.from(ids).slice(-200);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr));
  } catch {}
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useGetMe();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 30_000 } });
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey(), refetchInterval: 20_000 } });
  const { data: notifications } = useGetNotifications({ query: { queryKey: getGetNotificationsQueryKey(), refetchInterval: 8_000 } });
  const { data: pendingConnections } = useGetConnections(
    { status: "pending" as any },
    { query: { queryKey: getGetConnectionsQueryKey({ status: "pending" as any }), refetchInterval: 10_000 } }
  );
  const networkStatus = useNetworkStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const acceptMutation = useAcceptConnection();
  const rejectMutation = useRejectConnection();

  const [dismissed, setDismissed] = useState<Set<string>>(getDismissed);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDismiss = useCallback((id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  }, []);

  const handleDeleteSlip = useCallback(async (activityId: string, slipId: number) => {
    setDeletingId(activityId);
    try {
      const res = await fetch(`/api/job-slips/${slipId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Delete nahi hua");
      }
      handleDismiss(activityId);
      queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      toast({ title: "Slip delete ho gayi" });
    } catch (e: any) {
      toast({ title: e?.message ?? "Kuch galat hua", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }, [handleDismiss, queryClient, toast]);

  const receivedPending = (pendingConnections ?? []).filter((c: any) => c.direction === "received");

  const handleAccept = (id: number, name: string) => {
    acceptMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetConnectionsQueryKey() });
        toast({ title: "✅ Connection Accept!", description: `${name} se connection ho gaya` });
      }
    });
  };

  const handleReject = (id: number) => {
    rejectMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetConnectionsQueryKey() });
        toast({ title: "Request reject ho gayi" });
      }
    });
  };

  const unreadCount = notifications?.filter(n => !n.isRead).length || 0;
  const { plan, daysLeft, isLocked, isExpiringSoon } = getPlanStatus(user);

  if (userLoading || summaryLoading || activityLoading) {
    return (
      <Layout>
        <div className="p-4 space-y-6">
          <Skeleton className="h-52 w-full rounded-3xl" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </Layout>
    );
  }

  if (!user || !summary) return null;

  const isSeth = user.role === "seth" || user.role === "super_admin";

  return (
    <Layout>
      <div className="flex flex-col h-[calc(100dvh-4rem)] overflow-hidden">
        {/* Fixed top section — header + banners + status */}
        <div className="flex-shrink-0">
        {/* Header */}
        <header className="bg-primary text-primary-foreground p-5 rounded-b-3xl shadow-md relative overflow-hidden">

          {/* Animated fabric threads in background */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 360 200"
            preserveAspectRatio="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line className="thread-h" x1="0" y1="20" x2="360" y2="20" stroke="white" strokeWidth="1" />
            <line className="thread-h-rev" x1="0" y1="55" x2="360" y2="55" stroke="white" strokeWidth="0.8" style={{animationDelay:"-1s"}} />
            <line className="thread-h" x1="0" y1="100" x2="360" y2="100" stroke="white" strokeWidth="0.7" style={{animationDelay:"-2.5s"}} />
            <line className="thread-h-rev" x1="0" y1="150" x2="360" y2="150" stroke="white" strokeWidth="0.6" style={{animationDelay:"-0.5s"}} />
            <line className="thread-h" x1="60" y1="0" x2="60" y2="200" stroke="white" strokeWidth="0.7" style={{animationDelay:"-1.5s"}} />
            <line className="thread-h-rev" x1="180" y1="0" x2="180" y2="200" stroke="white" strokeWidth="0.6" style={{animationDelay:"-3s"}} />
            <line className="thread-h" x1="300" y1="0" x2="300" y2="200" stroke="white" strokeWidth="0.7" style={{animationDelay:"-0.8s"}} />
            <path className="thread-wave-path" d="M0,30 Q60,18 120,30 Q180,42 240,30 Q300,18 360,30" stroke="white" strokeWidth="1" fill="none" opacity="0.2" />
            <path className="thread-wave-path2" d="M0,80 Q80,68 160,80 Q240,92 320,80 Q360,74 400,80" stroke="white" strokeWidth="0.8" fill="none" opacity="0.15" />
          </svg>

          {/* Compact Logo + Brand — centered at top */}
          <div className="relative flex items-center justify-center gap-3 mb-4">
            <div
              className="animate-logo-float bg-primary rounded-xl flex items-center justify-center shrink-0"
              style={{
                width: 40, height: 40,
                boxShadow: [
                  "0 0 0 2px rgba(255,255,255,0.90)",
                  "0 0 0 5px rgba(255,210,60,0.75)",
                  "0 0 0 8px rgba(255,100,160,0.55)",
                  "0 0 0 11px rgba(80,220,255,0.35)",
                ].join(", "),
              }}
            >
              <svg width="24" height="24" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 5h22v6H15v7h13v6H15V35H8V5z" fill="white"/>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-extrabold tracking-tight text-white leading-none">FabricPro</h2>
              <p className="text-white/60 text-[10px] tracking-wide">Job Work & Payment Register</p>
            </div>
          </div>

          {/* Top row: avatar + name + bell */}
          <div className="relative flex justify-between items-start mb-3">
            <div className="flex items-center gap-3">
              {/* Avatar */}
              <div className="h-11 w-11 rounded-full overflow-hidden border-2 border-white/30 shrink-0 bg-white/10 flex items-center justify-center">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-base font-extrabold text-white">
                    {(user.name || user.code || "?")[0].toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <p className="text-white/60 text-[11px] font-semibold tracking-wide uppercase">Hello..! 👋</p>
                <h1 className="text-xl font-extrabold text-white leading-tight truncate max-w-[170px]">
                  {user.name || user.code}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              {/* Network dot */}
              <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-2 py-1">
                <NetworkDot status={networkStatus} />
                {networkStatus !== "online" && (
                  <span className="text-[10px] text-white/80 font-medium">
                    {networkStatus === "offline" ? "Offline" : "Sync..."}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  const msg = encodeURIComponent("FabricPro app join karo! Fabric ka pura hisaab ek jagah 📱\nYahaan se register karo: https://fabric-flow-management--adeenadupatta.replit.app");
                  window.open(`https://wa.me/?text=${msg}`, "_blank");
                }}
                className="p-2 bg-white/10 rounded-full"
                title="App Share Karo"
              >
                <Share2 className="w-5 h-5" />
              </button>
              <Link href="/notifications" className="relative p-2 bg-white/10 rounded-full">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-primary" />
                )}
              </Link>
            </div>
          </div>

          {/* Plan badge row */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <PlanBadge plan={plan} daysLeft={daysLeft} isExpiringSoon={isExpiringSoon} />
            {daysLeft !== null && plan !== "pro" && plan !== "inactive" && (
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                daysLeft <= 5 ? "bg-red-500/90 text-white" : "bg-white/20 text-white"
              )}>
                <Clock className="w-3 h-3" />
                {daysLeft === 0 ? "Aaj khatam!" : `${daysLeft} din baki`}
              </span>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/10 rounded-2xl p-3 border border-white/15 text-center">
              <ArrowDownRight className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
              <p className="text-[9px] leading-tight text-white/70 mb-0.5 truncate">{isSeth ? "Maal Aya" : "Maal Liya"}</p>
              <p className="font-bold text-base">{isSeth ? summary.maalAya : summary.maalLiya}</p>
            </div>
            <div className="bg-white/10 rounded-2xl p-3 border border-white/15 text-center">
              <ArrowUpRight className="w-4 h-4 text-orange-400 mx-auto mb-1" />
              <p className="text-[9px] leading-tight text-white/70 mb-0.5 truncate">{isSeth ? "Maal Gaya" : "Maal Diya"}</p>
              <p className="font-bold text-base">{isSeth ? summary.maalGaya : summary.maalDiya}</p>
            </div>
            <div className="bg-white/10 rounded-2xl p-3 border border-white/15 text-center">
              <IndianRupee className="w-4 h-4 text-sky-400 mx-auto mb-1" />
              <p className="text-[9px] leading-tight text-white/70 mb-0.5 truncate">{isSeth ? "Payment Aya" : "Payment Diya"}</p>
              <p className="font-bold text-base">{isSeth ? summary.paymentAya : summary.paymentDiya}</p>
            </div>
          </div>

          {/* Copyright inside header */}
          <p className="text-center text-[10px] text-white/60 mt-3 tracking-wide select-none font-medium">
            © {new Date().getFullYear()} FabricPro · All Rights Reserved
          </p>
        </header>

        {/* Pending Connection Requests Banner */}
        {receivedPending.length > 0 && (
          <div className="mx-4 mt-4 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <UserCheck className="h-4 w-4 text-orange-600" />
              <p className="font-bold text-sm text-orange-700">
                {receivedPending.length} Connection Request{receivedPending.length > 1 ? "s" : ""} Aayi
                {receivedPending.length > 1 ? " Hain" : " Hai"}!
              </p>
            </div>
            {receivedPending.map((conn: any) => (
              <Card key={conn.id} className="border-orange-200 bg-orange-50 shadow-sm">
                <CardContent className="p-3">
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="h-10 w-10 rounded-full bg-orange-200 flex items-center justify-center shrink-0">
                      <span className="font-bold text-orange-700 text-base">
                        {(conn.connectedUser?.name || conn.connectedUser?.code || "?")[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{conn.connectedUser?.name || conn.connectedUser?.code || "Unknown"}</p>
                      {conn.connectedUser?.mobile && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground font-mono">+91 {conn.connectedUser.mobile}</span>
                        </div>
                      )}
                      <p className="text-xs text-orange-600 font-semibold mt-0.5 capitalize">{conn.roleLabel} ke roop mein add karna chahta hai</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white h-8 text-xs font-bold"
                      disabled={acceptMutation.isPending || rejectMutation.isPending}
                      onClick={() => handleAccept(conn.id, conn.connectedUser?.name || conn.connectedUser?.mobile || "")}
                    >
                      <Check className="w-3.5 h-3.5 mr-1" /> Accept Karo
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-red-600 border-red-200 hover:bg-red-50 h-8 text-xs font-bold"
                      disabled={acceptMutation.isPending || rejectMutation.isPending}
                      onClick={() => handleReject(conn.id)}
                    >
                      <X className="w-3.5 h-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Inactive banner */}
        {isLocked && (
          <div className="mx-4 mt-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex items-start gap-3">
            <Lock className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-red-800 dark:text-red-200 text-sm">Trial khatam ho gaya</p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                Naya data save nahi hoga. <strong>1 month tak aapka record safe rahega.</strong> Basic ya Pro plan len.
              </p>
            </div>
          </div>
        )}

        {/* Expiring soon */}
        {isExpiringSoon && !isLocked && daysLeft !== null && (
          <div className="mx-4 mt-3 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-orange-800 dark:text-orange-200 text-sm">Sirf {daysLeft} din bache hain</p>
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                Trial jald expire hogi. Plan upgrade karo data safe rakhne ke liye.
              </p>
            </div>
          </div>
        )}

        {/* Status bar */}
        <div className="px-4 py-3 flex gap-3">
          <Link href="/connections" className="flex-1">
            <Card className="bg-card hover:bg-accent/50 transition-colors border-border/50">
              <CardContent className="p-4 flex justify-between items-center">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Connections</p>
                  <p className="text-xl font-bold text-foreground">{summary.totalConnections}</p>
                </div>
                <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-full text-blue-600 dark:text-blue-400">
                  <Users className="w-4 h-4" />
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/slips?status=pending" className="flex-1">
            <Card className="bg-card hover:bg-accent/50 transition-colors border-border/50">
              <CardContent className="p-4 flex justify-between items-center">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Pending</p>
                  <p className="text-xl font-bold text-foreground">{summary.pendingSlips}</p>
                </div>
                <div className="bg-yellow-100 dark:bg-yellow-900/30 p-2 rounded-full text-yellow-600 dark:text-yellow-400">
                  <span className="w-4 h-4 flex items-center justify-center font-bold text-sm">!</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
        </div>{/* end fixed top section */}

        {/* Scrollable activity section */}
        <div className="flex-1 overflow-y-auto min-h-0">
        {/* Recent Activity */}
        <div className="px-4 mt-1 pb-28">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-foreground">Recent Activity</h2>
            {dismissed.size > 0 && (
              <button
                onClick={() => { setDismissed(new Set()); localStorage.removeItem(DISMISSED_KEY); }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="w-3 h-3" /> Restore
              </button>
            )}
          </div>
          <div className="space-y-2">
            {(() => {
              const visibleItems = (activity ?? []).filter((item: any) => !dismissed.has(item.id));
              if (activityLoading) {
                return Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />);
              }
              if (visibleItems.length === 0) {
                return (
                  <div className="text-center py-10 text-muted-foreground bg-muted/30 rounded-xl border border-dashed border-border text-sm">
                    Koi activity nahi hai
                  </div>
                );
              }
              return visibleItems.map((item: any) => {
                const isSlip = item.activityType === "slip";
                const isReturn = item.activityType === "return";
                const isDeleting = deletingId === item.id;
                return (
                  <Card key={item.id} className="overflow-hidden border-border/50">
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        <div className={`p-2.5 rounded-full shrink-0 ${
                          item.activityType === 'payment' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          isSlip ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                          isReturn ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                          'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        }`}>
                          {item.activityType === 'payment' ? <IndianRupee className="w-4 h-4" /> :
                           isSlip ? <FileText className="w-4 h-4" /> :
                           isReturn ? <RotateCcw className="w-4 h-4" /> :
                           <Users className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-foreground text-sm truncate">{item.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                            {format(new Date(item.timestamp), 'dd MMM, hh:mm a')}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.status && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                              item.status === 'completed' || item.status === 'confirmed' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
                              item.status === 'draft' ? 'bg-gray-100 text-gray-600' :
                              item.status === 'rejected' ? 'bg-red-100 text-red-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>
                              {item.status === "draft" ? "Draft" :
                               item.status === "confirmed" ? "Confirm" :
                               item.status === "completed" ? "Done" : item.status}
                            </span>
                          )}
                          {/* Dismiss X button */}
                          <button
                            onClick={() => handleDismiss(item.id)}
                            className="p-1 rounded-full text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-colors"
                            title="Hatao"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Slip action buttons — only for Seth on editable/deletable slips */}
                      {isSlip && (item.canEdit || item.canDelete) && (
                        <div className="flex gap-2 mt-2.5 pl-10">
                          {item.canEdit && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-3 gap-1 rounded-full border-primary/40 text-primary hover:bg-primary/5"
                              onClick={() => setLocation(`/slips/job/${item.referenceId}`)}
                            >
                              <Pencil className="w-3 h-3" /> Edit
                            </Button>
                          )}
                          {item.canDelete && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-3 gap-1 rounded-full border-red-300 text-red-600 hover:bg-red-50"
                              disabled={isDeleting}
                              onClick={() => handleDeleteSlip(item.id, item.referenceId)}
                            >
                              <Trash2 className="w-3 h-3" /> {isDeleting ? "..." : "Delete"}
                            </Button>
                          )}
                        </div>
                      )}

                      {/* Return/Job slip — tap to open */}
                      {(isSlip || isReturn) && !item.canEdit && !item.canDelete && (
                        <div className="pl-10 mt-1.5">
                          <button
                            onClick={() => setLocation(isSlip ? `/slips/job/${item.referenceId}` : `/slips/return/${item.referenceId}`)}
                            className="text-xs text-primary font-semibold hover:underline"
                          >
                            Detail Dekho →
                          </button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              });
            })()}
          </div>
        </div>
        </div>{/* end scrollable activity section */}

        {/* Quick Actions sticky above nav */}
        <div className="fixed bottom-16 left-0 right-0 p-3 bg-gradient-to-t from-background via-background/90 to-transparent pointer-events-none z-40">
          <div className="flex gap-3 pointer-events-auto max-w-lg mx-auto">
            {isLocked ? (
              <div className="flex-1 flex items-center justify-center gap-2 h-13 bg-muted rounded-xl text-muted-foreground text-sm font-medium border border-border py-3">
                <Lock className="w-4 h-4" /> Plan Upgrade Karo
              </div>
            ) : (
              <>
                <Link href="/slips/new" className="flex-1">
                  <Button size="lg" className="w-full h-13 text-sm font-bold shadow-lg py-3">
                    <PlusCircle className="mr-1.5 h-4 w-4" /> Maal Issue
                  </Button>
                </Link>
                <Link href="/payments/new" className="flex-1">
                  <Button size="lg" variant="secondary" className="w-full h-13 text-sm font-bold shadow-lg py-3">
                    <IndianRupee className="mr-1.5 h-4 w-4" /> Payment
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

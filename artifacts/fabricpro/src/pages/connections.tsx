import { useState } from "react";
import { Link } from "wouter";
import { apiUrl } from "@/lib/api-url";
import { useGetConnections, getGetConnectionsQueryKey, useAcceptConnection, useRejectConnection, ConnectionStatus } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users, UserPlus, Phone, ChevronDown, ChevronUp, Clock, Trash2, Check, X, WifiOff, Pencil, Loader2, Tags } from "lucide-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { UserAvatar } from "@/components/user-avatar";

function isOfflineKarigar(mobile?: string) {
  return mobile ? mobile.startsWith("100") : false;
}

export default function Connections() {
  const [tab, setTab] = useState<"accepted" | "requests">("accepted");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Offline karigar add sheet
  const [offlineSheet, setOfflineSheet] = useState(false);
  const [offlineName, setOfflineName] = useState("");
  const [offlineMobile, setOfflineMobile] = useState("");
  const [offlineLoading, setOfflineLoading] = useState(false);

  // Offline karigar edit sheet
  const [editSheet, setEditSheet] = useState<{ connId: number; name: string; mobile: string } | null>(null);
  const [editName, setEditName] = useState("");
  const [editMobile, setEditMobile] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // Role change
  const [roleChangeLoading, setRoleChangeLoading] = useState<number | null>(null);

  const { data: acceptedConnections, isLoading: acceptedLoading } = useGetConnections(
    { status: "accepted" as ConnectionStatus },
    { query: { queryKey: getGetConnectionsQueryKey({ status: "accepted" as ConnectionStatus }), refetchInterval: 10_000 } }
  );

  const { data: adminReviewConnections = [], isLoading: adminReviewLoading } = useQuery({
    queryKey: ["connections", "admin_review"],
    queryFn: async () => {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(apiUrl("/api/connections?status=admin_review"), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return [];
      return res.json() as Promise<any[]>;
    },
    refetchInterval: 8_000,
  });

  const { data: receivedConnections = [], isLoading: receivedLoading } = useGetConnections(
    { status: "pending" as ConnectionStatus },
    { query: { queryKey: getGetConnectionsQueryKey({ status: "pending" as ConnectionStatus }), refetchInterval: 8_000 } }
  );

  const acceptMutation = useAcceptConnection();
  const rejectMutation = useRejectConnection();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetConnectionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["connections", "admin_review"] });
  };

  const handleRoleChange = async (connId: number, newRole: "seth" | "karigar" | "both") => {
    setRoleChangeLoading(connId);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(`/api/connections/${connId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ roleLabel: newRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast({ title: err.error ?? "Role update nahi hua", variant: "destructive" });
        return;
      }
      toast({ title: "Role update ho gaya ✅" });
      invalidateAll();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setRoleChangeLoading(null);
    }
  };

  const handleAccept = (id: number) => {
    acceptMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Connection accept ho gaya ✅" });
        invalidateAll();
      }
    });
  };

  const handleReject = (id: number) => {
    rejectMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Request reject ho gayi" });
        invalidateAll();
      }
    });
  };

  const handleCancelRequest = (id: number) => {
    rejectMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Request cancel ho gayi" });
        invalidateAll();
      },
      onError: () => {
        toast({ title: "Kuch gadbad hui", variant: "destructive" });
      }
    });
  };

  const handleAddOffline = async () => {
    if (!offlineName.trim()) {
      toast({ title: "Naam daalna zaroori hai", variant: "destructive" });
      return;
    }
    setOfflineLoading(true);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(apiUrl("/api/connections/add-offline-karigar"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: offlineName.trim(),
          mobile: offlineMobile.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Kuch gadbad hui", variant: "destructive" });
        return;
      }
      toast({ title: `${offlineName.trim()} ko add kar diya ✅` });
      setOfflineSheet(false);
      setOfflineName("");
      setOfflineMobile("");
      invalidateAll();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setOfflineLoading(false);
    }
  };

  const openEditSheet = (conn: any) => {
    const user = conn.connectedUser as any;
    setEditSheet({ connId: conn.id, name: user?.name || "", mobile: "" });
    setEditName(user?.name || "");
    setEditMobile("");
  };

  const handleEditOffline = async () => {
    if (!editSheet) return;
    if (!editName.trim() && !editMobile.trim()) {
      toast({ title: "Naam ya mobile — kuch toh daalein", variant: "destructive" });
      return;
    }
    setEditLoading(true);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(`/api/connections/${editSheet.connId}/update-offline-karigar`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: editName.trim() || undefined,
          mobile: editMobile.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Update nahi hua", variant: "destructive" });
        return;
      }
      toast({ title: "Update ho gaya ✅" });
      setEditSheet(null);
      invalidateAll();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setEditLoading(false);
    }
  };

  const receivedPending = receivedConnections.filter((c) => c.direction === "received");
  const sentAdminReview = adminReviewConnections.filter((c: any) => c.direction === "sent");
  const pendingCount = receivedPending.length + sentAdminReview.length;

  return (
    <Layout>
      <div className="p-4 max-w-lg mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Connections</h1>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-10 rounded-full px-3 font-semibold border-orange-300 text-orange-700 hover:bg-orange-50"
              onClick={() => setOfflineSheet(true)}
            >
              <WifiOff className="w-4 h-4 mr-1.5" /> Offline
            </Button>
            <Link href="/add-connection">
              <Button size="sm" className="h-10 rounded-full px-4 font-semibold">
                <UserPlus className="w-4 h-4 mr-2" /> Add New
              </Button>
            </Link>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "accepted" | "requests")} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="accepted" className="text-base h-10">Connected</TabsTrigger>
            <TabsTrigger value="requests" className="text-base h-10 relative">
              Requests
              {pendingCount > 0 && (
                <span className="absolute top-1 right-2 w-2 h-2 bg-amber-500 rounded-full"></span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ACCEPTED */}
          <TabsContent value="accepted" className="space-y-2">
            {acceptedLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
            ) : acceptedConnections && acceptedConnections.length > 0 ? (
              acceptedConnections.map((conn) => {
                const isExpanded = expandedId === conn.id;
                const user = conn.connectedUser as any;
                const offline = isOfflineKarigar(user?.mobile);
                return (
                  <Card
                    key={conn.id}
                    className="overflow-hidden border-border/50 transition-all"
                  >
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-left"
                      onClick={() => setExpandedId(isExpanded ? null : conn.id)}
                    >
                      <UserAvatar
                        userId={user?.id ?? conn.id}
                        name={user?.name}
                        code={user?.code}
                        avatarUrl={user?.avatarUrl}
                        size="sm"
                        showOnline
                        isOnline={user?.isOnline}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-bold text-sm truncate">{user?.name || "Unknown User"}</p>
                          {offline && (
                            <Badge className="text-[9px] px-1.5 py-0 h-4 bg-orange-100 text-orange-700 border-orange-300 font-semibold shrink-0">
                              <WifiOff className="w-2.5 h-2.5 mr-0.5" /> Offline
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono">
                          {offline ? user?.code || "" : user?.mobile ? `+91 ${user.mobile}` : user?.code || ""}
                        </p>
                      </div>
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                        : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                      }
                    </button>

                    {isExpanded && (
                      <CardContent className="px-4 pb-4 pt-0 border-t border-border/50">
                        <div className="space-y-2 mt-3">
                          {user?.code && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Code</span>
                              <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs">{user.code}</span>
                            </div>
                          )}
                          {/* Role display + change */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Role</span>
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                conn.roleLabel === "both"
                                  ? "bg-purple-100 text-purple-700"
                                  : conn.roleLabel === "seth"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-green-100 text-green-700"
                              }`}>
                                {conn.roleLabel === "both" ? "Dono (Seth + Karigar)" : conn.roleLabel === "seth" ? "Seth" : "Karigar"}
                              </span>
                            </div>
                            <div className="pt-1 border-t border-border/40">
                              <p className="text-[10px] text-muted-foreground mb-2 flex items-center gap-1">
                                <Tags className="w-3 h-3" /> Role Badlo
                              </p>
                              <div className="grid grid-cols-3 gap-1.5">
                                {(["seth", "karigar", "both"] as const).map((r) => {
                                  const active = conn.roleLabel === r;
                                  const isLoading = roleChangeLoading === conn.id;
                                  return (
                                    <button
                                      key={r}
                                      disabled={active || isLoading}
                                      onClick={(e) => { e.stopPropagation(); handleRoleChange(conn.id, r); }}
                                      className={`h-8 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1 ${
                                        active
                                          ? r === "both"
                                            ? "bg-purple-600 text-white"
                                            : r === "seth"
                                            ? "bg-blue-600 text-white"
                                            : "bg-green-600 text-white"
                                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                                      }`}
                                    >
                                      {isLoading && !active ? <Loader2 className="w-3 h-3 animate-spin" /> : (
                                        r === "both" ? "Dono" : r === "seth" ? "Seth" : "Karigar"
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                          {!offline && user?.mobile && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Mobile</span>
                              <div className="flex items-center gap-1.5">
                                <Phone className="w-3 h-3 text-muted-foreground" />
                                <span className="text-sm font-mono">+91 {user.mobile}</span>
                              </div>
                            </div>
                          )}
                          {user?.address && (
                            <div className="flex items-start justify-between text-sm gap-4">
                              <span className="text-muted-foreground shrink-0">Address</span>
                              <span className="text-right text-sm">{user.address}</span>
                            </div>
                          )}
                          {offline && (
                            <div className="pt-1 border-t border-border/40">
                              <div className="flex items-center gap-1.5 text-xs text-orange-600 mb-2">
                                <WifiOff className="w-3 h-3" />
                                <span>Offline karigar — phone number nahi hai</span>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full h-8 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
                                onClick={(e) => { e.stopPropagation(); openEditSheet(conn); }}
                              >
                                <Pencil className="w-3 h-3 mr-1.5" /> Naam / Number Update Karo
                              </Button>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })
            ) : (
              <div className="text-center py-12 px-4 bg-muted/30 rounded-xl border border-dashed border-border">
                <Users className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                <h3 className="font-semibold text-lg mb-1">Koi connection nahi</h3>
                <p className="text-muted-foreground text-sm mb-4">Business partners add karo tracking ke liye.</p>
                <Link href="/add-connection">
                  <Button variant="outline">Connection Dhundo</Button>
                </Link>
              </div>
            )}
          </TabsContent>

          {/* REQUESTS */}
          <TabsContent value="requests" className="space-y-3">

            {(receivedLoading) ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : receivedPending.length > 0 && (
              <>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Aapke paas aayi requests</p>
                {receivedPending.map((conn) => {
                  const user = conn.connectedUser as any;
                  return (
                    <Card key={conn.id} className="overflow-hidden border-green-200 bg-green-50/30">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <UserAvatar
                            userId={user?.id ?? conn.id}
                            name={user?.name}
                            code={user?.code}
                            avatarUrl={user?.avatarUrl}
                            size="sm"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm truncate">{user?.name || "Unknown User"}</p>
                            {user?.mobile && (
                              <p className="text-xs text-muted-foreground font-mono">+91 {user.mobile}</p>
                            )}
                          </div>
                          <Badge variant="outline" className="text-[10px] capitalize shrink-0">{conn.roleLabel}</Badge>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white h-9 text-sm"
                            onClick={() => handleAccept(conn.id)}
                            disabled={acceptMutation.isPending || rejectMutation.isPending}
                          >
                            <Check className="w-4 h-4 mr-1.5" /> Accept
                          </Button>
                          <Button
                            variant="outline"
                            className="flex-1 text-destructive hover:bg-destructive/10 h-9 text-sm"
                            onClick={() => handleReject(conn.id)}
                            disabled={acceptMutation.isPending || rejectMutation.isPending}
                          >
                            <X className="w-4 h-4 mr-1.5" /> Reject
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </>
            )}

            {adminReviewLoading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : sentAdminReview.length > 0 && (
              <>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Aapki bheji hui requests</p>
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
                  <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                  <span>Yeh requests Admin review kar ke approve karega.</span>
                </div>
                {sentAdminReview.map((conn: any) => {
                  const user = conn.connectedUser as any;
                  return (
                    <Card key={conn.id} className="overflow-hidden border-amber-200 bg-amber-50/40">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <UserAvatar
                            userId={user?.id ?? conn.id}
                            name={user?.name}
                            code={user?.code}
                            avatarUrl={user?.avatarUrl}
                            size="sm"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm truncate">{user?.name || "Unknown User"}</p>
                            {user?.mobile && (
                              <p className="text-xs text-muted-foreground font-mono">+91 {user.mobile}</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge className="bg-amber-100 text-amber-700 border-amber-300 text-[10px] font-semibold">
                              ⏳ Admin Review
                            </Badge>
                            <span className="text-[10px] text-muted-foreground capitalize">{conn.roleLabel}</span>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full h-8 text-xs text-red-600 border-red-200 hover:bg-red-50 gap-1.5"
                          onClick={() => handleCancelRequest(conn.id)}
                          disabled={rejectMutation.isPending}
                        >
                          <Trash2 className="w-3 h-3" /> Cancel Karo
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </>
            )}

            {!receivedLoading && !adminReviewLoading && receivedPending.length === 0 && sentAdminReview.length === 0 && (
              <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-xl border border-dashed border-border">
                <Clock className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm">Koi pending request nahi</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ADD OFFLINE KARIGAR SHEET */}
      <Sheet open={offlineSheet} onOpenChange={setOfflineSheet}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8">
          <SheetHeader className="mb-5">
            <SheetTitle className="flex items-center gap-2 text-orange-700">
              <WifiOff className="w-5 h-5" /> Offline Karigar Banao
            </SheetTitle>
          </SheetHeader>

          <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 text-xs text-orange-800 mb-5">
            Jin karigar ke paas phone nahi, unhe sirf naam se add karo. Baad mein jab phone milega to number daal dena — woh apna sara kaam dekh sakenge.
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="offline-name" className="font-semibold">
                Karigar ka Naam <span className="text-destructive">*</span>
              </Label>
              <Input
                id="offline-name"
                placeholder="Jaise: Ramesh Bhai, Shyam Karigar..."
                value={offlineName}
                onChange={(e) => setOfflineName(e.target.value)}
                className="h-12 text-base"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="offline-mobile" className="font-semibold">
                Phone Number{" "}
                <span className="text-muted-foreground font-normal text-xs">(optional — baad mein bhi daal sakte ho)</span>
              </Label>
              <div className="flex gap-2 items-center">
                <span className="text-sm text-muted-foreground font-mono bg-muted px-3 h-12 flex items-center rounded-md border border-input">+91</span>
                <Input
                  id="offline-mobile"
                  placeholder="10 digit number..."
                  value={offlineMobile}
                  onChange={(e) => setOfflineMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="h-12 text-base flex-1"
                  inputMode="numeric"
                  maxLength={10}
                />
              </div>
            </div>

            <Button
              className="w-full h-12 text-base font-semibold mt-2"
              onClick={handleAddOffline}
              disabled={offlineLoading || !offlineName.trim()}
            >
              {offlineLoading ? "Add ho raha hai..." : "Karigar Add Karo"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* EDIT OFFLINE KARIGAR SHEET */}
      <Sheet open={!!editSheet} onOpenChange={(open) => { if (!open) setEditSheet(null); }}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8">
          <SheetHeader className="mb-5">
            <SheetTitle className="flex items-center gap-2 text-orange-700">
              <Pencil className="w-5 h-5" /> Karigar Update Karo
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name" className="font-semibold">Naam</Label>
              <Input
                id="edit-name"
                placeholder="Karigar ka naam..."
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-12 text-base"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-mobile" className="font-semibold">
                Asli Phone Number Daalein
              </Label>
              <div className="flex gap-2 items-center">
                <span className="text-sm text-muted-foreground font-mono bg-muted px-3 h-12 flex items-center rounded-md border border-input">+91</span>
                <Input
                  id="edit-mobile"
                  placeholder="10 digit number..."
                  value={editMobile}
                  onChange={(e) => setEditMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="h-12 text-base flex-1"
                  inputMode="numeric"
                  maxLength={10}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Number dalne ke baad karigar apne phone se login karke sab transactions dekh sakta hai.
              </p>
            </div>

            <Button
              className="w-full h-12 text-base font-semibold mt-2"
              onClick={handleEditOffline}
              disabled={editLoading}
            >
              {editLoading ? "Update ho raha hai..." : "Update Karo"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </Layout>
  );
}

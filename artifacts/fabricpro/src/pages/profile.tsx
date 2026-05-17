import { useRef, useState, useEffect } from "react";
import { useGetMe, useLogout, useUpdateAvatar, customFetch } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Phone, BadgeCheck, Camera, X, Fingerprint, ShieldCheck, ShieldOff, Pencil, Check, Lock, Eye, EyeOff, KeyRound, User, Mail, Download, FileSpreadsheet, Wallet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { startRegistration } from "@simplewebauthn/browser";

export default function Profile() {
  const [showAvatarLightbox, setShowAvatarLightbox] = useState(false);
  const { data: user, isLoading } = useGetMe();
  const logoutMutation = useLogout();
  const updateAvatarMutation = useUpdateAvatar();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // Name editing state
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState("");
  const [nameSaving, setNameSaving] = useState(false);

  // Email editing state
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailVal, setEmailVal] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [exportingData, setExportingData] = useState(false);

  // UPI ID editing state
  const [editingUpi, setEditingUpi] = useState(false);
  const [upiVal, setUpiVal] = useState("");
  const [upiSaving, setUpiSaving] = useState(false);

  // Password change state
  const [showPwForm, setShowPwForm] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  const [bioStatus, setBioStatus] = useState<"loading" | "enabled" | "disabled">("loading");
  const [bioLoading, setBioLoading] = useState(false);

  // Check if biometric is set up — read localStorage cache first, then verify from server
  useEffect(() => {
    if (!user?.mobile) return;
    const cacheKey = `fp_bio_${user.mobile}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached === "1") setBioStatus("enabled");
    fetch(`/api/auth/webauthn/has-credential?mobile=${encodeURIComponent(user.mobile)}`)
      .then((r) => r.json())
      .then((d) => {
        setBioStatus(d.hasCredential ? "enabled" : "disabled");
        if (d.hasCredential) {
          localStorage.setItem(cacheKey, "1");
        } else {
          localStorage.removeItem(cacheKey);
        }
      })
      .catch(() => {
        if (cached !== "1") setBioStatus("disabled");
      });
  }, [user?.mobile]);

  const handleLogout = () => {
    logoutMutation.mutate({}, {
      onSuccess: () => {
        localStorage.removeItem("fabricpro_token");
        queryClient.clear();
        setLocation("/login");
      }
    });
  };

  const handleNameSave = async () => {
    const trimmed = nameVal.trim();
    if (!trimmed || trimmed.length < 2) {
      toast({ title: "Naam bahut chhota hai", variant: "destructive" }); return;
    }
    setNameSaving(true);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(apiUrl("/api/users/me/name"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Save nahi hua"); }
      queryClient.invalidateQueries({ queryKey: ["getMe"] });
      toast({ title: "Naam update ho gaya ✓" });
      setEditingName(false);
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally { setNameSaving(false); }
  };

  const handleEmailSave = async () => {
    const trimmed = emailVal.trim().toLowerCase();
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast({ title: "Sahi email address daalo", variant: "destructive" }); return;
    }
    setEmailSaving(true);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(apiUrl("/api/users/me/email"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ email: trimmed || null }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Save nahi hua"); }
      queryClient.invalidateQueries({ queryKey: ["getMe"] });
      toast({ title: trimmed ? "Email save ho gaya ✓" : "Email hata di gayi" });
      setEditingEmail(false);
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally { setEmailSaving(false); }
  };

  const handleUpiSave = async () => {
    const trimmed = upiVal.trim();
    setUpiSaving(true);
    try {
      const updated = await customFetch<any>("/api/users/me/upi", {
        method: "PATCH",
        body: JSON.stringify({ upiId: trimmed || null }),
      });
      queryClient.setQueryData(["getMe"], (old: any) => old ? { ...old, ...updated } : updated);
      queryClient.invalidateQueries({ queryKey: ["getMe"] });
      toast({ title: trimmed ? "UPI ID save ho gaya ✓" : "UPI ID hata di gayi" });
      setEditingUpi(false);
    } catch (e: any) {
      toast({ title: e.message ?? "Save nahi hua", variant: "destructive" });
    } finally { setUpiSaving(false); }
  };

  const handleDataExport = async () => {
    setExportingData(true);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(apiUrl("/api/users/me/export-excel"), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Export nahi hua");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const cd = res.headers.get("content-disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      a.href = url;
      a.download = match?.[1] ?? "MyData_FabricPro.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Data export ho gaya! Excel file download ho rahi hai" });
    } catch {
      toast({ title: "Export fail hua, dobara try karo", variant: "destructive" });
    } finally { setExportingData(false); }
  };

  const handlePasswordChange = async () => {
    if (!currentPw) { toast({ title: "Purana password daalo", variant: "destructive" }); return; }
    if (newPw.length < 6) { toast({ title: "Naya password kam se kam 6 characters ka hona chahiye", variant: "destructive" }); return; }
    if (newPw !== confirmPw) { toast({ title: "Naya password aur confirm password alag hain", variant: "destructive" }); return; }
    setPwSaving(true);
    try {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(apiUrl("/api/users/me/password"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Password nahi badla"); }
      toast({ title: "Password badal gaya ✓" });
      setShowPwForm(false); setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally { setPwSaving(false); }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File bahut badi hai", description: "2MB se chhoti image choose karo", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const b64 = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX = 300;
        const ratio = Math.min(MAX / img.width, MAX / img.height);
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const resized = canvas.toDataURL("image/jpeg", 0.7);
        updateAvatarMutation.mutate(
          { data: { avatarUrl: resized } },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: ["getMe"] });
              toast({ title: "Photo update ho gayi!" });
            },
            onError: () => toast({ title: "Upload fail", variant: "destructive" }),
          }
        );
      };
      img.src = b64;
    };
    reader.readAsDataURL(file);
  };

  const handleEnableBiometric = async () => {
    if (!("credentials" in navigator)) {
      toast({ title: "Is device mein biometric support nahi hai", variant: "destructive" });
      return;
    }
    setBioLoading(true);
    try {
      const token = localStorage.getItem("fabricpro_token");
      // Get registration options from server
      const optRes = await fetch(apiUrl("/api/auth/webauthn/register-options"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (!optRes.ok) {
        const err = await optRes.json();
        throw new Error(err.error || "Options nahi mile");
      }
      const options = await optRes.json();

      // Use browser to get biometric credential
      const credential = await startRegistration({ optionsJSON: options });

      // Verify on server
      const verifyRes = await fetch(apiUrl("/api/auth/webauthn/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ credential }),
      });
      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        throw new Error(err.error || "Registration fail");
      }
      setBioStatus("enabled");
      if (user?.mobile) localStorage.setItem(`fp_bio_${user.mobile}`, "1");
      toast({ title: "Fingerprint login enable ho gaya! 🎉" });
    } catch (e: any) {
      if (e.name === "NotAllowedError") {
        toast({ title: "Biometric cancel kar diya", variant: "destructive" });
      } else {
        toast({ title: e.message || "Biometric setup fail", variant: "destructive" });
      }
    } finally {
      setBioLoading(false);
    }
  };

  const handleRemoveBiometric = async () => {
    setBioLoading(true);
    try {
      const token = localStorage.getItem("fabricpro_token");
      await fetch(apiUrl("/api/auth/webauthn/credential"), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setBioStatus("disabled");
      if (user?.mobile) localStorage.removeItem(`fp_bio_${user.mobile}`);
      toast({ title: "Fingerprint login hata diya gaya" });
    } catch {
      toast({ title: "Remove karne mein problem aayi", variant: "destructive" });
    } finally {
      setBioLoading(false);
    }
  };

  const roleLabel = (role: string) => {
    if (role === "super_admin") return "Super Admin";
    if (role === "seth") return "Seth Ji";
    return "Karigar";
  };

  const roleBadgeColor = (role: string) => {
    if (role === "super_admin") return "bg-yellow-100 text-yellow-800 border-yellow-300";
    if (role === "seth") return "bg-blue-100 text-blue-800 border-blue-300";
    return "bg-green-100 text-green-800 border-green-300";
  };

  const isBioSupported = typeof window !== "undefined" && "credentials" in navigator;

  return (
    <Layout>
      <div className="pb-24">
        <header className="bg-primary text-primary-foreground px-6 pt-10 pb-6 rounded-b-3xl shadow-md relative">
          <h1 className="text-2xl font-bold">Mera Profile</h1>
          <p className="text-primary-foreground/70 text-sm mt-1">Account details</p>
        </header>

        <div className="px-4 mt-4 space-y-4">
          <div className="bg-card border border-border rounded-3xl p-6 shadow-lg text-center">
            {isLoading ? (
              <>
                <Skeleton className="h-24 w-24 rounded-full mx-auto" />
                <Skeleton className="h-6 w-40 mx-auto mt-4" />
              </>
            ) : user ? (
              <>
                <div className="relative inline-block">
                  <button
                    className="h-24 w-24 rounded-full overflow-hidden border-4 border-primary/20 mx-auto bg-primary/10 flex items-center justify-center"
                    onClick={() => user.avatarUrl && setShowAvatarLightbox(true)}
                    style={{ display: "block" }}
                  >
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-3xl font-bold text-primary">
                        {(user.name || user.code || "?")[0].toUpperCase()}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={updateAvatarMutation.isPending}
                    className="absolute bottom-0 right-0 h-8 w-8 bg-primary rounded-full flex items-center justify-center border-2 border-card shadow-md hover:bg-primary/80 transition-colors"
                  >
                    <Camera className="h-4 w-4 text-white" />
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                </div>

                {/* Avatar lightbox */}
                {showAvatarLightbox && user.avatarUrl && (
                  <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
                    onClick={() => setShowAvatarLightbox(false)}
                  >
                    <img
                      src={user.avatarUrl}
                      alt="Profile"
                      className="max-w-full max-h-full object-contain rounded-2xl"
                      style={{ maxWidth: "90vw", maxHeight: "80vh" }}
                    />
                    <button className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                )}

                <h2 className="text-2xl font-bold mt-4">{user.name ?? "Name nahi hai"}</h2>
                <div className="mt-2 flex justify-center">
                  <span className={`text-sm font-bold px-3 py-1 rounded-full border ${roleBadgeColor(user.role)}`}>
                    {roleLabel(user.role)}
                  </span>
                </div>
                {user.kycCompleted && (
                  <div className="flex items-center justify-center gap-1 mt-2 text-green-600 text-sm">
                    <BadgeCheck className="h-4 w-4" />
                    <span>KYC Verified</span>
                  </div>
                )}
                {updateAvatarMutation.isPending && (
                  <p className="text-xs text-muted-foreground mt-2">Photo upload ho rahi hai...</p>
                )}
              </>
            ) : null}
          </div>

          {user && (
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
              <p className="text-sm text-muted-foreground font-medium mb-2">Aapka Unique Code</p>
              <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 text-center">
                <p className="text-3xl font-black font-mono tracking-[0.3em] text-primary">{user.code}</p>
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2">
                Doosron ko yeh code do taki woh aapko connect kar sakein
              </p>
            </div>
          )}

          {user && (
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
              <h3 className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">Account Info</h3>

              {/* Name — editable */}
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-xl shrink-0">
                  <User className="h-5 w-5 text-muted-foreground" />
                </div>
                {editingName ? (
                  <div className="flex-1 flex gap-2">
                    <Input
                      value={nameVal}
                      onChange={(e) => setNameVal(e.target.value)}
                      placeholder="Apna naam daalo"
                      className="h-9 text-sm flex-1"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") handleNameSave(); if (e.key === "Escape") setEditingName(false); }}
                    />
                    <Button size="sm" className="h-9 px-3" onClick={handleNameSave} disabled={nameSaving}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-9 px-3" onClick={() => setEditingName(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Naam</p>
                      <p className="font-semibold">{user.name ?? "—"}</p>
                    </div>
                    <button
                      onClick={() => { setNameVal(user.name ?? ""); setEditingName(true); }}
                      className="p-2 rounded-xl hover:bg-muted transition-colors"
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                )}
              </div>

              {/* Phone — read only */}
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-xl shrink-0">
                  <Phone className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Mobile Number</p>
                    <p className="font-semibold">{user.mobile}</p>
                  </div>
                  <div className="p-2 rounded-xl bg-muted/50">
                    <Lock className="h-4 w-4 text-muted-foreground/50" />
                  </div>
                </div>
              </div>

              {/* Email — editable */}
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-xl shrink-0">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                </div>
                {editingEmail ? (
                  <div className="flex-1 flex gap-2">
                    <Input
                      type="email"
                      value={emailVal}
                      onChange={(e) => setEmailVal(e.target.value)}
                      placeholder="aapka@email.com"
                      className="h-9 text-sm flex-1"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") handleEmailSave(); if (e.key === "Escape") setEditingEmail(false); }}
                    />
                    <Button size="sm" className="h-9 px-3" onClick={handleEmailSave} disabled={emailSaving}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-9 px-3" onClick={() => setEditingEmail(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="font-semibold text-sm">{(user as any).email ?? <span className="text-muted-foreground font-normal">— abhi nahi dala</span>}</p>
                    </div>
                    <button
                      onClick={() => { setEmailVal((user as any).email ?? ""); setEditingEmail(true); }}
                      className="p-2 rounded-xl hover:bg-muted transition-colors"
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                )}
              </div>

              {/* UPI ID — editable */}
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-xl shrink-0">
                  <Wallet className="h-5 w-5 text-muted-foreground" />
                </div>
                {editingUpi ? (
                  <div className="flex-1 flex gap-2">
                    <Input
                      type="text"
                      value={upiVal}
                      onChange={(e) => setUpiVal(e.target.value)}
                      placeholder="mobile@upi ya yourname@okaxis"
                      className="h-9 text-sm flex-1"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") handleUpiSave(); if (e.key === "Escape") setEditingUpi(false); }}
                    />
                    <Button size="sm" className="h-9 px-3" onClick={handleUpiSave} disabled={upiSaving}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-9 px-3" onClick={() => setEditingUpi(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">UPI ID <span className="text-orange-600 font-semibold">(payment ke liye)</span></p>
                      <p className="font-semibold text-sm">{(user as any).upiId ?? <span className="text-muted-foreground font-normal">— abhi nahi dala</span>}</p>
                    </div>
                    <button
                      onClick={() => { setUpiVal((user as any).upiId ?? ""); setEditingUpi(true); }}
                      className="p-2 rounded-xl hover:bg-muted transition-colors"
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Data Export Card */}
          {user && (
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-emerald-100 rounded-xl">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-base">Apna Data Export Karo</h3>
                  <p className="text-xs text-muted-foreground">
                    Job slips, return slips, payments — sab Excel mein
                  </p>
                </div>
              </div>
              <Button
                onClick={handleDataExport}
                disabled={exportingData}
                className="w-full h-11 font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Download className="h-4 w-4 mr-2" />
                {exportingData ? "Taiyar ho raha hai..." : "Excel File Download Karo"}
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-2">
                3 sheets — Maal Gaya, Maal Aya, Payments
              </p>
            </div>
          )}

          {/* Password Change Card */}
          {user && (
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-muted rounded-xl">
                    <KeyRound className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold text-base">Password Badlo</p>
                    <p className="text-xs text-muted-foreground">Apna login password change karo</p>
                  </div>
                </div>
                {!showPwForm && (
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setShowPwForm(true)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Badlo
                  </Button>
                )}
              </div>

              {showPwForm && (
                <div className="mt-4 space-y-3">
                  {/* Current Password */}
                  <div className="relative">
                    <Input
                      type={showCurrentPw ? "text" : "password"}
                      placeholder="Purana password"
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      className="pr-10"
                    />
                    <button type="button" onClick={() => setShowCurrentPw(!showCurrentPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {/* New Password */}
                  <div className="relative">
                    <Input
                      type={showNewPw ? "text" : "password"}
                      placeholder="Naya password (min 6 characters)"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      className="pr-10"
                    />
                    <button type="button" onClick={() => setShowNewPw(!showNewPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {/* Confirm Password */}
                  <Input
                    type="password"
                    placeholder="Naya password confirm karo"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                  />

                  <div className="flex gap-2 pt-1">
                    <Button onClick={handlePasswordChange} disabled={pwSaving} className="flex-1 rounded-xl">
                      {pwSaving ? "Badal raha hai..." : "Password Badlo"}
                    </Button>
                    <Button variant="ghost" onClick={() => { setShowPwForm(false); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }} className="rounded-xl">
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Biometric Login Card ── */}
          {user && isBioSupported && (
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-xl ${bioStatus === "enabled" ? "bg-green-100" : "bg-muted"}`}>
                  <Fingerprint className={`h-5 w-5 ${bioStatus === "enabled" ? "text-green-600" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-base">Fingerprint Login</h3>
                  <p className="text-xs text-muted-foreground">
                    {bioStatus === "loading" ? "Check ho raha hai..." :
                     bioStatus === "enabled" ? "Biometric login active hai ✓" :
                     "Password ki jagah fingerprint se login karo"}
                  </p>
                </div>
                {bioStatus === "enabled" && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-semibold border border-green-200">
                    ON
                  </span>
                )}
              </div>

              {bioStatus === "disabled" && (
                <Button
                  onClick={handleEnableBiometric}
                  disabled={bioLoading}
                  className="w-full h-12 font-semibold rounded-xl bg-primary"
                >
                  <Fingerprint className="h-4 w-4 mr-2" />
                  {bioLoading ? "Setup ho raha hai..." : "Fingerprint Enable Karo"}
                </Button>
              )}

              {bioStatus === "enabled" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                    <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />
                    <p className="text-sm text-green-800">Next time login screen pe fingerprint button dikhega</p>
                  </div>
                  <Button
                    onClick={handleRemoveBiometric}
                    disabled={bioLoading}
                    variant="outline"
                    className="w-full h-11 font-semibold rounded-xl border-red-200 text-red-600 hover:bg-red-50"
                  >
                    <ShieldOff className="h-4 w-4 mr-2" />
                    {bioLoading ? "Hata raha hai..." : "Fingerprint Hatao"}
                  </Button>
                </div>
              )}
            </div>
          )}

          <Button
            onClick={handleLogout}
            variant="destructive"
            className="w-full h-14 text-base font-semibold rounded-2xl"
            disabled={logoutMutation.isPending}
          >
            <LogOut className="h-5 w-5 mr-2" />
            {logoutMutation.isPending ? "Nikal rahe hain..." : "Logout Karo"}
          </Button>
        </div>
      </div>
    </Layout>
  );
}

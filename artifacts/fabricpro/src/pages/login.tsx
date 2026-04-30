import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useLogin, useLoginWithPassword, useForgotPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, ArrowLeft, UserCircle2, UserPlus, KeyRound, ShieldCheck, Fingerprint } from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";

type Step = "mobile" | "password" | "new_register" | "forgot" | "admin" | "wa_waiting";

interface StoredUser {
  mobile: string;
  name: string;
}

function getStoredUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem("fabricpro_last_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Login() {
  const [step, setStep] = useState<Step>("mobile");
  const [mobile, setMobile] = useState("");
  const [regMobile, setRegMobile] = useState("");
  const [forgotMobile, setForgotMobile] = useState("");
  const [storedUser, setStoredUser] = useState<StoredUser | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminPw, setShowAdminPw] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);

  // WhatsApp approval state
  const [waMobile, setWaMobile] = useState("");
  const [waMode, setWaMode] = useState<"signup" | "reset" | "login">("signup");
  const [waMsg, setWaMsg] = useState("");
  const [waAdminNumber, setWaAdminNumber] = useState("");
  const [waPolling, setWaPolling] = useState(false);
  const waPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loginMutation = useLogin();
  const passwordLoginMutation = useLoginWithPassword();
  const forgotMutation = useForgotPassword();

  const [hasBiometric, setHasBiometric] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);

  useEffect(() => {
    const su = getStoredUser();
    if (su) {
      setStoredUser(su);
      setMobile(su.mobile);
      const rememberedPw = localStorage.getItem(`fabricpro_pw_${su.mobile}`);
      if (rememberedPw) setPassword(rememberedPw);
      setStep("password");
    }
  }, []);

  // Check biometric availability when entering password step (cache-first)
  useEffect(() => {
    if (step !== "password" || !mobile || !("credentials" in navigator)) {
      setHasBiometric(false);
      return;
    }
    const cached = localStorage.getItem(`fp_bio_${mobile}`);
    if (cached === "1") setHasBiometric(true);
    fetch(`/api/auth/webauthn/has-credential?mobile=${encodeURIComponent(mobile)}`)
      .then((r) => r.json())
      .then((d) => {
        setHasBiometric(!!d.hasCredential);
        if (d.hasCredential) {
          localStorage.setItem(`fp_bio_${mobile}`, "1");
        } else {
          localStorage.removeItem(`fp_bio_${mobile}`);
        }
      })
      .catch(() => { if (cached !== "1") setHasBiometric(false); });
  }, [step, mobile]);

  // Auto-trigger biometric on login page if storedUser + biometric cache found
  useEffect(() => {
    if (step !== "password" || !mobile || !storedUser || !("credentials" in navigator)) return;
    const cached = localStorage.getItem(`fp_bio_${mobile}`);
    if (cached !== "1") return;
    const timer = setTimeout(() => {
      handleBiometricLogin();
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mobile, storedUser]);

  const handleBiometricLogin = async () => {
    if (!mobile) return;
    setBioLoading(true);
    try {
      // Get authentication options
      const optRes = await fetch("/api/auth/webauthn/login-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile }),
      });
      if (!optRes.ok) {
        const err = await optRes.json();
        throw new Error(err.error || "Options nahi mile");
      }
      const options = await optRes.json();

      // Prompt fingerprint on device
      const credential = await startAuthentication({ optionsJSON: options });

      // Verify on server
      const loginRes = await fetch("/api/auth/webauthn/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, credential }),
      });
      if (!loginRes.ok) {
        const err = await loginRes.json();
        throw new Error(err.error || "Login fail");
      }
      const data = await loginRes.json();
      localStorage.setItem("fabricpro_token", data.token);
      if (data.user) {
        localStorage.setItem("fabricpro_last_user", JSON.stringify({ mobile: data.user.mobile, name: data.user.name }));
      }
      if (!data.user?.kycCompleted) {
        sessionStorage.setItem("kyc_in_progress", "1");
        setLocation("/kyc");
      } else if (data.user?.activationStatus !== "active") {
        toast({ title: "Account active nahi hai, admin se contact karo", variant: "destructive" });
      } else {
        setLocation("/");
      }
    } catch (e: any) {
      if (e.name === "NotAllowedError") {
        toast({ title: "Fingerprint cancel kar diya", variant: "destructive" });
      } else {
        toast({ title: e.message || "Fingerprint login fail", variant: "destructive" });
      }
    } finally {
      setBioLoading(false);
    }
  };

  // WhatsApp polling — starts when step = "wa_waiting"
  useEffect(() => {
    if (step !== "wa_waiting" || !waMobile) return;
    setWaPolling(true);
    const poll = async () => {
      try {
        const res = await fetch(`/api/auth/wa-status?mobile=${encodeURIComponent(waMobile)}&mode=${waMode}`);
        const data = await res.json();
        if (data.approved) {
          if (waPollRef.current) clearInterval(waPollRef.current);
          setWaPolling(false);
          if (waMode === "signup" || waMode === "login") {
            if (data.token) localStorage.setItem("fabricpro_token", data.token);
            if (data.needsKyc) {
              sessionStorage.setItem("kyc_in_progress", "1");
              sessionStorage.setItem("wa_just_approved", "1");
            }
            setLocation(data.needsKyc ? "/kyc" : "/");
          } else {
            // Reset mode: store otp and redirect to verify-otp
            sessionStorage.setItem("verify_mobile", waMobile);
            sessionStorage.setItem("verify_mode", "reset");
            if (data.resetOtp) sessionStorage.setItem("system_otp", data.resetOtp);
            setLocation("/verify-otp");
          }
        }
      } catch { /* network error — keep polling */ }
    };
    poll(); // immediate first check
    waPollRef.current = setInterval(poll, 3000);
    return () => { if (waPollRef.current) clearInterval(waPollRef.current); };
  }, [step, waMobile, waMode, setLocation]);

  const goToWaWaiting = (mob: string, mode: "signup" | "reset" | "login", adminWa: string, msg: string) => {
    setWaMobile(mob);
    setWaMode(mode);
    setWaAdminNumber(adminWa);
    setWaMsg(msg);
    setStep("wa_waiting");
  };

  const proceedWithMobile = (mob: string) => {
    loginMutation.mutate(
      { data: { mobile: mob } },
      {
        onSuccess: (data: any) => {
          if (data.directLogin) {
            // Already approved user — KYC pending, let them in directly
            sessionStorage.removeItem("verify_mobile");
            if (data.token) localStorage.setItem("fabricpro_token", data.token);
            sessionStorage.setItem("kyc_in_progress", "1");
            sessionStorage.setItem("wa_just_approved", "1");
            setLocation("/kyc");
            return;
          }
          if (data.hasPassword) {
            sessionStorage.removeItem("verify_mobile");
            const remembered = localStorage.getItem(`fabricpro_pw_${mob}`);
            if (remembered) setPassword(remembered);
            setMobile(mob);
            setStep("password");
          } else if (data.whatsappMode) {
            sessionStorage.removeItem("verify_mobile");
            goToWaWaiting(mob, data.waMode ?? "signup", data.adminWhatsapp, data.waMsg);
          } else {
            sessionStorage.setItem("verify_mobile", mob);
            sessionStorage.setItem("verify_mode", "signup");
            if (data.systemOtp) {
              sessionStorage.setItem("system_otp", data.systemOtp);
            } else {
              sessionStorage.removeItem("system_otp");
            }
            setLocation("/verify-otp");
          }
        },
        onError: () => {
          toast({ title: "Network error, dobara try karo", variant: "destructive" });
        },
      }
    );
  };

  const handleMobileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mobile.length < 10) {
      toast({ title: "Mobile number 10 digit hona chahiye", variant: "destructive" });
      return;
    }
    proceedWithMobile(mobile);
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast({ title: "Password kam se kam 6 character ka hona chahiye", variant: "destructive" });
      return;
    }
    passwordLoginMutation.mutate(
      { data: { mobile, password } },
      {
        onSuccess: (data: any) => {
          if (data.token) localStorage.setItem("fabricpro_token", data.token);
          if (data.user) {
            localStorage.setItem(
              "fabricpro_last_user",
              JSON.stringify({ mobile, name: data.user.name ?? "" })
            );
          }
          setLocation(data.needsKyc ? "/kyc" : "/");
        },
        onError: () => {
          toast({ title: "Password galat hai, phir se try karo", variant: "destructive" });
        },
      }
    );
  };

  const handleNewRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (regMobile.length < 10) {
      toast({ title: "Mobile number 10 digit hona chahiye", variant: "destructive" });
      return;
    }
    loginMutation.mutate(
      { data: { mobile: regMobile } },
      {
        onSuccess: (data: any) => {
          if (data.directLogin) {
            if (data.token) localStorage.setItem("fabricpro_token", data.token);
            sessionStorage.setItem("kyc_in_progress", "1");
            sessionStorage.setItem("wa_just_approved", "1");
            setLocation("/kyc");
            return;
          }
          if (data.hasPassword) {
            toast({
              title: "Yeh number pehle se registered hai",
              description: "Login karo ya 'Password bhool gaye?' use karo",
              variant: "destructive",
            });
            setMobile(regMobile);
            const remembered = localStorage.getItem(`fabricpro_pw_${regMobile}`);
            if (remembered) setPassword(remembered);
            setStep("password");
          } else if (data.whatsappMode) {
            goToWaWaiting(regMobile, data.waMode ?? "signup", data.adminWhatsapp, data.waMsg);
          } else {
            sessionStorage.setItem("verify_mobile", regMobile);
            sessionStorage.setItem("verify_mode", "signup");
            if (data.systemOtp) {
              sessionStorage.setItem("system_otp", data.systemOtp);
            } else {
              sessionStorage.removeItem("system_otp");
            }
            setLocation("/verify-otp");
          }
        },
        onError: () => {
          toast({ title: "Network error, dobara try karo", variant: "destructive" });
        },
      }
    );
  };

  const handleForgotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotMobile.length < 10) {
      toast({ title: "Mobile number 10 digit hona chahiye", variant: "destructive" });
      return;
    }
    forgotMutation.mutate(
      { data: { mobile: forgotMobile } },
      {
        onSuccess: (data: any) => {
          localStorage.removeItem(`fabricpro_pw_${forgotMobile}`);
          sessionStorage.removeItem("system_otp");
          if (data.whatsappMode) {
            goToWaWaiting(forgotMobile, "reset", data.adminWhatsapp, data.waMsg);
          } else {
            sessionStorage.setItem("verify_mobile", forgotMobile);
            sessionStorage.setItem("verify_mode", "reset");
            toast({ title: "OTP bheja gaya — apne mobile par dekho" });
            setLocation("/verify-otp");
          }
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error || err?.message || "";
          const status = err?.response?.status;
          if (status === 429 || msg.includes("minute baad")) {
            toast({ title: msg || "Bahut zyada requests — thodi der baad try karo", variant: "destructive" });
          } else if (msg.includes("account nahi")) {
            toast({
              title: "Yeh number registered nahi hai",
              description: "Pehle naya account banao",
              variant: "destructive",
            });
          } else {
            toast({ title: "OTP nahi bhej saka, dobara try karo", variant: "destructive" });
          }
        },
      }
    );
  };

  const switchAccount = () => {
    setStoredUser(null);
    setMobile("");
    setPassword("");
    setStep("mobile");
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPassword || adminPassword.length < 6) {
      toast({ title: "Password kam se kam 6 character ka hona chahiye", variant: "destructive" });
      return;
    }
    setAdminLoading(true);
    try {
      const res = await fetch("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: adminUsername.trim(), password: adminPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "Login fail ho gaya", variant: "destructive" });
        return;
      }
      if (data.token) localStorage.setItem("fabricpro_token", data.token);
      if (data.user) {
        localStorage.setItem(
          "fabricpro_last_user",
          JSON.stringify({ mobile: data.user.mobile, name: data.user.name ?? "" })
        );
      }
      setLocation("/admin");
    } catch {
      toast({ title: "Network error, dobara try karo", variant: "destructive" });
    } finally {
      setAdminLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Top brand */}
      <div className="animate-shimmer-bg text-primary-foreground px-6 pt-7 pb-6 text-center rounded-b-3xl shadow-md relative overflow-hidden">
        {/* Animated fabric threads in background */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 360 130"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Horizontal sliding threads */}
          <line className="thread-h" x1="0" y1="18" x2="360" y2="18" stroke="white" strokeWidth="1" />
          <line className="thread-h-rev" x1="0" y1="40" x2="360" y2="40" stroke="white" strokeWidth="0.8" style={{animationDelay:"-1s"}} />
          <line className="thread-h" x1="0" y1="70" x2="360" y2="70" stroke="white" strokeWidth="1" style={{animationDelay:"-2.5s"}} />
          <line className="thread-h-rev" x1="0" y1="95" x2="360" y2="95" stroke="white" strokeWidth="0.8" style={{animationDelay:"-0.5s"}} />
          <line className="thread-h" x1="0" y1="115" x2="360" y2="115" stroke="white" strokeWidth="0.6" style={{animationDelay:"-3.5s"}} />

          {/* Vertical sliding threads */}
          <line className="thread-h" x1="40" y1="0" x2="40" y2="130" stroke="white" strokeWidth="0.8" style={{animationDelay:"-1.5s"}} />
          <line className="thread-h-rev" x1="120" y1="0" x2="120" y2="130" stroke="white" strokeWidth="0.6" style={{animationDelay:"-3s"}} />
          <line className="thread-h" x1="220" y1="0" x2="220" y2="130" stroke="white" strokeWidth="0.8" style={{animationDelay:"-0.8s"}} />
          <line className="thread-h-rev" x1="310" y1="0" x2="310" y2="130" stroke="white" strokeWidth="0.6" style={{animationDelay:"-2s"}} />

          {/* Wavy thread lines */}
          <path
            className="thread-wave-path"
            d="M0,20 Q60,8 120,20 Q180,32 240,20 Q300,8 360,20"
            stroke="white" strokeWidth="1.2" fill="none" opacity="0.25"
          />
          <path
            className="thread-wave-path2"
            d="M0,50 Q80,38 160,50 Q240,62 320,50 Q360,45 400,50"
            stroke="white" strokeWidth="1" fill="none" opacity="0.2"
          />
          <path
            className="thread-wave-path"
            d="M0,90 Q60,78 120,90 Q180,102 240,90 Q300,78 360,90"
            stroke="white" strokeWidth="0.8" fill="none" opacity="0.15"
            style={{animationDelay:"-2s"}}
          />
        </svg>
        <div
          className="animate-logo-float bg-primary rounded-2xl flex items-center justify-center mx-auto mb-3"
          style={{
            width: 72,
            height: 72,
            boxShadow: [
              "0 0 0 4px rgba(255,255,255,0.90)",
              "0 0 0 8px rgba(255,210,60,0.80)",
              "0 0 0 12px rgba(255,100,160,0.65)",
              "0 0 0 16px rgba(80,220,255,0.50)",
              "0 0 0 20px rgba(255,150,50,0.35)",
            ].join(", "),
          }}
        >
          <svg width="44" height="44" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 5h22v6H15v7h13v6H15V35H8V5z" fill="white"/>
          </svg>
        </div>
        <h1 className="text-3xl font-bold tracking-tight animate-fade-slide-up mt-6">FabricPro</h1>
        <p className="text-primary-foreground/70 text-sm mt-1 animate-fade-slide-up-delay">Job Work & Payment Digital Register</p>
        <p className="text-primary-foreground/60 text-xs mt-1 tracking-widest animate-fade-slide-up-delay">v1.0.0</p>
      </div>

      <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto px-6 space-y-6 py-8">

        {/* ── STEP: MOBILE ── */}
        {step === "mobile" && (
          <>
            <div className="space-y-1">
              <h2 className="text-2xl font-bold">Login Karo</h2>
              <p className="text-muted-foreground text-sm">Apna registered mobile number daalo</p>
            </div>

            <form onSubmit={handleMobileSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="mobile" className="text-base font-semibold">Mobile Number</Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">+91</span>
                  <Input
                    id="mobile"
                    type="tel"
                    placeholder="9876543210"
                    className="pl-14 h-14 text-xl font-semibold tracking-wide"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    autoFocus
                  />
                </div>
              </div>
              <Button type="submit" className="w-full h-14 text-lg font-bold" disabled={loginMutation.isPending || mobile.length < 10}>
                {loginMutation.isPending ? "Check kar raha hu..." : "Aage Badho →"}
              </Button>
            </form>

            <div className="border-t border-border pt-4 space-y-3">
              <button
                type="button"
                onClick={() => { setRegMobile(""); setStep("new_register"); }}
                className="w-full flex items-center justify-center gap-2 h-12 rounded-xl border-2 border-primary/30 text-primary font-semibold text-sm hover:bg-primary/5 transition-colors"
              >
                <UserPlus className="h-4 w-4" />
                Naya Account Banao
              </button>
              <button
                type="button"
                onClick={() => { setForgotMobile(mobile); setStep("forgot"); }}
                className="block w-full text-muted-foreground text-sm text-center"
              >
                Password bhool gaye?
              </button>
              <div className="pt-2 border-t border-border/50">
                <button
                  type="button"
                  onClick={() => { setAdminUsername("admin"); setAdminPassword(""); setStep("admin"); }}
                  className="flex items-center justify-center gap-2 w-full text-muted-foreground/60 text-xs hover:text-muted-foreground transition-colors py-1"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Admin Panel Login
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── STEP: PASSWORD ── */}
        {step === "password" && (
          <>
            {storedUser ? (
              <div className="flex items-center gap-4 bg-muted rounded-2xl p-4">
                <div className="h-14 w-14 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                  <UserCircle2 className="h-8 w-8 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-base truncate">{storedUser.name || "User"}</p>
                  <p className="text-muted-foreground text-sm font-mono">+91 {storedUser.mobile}</p>
                </div>
                <button type="button" onClick={switchAccount} className="text-xs text-primary font-semibold underline shrink-0">
                  Change
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => { setStep("mobile"); setPassword(""); }} className="inline-flex items-center text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="mr-1 h-4 w-4" />
                </button>
                <div>
                  <p className="text-sm text-muted-foreground">Login as</p>
                  <p className="font-bold">+91 {mobile}</p>
                </div>
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-base font-semibold">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="6+ character"
                    className="h-14 text-xl font-semibold pr-14"
                    value={password}
                    onChange={(e) => setPassword(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                    autoFocus
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full h-14 text-lg font-bold" disabled={passwordLoginMutation.isPending || password.length < 6}>
                {passwordLoginMutation.isPending ? "Login ho raha hai..." : "Login Karo"}
              </Button>
            </form>

            {/* Biometric / Fingerprint Login */}
            {hasBiometric && (
              <div className="relative flex items-center gap-3">
                <div className="flex-1 border-t border-border" />
                <span className="text-xs text-muted-foreground whitespace-nowrap">ya</span>
                <div className="flex-1 border-t border-border" />
              </div>
            )}
            {hasBiometric && (
              <button
                type="button"
                onClick={handleBiometricLogin}
                disabled={bioLoading}
                className="w-full h-14 flex items-center justify-center gap-3 border-2 border-primary/30 rounded-2xl bg-primary/5 hover:bg-primary/10 transition-colors text-primary font-semibold text-base"
              >
                <Fingerprint className="h-6 w-6" />
                {bioLoading ? "Fingerprint check ho raha hai..." : "Fingerprint se Login Karo"}
              </button>
            )}

            <div className="border-t border-border pt-4 space-y-3 text-center">
              <button
                type="button"
                onClick={() => { setForgotMobile(mobile); setStep("forgot"); }}
                disabled={forgotMutation.isPending}
                className="block w-full text-primary font-semibold text-sm underline"
              >
                Password bhool gaye?
              </button>
              <button
                type="button"
                onClick={() => { setRegMobile(""); setStep("new_register"); }}
                className="flex items-center justify-center gap-2 w-full text-muted-foreground text-sm"
              >
                <UserPlus className="h-4 w-4" />
                Naya account banao
              </button>
            </div>
          </>
        )}

        {/* ── STEP: NEW REGISTER ── */}
        {step === "new_register" && (
          <>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setStep("mobile")} className="inline-flex items-center text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h2 className="text-2xl font-bold">Naya Account Banao</h2>
                <p className="text-muted-foreground text-sm">Apna mobile number daalo</p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm text-blue-800">
                OTP se verify hoga, phir naam aur password set karoge. Agar number pehle se registered hai to login karo.
              </p>
            </div>

            <form onSubmit={handleNewRegisterSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="reg-mobile" className="text-base font-semibold">Mobile Number</Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">+91</span>
                  <Input
                    id="reg-mobile"
                    type="tel"
                    placeholder="9876543210"
                    className="pl-14 h-14 text-xl font-semibold tracking-wide"
                    value={regMobile}
                    onChange={(e) => setRegMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    autoFocus
                  />
                </div>
              </div>
              <Button type="submit" className="w-full h-14 text-lg font-bold" disabled={loginMutation.isPending || regMobile.length < 10}>
                {loginMutation.isPending ? "OTP bhej raha hu..." : "OTP Bhejo →"}
              </Button>
            </form>

            <div className="border-t border-border pt-3 text-center">
              <button type="button" onClick={() => setStep("mobile")} className="text-muted-foreground text-sm">
                Pehle se account hai? Login karo
              </button>
            </div>
          </>
        )}

        {/* ── STEP: FORGOT PASSWORD ── */}
        {step === "forgot" && (
          <>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setStep(storedUser ? "password" : "mobile")} className="inline-flex items-center text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h2 className="text-2xl font-bold">Password Reset</h2>
                <p className="text-muted-foreground text-sm">OTP se verify karke naya password set karo</p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
              <KeyRound className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                Apna registered mobile number daalo. OTP aayega, phir naya password set kar sakte ho.
              </p>
            </div>

            <form onSubmit={handleForgotSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="forgot-mobile" className="text-base font-semibold">Registered Mobile Number</Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">+91</span>
                  <Input
                    id="forgot-mobile"
                    type="tel"
                    placeholder="9876543210"
                    className="pl-14 h-14 text-xl font-semibold tracking-wide"
                    value={forgotMobile}
                    onChange={(e) => setForgotMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    autoFocus
                  />
                </div>
              </div>
              <Button type="submit" className="w-full h-14 text-lg font-bold" disabled={forgotMutation.isPending || forgotMobile.length < 10}>
                {forgotMutation.isPending ? "OTP bhej raha hu..." : "OTP Bhejo →"}
              </Button>
            </form>

            <div className="border-t border-border pt-3 text-center">
              <button type="button" onClick={() => { setRegMobile(""); setStep("new_register"); }} className="text-muted-foreground text-sm">
                Naya account banao
              </button>
            </div>
          </>
        )}

        {/* ── STEP: WHATSAPP WAITING ── */}
        {step === "wa_waiting" && (
          <>
            <div className="text-center space-y-3">
              <div className="h-20 w-20 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <span className="text-5xl">💬</span>
              </div>
              <h2 className="text-2xl font-bold">Admin Se Approval Lo</h2>
              <p className="text-muted-foreground text-sm">
                {waMode === "signup" ? "Registration" : "Password Reset"} ke liye admin ka approval chahiye
              </p>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 space-y-2 text-sm">
              <p className="font-bold text-green-800">📋 Yeh karo:</p>
              <ol className="text-green-700 space-y-1.5 list-decimal list-inside">
                <li>Neeche "WhatsApp Bhejo" button dabao</li>
                <li>WhatsApp khulega — message <strong>Send</strong> karo</li>
                <li>Wapas aao — Admin approve karega</li>
                <li>Approval hone par automatically aage jayega ✅</li>
              </ol>
            </div>

            <a
              href={`https://wa.me/${waAdminNumber}?text=${waMsg}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 w-full h-14 rounded-2xl bg-[#25D366] text-white font-bold text-lg shadow-lg active:scale-95 transition-transform"
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.99 2C6.476 2 2 6.477 2 12c0 1.772.462 3.434 1.268 4.887L2.028 22l5.256-1.226A9.963 9.963 0 0011.99 22C17.513 22 22 17.523 22 12S17.513 2 11.99 2zm.01 18c-1.586 0-3.07-.434-4.35-1.18l-.309-.184-3.119.727.755-3.036-.201-.321A7.965 7.965 0 014 12c0-4.418 3.582-8 8-8s8 3.582 8 8-3.582 8-8 8z"/></svg>
              WhatsApp Bhejo
            </a>

            <div className="bg-muted rounded-2xl p-4 text-center space-y-2">
              {waPolling ? (
                <>
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
                    Admin ke approval ka intezaar kar raha hoon...
                  </div>
                  <p className="text-xs text-muted-foreground">+91 {waMobile}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Loading...</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => { setStep("mobile"); setWaMobile(""); }}
              className="w-full text-sm text-muted-foreground underline text-center"
            >
              Wapas jao
            </button>
          </>
        )}

        {/* ── STEP: ADMIN LOGIN ── */}
        {step === "admin" && (
          <>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setStep("mobile")} className="inline-flex items-center text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h2 className="text-2xl font-bold">Admin Login</h2>
                <p className="text-muted-foreground text-sm">Super Admin panel access</p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
              <ShieldCheck className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                Sirf authorized admins ke liye. Username mein <strong>admin</strong> daalo ya apna mobile number.
              </p>
            </div>

            <form onSubmit={handleAdminLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="admin-username" className="text-base font-semibold">Username</Label>
                <Input
                  id="admin-username"
                  type="text"
                  placeholder="admin"
                  className="h-14 text-xl font-semibold"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-password" className="text-base font-semibold">Password</Label>
                <div className="relative">
                  <Input
                    id="admin-password"
                    type={showAdminPw ? "text" : "password"}
                    placeholder="Admin password daalo"
                    className="h-14 text-xl font-semibold pr-14"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                  />
                  <button type="button" onClick={() => setShowAdminPw(!showAdminPw)} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground">
                    {showAdminPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full h-14 text-lg font-bold bg-amber-600 hover:bg-amber-700"
                disabled={adminLoading || adminPassword.length < 6}
              >
                {adminLoading ? "Verify ho raha hai..." : "Admin Login Karo"}
              </Button>
            </form>

            <div className="border-t border-border pt-3 text-center">
              <button type="button" onClick={() => setStep("mobile")} className="text-muted-foreground text-sm">
                Normal login par wapas jao
              </button>
            </div>
          </>
        )}
      </div>

      {/* Copyright */}
      <p className="text-center text-xs text-muted-foreground/70 pb-6 select-none tracking-wide font-medium">
        © {new Date().getFullYear()} FabricPro · All Rights Reserved
      </p>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useGetMe, useSubmitKyc } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, EyeOff, KeyRound, Upload, CheckCircle2, PartyPopper } from "lucide-react";

type RegInfo = { required: boolean; fee: string; upiId: string; upiName: string };

export default function Kyc() {
  const { data: user, isLoading } = useGetMe();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(true);
  const [paymentScreenshot, setPaymentScreenshot] = useState<string | null>(null);
  const [regInfo, setRegInfo] = useState<RegInfo | null>(null);
  const [regInfoLoading, setRegInfoLoading] = useState(true);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const submitKycMutation = useSubmitKyc();

  useEffect(() => {
    const token = localStorage.getItem("fabricpro_token");
    fetch("/api/auth/registration-info", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((d) => { setRegInfo(d); setRegInfoLoading(false); })
      .catch(() => { setRegInfoLoading(false); });
  }, []);

  const handleScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      toast({ title: "Screenshot 3MB se chhota hona chahiye", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPaymentScreenshot(reader.result as string);
    reader.readAsDataURL(file);
  };

  // Determine mode: password reset (KYC done already) vs new signup
  const isResetMode = sessionStorage.getItem("kyc_mode") === "reset";

  // Show "Approved!" banner if user just came from WhatsApp approval
  const [showApprovedBanner, setShowApprovedBanner] = useState(() => {
    const flag = sessionStorage.getItem("wa_just_approved");
    if (flag) { sessionStorage.removeItem("wa_just_approved"); return true; }
    return false;
  });

  useEffect(() => {
    if (user && !isResetMode) {
      if (user.name) setName(user.name);
      if ((user as any).address) setAddress((user as any).address);
    }
  }, [user, isResetMode]);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex flex-col p-6 bg-background">
        <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto space-y-4">
          <Skeleton className="h-10 w-3/4 mx-auto" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>
    );
  }

  if (!user) {
    setLocation("/login");
    return null;
  }

  const validatePassword = (pw: string) => /^[a-zA-Z0-9]{6,}$/.test(pw);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Reset mode = only password change
    if (isResetMode) {
      if (!validatePassword(password)) {
        toast({ title: "Password 6+ character (sirf letters aur numbers)", variant: "destructive" });
        return;
      }
      if (password !== confirmPassword) {
        toast({ title: "Dono passwords match nahi ho rahe", variant: "destructive" });
        return;
      }
    } else {
      // Signup mode — name + password required
      if (name.trim().length < 2) {
        toast({ title: "Naam zaroori hai", variant: "destructive" });
        return;
      }
      if (!validatePassword(password)) {
        toast({ title: "Password 6+ character (sirf letters aur numbers)", variant: "destructive" });
        return;
      }
      if (password !== confirmPassword) {
        toast({ title: "Dono passwords match nahi ho rahe", variant: "destructive" });
        return;
      }
      // If registration is required, screenshot is mandatory
      if (regInfo?.required && !paymentScreenshot) {
        toast({ title: "Payment screenshot zaroori hai — pehle UPI se fee jama karo phir screenshot lagao", variant: "destructive" });
        return;
      }
    }

    submitKycMutation.mutate(
      {
        data: {
          name: isResetMode ? (user.name ?? "") : name,
          mobile: user.mobile,
          address: isResetMode ? undefined : (address || undefined),
          aadhaar: isResetMode ? undefined : (aadhaar.trim() || undefined),
          password,
          ...(paymentScreenshot ? { paymentScreenshot } : {}),
        } as any,
      },
      {
        onSuccess: () => {
          // Save remembered password if checkbox is on
          if (rememberPassword) {
            localStorage.setItem(`fabricpro_pw_${user.mobile}`, password);
          } else {
            localStorage.removeItem(`fabricpro_pw_${user.mobile}`);
          }
          // Update cache — including activationStatus so AuthGuard shows correct screen
          const willBePending = !isResetMode && regInfo?.required && !!paymentScreenshot;
          const updatedUser = (old: any) =>
            old
              ? {
                  ...old,
                  kycCompleted: true,
                  name: isResetMode ? old.name : name,
                  activationStatus: willBePending ? "pending_payment" : old.activationStatus,
                }
              : old;
          // Update both query keys (generated client uses "/api/auth/me", AuthGuard uses "me")
          queryClient.setQueryData(getGetMeQueryKey(), updatedUser);
          queryClient.setQueryData(["me"], updatedUser);
          sessionStorage.removeItem("kyc_mode");
          sessionStorage.removeItem("kyc_in_progress");
          toast({ title: isResetMode ? "Password reset ho gaya!" : "Account ban gaya! Welcome 🎉" });
          setLocation("/");
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error || err?.message || "Save nahi hua, dobara try karo";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="min-h-[100dvh] flex flex-col p-6 bg-background">
      <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto space-y-6 py-8">
        {/* WhatsApp Approved Banner */}
        {showApprovedBanner && (
          <div className="relative flex items-center gap-3 bg-green-50 border border-green-300 rounded-2xl px-4 py-3 shadow-sm">
            <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center shrink-0">
              <PartyPopper className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-green-800 text-sm">Admin ne Approve kar diya! ✅</p>
              <p className="text-green-700 text-xs mt-0.5">Ab apna account setup karo — naam aur password daalo</p>
            </div>
            <button
              type="button"
              onClick={() => setShowApprovedBanner(false)}
              className="text-green-400 hover:text-green-600 shrink-0 text-lg leading-none"
            >✕</button>
          </div>
        )}

        <div className="space-y-2 text-center">
          <div className="h-16 w-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-2">
            <KeyRound className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            {isResetMode ? "Naya Password Banao" : "Account Setup Karo"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {isResetMode
              ? "Naya password set karo aur login karo"
              : "Apni details aur password set karo. Aage se sirf mobile + password se login hoga."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Mobile (read-only) */}
          <div className="space-y-2">
            <Label htmlFor="mobile" className="text-base font-semibold">Mobile Number</Label>
            <Input
              id="mobile"
              type="text"
              value={`+91 ${user.mobile}`}
              className="h-14 text-base bg-muted"
              disabled
            />
          </div>

          {!isResetMode && (
            <>
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name" className="text-base font-semibold">Pura Naam *</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Jaise: Ramesh Bhai"
                  className="h-14 text-base"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Address */}
              <div className="space-y-2">
                <Label htmlFor="address" className="text-base font-semibold">Address</Label>
                <Textarea
                  id="address"
                  placeholder="Shop ya ghar ka pata"
                  className="text-base rounded-xl"
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>

              {/* Aadhaar (Optional) */}
              <div className="space-y-2">
                <Label htmlFor="aadhaar" className="text-base font-semibold">
                  Aadhaar Number <span className="text-muted-foreground font-normal text-sm">(optional)</span>
                </Label>
                <Input
                  id="aadhaar"
                  type="text"
                  inputMode="numeric"
                  placeholder="12 digit Aadhaar number"
                  className="h-14 text-base tracking-widest"
                  maxLength={12}
                  value={aadhaar}
                  onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, "").slice(0, 12))}
                />
                {aadhaar && aadhaar.length !== 12 && (
                  <p className="text-xs text-amber-600">Aadhaar 12 digit ka hona chahiye</p>
                )}
              </div>
            </>
          )}

          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="password" className="text-base font-semibold">
              {isResetMode ? "Naya Password *" : "Password Banao *"}
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="6+ character (letters/numbers)"
                className="h-14 text-base pr-14"
                value={password}
                onChange={(e) => setPassword(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
                autoFocus={isResetMode}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Kam se kam 6 character — sirf English letters (a-z, A-Z) aur numbers (0-9)
            </p>
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="text-base font-semibold">Password Phir Se Daalo *</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                placeholder="Same password"
                className="h-14 text-base pr-14"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            {confirmPassword && password !== confirmPassword && (
              <p className="text-xs text-red-600 font-semibold">Passwords match nahi ho rahe</p>
            )}
          </div>

          {/* Registration Fee Section - Loading State */}
          {!isResetMode && regInfoLoading && (
            <div className="bg-muted rounded-2xl p-4 flex items-center gap-3 animate-pulse">
              <div className="h-8 w-8 bg-muted-foreground/20 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-muted-foreground/20 rounded w-3/4" />
                <div className="h-3 bg-muted-foreground/20 rounded w-1/2" />
              </div>
            </div>
          )}

          {/* Registration Fee Section */}
          {!isResetMode && regInfo?.required && (
            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 space-y-3">
              <p className="font-bold text-orange-800 flex items-center gap-2">
                💳 Registration Fee Bhari Jaayegi
              </p>
              <p className="text-sm text-orange-700">
                FabricPro mein account activate karne ke liye ek baar <strong>₹{regInfo.fee}</strong> registration fee jama karni hogi.
              </p>
              {regInfo.upiId && (
                <div className="bg-white border border-orange-200 rounded-xl p-3 space-y-1 font-mono text-sm">
                  <p className="text-xs text-muted-foreground font-sans">UPI ID pe bhejo:</p>
                  <p className="font-bold text-orange-800 select-all text-base">{regInfo.upiId}</p>
                  {regInfo.upiName && <p className="text-xs text-muted-foreground font-sans">Naam: {regInfo.upiName}</p>}
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-orange-800">Payment ka screenshot lagao *</Label>
                <p className="text-xs text-muted-foreground">Payment karne ke baad screenshot yahan upload karo</p>
                {paymentScreenshot ? (
                  <div className="relative">
                    <img src={paymentScreenshot} alt="Payment proof" className="w-full max-h-48 object-contain rounded-xl border border-orange-200" />
                    <div className="flex items-center gap-1.5 mt-2 text-green-700 text-sm font-semibold">
                      <CheckCircle2 className="h-4 w-4" /> Screenshot uploaded!
                    </div>
                    <button type="button" onClick={() => setPaymentScreenshot(null)} className="text-xs text-red-500 mt-1">Hata do</button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center gap-2 border-2 border-dashed border-orange-300 rounded-xl p-6 cursor-pointer hover:bg-orange-100/50 transition-colors">
                    <Upload className="h-8 w-8 text-orange-400" />
                    <span className="text-sm font-medium text-orange-700">Screenshot choose karo</span>
                    <span className="text-xs text-muted-foreground">JPG/PNG, 3MB tak</span>
                    <input type="file" accept="image/*" className="sr-only" onChange={handleScreenshotUpload} />
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Remember Password Checkbox */}
          <label className="flex items-start gap-3 bg-muted p-4 rounded-2xl cursor-pointer">
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(e) => setRememberPassword(e.target.checked)}
              className="h-5 w-5 mt-0.5 accent-primary"
            />
            <div className="flex-1">
              <p className="font-semibold text-sm">Iss device par password yaad rakho</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Aage se login karte waqt password apne aap aa jayega
              </p>
            </div>
          </label>

          <Button
            type="submit"
            className="w-full h-14 text-lg font-bold"
            disabled={submitKycMutation.isPending}
          >
            {submitKycMutation.isPending ? "Save ho raha hai..." : isResetMode ? "Password Reset Karo" : "Account Banao"}
          </Button>
        </form>
      </div>
    </div>
  );
}

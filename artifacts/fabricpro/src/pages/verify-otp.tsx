import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useVerifyOtp } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

export default function VerifyOtp() {
  const [otp, setOtp] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const verifyMutation = useVerifyOtp();
  const mobile = sessionStorage.getItem("verify_mobile") || "";
  const mode = sessionStorage.getItem("verify_mode") || "signup";
  const systemOtp = sessionStorage.getItem("system_otp") || "";

  useEffect(() => {
    if (!mobile) {
      setLocation("/login");
      return;
    }
    // Auto-fill system OTP only for signup — NEVER for password reset (security)
    if (systemOtp && mode !== "reset") {
      setOtp(systemOtp);
    }
  }, [mobile, mode, setLocation, systemOtp]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length < 4) return;

    verifyMutation.mutate(
      { data: { mobile, otp } },
      {
        onSuccess: (data: any) => {
          if (data.token) {
            localStorage.setItem("fabricpro_token", data.token);
          }
          sessionStorage.removeItem("system_otp");
          // For password reset mode, force user to KYC page to set new password
          if (mode === "reset") {
            sessionStorage.setItem("kyc_mode", "reset");
            setLocation("/kyc");
          } else if (data.needsKyc || data.needsPassword) {
            sessionStorage.removeItem("kyc_mode");
            sessionStorage.setItem("kyc_in_progress", "1");
            setLocation("/kyc");
          } else {
            setLocation("/");
          }
          sessionStorage.removeItem("verify_mode");
        },
        onError: () => {
          toast({ title: "OTP galat hai ya expired — dobara try karo", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="min-h-[100dvh] flex flex-col p-6 bg-background">
      <Link href="/login" className="inline-flex items-center text-muted-foreground hover:text-foreground py-2 mb-8">
        <ArrowLeft className="mr-2 h-5 w-5" /> Wapas
      </Link>

      <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            {mode === "reset" ? "Password Reset" : "OTP Verify Karo"}
          </h1>
          {systemOtp ? (
            <p className="text-muted-foreground">OTP neeche box mein auto-fill ho gaya ✓</p>
          ) : (
            <p className="text-muted-foreground">+91 {mobile} par SMS se OTP bheja gaya</p>
          )}
          {systemOtp && (
            <p className="text-sm text-green-700 font-semibold bg-green-50 px-3 py-2 rounded-lg border border-green-200 flex items-center gap-2">
              ✅ OTP ready hai — bas "Verify Karo" dabao
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-3">
            <Label htmlFor="otp" className="text-lg">OTP Daalo</Label>
            <Input
              id="otp"
              type="text"
              inputMode="numeric"
              placeholder="123456"
              className="h-14 text-2xl tracking-widest text-center"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
            />
          </div>

          <Button
            type="submit"
            className="w-full h-14 text-lg font-semibold"
            disabled={verifyMutation.isPending || otp.length < 4}
          >
            {verifyMutation.isPending ? "Verify ho raha hai..." : "Verify Karo"}
          </Button>
        </form>
      </div>
    </div>
  );
}

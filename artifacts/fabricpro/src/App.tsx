import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";

// When deployed on Vercel, VITE_API_BASE_URL points to the Express API server
if (import.meta.env.VITE_API_BASE_URL) {
  setBaseUrl(import.meta.env.VITE_API_BASE_URL);
}
// Warmup ping — wakes up the serverless API on first load
fetch("/api/healthz").catch(() => {});
import { useHeartbeatPing } from "@/hooks/use-heartbeat";
import { PWAInstallBanner } from "@/components/pwa-install-banner";
import { SavingIndicator } from "@/components/saving-indicator";
import { AnimatePresence, motion } from "framer-motion";
import React, { useEffect, useState } from "react";

import Login from "@/pages/login";
import VerifyOtp from "@/pages/verify-otp";
import Kyc from "@/pages/kyc";
import Dashboard from "@/pages/dashboard";
import Connections from "@/pages/connections";
import AddConnection from "@/pages/add-connection";
import Slips from "@/pages/slips";
import NewSlip from "@/pages/new-slip";
import SlipDetail from "@/pages/slip-detail";
import NewReturnSlip from "@/pages/new-return-slip";
import ReturnSlipDetail from "@/pages/return-slip-detail";
import Payments from "@/pages/payments";
import NewPayment from "@/pages/new-payment";
import EditPayment from "@/pages/edit-payment";
import Notifications from "@/pages/notifications";
import Profile from "@/pages/profile";
import Admin from "@/pages/admin";
import Chat from "@/pages/chat";
import ChatThread from "@/pages/chat-thread";
import Gallery from "@/pages/gallery";
import Statement from "@/pages/statement";
import NotFound from "@/pages/not-found";
import { getLastPath } from "@/hooks/use-swipe-nav";

// Configure auth token getter for all API calls
setAuthTokenGetter(() => localStorage.getItem("fabricpro_token"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,      // 5 min — cached data "fresh" for 5 min
      gcTime: 24 * 60 * 60 * 1000,   // 24 hr — keep in localStorage for 1 day
    },
  },
});

const localPersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "fabricpro_cache",
  throttleTime: 1000,
});

function HeartbeatPinger() {
  useHeartbeatPing();
  return null;
}

type LocationPermState = "checking" | "granted" | "denied" | "prompt";

function useLocationEnforcement(userRole: string | undefined) {
  const [permState, setPermState] = useState<LocationPermState>("checking");

  useEffect(() => {
    if (!userRole) return;
    // Admins bypass location check
    if (userRole === "super_admin") {
      setPermState("granted");
      return;
    }
    if (!navigator.geolocation) {
      setPermState("granted");
      return;
    }
    // Use Permissions API if available
    if (navigator.permissions) {
      navigator.permissions
        .query({ name: "geolocation" as PermissionName })
        .then((status) => {
          setPermState(status.state as LocationPermState);
          status.onchange = () => setPermState(status.state as LocationPermState);
        })
        .catch(() => {
          // Permissions API not available — try requesting directly
          navigator.geolocation.getCurrentPosition(
            () => setPermState("granted"),
            (err) => setPermState(err.code === 1 ? "denied" : "granted"),
            { timeout: 8000, maximumAge: 60000 }
          );
        });
    } else {
      navigator.geolocation.getCurrentPosition(
        () => setPermState("granted"),
        (err) => setPermState(err.code === 1 ? "denied" : "granted"),
        { timeout: 8000, maximumAge: 60000 }
      );
    }
  }, [userRole]);

  // If state is "prompt", trigger the browser dialog
  useEffect(() => {
    if (permState !== "prompt") return;
    navigator.geolocation.getCurrentPosition(
      () => setPermState("granted"),
      (err) => setPermState(err.code === 1 ? "denied" : "granted"),
      { timeout: 15000, maximumAge: 60000 }
    );
  }, [permState]);

  return permState;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const token = localStorage.getItem("fabricpro_token");

  const { data: user, isLoading, error } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      if (!token) throw new Error("UNAUTHORIZED");
      let res: Response;
      const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
      try {
        res = await fetch(`${apiBase}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        throw new Error("NETWORK_ERROR");
      }
      if (res.status === 401 || res.status === 403) throw new Error("UNAUTHORIZED");
      if (!res.ok) throw new Error("NETWORK_ERROR");
      return res.json();
    },
    enabled: !!token,
    retry: (failureCount, err: any) => {
      if (err?.message === "UNAUTHORIZED") return false;
      return failureCount < 3;
    },
    retryDelay: 3000,
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  // Hook must be called unconditionally at top level
  const locationPerm = useLocationEnforcement(user?.role);

  if (!token) {
    return <Redirect to="/login" />;
  }

  // Auth token invalid — logout karo
  if (error?.message === "UNAUTHORIZED") {
    localStorage.removeItem("fabricpro_token");
    return <Redirect to="/login" />;
  }

  // Network error aur koi cached data nahi — loading/offline screen
  if (error?.message === "NETWORK_ERROR" && !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center space-y-4">
        <div className="h-16 w-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto">
          <span className="text-3xl">📡</span>
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-bold">Internet nahi hai</h1>
          <p className="text-muted-foreground text-sm">Connection aane par automatically wapas aa jaayega</p>
        </div>
        <div className="h-6 w-6 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (isLoading && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto" />
          <p className="text-muted-foreground font-medium">Load ho raha hai...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    localStorage.removeItem("fabricpro_token");
    return <Redirect to="/login" />;
  }

  if (!user.kycCompleted) {
    const inKycFlow = sessionStorage.getItem("kyc_in_progress") === "1";
    if (!inKycFlow) {
      localStorage.removeItem("fabricpro_token");
      return <Redirect to="/login" />;
    }
    if (location !== "/kyc") {
      return <Redirect to="/kyc" />;
    }
  }

  // Pending payment — show a waiting screen
  if (user.activationStatus === "pending_payment") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center space-y-6">
        <div className="h-20 w-20 rounded-full bg-orange-100 flex items-center justify-center mx-auto">
          <span className="text-4xl">💳</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Payment Verify Ho Rahi Hai</h1>
          <p className="text-muted-foreground text-sm max-w-xs">
            Aapka registration screenshot admin ke paas pahunch gaya hai. Jaldi hi aapka account activate ho jayega.
          </p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 max-w-xs w-full space-y-2 text-left">
          <p className="text-sm font-bold text-orange-800">Ab kya hoga?</p>
          <ul className="text-xs text-orange-700 space-y-1.5 list-none">
            <li>✅ Aapka screenshot admin ne receive kar liya</li>
            <li>⏳ Admin payment verify karega (24 hrs mein)</li>
            <li>🎉 Activate hone ke baad aapko notification milegi</li>
          </ul>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="w-full max-w-xs h-12 rounded-xl bg-orange-100 text-orange-800 font-semibold text-sm border border-orange-200"
        >
          🔄 Status Check Karo (Refresh)
        </button>
        <button
          onClick={() => {
            localStorage.removeItem("fabricpro_token");
            window.location.href = "/login";
          }}
          className="text-sm text-muted-foreground underline"
        >
          Logout karo
        </button>
      </div>
    );
  }

  // Location checking — show spinner while browser asks for permission
  if (locationPerm === "checking" || locationPerm === "prompt") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center space-y-6">
        <div className="h-20 w-20 rounded-full bg-blue-100 flex items-center justify-center mx-auto animate-pulse">
          <span className="text-4xl">📍</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold">Location Permission Chahiye</h1>
          <p className="text-muted-foreground text-sm max-w-xs">
            Browser ka location permission dialog aaya hoga — <strong>"Allow"</strong> karo taaki aap app use kar sako.
          </p>
        </div>
        <div className="h-8 w-8 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
        <p className="text-xs text-muted-foreground">Permission ka wait kar rahe hain...</p>
      </div>
    );
  }

  // Location denied — hard block
  if (locationPerm === "denied") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center space-y-6">
        <div className="h-20 w-20 rounded-full bg-red-100 flex items-center justify-center mx-auto">
          <span className="text-4xl">🚫</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-red-700">Location Blocked Hai</h1>
          <p className="text-muted-foreground text-sm max-w-xs">
            FabricPro use karne ke liye location permission zaroori hai. Aapne abhi block kar di hai.
          </p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 max-w-xs w-full space-y-2 text-left">
          <p className="text-sm font-bold text-red-800">Location allow kaise karein?</p>
          <ul className="text-xs text-red-700 space-y-2 list-none">
            <li>1️⃣ Browser ke address bar mein 🔒 icon tap karein</li>
            <li>2️⃣ <strong>Site Settings</strong> ya <strong>Permissions</strong> kholein</li>
            <li>3️⃣ <strong>Location</strong> ko <strong>Allow</strong> karein</li>
            <li>4️⃣ Page refresh karein</li>
          </ul>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="bg-primary text-primary-foreground font-semibold px-6 py-2.5 rounded-xl text-sm"
        >
          Refresh Karo (Allow karne ke baad)
        </button>
        <button
          onClick={() => {
            localStorage.removeItem("fabricpro_token");
            window.location.href = "/login";
          }}
          className="text-xs text-muted-foreground underline"
        >
          Logout karo
        </button>
      </div>
    );
  }

  // Restore last screen on first session load (not on every '/' navigation)
  if (
    location === "/" &&
    user?.kycCompleted &&
    user?.activationStatus !== "pending_payment" &&
    locationPerm === "granted"
  ) {
    const alreadyRestored = sessionStorage.getItem("fp_restored") === "1";
    if (!alreadyRestored) {
      sessionStorage.setItem("fp_restored", "1");
      const last = getLastPath();
      if (last && last !== "/") return <Redirect to={last} />;
    }
  }

  return <>{children}</>;
}

// Page transition variants — Android shutter feel
const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6, scale: 0.98 },
};

const pageTransition = {
  duration: 0.22,
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
};

function AnimatedRouter() {
  const [location] = useLocation();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={pageTransition}
        style={{ willChange: "opacity, transform" }}
      >
        <Switch>
          <Route path="/login" component={Login} />
          <Route path="/verify-otp" component={VerifyOtp} />
          <Route path="/kyc">
            <AuthGuard><Kyc /></AuthGuard>
          </Route>
          <Route path="/">
            <AuthGuard><Dashboard /></AuthGuard>
          </Route>
          <Route path="/connections">
            <AuthGuard><Connections /></AuthGuard>
          </Route>
          <Route path="/add-connection">
            <AuthGuard><AddConnection /></AuthGuard>
          </Route>
          <Route path="/slips/new">
            <AuthGuard><NewSlip /></AuthGuard>
          </Route>
          <Route path="/slips/return/new">
            <AuthGuard><NewReturnSlip /></AuthGuard>
          </Route>
          <Route path="/slips/return/:id">
            <AuthGuard><ReturnSlipDetail /></AuthGuard>
          </Route>
          <Route path="/slips/job/:id">
            <AuthGuard><SlipDetail /></AuthGuard>
          </Route>
          <Route path="/slips">
            <AuthGuard><Slips /></AuthGuard>
          </Route>
          <Route path="/payments/new">
            <AuthGuard><NewPayment /></AuthGuard>
          </Route>
          <Route path="/payments/edit/:id">
            <AuthGuard><EditPayment /></AuthGuard>
          </Route>
          <Route path="/payments">
            <AuthGuard><Payments /></AuthGuard>
          </Route>
          <Route path="/notifications">
            <AuthGuard><Notifications /></AuthGuard>
          </Route>
          <Route path="/profile">
            <AuthGuard><Profile /></AuthGuard>
          </Route>
          <Route path="/admin">
            <AuthGuard><Admin /></AuthGuard>
          </Route>
          <Route path="/chat/:userId">
            <AuthGuard><ChatThread /></AuthGuard>
          </Route>
          <Route path="/chat">
            <AuthGuard><Chat /></AuthGuard>
          </Route>
          <Route path="/gallery">
            <AuthGuard><Gallery /></AuthGuard>
          </Route>
          <Route path="/statement">
            <AuthGuard><Statement /></AuthGuard>
          </Route>
          <Route component={NotFound} />
        </Switch>
      </motion.div>
    </AnimatePresence>
  );
}

function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: localPersister, maxAge: 24 * 60 * 60 * 1000 }}
    >
      <TooltipProvider>
        <HeartbeatPinger />
        <SavingIndicator />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AnimatedRouter />
        </WouterRouter>
        <Toaster />
        <PWAInstallBanner />
      </TooltipProvider>
    </PersistQueryClientProvider>
  );
}

export default App;

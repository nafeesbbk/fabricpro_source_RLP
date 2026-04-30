import { useState, useEffect } from "react";

export type NetworkStatus = "online" | "offline" | "syncing";

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(
    navigator.onLine ? "online" : "offline"
  );
  const [prevOnline, setPrevOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      if (!prevOnline) {
        setStatus("syncing");
      } else {
        setStatus("online");
      }
      setPrevOnline(true);
    };

    const handleOffline = () => {
      setStatus("offline");
      setPrevOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [prevOnline]);

  useEffect(() => {
    if (status === "syncing") {
      const t = setTimeout(() => setStatus("online"), 3500);
      return () => clearTimeout(t);
    }
  }, [status]);

  return status;
}

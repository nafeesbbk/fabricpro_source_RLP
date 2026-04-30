import { useEffect, useRef } from "react";

async function getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 30000, enableHighAccuracy: false }
    );
  });
}

async function sendHeartbeat() {
  const token = localStorage.getItem("fabricpro_token");
  if (!token) return;

  const loc = await getCurrentLocation();
  const body: Record<string, any> = {};
  if (loc) {
    body.lat = loc.lat;
    body.lng = loc.lng;
  }

  await fetch("/api/users/me/heartbeat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export function useHeartbeatPing() {
  const sentRef = useRef(false);

  useEffect(() => {
    if (!sentRef.current) {
      sentRef.current = true;
      sendHeartbeat();
    }

    const interval = setInterval(() => {
      if (navigator.onLine) {
        sendHeartbeat();
      }
    }, 30_000);

    return () => clearInterval(interval);
  }, []);
}

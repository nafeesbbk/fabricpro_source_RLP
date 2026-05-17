import { useEffect, useRef, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiUrl } from "@/lib/api-url";
import { Button } from "@/components/ui/button";
import { RefreshCw, Navigation } from "lucide-react";
import { format } from "date-fns";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface LocationTrackingModalProps {
  open: boolean;
  onClose: () => void;
  userId: number;
  userName: string;
  initialLat: number;
  initialLng: number;
  initialUpdatedAt: string | null;
  isOnline: boolean;
}

export function LocationTrackingModal({
  open,
  onClose,
  userId,
  userName,
  initialLat,
  initialLng,
  initialUpdatedAt,
  isOnline,
}: LocationTrackingModalProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const fetchLatestLocation = useCallback(async () => {
    const token = localStorage.getItem("fabricpro_token");
    if (!token) return;
    setRefreshing(true);
    try {
      const res = await fetch(apiUrl("/api/users"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const users: any[] = await res.json();
      const user = users.find((u) => u.id === userId);
      if (user && user.latitude && user.longitude) {
        setLat(user.latitude);
        setLng(user.longitude);
        setUpdatedAt(user.locationUpdatedAt);
        setLastRefreshed(new Date());
      }
    } finally {
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    setLat(initialLat);
    setLng(initialLng);
    setUpdatedAt(initialUpdatedAt);
  }, [open, initialLat, initialLng, initialUpdatedAt]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(fetchLatestLocation, 30_000);
    return () => clearInterval(timer);
  }, [open, fetchLatestLocation]);

  useEffect(() => {
    if (!open || !mapContainerRef.current) return;

    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [lat, lng],
        zoom: 15,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const marker = L.marker([lat, lng]).addTo(map);
      marker.bindPopup(
        `<b>${userName}</b><br/>${isOnline ? "🟢 Online" : "⏱ Last seen"}`
      ).openPopup();

      mapRef.current = map;
      markerRef.current = marker;
    } else {
      mapRef.current.setView([lat, lng]);
      markerRef.current?.setLatLng([lat, lng]);
    }
  }, [open, lat, lng, userName, isOnline]);

  useEffect(() => {
    if (!open && mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      markerRef.current = null;
    }
  }, [open]);

  const centerMap = () => {
    mapRef.current?.setView([lat, lng], 15);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center justify-between">
            <span>📍 {userName} ki Location</span>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isOnline ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                {isOnline ? "🟢 Live" : "Offline"}
              </span>
            </div>
          </DialogTitle>
          {updatedAt && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last update: {format(new Date(updatedAt), "hh:mm:ss a, dd MMM yyyy")}
            </p>
          )}
        </DialogHeader>

        <div className="relative" style={{ height: 380 }}>
          <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />

          <div className="absolute bottom-3 right-3 z-[1000] flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="shadow-md h-8"
              onClick={centerMap}
            >
              <Navigation className="h-3.5 w-3.5 mr-1" />
              Center
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="shadow-md h-8"
              onClick={fetchLatestLocation}
              disabled={refreshing}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          <div className="absolute bottom-3 left-3 z-[1000] bg-white/90 rounded-lg px-2.5 py-1.5 shadow-md text-xs text-gray-700">
            {isOnline
              ? "⏱ Auto-refresh: 30 sec"
              : `Last refreshed: ${format(lastRefreshed, "hh:mm a")}`}
          </div>
        </div>

        <div className="px-4 py-3 border-t bg-muted/30 flex items-center justify-between">
          <div className="text-xs text-muted-foreground font-mono">
            {lat.toFixed(6)}, {lng.toFixed(6)}
          </div>
          <a
            href={`https://maps.google.com/?q=${lat},${lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 font-semibold hover:underline"
          >
            Google Maps mein kholein ↗
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

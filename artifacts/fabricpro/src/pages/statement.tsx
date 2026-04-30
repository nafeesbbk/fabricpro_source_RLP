import React, { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useGetConnections, useGetMe, customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Package, RotateCcw, Banknote,
  TrendingDown, TrendingUp, Clock, CheckCircle2, AlertCircle,
  Calendar, FileText, ChevronDown, ChevronUp, Wrench, Minus, GripVertical, Pencil, Check,
} from "lucide-react";
import { generateStatementPdf } from "@/lib/print-utils";
import { PrintShareButton } from "@/components/print-share-button";
import { format, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from "date-fns";
import { cn } from "@/lib/utils";
import { useTabOrder } from "@/hooks/use-tab-order";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, horizontalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type DatePreset = "aaj" | "hafte" | "mahine" | "custom" | "sab";
type ActiveTab = "overview" | "slips" | "aya" | "payments";

function SortableTabPill({
  t, Icon, activeTab, setActiveTab, editMode,
}: {
  t: { id: string; label: string };
  Icon: React.ElementType;
  activeTab: string;
  setActiveTab: (id: any) => void;
  editMode: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: t.id });
  const isActive = activeTab === t.id;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all select-none",
        isActive ? "bg-slate-800 text-white shadow-md" : "bg-muted text-muted-foreground",
        isDragging && "opacity-60 shadow-xl scale-105",
        editMode && "ring-2 ring-primary/40"
      )}
      onClick={() => { if (!editMode) setActiveTab(t.id as ActiveTab); }}
    >
      {editMode && (
        <span {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing -ml-1">
          <GripVertical className="w-3 h-3" />
        </span>
      )}
      <Icon className="w-3.5 h-3.5" />
      {t.label}
    </div>
  );
}

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: "sab", label: "Sab" },
  { id: "aaj", label: "Aaj" },
  { id: "hafte", label: "Hafte" },
  { id: "mahine", label: "Mahine" },
  { id: "custom", label: "Custom" },
];

function getDateRange(preset: DatePreset, customFrom: string, customTo: string) {
  const today = new Date();
  if (preset === "aaj") { const d = format(today, "yyyy-MM-dd"); return { from: d, to: d }; }
  if (preset === "hafte") return { from: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"), to: format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd") };
  if (preset === "mahine") return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: format(endOfMonth(today), "yyyy-MM-dd") };
  if (preset === "custom") return { from: customFrom, to: customTo };
  return { from: undefined, to: undefined };
}

function StatCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className={cn("rounded-2xl p-4 flex flex-col gap-1", color)}>
      <div className="flex items-center gap-2 mb-0.5">
        <Icon className="w-4 h-4 opacity-80" />
        <p className="text-xs font-bold opacity-90">{label}</p>
      </div>
      <p className="text-2xl font-black leading-none">{value}</p>
      {sub && <p className="text-xs opacity-75 font-medium">{sub}</p>}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("font-bold text-sm", color ?? "text-foreground")}>{value}</span>
    </div>
  );
}

function JobSlipCard({ slip, isSeth }: { slip: any; isSeth: boolean }) {
  // jamaBill comes from backend (proportional of jama returned)
  // NEVER fall back to full issued bill — if no jama yet, slip is still pending
  const jamaBill: number = slip.jamaBill ?? 0;
  const paid: number = slip.paidAmount ?? 0;
  const bal = Math.max(0, jamaBill - paid);
  const balLabel = isSeth ? "Dena Hai" : "Lena Hai";
  const jamaYetToReturn = jamaBill === 0 && slip.totalQty > 0;
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex justify-between mb-2">
        <div>
          <p className="font-bold text-sm font-mono">{slip.slipNumber}</p>
          <p className="text-xs text-muted-foreground">{format(new Date(slip.date), "d MMM yyyy")}</p>
        </div>
        <p className="font-black text-lg">{slip.totalQty}pc</p>
      </div>
      {slip.items.length > 0 && (
        <div className="space-y-1 border-t border-border pt-2">
          {slip.items.map((item: any, i: number) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-foreground font-semibold">{item.itemName}</span>
              <span className="font-bold">{item.totalQty}pc{(item.finalRate || item.ratePerPc) ? <span className="text-muted-foreground font-normal ml-1">@ ₹{item.finalRate ?? item.ratePerPc}</span> : ""}</span>
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-border pt-2 mt-2 space-y-1">
        {jamaYetToReturn && (
          <p className="text-xs text-amber-600 font-semibold">⏳ Maal wapas nahi aaya — bill pending hai</p>
        )}
        {jamaBill > 0 && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Jama Bill</span><span className="font-semibold">₹{jamaBill.toLocaleString("en-IN")}</span></div>}
        {jamaBill > 0 && paid > 0 && <div className="flex justify-between text-xs text-emerald-600"><span>Paid</span><span className="font-semibold">₹{paid.toLocaleString("en-IN")}</span></div>}
        {jamaBill > 0 && bal > 0 && (
          <div className="flex justify-between text-xs text-violet-600 font-bold">
            <span>{balLabel}</span><span>₹{bal.toLocaleString("en-IN")}</span>
          </div>
        )}
        {jamaBill > 0 && bal === 0 && paid > 0 && (
          <p className="text-xs text-emerald-600 font-bold">✓ Fully Paid</p>
        )}
      </div>
    </div>
  );
}

function ReturnSlipCard({ rs }: { rs: any }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex justify-between">
        <div>
          <p className="font-bold text-sm font-mono">{rs.slipNumber}</p>
          <p className="text-xs text-muted-foreground">{format(new Date(rs.date), "d MMM yyyy")}</p>
        </div>
        <div className="text-right">
          <p className="font-black text-lg text-emerald-600">{rs.jamaQty}pc</p>
          <p className="text-xs text-muted-foreground">jama</p>
        </div>
      </div>
      {(rs.damageQty > 0 || rs.shortageQty > 0 || rs.noWorkQty > 0) && (
        <div className="flex gap-3 mt-2 border-t border-border pt-2 flex-wrap">
          {rs.damageQty > 0 && <span className="text-xs text-red-500 font-semibold">{rs.damageQty}pc damage</span>}
          {rs.shortageQty > 0 && <span className="text-xs text-orange-500 font-semibold">{rs.shortageQty}pc shortage</span>}
          {rs.noWorkQty > 0 && <span className="text-xs text-muted-foreground font-semibold">{rs.noWorkQty}pc no-work</span>}
        </div>
      )}
    </div>
  );
}

export default function Statement() {
  const [, navigate] = useLocation();
  const { data: me } = useGetMe();

  const [selectedConnId, setSelectedConnId] = useState<number | null>(null);
  const [selectedSide, setSelectedSide] = useState<"seth" | "karigar" | null>(null);
  const [preset, setPreset] = useState<DatePreset>("mahine");
  const [customFrom, setCustomFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [showCustom, setShowCustom] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<"seth" | "karigar" | null>(null);

  const { data: connections } = useGetConnections();
  const accepted = useMemo(() => ((connections ?? []) as any[]).filter((c) => c.status === "accepted"), [connections]);

  // sethList = connections jahan main KARIGAR hun (ye log mere Seth hain)
  // karigarList = connections jahan main SETH hun (ye log mere Karigar hain)
  //
  // roleLabel ka matlab SENDER ke perspective se hai:
  //   roleLabel="karigar" + direction="sent"     → main karigar → wo mera Seth → sethList
  //   roleLabel="karigar" + direction="received" → wo karigar → main Seth → karigarList
  //   roleLabel="seth"    + direction="sent"     → main seth → wo mera Karigar → karigarList
  //   roleLabel="seth"    + direction="received" → wo seth → main karigar → sethList
  const sethList = useMemo(() => accepted.filter((c) => {
    if (c.roleLabel === "both") return true;   // dono role → dono lists mein
    if (c.myRole === "karigar") return true;   // slip se confirm: main karigar
    if (c.myRole === "unknown") {
      // direction se nikalte hain: sent=apna role, received=unka role (flip)
      if (c.direction === "sent") return c.roleLabel === "karigar";
      if (c.direction === "received") return c.roleLabel === "seth";
    }
    return false;
  }), [accepted]);

  const karigarList = useMemo(() => accepted.filter((c) => {
    if (c.roleLabel === "both") return true;   // dono role → dono lists mein
    if (c.myRole === "seth") return true;      // slip se confirm: main seth
    if (c.myRole === "unknown") {
      if (c.direction === "sent") return c.roleLabel === "seth";
      if (c.direction === "received") return c.roleLabel === "karigar";
    }
    return false;
  }), [accepted]);

  const { from, to } = getDateRange(preset, customFrom, customTo);

  const queryParams = new URLSearchParams();
  if (selectedConnId) queryParams.set("connectionId", String(selectedConnId));
  if (from) queryParams.set("from", from);
  if (to) queryParams.set("to", to);
  // Tell backend explicitly which perspective to use (critical for "both" role contacts)
  // "seth" list = ye log mere Seth hain → main karigar hun → asSeth=false
  // "karigar" list = ye log mere Karigar hain → main Seth hun → asSeth=true
  if (selectedSide === "seth") queryParams.set("asSeth", "false");
  if (selectedSide === "karigar") queryParams.set("asSeth", "true");

  const { data: stmt, isLoading, error } = useQuery({
    queryKey: ["statement", selectedConnId, selectedSide, from, to],
    queryFn: () => customFetch<any>(`/api/statement?${queryParams}`),
    enabled: !!selectedConnId,
  });

  const isSeth: boolean = stmt ? (stmt.isSeth ?? false) : false;
  const sethName = stmt?.seth?.name || stmt?.seth?.code || "Seth";
  const karigarName = stmt?.karigar?.name || stmt?.karigar?.code || "Karigar";

  // Backend always stores from Seth's perspective:
  //   maalGaya = job slips (Seth → Karigar) = material issued
  //   maalAya  = return slips (Karigar → Seth) = material returned
  //
  // From Seth's view:    Maal Gaya = gave to karigar,   Maal Aya = came back
  // From Karigar's view: Maal Aya  = received from seth, Maal Gaya = returned to seth
  const rawGayaQty: number = stmt?.maalGaya?.totalQty ?? 0;       // job slips qty
  const rawAyaQty: number = stmt?.maalAya?.totalJamaQty ?? 0;     // return slips qty

  // Swap for Karigar's perspective
  const displayGayaQty = isSeth ? rawGayaQty : rawAyaQty;
  const displayAyaQty  = isSeth ? rawAyaQty  : rawGayaQty;
  const displayGayaCount = isSeth
    ? `${stmt?.maalGaya?.slipCount ?? 0} slip`
    : `${stmt?.maalAya?.returnSlipCount ?? 0} return`;
  const displayAyaCount = isSeth
    ? `${stmt?.maalAya?.returnSlipCount ?? 0} return`
    : `${stmt?.maalGaya?.slipCount ?? 0} slip`;

  const maalBal: number = stmt?.pendingAtKarigar ?? 0;
  const balanceDue: number = stmt?.balanceDue ?? 0;

  const DEFAULT_TABS = [
    { id: "overview", label: "Overview" },
    { id: "slips", label: "Maal Gaya" },
    { id: "aya", label: "Maal Aya" },
    { id: "payments", label: "Payments" },
  ];
  const TAB_ICON: Record<string, React.ElementType> = {
    overview: FileText, slips: Package, aya: RotateCcw, payments: Banknote,
  };
  const [tabs, setTabs] = useTabOrder("stmt-tabs", DEFAULT_TABS);
  const [tabEditMode, setTabEditMode] = useState(false);

  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );
  const handleTabDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = tabs.findIndex((t) => t.id === active.id);
      const newIdx = tabs.findIndex((t) => t.id === over.id);
      setTabs(arrayMove(tabs, oldIdx, newIdx));
    }
  };

  function selectConn(id: number, side: "seth" | "karigar") {
    // Same id+side clicked again → deselect
    if (selectedConnId === id && selectedSide === side) {
      setSelectedConnId(null);
      setSelectedSide(null);
    } else {
      setSelectedConnId(id);
      setSelectedSide(side);
    }
    setActiveTab("overview");
  }

  function connName(c: any) {
    return c.connectedUser?.name || c.connectedUser?.code || c.connectedUser?.mobile || "—";
  }

  return (
    <Layout>
      <div className="pb-28">
        {/* ── Top Header ── */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white px-4 pt-10 pb-4 rounded-b-3xl shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => navigate("/")} className="bg-white/15 p-2 rounded-full shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1">
              <h1 className="text-xl font-black">Statement</h1>
              <p className="text-white/50 text-xs">Seth ya Karigar chuno</p>
            </div>
            {stmt && selectedConnId && (
              <PrintShareButton
                generatePdf={() => {
                  const conn = [...(sethList ?? []), ...(karigarList ?? [])].find((c: any) => c.id === selectedConnId);
                  const name = conn ? connName(conn) : "Party";
                  const label = preset === "custom"
                    ? `${customFrom} to ${customTo}`
                    : PRESETS.find(p => p.id === preset)?.label ?? preset;
                  return generateStatementPdf(stmt, name, label);
                }}
                filename={`statement-${stmt.karigar?.name || stmt.karigar?.code || "karigar"}.pdf`}
              />
            )}
          </div>

          {/* Date filter */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1" style={{ touchAction: "pan-x" }}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => { setPreset(p.id); if (p.id === "custom") setShowCustom(true); else setShowCustom(false); }}
                className={cn(
                  "whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0",
                  preset === p.id ? "bg-white text-slate-900" : "bg-white/15 text-white/80"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <AnimatePresence>
            {showCustom && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 flex gap-2">
                <div className="flex-1">
                  <p className="text-white/60 text-xs mb-1">From</p>
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-full h-9 px-3 rounded-xl bg-white/15 text-white text-sm border border-white/20 focus:outline-none" />
                </div>
                <div className="flex-1">
                  <p className="text-white/60 text-xs mb-1">To</p>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-full h-9 px-3 rounded-xl bg-white/15 text-white text-sm border border-white/20 focus:outline-none" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {from && to && !showCustom && (
            <p className="text-white/40 text-xs mt-2 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {format(new Date(from), "d MMM")} — {format(new Date(to), "d MMM yyyy")}
            </p>
          )}
        </div>

        {/* ── Two Dropdowns Side by Side ── */}
        <div className="sticky top-0 z-40 bg-background px-4 pt-3 pb-2 border-b border-border">
        <div className="grid grid-cols-2 gap-3 relative">
          {/* Seth Dropdown */}
          <div className="relative">
            <button
              onClick={() => setOpenDropdown(openDropdown === "seth" ? null : "seth")}
              className={cn(
                "w-full flex items-center justify-between px-3 py-3 rounded-2xl border-2 text-left transition-all",
                openDropdown === "seth"
                  ? "border-blue-500 bg-blue-50"
                  : sethList.some((c: any) => c.id === selectedConnId && selectedSide === "seth")
                    ? "border-blue-500 bg-blue-600 text-white"
                    : "border-border bg-card"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className={cn("text-[10px] font-black uppercase tracking-wide",
                  sethList.some((c: any) => c.id === selectedConnId && selectedSide === "seth") && openDropdown !== "seth" ? "text-blue-100" : "text-blue-600"
                )}>Seth List</p>
                <p className={cn("text-sm font-bold truncate",
                  sethList.some((c: any) => c.id === selectedConnId && selectedSide === "seth") && openDropdown !== "seth" ? "text-white" : "text-foreground"
                )}>
                  {sethList.find((c: any) => c.id === selectedConnId && selectedSide === "seth")
                    ? connName(sethList.find((c: any) => c.id === selectedConnId && selectedSide === "seth"))
                    : sethList.length === 0 ? "Koi nahi" : "Chuno..."}
                </p>
              </div>
              <ChevronDown className={cn("w-4 h-4 shrink-0 ml-1 transition-transform",
                openDropdown === "seth" ? "rotate-180 text-blue-600" :
                sethList.some((c: any) => c.id === selectedConnId && selectedSide === "seth") ? "text-white" : "text-muted-foreground"
              )} />
            </button>

            <AnimatePresence>
              {openDropdown === "seth" && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-2xl shadow-xl overflow-hidden z-50"
                >
                  {sethList.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-5">Koi Seth nahi</p>
                  ) : (
                    sethList.map((c: any) => (
                      <button
                        key={c.id}
                        onClick={() => { selectConn(c.id, "seth"); setOpenDropdown(null); }}
                        className={cn(
                          "w-full text-left px-4 py-3 text-sm font-bold border-b border-border/40 last:border-0 transition-colors text-foreground",
                          selectedConnId === c.id && selectedSide === "seth" ? "bg-blue-50 text-blue-700" : "hover:bg-muted/50"
                        )}
                      >
                        {connName(c)}
                      </button>
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Karigar Dropdown */}
          <div className="relative">
            <button
              onClick={() => setOpenDropdown(openDropdown === "karigar" ? null : "karigar")}
              className={cn(
                "w-full flex items-center justify-between px-3 py-3 rounded-2xl border-2 text-left transition-all",
                openDropdown === "karigar"
                  ? "border-emerald-500 bg-emerald-50"
                  : karigarList.some((c: any) => c.id === selectedConnId && selectedSide === "karigar")
                    ? "border-emerald-500 bg-emerald-600 text-white"
                    : "border-border bg-card"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className={cn("text-[10px] font-black uppercase tracking-wide",
                  karigarList.some((c: any) => c.id === selectedConnId && selectedSide === "karigar") && openDropdown !== "karigar" ? "text-emerald-100" : "text-emerald-600"
                )}>Karigar List</p>
                <p className={cn("text-sm font-bold truncate",
                  karigarList.some((c: any) => c.id === selectedConnId && selectedSide === "karigar") && openDropdown !== "karigar" ? "text-white" : "text-foreground"
                )}>
                  {karigarList.find((c: any) => c.id === selectedConnId && selectedSide === "karigar")
                    ? connName(karigarList.find((c: any) => c.id === selectedConnId && selectedSide === "karigar"))
                    : karigarList.length === 0 ? "Koi nahi" : "Chuno..."}
                </p>
              </div>
              <ChevronDown className={cn("w-4 h-4 shrink-0 ml-1 transition-transform",
                openDropdown === "karigar" ? "rotate-180 text-emerald-600" :
                karigarList.some((c: any) => c.id === selectedConnId && selectedSide === "karigar") ? "text-white" : "text-muted-foreground"
              )} />
            </button>

            <AnimatePresence>
              {openDropdown === "karigar" && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-2xl shadow-xl overflow-hidden z-50"
                >
                  {karigarList.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-5">Koi Karigar nahi</p>
                  ) : (
                    karigarList.map((c: any) => (
                      <button
                        key={c.id}
                        onClick={() => { selectConn(c.id, "karigar"); setOpenDropdown(null); }}
                        className={cn(
                          "w-full text-left px-4 py-3 text-sm font-bold border-b border-border/40 last:border-0 transition-colors text-foreground",
                          selectedConnId === c.id && selectedSide === "karigar" ? "bg-emerald-50 text-emerald-700" : "hover:bg-muted/50"
                        )}
                      >
                        {connName(c)}
                      </button>
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        </div>

        {/* ── Statement Detail (full width) ── */}
        <div className="px-4 mt-4">
          {!selectedConnId ? (
            <div className="text-center py-16">
              <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" />
              <p className="text-muted-foreground font-medium">Koi naam select nahi kiya</p>
              <p className="text-xs text-muted-foreground mt-1">Upar Seth ya Karigar list se naam chuno</p>
            </div>
          ) : isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted animate-pulse rounded-2xl" />)}
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <AlertCircle className="w-10 h-10 mx-auto text-red-400 mb-2" />
              <p className="text-red-500 font-semibold text-sm">Load nahi hua</p>
            </div>
          ) : stmt ? (
            <>

              {/* 4 Stat Cards */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <StatCard icon={Package} label="Maal Gaya" value={`${displayGayaQty.toLocaleString()} pc`} sub={displayGayaCount} color="bg-blue-600 text-white" />
                <StatCard icon={RotateCcw} label="Maal Aya" value={`${displayAyaQty.toLocaleString()} pc`} sub={displayAyaCount} color="bg-emerald-600 text-white" />
                <StatCard icon={Clock} label="Maal Bal" value={`${maalBal.toLocaleString()} pc`} sub="baaki" color={maalBal > 0 ? "bg-amber-500 text-white" : "bg-slate-400 text-white"} />
                <StatCard
                  icon={Banknote}
                  label={isSeth ? "Dena Hai" : "Lena Hai"}
                  value={`₹${balanceDue.toLocaleString("en-IN")}`}
                  sub={balanceDue === 0 ? "Sab clear ✓" : "Unpaid + Partial slips"}
                  color={balanceDue === 0 ? "bg-emerald-600 text-white" : "bg-violet-600 text-white"}
                />
              </div>

              {/* Slip payment status */}
              <div className="bg-card border border-border rounded-2xl overflow-hidden mb-3">
                <div className="px-4 py-3 bg-muted/40 border-b border-border">
                  <p className="font-bold text-sm">Slip Payment Status</p>
                </div>
                <div className="px-4 py-3">
                  <Row label="✅ Fully Paid" value={`${stmt.slipPaymentSummary.fullyPaid} slip`} color="text-emerald-600" />
                  <Row label="🔶 Partial Paid" value={`${stmt.slipPaymentSummary.partial} slip`} color="text-amber-600" />
                  <Row label="🔴 Unpaid" value={`${stmt.slipPaymentSummary.unpaid} slip`} color="text-red-500" />
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-border">
                    <span className="text-sm font-semibold">Total Paid</span>
                    <span className="font-black text-foreground">₹{stmt.slipPaymentSummary.totalPaid.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>

              {/* Maal qty breakdown */}
              <div className="bg-card border border-border rounded-2xl overflow-hidden mb-3">
                <div className="px-4 py-3 bg-muted/40 border-b border-border">
                  <p className="font-bold text-sm">Maal Qty Breakdown</p>
                </div>
                <div className="px-4 py-3">
                  <Row label="✅ Maal Aya" value={`${displayAyaQty.toLocaleString()} pc`} color="text-emerald-600" />
                  <Row label="📦 Maal Gaya" value={`${displayGayaQty.toLocaleString()} pc`} color="text-blue-600" />
                  {stmt.maalAya.totalDamageQty > 0 && <Row label="💥 Damage" value={`${stmt.maalAya.totalDamageQty} pc`} color="text-red-500" />}
                  {stmt.maalAya.totalShortageQty > 0 && <Row label="⚠️ Shortage" value={`${stmt.maalAya.totalShortageQty} pc`} color="text-orange-500" />}
                  {stmt.maalAya.totalNoWorkQty > 0 && <Row label="🔁 No Work Return" value={`${stmt.maalAya.totalNoWorkQty} pc`} color="text-muted-foreground" />}
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-border">
                    <span className="text-sm font-bold text-amber-700">⏳ Maal Bal (baaki)</span>
                    <span className={cn("font-black", maalBal > 0 ? "text-amber-600" : "text-emerald-600")}>{maalBal.toLocaleString()} pc</span>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1">
                <DndContext sensors={tabSensors} collisionDetection={closestCenter} onDragEnd={handleTabDragEnd}>
                  <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
                    <div className={cn("flex gap-1 overflow-x-auto scrollbar-hide pb-2 flex-1", tabEditMode ? "cursor-grab" : "")} style={{ touchAction: tabEditMode ? "none" : "pan-x" }}>
                      {tabs.map((t) => {
                        const Icon = TAB_ICON[t.id] ?? FileText;
                        return <SortableTabPill key={t.id} t={t} Icon={Icon} activeTab={activeTab as string} setActiveTab={setActiveTab} editMode={tabEditMode} />;
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
                <button
                  onClick={() => setTabEditMode((v) => !v)}
                  className={cn("shrink-0 mb-2 p-1.5 rounded-full transition-colors", tabEditMode ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
                >
                  {tabEditMode ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3 h-3" />}
                </button>
              </div>

              <AnimatePresence mode="wait">
                <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>

                  {/* Overview tab */}
                  {activeTab === "overview" && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      Upar se summary dekho ya niche tabs se detail
                    </div>
                  )}

                  {/* Maal Gaya tab — Seth: job slips | Karigar: return slips */}
                  {activeTab === "slips" && (
                    <div>
                      {isSeth ? (
                        // Seth view: job slips (what I gave to karigar)
                        stmt.maalGaya.slips.length === 0 ? (
                          <div className="text-center py-12"><Package className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-muted-foreground text-sm">Koi slip nahi</p></div>
                        ) : (
                          ["unpaid", "partial", "paid"].map((status) => {
                            const slips = stmt.maalGaya.slips.filter((s: any) => s.paymentStatus === status);
                            if (!slips.length) return null;
                            const label = status === "paid" ? "✅ Fully Paid" : status === "partial" ? "🔶 Partial Paid" : "🔴 Unpaid";
                            const headerColor = status === "paid" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : status === "partial" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-red-50 border-red-200 text-red-800";
                            return (
                              <div key={status} className="mb-4">
                                <div className={cn("px-3 py-1.5 rounded-xl border mb-2 text-xs font-bold inline-flex", headerColor)}>{label} — {slips.length} slip</div>
                                <div className="space-y-2">
                                  {slips.map((slip: any) => (
                                    <JobSlipCard key={slip.id} slip={slip} isSeth={isSeth} />
                                  ))}
                                </div>
                              </div>
                            );
                          })
                        )
                      ) : (
                        // Karigar view: return slips (what I returned to seth)
                        stmt.maalAya.returnSlips.length === 0 ? (
                          <div className="text-center py-10"><RotateCcw className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-muted-foreground text-sm">Koi return slip nahi</p></div>
                        ) : (
                          <div className="space-y-2">
                            {stmt.maalAya.returnSlips.map((rs: any) => (
                              <ReturnSlipCard key={rs.id} rs={rs} />
                            ))}
                          </div>
                        )
                      )}
                    </div>
                  )}

                  {/* Maal Aya tab — Seth: return slips | Karigar: job slips */}
                  {activeTab === "aya" && (
                    <div>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-center">
                          <p className="text-xs text-muted-foreground">Maal Aya</p>
                          <p className="font-black text-emerald-700">{displayAyaQty.toLocaleString()} pc</p>
                        </div>
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-center">
                          <p className="text-xs text-muted-foreground">Maal Bal</p>
                          <p className="font-black text-amber-700">{maalBal.toLocaleString()} pc</p>
                        </div>
                        {stmt.maalAya.totalDamageQty > 0 && (
                          <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-center">
                            <p className="text-xs text-muted-foreground">Damage</p>
                            <p className="font-black text-red-600">{stmt.maalAya.totalDamageQty} pc</p>
                          </div>
                        )}
                        {stmt.maalAya.totalShortageQty > 0 && (
                          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-3 text-center">
                            <p className="text-xs text-muted-foreground">Shortage</p>
                            <p className="font-black text-orange-600">{stmt.maalAya.totalShortageQty} pc</p>
                          </div>
                        )}
                      </div>
                      {isSeth ? (
                        // Seth view: return slips (what came back from karigar)
                        stmt.maalAya.returnSlips.length === 0 ? (
                          <div className="text-center py-10"><RotateCcw className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-muted-foreground text-sm">Koi return slip nahi</p></div>
                        ) : (
                          <div className="space-y-2">
                            {stmt.maalAya.returnSlips.map((rs: any) => (
                              <ReturnSlipCard key={rs.id} rs={rs} />
                            ))}
                          </div>
                        )
                      ) : (
                        // Karigar view: job slips (what I received from seth)
                        stmt.maalGaya.slips.length === 0 ? (
                          <div className="text-center py-12"><Package className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-muted-foreground text-sm">Koi slip nahi</p></div>
                        ) : (
                          ["unpaid", "partial", "paid"].map((status) => {
                            const slips = stmt.maalGaya.slips.filter((s: any) => s.paymentStatus === status);
                            if (!slips.length) return null;
                            const label = status === "paid" ? "✅ Fully Paid" : status === "partial" ? "🔶 Partial Paid" : "🔴 Unpaid";
                            const headerColor = status === "paid" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : status === "partial" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-red-50 border-red-200 text-red-800";
                            return (
                              <div key={status} className="mb-4">
                                <div className={cn("px-3 py-1.5 rounded-xl border mb-2 text-xs font-bold inline-flex", headerColor)}>{label} — {slips.length} slip</div>
                                <div className="space-y-2">
                                  {slips.map((slip: any) => (
                                    <JobSlipCard key={slip.id} slip={slip} isSeth={isSeth} />
                                  ))}
                                </div>
                              </div>
                            );
                          })
                        )
                      )}
                    </div>
                  )}

                  {/* Payments tab */}
                  {activeTab === "payments" && (
                    <div>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {/* Seth view: Diya=totalDiya, Mila=totalAaya | Karigar view: Mila=totalDiya, Diya=totalAaya */}
                        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-3 text-center">
                          <TrendingDown className="w-4 h-4 text-violet-600 mx-auto mb-1" />
                          <p className="text-xs text-muted-foreground">{isSeth ? "Diya" : "Mila"}</p>
                          <p className="font-black text-violet-700">₹{(isSeth ? stmt.payments.totalDiya : stmt.payments.totalDiya).toLocaleString("en-IN")}</p>
                        </div>
                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-center">
                          <TrendingUp className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
                          <p className="text-xs text-muted-foreground">{isSeth ? "Mila" : "Diya"}</p>
                          <p className="font-black text-emerald-700">₹{stmt.payments.totalAaya.toLocaleString("en-IN")}</p>
                        </div>
                      </div>
                      {stmt.payments.records.length === 0 ? (
                        <div className="text-center py-10"><Banknote className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-muted-foreground text-sm">Koi payment nahi</p></div>
                      ) : (
                        <div className="space-y-2">
                          {stmt.payments.records.map((p: any) => {
                            // Seth view: diya=gave, mila=received | Karigar view: diya=received from seth, mila=gave to seth
                            const displayDiya = isSeth ? p.direction === "diya" : p.direction !== "diya";
                            return (
                              <div key={p.id} className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3">
                                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", displayDiya ? "bg-violet-100" : "bg-emerald-100")}>
                                  {displayDiya ? <TrendingDown className="w-5 h-5 text-violet-600" /> : <TrendingUp className="w-5 h-5 text-emerald-600" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold text-sm">{displayDiya ? "Diya" : "Mila"}</p>
                                  <p className="text-xs text-muted-foreground">{format(new Date(p.date), "d MMM yyyy")}{p.note && ` • ${p.note}`}{p.finalRate && ` • ₹${p.finalRate}/pc`}</p>
                                </div>
                                <p className={cn("font-black text-base shrink-0", displayDiya ? "text-violet-600" : "text-emerald-600")}>₹{p.amount.toLocaleString("en-IN")}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </>
          ) : null}
        </div>
      </div>
    </Layout>
  );
}

import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { apiUrl } from "@/lib/api-url";
import {
  useGetConnections,
  useGetPendingSlipsForSeth,
  useGetJobSlips,
  useCreateReturnSlip,
  useGetMe,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Search, ChevronRight, Package, CheckSquare, Square, AlertCircle, Mic, MicOff, WifiOff, Wifi
} from "lucide-react";
import { format } from "date-fns";

interface EntryState {
  jobSlipId: number;
  jamaQty: string;
  damageQty: string;
  shortageQty: string;
  noWorkQty: string;
  ratePerPc: string;
  notes: string;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function NewReturnSlip() {
  const [, setLocation] = useLocation();
  const queryString = useSearch();
  const urlMode = new URLSearchParams(queryString).get("mode");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"normal" | "offline">(urlMode === "offline" ? "offline" : "normal");
  const [step, setStep] = useState<"select_seth" | "select_slips" | "fill_details">("select_seth");
  const [search, setSearch] = useState("");
  const [selectedSeth, setSelectedSeth] = useState<any>(null);
  const [selectedKarigar, setSelectedKarigar] = useState<any>(null);
  const [selectedSlipIds, setSelectedSlipIds] = useState<Set<number>>(new Set());
  const [entries, setEntries] = useState<Record<number, EntryState>>({});
  const [slipNotes, setSlipNotes] = useState("");
  const [isRecording, setIsRecording] = useState<number | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);

  const { data: meData } = useGetMe();
  const { data: connections = [] } = useGetConnections();

  // Fetch all my karigar slips to know which seths have balance qty > 0
  const { data: allKarigarSlips = [] } = useGetJobSlips({ role: "karigar" } as any);
  const sethIdsWithBalance = new Set(
    (allKarigarSlips as any[])
      .filter((s: any) => (s.balanceQty ?? 0) > 0)
      .map((s: any) => s.sethId)
  );

  const { data: pendingSlips = [], isLoading: loadingSlips } = useGetPendingSlipsForSeth(
    selectedSeth?.connectedUser?.id ?? 0,
    { query: { enabled: mode === "normal" && !!selectedSeth } }
  );

  // Offline mode: fetch pending slips for the selected karigar (Seth's perspective)
  const { data: offlinePendingSlips = [], isLoading: loadingOfflineSlips } = useQuery({
    queryKey: ["job-slips", "karigar", selectedKarigar?.connectedUser?.id, "pending"],
    queryFn: async () => {
      const token = localStorage.getItem("fabricpro_token");
      const res = await fetch(`/api/job-slips/karigar/${selectedKarigar.connectedUser.id}/pending`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: mode === "offline" && !!selectedKarigar,
  });

  const createReturn = useCreateReturnSlip();

  // In normal mode: show only Seth connections with balance qty > 0
  // In offline mode: show offline karigar connections
  const sethConnections = (connections as any[]).filter(
    (c: any) => c.status === "accepted" && sethIdsWithBalance.has(c.connectedUser?.id)
  );
  const offlineKarigarConnections = (connections as any[]).filter(
    (c: any) => c.status === "accepted" && c.connectedUser?.role === "karigar"
  );
  const activeConnections = mode === "offline" ? offlineKarigarConnections : sethConnections;
  const filtered = activeConnections.filter((c: any) => {
    const name = c.connectedUser?.name || c.connectedUser?.code || "";
    return name.toLowerCase().includes(search.toLowerCase());
  });

  // Effective pending slips based on mode
  const activePendingSlips: any[] = mode === "offline" ? offlinePendingSlips : (pendingSlips as any[]);
  const activeLoadingSlips = mode === "offline" ? loadingOfflineSlips : loadingSlips;

  function toggleSlip(slipId: number, slip: any) {
    setSelectedSlipIds((prev) => {
      const next = new Set(prev);
      if (next.has(slipId)) {
        next.delete(slipId);
        setEntries((e) => { const n = { ...e }; delete n[slipId]; return n; });
      } else {
        next.add(slipId);
        const firstItem = slip.items?.[0];
        setEntries((e) => ({
          ...e,
          [slipId]: {
            jobSlipId: slipId,
            jamaQty: "",
            damageQty: "",
            shortageQty: "",
            noWorkQty: "",
            ratePerPc: firstItem?.ratePerPc ? String(parseFloat(firstItem.ratePerPc)) : "",
            notes: "",
          },
        }));
      }
      return next;
    });
  }

  function updateEntry(slipId: number, field: keyof EntryState, value: string) {
    setEntries((prev) => ({
      ...prev,
      [slipId]: { ...prev[slipId], [field]: value },
    }));
  }

  function startVoice(slipId: number) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (isRecording === slipId) {
      setIsRecording(null);
      return;
    }
    const r = new SR();
    r.lang = "hi-IN";
    r.interimResults = false;
    r.onresult = (e: any) => updateEntry(slipId, "notes", e.results[0][0].transcript);
    r.onend = () => setIsRecording(null);
    r.start();
    setIsRecording(slipId);
  }

  async function handleSubmit() {
    const entryList = Object.values(entries).filter((e) => selectedSlipIds.has(e.jobSlipId));
    const invalid = entryList.find(
      (e) => !e.jamaQty && !e.damageQty && !e.shortageQty && !e.noWorkQty
    );
    if (invalid) {
      toast({ title: "Qty bharo", description: "Har slip ke liye kam se kam ek qty daalo (jama, damage, shortage, ya No Work)", variant: "destructive" });
      return;
    }

    try {
      if (mode === "offline") {
        // Seth creating on behalf of offline karigar — manual fetch with karigarId override
        setSubmitLoading(true);
        const token = localStorage.getItem("fabricpro_token");
        const res = await fetch(apiUrl("/api/return-slips"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            sethId: (meData as any)?.id,
            karigarId: selectedKarigar.connectedUser.id,
            notes: slipNotes || undefined,
            entries: entryList.map((e) => ({
              jobSlipId: e.jobSlipId,
              jamaQty: parseInt(e.jamaQty || "0"),
              damageQty: parseInt(e.damageQty || "0"),
              shortageQty: parseInt(e.shortageQty || "0"),
              noWorkQty: parseInt(e.noWorkQty || "0"),
              ratePerPc: e.ratePerPc ? parseFloat(e.ratePerPc) : undefined,
              notes: e.notes || undefined,
            })),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast({ title: data.error || "Slip nahi bani", variant: "destructive" });
          return;
        }
        qc.invalidateQueries({ queryKey: ["getReturnSlips"] });
        qc.invalidateQueries({ queryKey: ["getJobSlips"] });
        toast({ title: "Maal Wapas Record Ho Gaya! ✅", description: `${selectedKarigar.connectedUser?.name} ki slip save ho gayi` });
        setLocation("/slips");
      } else {
        await createReturn.mutateAsync({
          data: {
            sethId: selectedSeth.connectedUser.id,
            notes: slipNotes || undefined,
            entries: entryList.map((e) => ({
              jobSlipId: e.jobSlipId,
              jamaQty: parseInt(e.jamaQty || "0"),
              damageQty: parseInt(e.damageQty || "0"),
              shortageQty: parseInt(e.shortageQty || "0"),
              noWorkQty: parseInt(e.noWorkQty || "0"),
              ratePerPc: e.ratePerPc ? parseFloat(e.ratePerPc) : undefined,
              notes: e.notes || undefined,
            })),
          } as any,
        });
        qc.invalidateQueries({ queryKey: ["getReturnSlips"] });
        qc.invalidateQueries({ queryKey: ["getJobSlips"] });
        toast({ title: "Maal Wapas Bhej Diya!", description: `${selectedSeth.connectedUser?.name || selectedSeth.connectedUser?.code} ko notification gaya` });
        setLocation("/slips");
      }
    } catch {
      toast({ title: "Error", description: "Slip nahi bani. Dobara karo.", variant: "destructive" });
    } finally {
      setSubmitLoading(false);
    }
  }

  if (step === "select_seth") {
    return (
      <Layout>
        <div className="pb-24">
          <header className="bg-orange-500 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-md">
            <div className="flex items-center gap-3">
              <button onClick={() => setLocation("/slips")} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-xl font-bold">Maal Wapas Bhejo</h1>
                <p className="text-white/70 text-sm">
                  {mode === "offline" ? "Step 1: Offline karigar select karo" : "Step 1: Seth select karo"}
                </p>
              </div>
            </div>
          </header>

          <div className="px-4 pt-4">
            {/* Mode selector */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                onClick={() => { setMode("normal"); setSearch(""); }}
                className={`flex items-center justify-center gap-2 rounded-xl border-2 p-3 text-sm font-semibold transition-all ${
                  mode === "normal"
                    ? "border-orange-400 bg-orange-50 text-orange-700"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                <Wifi className="h-4 w-4" /> Main Karigar Hun
              </button>
              <button
                onClick={() => { setMode("offline"); setSearch(""); }}
                className={`flex items-center justify-center gap-2 rounded-xl border-2 p-3 text-sm font-semibold transition-all ${
                  mode === "offline"
                    ? "border-orange-400 bg-orange-50 text-orange-700"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                <WifiOff className="h-4 w-4" /> Offline Karigar ke liye
              </button>
            </div>

            {mode === "offline" && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 text-xs text-orange-800 mb-4">
                Seth ke roop mein offline karigar ki jagah maal wapas record kar rahe hain.
              </div>
            )}

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={mode === "offline" ? "Karigar ka naam..." : "Seth ka naam ya number..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 rounded-xl"
              />
            </div>

            {filtered.length === 0 ? (
              <div className="text-center py-16">
                <Package className="h-14 w-14 mx-auto text-muted-foreground/30 mb-3" />
                {mode === "normal" ? (
                  <>
                    <p className="text-muted-foreground font-medium">Koi pending maal nahi</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Jinke paas balance qty hai wahi seth dikhenge
                    </p>
                    {search && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Search: "{search}" — koi nahi mila
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground">
                      {search ? "Koi offline karigar nahi mila" : "Koi offline karigar nahi"}
                    </p>
                    {offlineKarigarConnections.length === 0 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Pehle Connections page se offline karigar add karo
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              filtered.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => {
                    if (mode === "offline") {
                      setSelectedKarigar(c);
                    } else {
                      setSelectedSeth(c);
                    }
                    setSelectedSlipIds(new Set());
                    setEntries({});
                    setStep("select_slips");
                  }}
                  className="w-full bg-card border border-border rounded-2xl p-4 mb-3 flex items-center gap-3 hover:shadow-md transition-all text-left"
                >
                  <div className="h-12 w-12 rounded-full bg-orange-100 flex items-center justify-center text-lg font-bold text-orange-600 shrink-0">
                    {(c.connectedUser?.name || c.connectedUser?.code || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{c.connectedUser?.name || c.connectedUser?.code}</p>
                      {c.connectedUser?.mobile?.startsWith("100") && (
                        <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-semibold">Offline</span>
                      )}
                    </div>
                    {!c.connectedUser?.mobile?.startsWith("100") && (
                      <p className="text-sm text-muted-foreground">{c.connectedUser?.mobile}</p>
                    )}
                    {mode === "normal" && (() => {
                      const totalBalance = (allKarigarSlips as any[])
                        .filter((s: any) => s.sethId === c.connectedUser?.id && (s.balanceQty ?? 0) > 0)
                        .reduce((sum: number, s: any) => sum + (s.balanceQty ?? 0), 0);
                      const slipCount = (allKarigarSlips as any[])
                        .filter((s: any) => s.sethId === c.connectedUser?.id && (s.balanceQty ?? 0) > 0).length;
                      return totalBalance > 0 ? (
                        <p className="text-xs text-amber-600 font-semibold mt-0.5">
                          {slipCount} slip • {totalBalance.toLocaleString()} pcs baaki
                        </p>
                      ) : null;
                    })()}
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        </div>
      </Layout>
    );
  }

  if (step === "select_slips") {
    return (
      <Layout>
        <div className="pb-28">
          <header className="bg-orange-500 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-md">
            <div className="flex items-center gap-3">
              <button onClick={() => { setStep("select_seth"); setSelectedSlipIds(new Set()); setEntries({}); }} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-xl font-bold">Slip Select Karo</h1>
                <p className="text-white/70 text-sm">
                  {mode === "offline"
                    ? `Karigar: ${selectedKarigar?.connectedUser?.name || selectedKarigar?.connectedUser?.code}`
                    : `Seth: ${selectedSeth?.connectedUser?.name || selectedSeth?.connectedUser?.code}`}
                </p>
              </div>
            </div>
          </header>

          <div className="px-4 pt-4">
            {activeLoadingSlips ? (
              <div className="text-center py-8 text-muted-foreground">Slips load ho rahi hain...</div>
            ) : activePendingSlips.length === 0 ? (
              <div className="text-center py-16">
                <Package className="h-14 w-14 mx-auto text-muted-foreground/30 mb-3" />
                <p className="font-medium text-muted-foreground">Koi pending slip nahi</p>
                <p className="text-sm text-muted-foreground mt-1">Is Seth ki saari slips mukammal ho gayi hain</p>
              </div>
            ) : (
              activePendingSlips.map((slip: any) => {
                const selected = selectedSlipIds.has(slip.id);
                return (
                  <button
                    key={slip.id}
                    onClick={() => toggleSlip(slip.id, slip)}
                    className={`w-full rounded-2xl p-4 mb-3 text-left transition-all border-2 ${
                      selected ? "border-orange-400 bg-orange-50" : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {selected ? (
                          <CheckSquare className="h-5 w-5 text-orange-500" />
                        ) : (
                          <Square className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-mono text-sm font-semibold">{slip.slipNumber}</span>
                          <span className="text-xs text-muted-foreground">{format(new Date(slip.createdAt), "dd MMM yyyy")}</span>
                        </div>
                        {(slip.items ?? []).slice(0, 2).map((item: any) => (
                          <p key={item.id} className="text-sm text-muted-foreground">{item.itemName}</p>
                        ))}
                        {(slip.items ?? []).length > 2 && (
                          <p className="text-xs text-muted-foreground">+{(slip.items ?? []).length - 2} aur items</p>
                        )}
                        <div className="flex gap-4 mt-2 pt-2 border-t border-border/50">
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">Total Maal</p>
                            <p className="font-bold text-sm">{(slip.totalQty ?? 0).toLocaleString()}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">Already Jama</p>
                            <p className="font-bold text-sm text-green-600">
                              {((slip.jamaQty ?? 0) + (slip.damageQty ?? 0) + (slip.shortageQty ?? 0)).toLocaleString()}
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">Balance Qty</p>
                            <p className="font-bold text-sm text-amber-600">{(slip.balanceQty ?? 0).toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {selectedSlipIds.size > 0 && (
          <div className="fixed bottom-16 left-0 right-0 p-4 bg-background border-t border-border shadow-lg z-40">
            <div className="max-w-md mx-auto">
              <Button
                onClick={() => setStep("fill_details")}
                className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-base font-semibold"
              >
                {selectedSlipIds.size} Slip(s) Select → Details Bharo
              </Button>
            </div>
          </div>
        )}
      </Layout>
    );
  }

  const selectedSlips = activePendingSlips.filter((s: any) => selectedSlipIds.has(s.id));

  return (
    <Layout>
      <div className="pb-32">
        <header className="bg-orange-500 text-white px-6 pt-10 pb-6 rounded-b-3xl shadow-md">
          <div className="flex items-center gap-3">
            <button onClick={() => setStep("select_slips")} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold">Qty Bharo</h1>
              <p className="text-white/70 text-sm">{selectedSlips.length} slip(s) selected</p>
            </div>
          </div>
        </header>

        <div className="px-4 pt-4 space-y-4">
          {selectedSlips.map((slip: any) => {
            const entry = entries[slip.id] ?? {};
            const totalReturning = (parseInt(entry.jamaQty || "0") + parseInt(entry.damageQty || "0") + parseInt(entry.shortageQty || "0") + parseInt(entry.noWorkQty || "0"));
            const balance = slip.balanceQty ?? 0;
            const overLimit = totalReturning > balance;

            return (
              <div key={slip.id} className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-orange-50 px-4 py-3 border-b border-border">
                  <p className="font-semibold font-mono">{slip.slipNumber}</p>
                  {(slip.items ?? []).map((item: any) => (
                    <p key={item.id} className="text-sm text-muted-foreground">{item.itemName}</p>
                  ))}
                </div>

                <div className="flex gap-4 px-4 py-3 border-b border-border bg-muted/30">
                  <div className="text-center flex-1">
                    <p className="text-xs text-muted-foreground">Total Maal</p>
                    <p className="font-bold">{(slip.totalQty ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="text-center flex-1">
                    <p className="text-xs text-muted-foreground">Already Jama</p>
                    <p className="font-bold text-green-600">
                      {((slip.jamaQty ?? 0) + (slip.damageQty ?? 0) + (slip.shortageQty ?? 0)).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-center flex-1">
                    <p className="text-xs text-muted-foreground">Balance</p>
                    <p className="font-bold text-amber-600">{balance.toLocaleString()}</p>
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Aaj ka Hisaab</p>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs font-medium text-green-700 mb-1 block">Jama Pcs</label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={entry.jamaQty || ""}
                        onChange={(e) => updateEntry(slip.id, "jamaQty", e.target.value)}
                        className="rounded-xl text-center"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-orange-600 mb-1 block">Damage Pcs</label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={entry.damageQty || ""}
                        onChange={(e) => updateEntry(slip.id, "damageQty", e.target.value)}
                        className="rounded-xl text-center"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-red-600 mb-1 block">Shortage Pcs</label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={entry.shortageQty || ""}
                        onChange={(e) => updateEntry(slip.id, "shortageQty", e.target.value)}
                        className="rounded-xl text-center"
                      />
                    </div>
                  </div>

                  {/* No Work Qty — kaam nahi hua, zero payment */}
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <label className="text-xs font-semibold text-purple-700 mb-1 block">
                          No Work Pcs (Kaam Nahi Hua — Zero Payment)
                        </label>
                        <Input
                          type="number"
                          placeholder="0"
                          value={entry.noWorkQty || ""}
                          onChange={(e) => updateEntry(slip.id, "noWorkQty", e.target.value)}
                          className="rounded-xl text-center bg-white"
                        />
                        {parseInt(entry.noWorkQty || "0") > 0 && (
                          <p className="text-xs text-purple-600 mt-1">
                            ✓ {parseInt(entry.noWorkQty)} pcs wapas aayenge — paise nahi milenge
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {overLimit && (
                    <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-xl p-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      Total qty ({totalReturning}) balance se zyada hai ({balance})
                    </div>
                  )}

                  {parseInt(entry.shortageQty || "0") > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-red-700">
                          Shortage: {entry.shortageQty} pcs
                        </p>
                        <p className="text-xs text-red-600 mt-0.5">
                          Rate/pc Seth dalenge — jab woh yeh slip dekhenge
                        </p>
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
                      <button
                        onClick={() => startVoice(slip.id)}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
                          isRecording === slip.id ? "bg-red-100 text-red-600 animate-pulse" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {isRecording === slip.id ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                        {isRecording === slip.id ? "Rok do" : "Voice"}
                      </button>
                    </div>
                    <Textarea
                      placeholder="Koi khaas baat..."
                      value={entry.notes || ""}
                      onChange={(e) => updateEntry(slip.id, "notes", e.target.value)}
                      className="rounded-xl resize-none"
                      rows={2}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Poori Slip ka Note (optional)</label>
            <Textarea
              placeholder="Koi aur baat..."
              value={slipNotes}
              onChange={(e) => setSlipNotes(e.target.value)}
              className="rounded-xl resize-none"
              rows={2}
            />
          </div>
        </div>
      </div>

      <div className="fixed bottom-16 left-0 right-0 p-4 bg-background border-t border-border shadow-lg z-40">
        <div className="max-w-md mx-auto">
          <Button
            onClick={handleSubmit}
            disabled={createReturn.isPending || submitLoading}
            className="w-full h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-base font-semibold"
          >
            {(createReturn.isPending || submitLoading) ? "Slip ban rahi hai..." : "Maal Wapas Bhejo →"}
          </Button>
        </div>
      </div>
    </Layout>
  );
}

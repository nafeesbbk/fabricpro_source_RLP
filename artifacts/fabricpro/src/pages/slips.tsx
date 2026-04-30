import { useState, useCallback } from "react";
import { Link } from "wouter";
import { useGetJobSlips, useGetReturnSlips } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Package, ChevronRight, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { format } from "date-fns";

const TAB_VOICE: Record<string, string> = {
  maal_dena: "Yahan woh slips hain jo aapne apne karigar ko bheje hain. Naya slip banane ke liye, Naya Slip wala button dabayen.",
  maal_aya:  "Yahan woh maal dikhta hai jo aapke seth ne aapko bheja hai. Har slip mein kitna maal aaya aur uski sthiti likhi hai.",
  wapas_jama: "Yahan woh slips hain jo aapne seth ko wapis jama ki hain. Naya wapasi record karne ke liye, Wapas Bhejo button dabayen.",
  wapas_aya:  "Yahan woh maal dikhta hai jo karigar ne aapko wapis bheja hai.",
};

function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "hi-IN";
    utt.rate = 0.9;
    utt.onstart = () => setSpeaking(true);
    utt.onend = () => setSpeaking(false);
    utt.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utt);
  }, [speaking]);
  return { speak, speaking };
}

type Tab = "maal_dena" | "maal_aya" | "wapas_jama" | "wapas_aya";

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    sent: { label: "Bheja", cls: "bg-amber-100 text-amber-700" },
    viewed: { label: "Dekha", cls: "bg-blue-100 text-blue-700" },
    confirmed: { label: "OK Ho Gaya", cls: "bg-green-100 text-green-700" },
    completed: { label: "Mukammal", cls: "bg-purple-100 text-purple-700" },
  };
  const s = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}

function Avatar({ name, color = "bg-primary/10 text-primary" }: { name: string; color?: string }) {
  return (
    <div className={`h-9 w-9 rounded-full ${color} flex items-center justify-center text-sm font-bold shrink-0`}>
      {(name || "?")[0].toUpperCase()}
    </div>
  );
}

function Stat({ label, value, color = "" }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-bold text-sm ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="text-center py-16">
      <Package className="h-14 w-14 mx-auto text-muted-foreground/30 mb-3" />
      <p className="text-muted-foreground font-medium">{msg}</p>
    </div>
  );
}

export default function Slips() {
  const [tab, setTab] = useState<Tab>("maal_dena");
  const { speak, speaking } = useTTS();

  const { data: sethSlips = [], isLoading: l1 } = useGetJobSlips({ role: "seth" } as any);
  const { data: karigarSlips = [], isLoading: l2 } = useGetJobSlips({ role: "karigar" } as any);
  const { data: returnKarigar = [], isLoading: l3 } = useGetReturnSlips({ role: "karigar" } as any);
  const { data: returnSeth = [], isLoading: l4 } = useGetReturnSlips({ role: "seth" } as any);

  const loading = l1 || l2 || l3 || l4;

  const renderJobSlips = (slips: any[], asRole: "seth" | "karigar") => {
    if (slips.length === 0) return <EmptyState msg="Koi slip nahi" />;
    const groups = new Map<string, { user: any; slips: any[] }>();
    for (const slip of slips) {
      const other = asRole === "seth" ? slip.karigar : slip.seth;
      const key = String(other?.id ?? "?");
      if (!groups.has(key)) groups.set(key, { user: other, slips: [] });
      groups.get(key)!.slips.push(slip);
    }
    return (
      <>
        {[...groups.values()].map(({ user, slips: groupSlips }) => (
          <div key={user?.id ?? "?"} className="mb-5">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Avatar name={user?.name || user?.code || user?.mobile || "?"} />
              <div>
                <p className="font-bold text-sm">{user?.name || user?.code || user?.mobile || "Unknown"}</p>
                <p className="text-xs text-muted-foreground">{groupSlips.length} slip</p>
              </div>
            </div>
            {groupSlips.map((slip: any) => {
              const balance = slip.balanceQty ?? 0;
              return (
                <Link key={slip.id} href={`/slips/job/${slip.id}`}>
                  <div className="bg-card border border-border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer mb-2 ml-11">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-mono text-muted-foreground">{slip.slipNumber}</span>
                      <StatusPill status={slip.status} />
                    </div>
                    <div className="flex gap-4 pt-2 border-t border-border">
                      <Stat label="Total" value={slip.totalQty ?? 0} />
                      <Stat label="Jama" value={(slip.jamaQty ?? 0) + (slip.damageQty ?? 0) + (slip.shortageQty ?? 0)} color="text-green-600" />
                      <Stat label="Baaki" value={balance} color={balance > 0 ? "text-amber-600" : "text-green-600"} />
                      <div className="ml-auto self-end text-xs text-muted-foreground flex items-center gap-0.5">
                        {format(new Date(slip.createdAt), "dd MMM")}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </>
    );
  };

  const renderReturnSlips = (slips: any[], asRole: "karigar" | "seth") => {
    if (slips.length === 0) return <EmptyState msg="Koi return slip nahi" />;
    const groups = new Map<string, { user: any; slips: any[] }>();
    for (const slip of slips) {
      const other = asRole === "karigar" ? slip.seth : slip.karigar;
      const key = String(other?.id ?? "?");
      if (!groups.has(key)) groups.set(key, { user: other, slips: [] });
      groups.get(key)!.slips.push(slip);
    }
    return (
      <>
        {[...groups.values()].map(({ user, slips: groupSlips }) => (
          <div key={user?.id ?? "?"} className="mb-5">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Avatar name={user?.name || user?.code || user?.mobile || "?"} color="bg-orange-100 text-orange-600" />
              <div>
                <p className="font-bold text-sm">{user?.name || user?.code || user?.mobile || "Unknown"}</p>
                <p className="text-xs text-muted-foreground">{groupSlips.length} return slip</p>
              </div>
            </div>
            {groupSlips.map((slip: any) => {
              const total = (slip.entries ?? []).reduce(
                (s: number, e: any) => s + (e.jamaQty || 0) + (e.damageQty || 0) + (e.shortageQty || 0),
                0
              );
              return (
                <Link key={slip.id} href={`/slips/return/${slip.id}`}>
                  <div className="bg-card border border-border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer mb-2 ml-11">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-mono text-muted-foreground">{slip.slipNumber}</span>
                      {slip.viewedAt ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Dekha</span>
                      ) : (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Pending</span>
                      )}
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-border">
                      <p className="text-sm font-bold">{total.toLocaleString()} pcs wapas</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-0.5">
                        {format(new Date(slip.createdAt), "dd MMM")}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </>
    );
  };

  return (
    <Layout>
      <div className="pb-28">
        {/* Header */}
        <header className="bg-primary text-primary-foreground px-6 pt-10 pb-6 rounded-b-3xl shadow-md">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">Maal ka Hisab</h1>
              <p className="text-primary-foreground/70 text-sm mt-1">Poora maal ka hisaab</p>
            </div>
            <button
              onClick={() => speak(TAB_VOICE[tab])}
              className={`mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                speaking
                  ? "bg-white/30 text-white animate-pulse"
                  : "bg-white/20 text-white hover:bg-white/30"
              }`}
              title="Sunao"
            >
              {speaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              {speaking ? "Rok do" : "Sunao"}
            </button>
          </div>
        </header>

        {/* Seth | Karigar selector — 2 columns, 2 rows each */}
        <div className="px-4 pt-4 pb-2">
          <div className="grid grid-cols-2 gap-3">

            {/* Seth column — main as Seth */}
            <div className="flex flex-col gap-2">
              <p className="text-center text-xs font-bold text-primary uppercase tracking-wider mb-1">
                Main — Seth 👔
              </p>
              {/* Maal Diya = main ne karigar ko diya (sethSlips) */}
              <button
                onClick={() => setTab("maal_dena")}
                className={`w-full py-3 rounded-2xl text-sm font-semibold transition-all ${
                  tab === "maal_dena"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                📤 Maal Diya
              </button>
              {/* Maal Wapis Aya = karigar ne wapis kiya mujhe (returnSeth) */}
              <button
                onClick={() => setTab("wapas_aya")}
                className={`w-full py-3 rounded-2xl text-sm font-semibold transition-all ${
                  tab === "wapas_aya"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                📥 Wapis Aya
              </button>
            </div>

            {/* Karigar column — main as Karigar */}
            <div className="flex flex-col gap-2">
              <p className="text-center text-xs font-bold text-orange-600 uppercase tracking-wider mb-1">
                Main — Karigar 👷
              </p>
              {/* Maal Aya = seth ne mujhe diya (karigarSlips) */}
              <button
                onClick={() => setTab("maal_aya")}
                className={`w-full py-3 rounded-2xl text-sm font-semibold transition-all ${
                  tab === "maal_aya"
                    ? "bg-orange-500 text-white shadow-md"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                📦 Maal Aya
              </button>
              {/* Maal Jama Kiya = main ne seth ko wapis kiya (returnKarigar) */}
              <button
                onClick={() => setTab("wapas_jama")}
                className={`w-full py-3 rounded-2xl text-sm font-semibold transition-all ${
                  tab === "wapas_jama"
                    ? "bg-orange-500 text-white shadow-md"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                🔄 Jama Kiya
              </button>
            </div>

          </div>
        </div>

        {/* Slip list */}
        <div className="px-4 pt-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl mb-3" />
            ))
          ) : (
            <>
              {tab === "maal_dena" && (
                <>
                  <div className="flex justify-end mb-3">
                    <Link href="/slips/new">
                      <Button size="sm" className="rounded-full gap-1.5 shadow">
                        <Plus className="h-4 w-4" /> Naya Slip
                      </Button>
                    </Link>
                  </div>
                  {renderJobSlips(sethSlips as any[], "seth")}
                </>
              )}
              {tab === "maal_aya" && renderJobSlips(karigarSlips as any[], "karigar")}
              {tab === "wapas_jama" && (
                <>
                  <div className="flex justify-end mb-3">
                    <Link href="/slips/return/new">
                      <Button size="sm" className="rounded-full gap-1.5 shadow bg-orange-500 hover:bg-orange-600">
                        <RotateCcw className="h-4 w-4" /> Wapas Bhejo
                      </Button>
                    </Link>
                  </div>
                  {renderReturnSlips(returnKarigar as any[], "karigar")}
                </>
              )}
              {tab === "wapas_aya" && (
                <>
                  <div className="flex justify-end mb-3">
                    <Link href="/slips/return/new?mode=offline">
                      <Button size="sm" variant="outline" className="rounded-full gap-1.5 shadow border-orange-300 text-orange-700 hover:bg-orange-50">
                        <RotateCcw className="h-4 w-4" /> Offline Karigar ki Wapasi
                      </Button>
                    </Link>
                  </div>
                  {renderReturnSlips(returnSeth as any[], "seth")}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

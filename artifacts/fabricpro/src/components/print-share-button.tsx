import { useState, useRef, useEffect } from "react";
import { Printer, Share2, Loader2 } from "lucide-react";
import { sharePdf } from "@/lib/print-utils";

interface PrintShareButtonProps {
  generatePdf: () => Uint8Array;
  filename: string;
  buttonClass?: string;
}

export function PrintShareButton({ generatePdf, filename, buttonClass = "p-2 rounded-full bg-white/15 hover:bg-white/25 transition-colors" }: PrintShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handlePrint() {
    setLoading(true);
    setOpen(false);
    try {
      const bytes = generatePdf();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) {
        // fallback: download
        const a = document.createElement("a");
        a.href = url; a.download = filename; a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleShare() {
    setLoading(true);
    setOpen(false);
    try {
      const bytes = generatePdf();
      await sharePdf(bytes, filename);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={buttonClass}
        title="Print / Share PDF"
        disabled={loading}
      >
        {loading
          ? <Loader2 className="h-5 w-5 animate-spin" />
          : <Printer className="h-5 w-5" />
        }
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-background border border-border rounded-2xl shadow-xl overflow-hidden w-48">
          <button
            onClick={handlePrint}
            className="flex items-center gap-3 w-full px-4 py-3.5 text-sm font-medium hover:bg-muted transition-colors text-left"
          >
            <Printer className="h-4 w-4 text-muted-foreground shrink-0" />
            Print karo
          </button>
          <div className="h-px bg-border" />
          <button
            onClick={handleShare}
            className="flex items-center gap-3 w-full px-4 py-3.5 text-sm font-medium hover:bg-muted transition-colors text-left"
          >
            <Share2 className="h-4 w-4 text-primary shrink-0" />
            PDF Share karo
          </button>
        </div>
      )}
    </div>
  );
}

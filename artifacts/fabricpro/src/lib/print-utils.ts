import { jsPDF } from "jspdf";

const BRAND = "FabricPro";
const TAGLINE = "Job Work & Payment Register";
const ORANGE = "#ea580c";

/* ── shared PDF helpers ── */
function newDoc(title: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  // header bar
  doc.setFillColor(ORANGE);
  doc.rect(0, 0, W, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor("#ffffff");
  doc.text(BRAND, 8, 12);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text(TAGLINE, 8, 16.5);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(title, W - 8, 12, { align: "right" });

  doc.setTextColor("#000000");
  return { doc, y: 24, W };
}

function sectionTitle(doc: jsPDF, label: string, y: number, W: number): number {
  doc.setFillColor("#f3f4f6");
  doc.rect(8, y, W - 16, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor("#6b7280");
  doc.text(label.toUpperCase(), 11, y + 4.2);
  doc.setTextColor("#000000");
  return y + 9;
}

function row(doc: jsPDF, label: string, value: string, y: number, W: number, bold = false): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor("#6b7280");
  doc.text(label, 11, y);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setTextColor("#111827");
  doc.text(value, W - 11, y, { align: "right" });
  doc.setTextColor("#000000");
  return y + 6;
}

function divider(doc: jsPDF, y: number, W: number): number {
  doc.setDrawColor("#e5e7eb");
  doc.line(8, y, W - 8, y);
  return y + 3;
}

function footer(doc: jsPDF) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor("#9ca3af");
  doc.text(`© ${new Date().getFullYear()} ${BRAND} · All Rights Reserved`, 8, H - 8);
  doc.text(`Printed: ${new Date().toLocaleString("en-IN")}`, W - 8, H - 8, { align: "right" });
}

/* ─────────────────────────────────────────
   1. Job Slip PDF
───────────────────────────────────────── */
export function generateJobSlipPdf(slip: any): Uint8Array {
  const s = slip as any;
  const items: any[] = s.items ?? [];
  const statusMap: Record<string, string> = {
    draft: "Draft", sent: "Bheja Gaya", viewed: "Dekha Gaya",
    confirmed: "Maal Mila ✓", completed: "Mukammal",
  };

  const { doc, W } = newDoc("Maal Slip");
  let y = 24;

  // slip number + date
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(ORANGE);
  doc.text(s.slipNumber ?? "—", 11, y + 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor("#6b7280");
  const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  doc.text(dateStr, W - 11, y + 2, { align: "right" });
  doc.setFontSize(8.5);
  doc.text(`Status: ${statusMap[s.status] ?? s.status}`, 11, y + 7);
  doc.setTextColor("#000000");
  y += 13;

  y = sectionTitle(doc, "Parties", y, W);
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor("#111827");
  doc.text("Seth (Dene Wala)", 11, y);
  doc.setFont("helvetica", "normal");
  doc.text(s.seth?.name || s.seth?.code || "—", W - 11, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "bold").text("Karigar (Lene Wala)", 11, y);
  doc.setFont("helvetica", "normal");
  doc.text(s.karigar?.name || s.karigar?.code || "—", W - 11, y, { align: "right" });
  doc.setTextColor("#000000");
  y += 10;

  y = sectionTitle(doc, "Maal ki List", y, W);

  // table header
  doc.setFillColor("#1f2937");
  doc.rect(8, y, W - 16, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor("#ffffff");
  const cols = [12, 75, 110, 135, 160];
  doc.text("Item", cols[0], y + 4.8);
  doc.text("Qty", cols[1], y + 4.8, { align: "right" });
  doc.text("Rate/pc", cols[2], y + 4.8, { align: "right" });
  doc.text("Jama", cols[3], y + 4.8, { align: "right" });
  doc.text("Baaki", cols[4], y + 4.8, { align: "right" });
  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setTextColor("#111827");
  let even = false;
  for (const item of items) {
    const bal = (item.totalQty ?? 0) - ((item.jamaQty ?? 0) + (item.damageQty ?? 0));
    if (even) { doc.setFillColor("#f9fafb"); doc.rect(8, y - 1, W - 16, 7, "F"); }
    even = !even;
    doc.setFontSize(8.5);
    doc.text(item.itemName ?? "—", cols[0], y + 4);
    doc.text(String((item.totalQty ?? 0).toLocaleString()), cols[1], y + 4, { align: "right" });
    doc.text(item.ratePerPc ? `Rs.${parseFloat(item.ratePerPc).toFixed(2)}` : "—", cols[2], y + 4, { align: "right" });
    doc.text(String(((item.jamaQty ?? 0) + (item.damageQty ?? 0)).toLocaleString()), cols[3], y + 4, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setTextColor(bal > 0 ? "#c2410c" : "#15803d");
    doc.text(String(bal.toLocaleString()), cols[4], y + 4, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setTextColor("#111827");
    y += 7;
  }
  y += 4;

  const totalQty = items.reduce((s: number, i: any) => s + (i.totalQty ?? 0), 0);
  const jamaQty = items.reduce((s: number, i: any) => s + ((i.jamaQty ?? 0) + (i.damageQty ?? 0)), 0);
  const balanceQty = totalQty - jamaQty;

  y = drawSummaryBoxes(doc, y, W, [
    { label: "Total Diya", value: String(totalQty.toLocaleString()), color: "#374151" },
    { label: "Jama Hua", value: String(jamaQty.toLocaleString()), color: "#15803d" },
    { label: "Baaki", value: String(balanceQty.toLocaleString()), color: "#c2410c" },
  ]);

  if (s.notes) {
    y += 4;
    y = sectionTitle(doc, "Notes", y, W);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor("#374151");
    doc.text(s.notes, 11, y);
    y += 6;
  }

  footer(doc);
  return doc.output("arraybuffer") as unknown as Uint8Array;
}

/* ─────────────────────────────────────────
   2. Return Slip PDF
───────────────────────────────────────── */
export function generateReturnSlipPdf(slip: any): Uint8Array {
  const s = slip as any;
  const entries: any[] = s.entries ?? [];

  const { doc, W } = newDoc("Maal Wapas Slip");
  let y = 24;

  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(ORANGE);
  doc.text(s.slipNumber ?? "—", 11, y + 2);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor("#6b7280");
  const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  doc.text(dateStr, W - 11, y + 2, { align: "right" });
  doc.setTextColor("#000000");
  y += 12;

  y = sectionTitle(doc, "Parties", y, W);
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor("#111827");
  doc.text("Karigar (Bhejne Wala)", 11, y);
  doc.setFont("helvetica", "normal");
  doc.text(s.karigar?.name || s.karigar?.code || "—", W - 11, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "bold").text("Seth (Lene Wala)", 11, y);
  doc.setFont("helvetica", "normal");
  doc.text(s.seth?.name || s.seth?.code || "—", W - 11, y, { align: "right" });
  doc.setTextColor("#000000");
  y += 10;

  y = sectionTitle(doc, "Slip-wise Hisaab", y, W);

  // table header
  doc.setFillColor("#1f2937");
  doc.rect(8, y, W - 16, 7, "F");
  doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor("#ffffff");
  doc.text("Job Slip", 12, y + 4.8);
  doc.text("Jama", 120, y + 4.8, { align: "right" });
  doc.text("Damage", 145, y + 4.8, { align: "right" });
  doc.text("Shortage", 170, y + 4.8, { align: "right" });
  doc.text("Deduction", W - 11, y + 4.8, { align: "right" });
  y += 9;

  let even = false;
  let totalJama = 0, totalDamage = 0, totalShortage = 0, totalShortageAmt = 0;
  for (const e of entries) {
    const sAmt = (e.shortageQty || 0) * (e.ratePerPc || 0);
    totalJama += e.jamaQty || 0;
    totalDamage += e.damageQty || 0;
    totalShortage += e.shortageQty || 0;
    totalShortageAmt += sAmt;
    if (even) { doc.setFillColor("#f9fafb"); doc.rect(8, y - 1, W - 16, 7, "F"); }
    even = !even;
    doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor("#c2410c");
    doc.text(e.jobSlip?.slipNumber ?? `#${e.jobSlipId}`, 12, y + 4);
    doc.setFont("helvetica", "normal").setTextColor("#15803d");
    doc.text(String((e.jamaQty || 0).toLocaleString()), 120, y + 4, { align: "right" });
    doc.setTextColor("#c2410c");
    doc.text(String((e.damageQty || 0).toLocaleString()), 145, y + 4, { align: "right" });
    doc.setTextColor("#dc2626");
    doc.text(String((e.shortageQty || 0).toLocaleString()), 170, y + 4, { align: "right" });
    doc.text(sAmt > 0 ? `Rs.${sAmt.toLocaleString()}` : "—", W - 11, y + 4, { align: "right" });
    doc.setTextColor("#000000");
    y += 7;
  }
  y += 4;

  y = drawSummaryBoxes(doc, y, W, [
    { label: "Jama", value: String(totalJama.toLocaleString()), color: "#15803d" },
    { label: "Damage", value: String(totalDamage.toLocaleString()), color: "#c2410c" },
    { label: "Shortage", value: String(totalShortage.toLocaleString()), color: "#dc2626" },
  ]);

  if (totalShortageAmt > 0) {
    y += 4;
    doc.setFillColor("#fef2f2");
    doc.rect(8, y, W - 16, 10, "F");
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor("#dc2626");
    doc.text("Shortage Deduction (Payment se minus hoga):", 11, y + 6.5);
    doc.text(`Rs.${totalShortageAmt.toLocaleString()}`, W - 11, y + 6.5, { align: "right" });
    doc.setTextColor("#000000");
    y += 14;
  }

  if (s.notes) {
    y = sectionTitle(doc, "Notes", y, W);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor("#374151");
    doc.text(s.notes, 11, y); y += 6;
  }

  footer(doc);
  return doc.output("arraybuffer") as unknown as Uint8Array;
}

/* ─────────────────────────────────────────
   3. Payment PDF
───────────────────────────────────────── */
export function generatePaymentPdf(payment: any): Uint8Array {
  const p = payment as any;
  const isOutgoing = p._isOutgoing;

  const { doc, W } = newDoc("Payment Receipt");
  let y = 24;

  const amt = Number(p.amount);
  doc.setFont("helvetica", "bold").setFontSize(20).setTextColor(isOutgoing ? "#dc2626" : "#15803d");
  doc.text(`Rs. ${amt.toLocaleString("en-IN")}`, W / 2, y + 4, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor("#6b7280");
  doc.text(isOutgoing ? "Diya Gaya" : "Mila", W / 2, y + 10, { align: "center" });
  const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  doc.text(dateStr, W / 2, y + 15, { align: "center" });
  doc.setTextColor("#000000");
  y += 22;

  y = divider(doc, y, W);
  y = sectionTitle(doc, "Parties", y, W);
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor("#111827");
  doc.text("Dene Wala (From)", 11, y);
  doc.setFont("helvetica", "normal");
  doc.text(p.fromUser?.name || p.fromUser?.code || "—", W - 11, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "bold").text("Lene Wala (To)", 11, y);
  doc.setFont("helvetica", "normal");
  doc.text(p.toUser?.name || p.toUser?.code || "—", W - 11, y, { align: "right" });
  doc.setTextColor("#000000");
  y += 10;

  if (p.jobSlip) {
    y = sectionTitle(doc, "Job Slip Reference", y, W);
    y = row(doc, "Slip Number", p.jobSlip.slipNumber, y, W, true);
    y += 4;
  }

  if (p.note) {
    y = sectionTitle(doc, "Note", y, W);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor("#374151");
    doc.text(p.note, 11, y); y += 8;
  }

  footer(doc);
  return doc.output("arraybuffer") as unknown as Uint8Array;
}

/* ─────────────────────────────────────────
   4. Statement PDF
───────────────────────────────────────── */
export function generateStatementPdf(stmt: any, connName: string, dateRange: string): Uint8Array {
  const isSeth: boolean = stmt.isSeth ?? false;
  const rawGayaQty: number = stmt.maalGaya?.totalQty ?? 0;
  const rawAyaQty: number = stmt.maalAya?.totalJamaQty ?? 0;
  const displayGayaQty = isSeth ? rawGayaQty : rawAyaQty;
  const displayAyaQty = isSeth ? rawAyaQty : rawGayaQty;
  const pendingAtKarigar: number = stmt.pendingAtKarigar ?? 0;
  const balanceDue: number = stmt.balanceDue ?? 0;
  const totalPaid: number = stmt.totalPaid ?? 0;

  const jobSlips: any[] = stmt.maalGaya?.slips ?? [];
  const returnSlips: any[] = stmt.maalAya?.returnSlips ?? [];
  const payments: any[] = stmt.payments ?? [];

  const { doc, W } = newDoc(`Statement — ${connName}`);
  let y = 24;

  // parties
  y = sectionTitle(doc, "Parties & Period", y, W);
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor("#111827");
  doc.text("Seth", 11, y);
  doc.setFont("helvetica", "normal");
  doc.text(stmt.seth?.name || stmt.seth?.code || "—", W - 11, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "bold").text("Karigar", 11, y);
  doc.setFont("helvetica", "normal");
  doc.text(stmt.karigar?.name || stmt.karigar?.code || "—", W - 11, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "bold").text("Period", 11, y);
  doc.setFont("helvetica", "normal");
  doc.text(dateRange, W - 11, y, { align: "right" });
  doc.setTextColor("#000000");
  y += 10;

  // summary boxes
  y = drawSummaryBoxes(doc, y, W, [
    { label: isSeth ? "Maal Gaya" : "Maal Liya", value: displayGayaQty.toLocaleString(), color: "#374151" },
    { label: isSeth ? "Maal Aaya" : "Maal Diya", value: displayAyaQty.toLocaleString(), color: "#15803d" },
    { label: "Karigar Ke Paas", value: pendingAtKarigar.toLocaleString(), color: "#c2410c" },
  ]);
  y += 4;
  y = drawSummaryBoxes(doc, y, W, [
    { label: "Total Paid", value: `Rs.${totalPaid.toLocaleString()}`, color: "#1d4ed8" },
    { label: "Balance Due", value: `Rs.${Math.abs(balanceDue).toLocaleString()}`, color: balanceDue > 0 ? "#dc2626" : "#15803d" },
    { label: "Total Slips", value: String(jobSlips.length + returnSlips.length), color: "#374151" },
  ]);
  y += 6;

  // job slips
  if (jobSlips.length > 0) {
    y = sectionTitle(doc, isSeth ? "Maal Gaya (Job Slips)" : "Maal Liya (Job Slips)", y, W);
    doc.setFillColor("#1f2937");
    doc.rect(8, y, W - 16, 7, "F");
    doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor("#ffffff");
    doc.text("Slip", 12, y + 4.8);
    doc.text("Date", 90, y + 4.8, { align: "right" });
    doc.text("Qty", 120, y + 4.8, { align: "right" });
    doc.text("Jama", 150, y + 4.8, { align: "right" });
    doc.text("Baaki", W - 11, y + 4.8, { align: "right" });
    y += 9;
    let even = false;
    for (const js of jobSlips) {
      if (even) { doc.setFillColor("#f9fafb"); doc.rect(8, y - 1, W - 16, 7, "F"); }
      even = !even;
      doc.setFont("helvetica", "bold").setFontSize(8).setTextColor("#c2410c");
      doc.text(js.slipNumber, 12, y + 4);
      doc.setFont("helvetica", "normal").setTextColor("#6b7280");
      doc.text(js.createdAt ? new Date(js.createdAt).toLocaleDateString("en-IN") : "", 90, y + 4, { align: "right" });
      doc.setTextColor("#111827");
      doc.text(String((js.totalQty ?? 0).toLocaleString()), 120, y + 4, { align: "right" });
      doc.setTextColor("#15803d");
      doc.text(String((js.jamaQty ?? 0).toLocaleString()), 150, y + 4, { align: "right" });
      const bal = js.balanceQty ?? 0;
      doc.setFont("helvetica", "bold").setTextColor(bal > 0 ? "#c2410c" : "#15803d");
      doc.text(String(bal.toLocaleString()), W - 11, y + 4, { align: "right" });
      doc.setTextColor("#000000");
      y += 7;
      if (y > 260) { doc.addPage(); y = 20; }
    }
    y += 4;
  }

  // return slips
  if (returnSlips.length > 0) {
    if (y > 230) { doc.addPage(); y = 20; }
    y = sectionTitle(doc, isSeth ? "Maal Aaya (Return Slips)" : "Maal Diya (Return Slips)", y, W);
    doc.setFillColor("#1f2937");
    doc.rect(8, y, W - 16, 7, "F");
    doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor("#ffffff");
    doc.text("Slip", 12, y + 4.8);
    doc.text("Date", 90, y + 4.8, { align: "right" });
    doc.text("Jama", 120, y + 4.8, { align: "right" });
    doc.text("Damage", 150, y + 4.8, { align: "right" });
    doc.text("Shortage", W - 11, y + 4.8, { align: "right" });
    y += 9;
    let even = false;
    for (const rs of returnSlips) {
      if (even) { doc.setFillColor("#f9fafb"); doc.rect(8, y - 1, W - 16, 7, "F"); }
      even = !even;
      doc.setFont("helvetica", "bold").setFontSize(8).setTextColor("#c2410c");
      doc.text(rs.slipNumber, 12, y + 4);
      doc.setFont("helvetica", "normal").setTextColor("#6b7280");
      doc.text(rs.createdAt ? new Date(rs.createdAt).toLocaleDateString("en-IN") : "", 90, y + 4, { align: "right" });
      doc.setTextColor("#15803d");
      doc.text(String((rs.totalJamaQty ?? 0).toLocaleString()), 120, y + 4, { align: "right" });
      doc.setTextColor("#c2410c");
      doc.text(String((rs.totalDamageQty ?? 0).toLocaleString()), 150, y + 4, { align: "right" });
      doc.setTextColor("#dc2626");
      doc.text(String((rs.totalShortageQty ?? 0).toLocaleString()), W - 11, y + 4, { align: "right" });
      doc.setTextColor("#000000");
      y += 7;
      if (y > 260) { doc.addPage(); y = 20; }
    }
    y += 4;
  }

  // payments
  if (payments.length > 0) {
    if (y > 220) { doc.addPage(); y = 20; }
    y = sectionTitle(doc, "Payments", y, W);
    doc.setFillColor("#1f2937");
    doc.rect(8, y, W - 16, 7, "F");
    doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor("#ffffff");
    doc.text("ID", 12, y + 4.8);
    doc.text("Date", 90, y + 4.8, { align: "right" });
    doc.text("Note", 140, y + 4.8, { align: "right" });
    doc.text("Amount", W - 11, y + 4.8, { align: "right" });
    y += 9;
    let even = false;
    for (const p of payments) {
      if (even) { doc.setFillColor("#f9fafb"); doc.rect(8, y - 1, W - 16, 7, "F"); }
      even = !even;
      doc.setFont("helvetica", "bold").setFontSize(8).setTextColor("#374151");
      doc.text(p.paymentId ?? `#${p.id}`, 12, y + 4);
      doc.setFont("helvetica", "normal").setTextColor("#6b7280");
      doc.text(p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN") : "", 90, y + 4, { align: "right" });
      const note = (p.note ?? "—").substring(0, 18);
      doc.text(note, 140, y + 4, { align: "right" });
      doc.setFont("helvetica", "bold").setTextColor("#15803d");
      doc.text(`Rs.${Number(p.amount).toLocaleString()}`, W - 11, y + 4, { align: "right" });
      doc.setTextColor("#000000");
      y += 7;
      if (y > 260) { doc.addPage(); y = 20; }
    }
    y += 4;
  }

  // balance footer box
  if (y > 240) { doc.addPage(); y = 20; }
  if (balanceDue !== 0) {
    doc.setFillColor(balanceDue > 0 ? "#fef2f2" : "#f0fdf4");
    doc.rect(8, y, W - 16, 12, "F");
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(balanceDue > 0 ? "#dc2626" : "#15803d");
    doc.text(balanceDue > 0 ? "Karigar Ko Dena Baaki:" : "Advance Diya Hai:", 11, y + 8);
    doc.text(`Rs.${Math.abs(balanceDue).toLocaleString("en-IN")}`, W - 11, y + 8, { align: "right" });
    doc.setTextColor("#000000");
  } else {
    doc.setFillColor("#f0fdf4");
    doc.rect(8, y, W - 16, 12, "F");
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor("#15803d");
    doc.text("✓ Poora Hisab Saaf — Koi Balance Nahi", W / 2, y + 8, { align: "center" });
    doc.setTextColor("#000000");
  }

  footer(doc);
  return doc.output("arraybuffer") as unknown as Uint8Array;
}

/* ── helper: 3-column stat boxes ── */
function drawSummaryBoxes(doc: jsPDF, y: number, W: number, boxes: { label: string; value: string; color: string }[]): number {
  const bw = (W - 16 - 8) / 3;
  boxes.forEach(({ label, value, color }, i) => {
    const x = 8 + i * (bw + 4);
    doc.setFillColor("#f9fafb");
    doc.rect(x, y, bw, 16, "F");
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor("#6b7280");
    doc.text(label, x + bw / 2, y + 5.5, { align: "center" });
    doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(color);
    doc.text(value, x + bw / 2, y + 13, { align: "center" });
    doc.setTextColor("#000000");
  });
  return y + 20;
}

/* ── share PDF via Web Share API, fallback to download ── */
export async function sharePdf(bytes: Uint8Array, filename: string): Promise<void> {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const file = new File([blob], filename, { type: "application/pdf" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename.replace(".pdf", ""), text: `${BRAND} — ${filename.replace(".pdf", "")}` });
      return;
    } catch (err: any) {
      if (err.name === "AbortError") return;
    }
  }

  // fallback: download
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/* ── print via popup window ── */
export function printHtmlPopup(title: string, htmlBody: string): void {
  const html = buildHtml(title, htmlBody);
  const win = window.open("", "_blank", "width=750,height=900");
  if (!win) { alert("Popup block hai — browser settings mein allow karo."); return; }
  win.document.write(html);
  win.document.close();
}

function buildHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="hi"><head><meta charset="UTF-8"/>
  <title>${title} — ${BRAND}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a1a1a;background:#fff;padding:20px;max-width:700px;margin:auto}
    .bh{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #ea580c;padding-bottom:10px;margin-bottom:16px}
    .bn{font-size:22px;font-weight:900;color:#ea580c}
    .bt{font-size:10px;color:#888;margin-top:2px}
    .st{font-size:15px;font-weight:700;text-align:right}
    .sec{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:12px}
    .sl{font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;margin-top:4px}
    th{background:#f3f4f6;font-size:11px;font-weight:700;padding:7px 8px;text-align:left;color:#374151}
    td{padding:7px 8px;border-top:1px solid #f3f4f6;font-size:12px}
    .num{text-align:right;font-variant-numeric:tabular-nums}
    .footer{margin-top:20px;border-top:1px dashed #d1d5db;padding-top:10px;display:flex;justify-content:space-between}
    .footer span{font-size:10px;color:#999}
    @media print{button,.no-print{display:none!important}@page{margin:15mm}}
  </style></head><body>
  <div class="bh"><div><div class="bn">${BRAND}</div><div class="bt">${TAGLINE}</div></div><div class="st">${title}</div></div>
  ${body}
  <div class="footer"><span>© ${new Date().getFullYear()} ${BRAND} · All Rights Reserved</span><span>Printed: ${new Date().toLocaleString("en-IN")}</span></div>
  <script>window.onload=function(){setTimeout(()=>window.print(),300)}<\/script>
  </body></html>`;
}

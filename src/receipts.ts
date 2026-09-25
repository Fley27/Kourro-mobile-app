import { fmtG, fmt } from "./format";

export type ReceiptCopyType = "customer" | "store";

export interface ReceiptItem {
  name: string;
  variant?: string | null;
  unitName?: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ReceiptCustomer {
  name: string;
  idCard?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ReceiptData {
  id: string;
  kind: "sale" | "credit_payment";
  copyType: ReceiptCopyType;
  receiptNumber: string;
  saleNumber: string;
  saleId: string;
  storeName: string;
  createdAt: string;
  cashier: { id: string | null; name: string; role: string };
  customer: ReceiptCustomer | null;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  amountPaid: number;
  amountDue: number;
  change: number;
  dueDate: string | null;
  customerId?: string | null;
  debtId?: string | null;
  debtTotal?: number | null;
  previousBalance?: number | null;
}

export const PAYMENT_LABELS: Record<string, string> = {
  cash: "Kach",
  moncash: "MonCash (Digicel)",
  natcash: "NatCash (Natcom)",
  credit: "Kredi",
  mobile_money: "Lajan mobil",
};

export function copyLabel(copy: ReceiptCopyType): string {
  return copy === "customer" ? "COPIE CLIENT" : "COPIE MAGASIN";
}

export function fmtDateTime(iso: string | null | undefined): string {
  const d = new Date(iso ?? "");
  if (isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function buildReceipts(input: {
  saleId: string;
  saleNumber: string;
  storeName: string;
  createdAt: string;
  cashier: { id: string | null; name: string; role: string };
  customer: ReceiptCustomer | null;
  customerId?: string | null;
  items: ReceiptItem[];
  subtotal: number;
  discount?: number;
  total: number;
  paymentMethod: string;
  amountPaid: number;
  amountDue: number;
  change: number;
  dueDate?: string | null;
}): { customer: ReceiptData; store: ReceiptData } {
  const base = {
    kind: "sale" as const,
    saleId: input.saleId,
    saleNumber: input.saleNumber,
    storeName: input.storeName,
    createdAt: input.createdAt,
    cashier: input.cashier,
    customer: input.customer,
    customerId: input.customerId ?? null,
    items: input.items,
    subtotal: input.subtotal,
    discount: input.discount ?? 0,
    total: input.total,
    paymentMethod: input.paymentMethod,
    amountPaid: input.amountPaid,
    amountDue: input.amountDue,
    change: input.change,
    dueDate: input.dueDate ?? null,
  };
  return {
    customer: { ...base, id: `rec-${input.saleId}-customer`, copyType: "customer" as const, receiptNumber: `REC-${input.saleNumber}` },
    store: { ...base, id: `rec-${input.saleId}-store`, copyType: "store" as const, receiptNumber: `REC-${input.saleNumber}-M` },
  };
}

export function buildCreditPaymentReceipts(input: {
  payId: string;
  receiptNumber: string;
  debtId: string;
  storeName: string;
  createdAt: string;
  cashier: { id: string | null; name: string; role: string };
  customer: ReceiptCustomer | null;
  debtTotal: number;
  previousBalance: number;
  amount: number;
  finalBalance: number;
  paymentMethod: string;
  change?: number;
  dueDate?: string | null;
}): { customer: ReceiptData; store: ReceiptData } {
  const base = {
    kind: "credit_payment" as const,
    saleId: input.payId,
    saleNumber: input.debtId,
    debtId: input.debtId,
    debtTotal: input.debtTotal,
    previousBalance: input.previousBalance,
    storeName: input.storeName,
    createdAt: input.createdAt,
    cashier: input.cashier,
    customer: input.customer,
    items: [],
    subtotal: input.amount,
    discount: 0,
    total: input.amount,
    paymentMethod: input.paymentMethod,
    amountPaid: input.amount,
    amountDue: input.finalBalance,
    change: input.change ?? 0,
    dueDate: input.dueDate ?? null,
  };
  return {
    customer: { ...base, id: `rec-${input.payId}-customer`, copyType: "customer" as const, receiptNumber: input.receiptNumber },
    store: { ...base, id: `rec-${input.payId}-store`, copyType: "store" as const, receiptNumber: `${input.receiptNumber}-M` },
  };
}

export function receiptToText(r: ReceiptData): string {
  const L: string[] = [];
  const push = (s = "") => { L.push(s); };
  const rule = "------------------------------------";
  const money = (n: number) => `${fmtG(n)}`;
  const isPayment = r.kind === "credit_payment";
  push("     JESYON MAGAZEN");
  push(isPayment ? "   RESI PEMAN DÈT" : "         RESI");
  push(rule);
  push(copyLabel(r.copyType));
  push(`N° ${r.receiptNumber}`);
  push(`${isPayment ? "Dèt:" : "Vant:"} ${r.saleNumber}`);
  push(`Dat: ${fmtDateTime(r.createdAt)}`);
  push(rule);
  push(`Kesye: ${r.cashier.name}`);
  push(`Wòl: ${r.cashier.role}`);
  if (r.customer) {
    push(`Kliyan: ${r.customer.name}`);
    if (r.customer.idCard) push(`ID: ${r.customer.idCard}`);
    if (r.customer.phone) push(`Tel: ${r.customer.phone}`);
  }
  push(rule);
  if (isPayment) {
    if (r.debtTotal !== undefined && r.debtTotal !== null) push(`Dèt total: ${money(r.debtTotal)}`);
    if (r.previousBalance !== undefined && r.previousBalance !== null) push(`Balans anvan: ${money(r.previousBalance)}`);
    push(`Peman sa a: ${money(r.amountPaid)}`);
    push(`Nouvo balans: ${money(r.amountDue)}`);
  } else {
    for (const it of r.items) {
      push(`${it.qty} × ${it.name}${it.variant ? ` · ${it.variant}` : ""}${it.unitName ? ` (${it.unitName})` : ""}`);
      push(`  ${fmtG(it.unitPrice)} × ${it.qty} = ${money(it.lineTotal)}`);
    }
    push(rule);
    push(`Sou-total: ${money(r.subtotal)}`);
    if (r.discount > 0) push(`Escompte: − ${money(r.discount)}`);
    push(`TOTAL A PEYE: ${money(r.total)}`);
  }
  push(rule);
  push(`Peman: ${PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod}`);
  if (isPayment) {
    if (r.change > 0) push(`Monnen: ${money(r.change)}`);
  } else if (r.paymentMethod === "credit") {
    push(`Akompte / Peze: ${money(r.amountPaid)}`);
    push(`Rès dèt: ${money(r.amountDue)}`);
    if (r.dueDate) push(`Echèans: ${new Date(r.dueDate + "T00:00:00").toLocaleDateString()}`);
  } else {
    push(`Montan peye: ${money(r.amountPaid)}`);
    if (r.change > 0) push(`Monnen: ${money(r.change)}`);
  }
  push(rule);
  push(isPayment ? "Mèsi pou peyi dèt la!" : "Mèsi pou acha w!");
  push(r.storeName);
  push(`Jesyon Magazen · ${fmtDateTime(r.createdAt)}`);
  return L.join("\n");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildReceiptHtml(r: ReceiptData): string {
  const money = (n: number) => `${fmtG(n)}`;
  const spacedRule = '<div class="rule"></div>';
  const row = (label: string, value: string, strong = false, tint = "") =>
    `<div class="row"><span>${esc(label)}</span><span class="${strong ? "strong" : ""}" ${tint ? `style="color:${tint}"` : ""}>${value}</span></div>`;
  const payLabel = PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod;
  const isPayment = r.kind === "credit_payment";
  let paymentBlock: string;
  if (isPayment) {
    paymentBlock =
      row("Peman", esc(payLabel)) +
      (r.change > 0 ? row("Monnen", money(r.change), false, "#0A7C3E") : "");
  } else if (r.paymentMethod === "credit") {
    paymentBlock =
      row("Peman", esc(payLabel)) +
      row("Akompte / Peze", money(r.amountPaid)) +
      row("Rès dèt", money(r.amountDue), true, "#B00020") +
      (r.dueDate ? row("Echèans", new Date(r.dueDate + "T00:00:00").toLocaleDateString()) : "");
  } else {
    paymentBlock =
      row("Peman", esc(payLabel)) +
      row("Montan peye", money(r.amountPaid)) +
      (r.change > 0 ? row("Monnen", money(r.change), false, "#0A7C3E") : "");
  }
  const items = isPayment
    ? row("Dèt total", money(r.debtTotal ?? 0)) +
      row("Balans anvan", money(r.previousBalance ?? 0), true) +
      row("Peman sa a", money(r.amountPaid), true) +
      row("Nouvo balans", money(r.amountDue), true, "#0A7C3E")
    : r.items
      .map(
        it =>
          `<div class="item"><div class="item-top"><span class="qty">${it.qty} x</span><span class="name">${esc(it.name)}${it.variant ? ` · ${esc(it.variant)}` : ""}</span><span class="line">${money(it.lineTotal)}</span></div><div class="item-sub">${money(it.unitPrice)} / ${esc(it.unitName ?? "inite")}</div></div>`
      )
      .join("");
  return `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  @page { margin: 12mm 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1c1917; padding: 8px 6px; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; background: #E7F0FF; border: 1px solid #A7C8F5; font-size: 10px; letter-spacing: 1px; color: #1D4ED8; font-weight: 800; }
  .center { text-align: center; }
  .head { text-align: center; margin-bottom: 4px; }
  .head h1 { font-size: 20px; letter-spacing: 2px; }
  .head .store { font-size: 11px; color: #78716c; margin-top: 2px; font-weight: 600; }
  .head .label { font-size: 26px; letter-spacing: 8px; margin-top: 6px; font-weight: 900; }
  .row { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; padding: 2px 0; }
  .row span.strong, span.strong { font-weight: 800; }
  .meta { margin: 8px 0; }
  .rule { border-top: 1px dashed #a8a29e; margin: 8px 0; }
  .items { margin: 4px 0; }
  .item { margin-bottom: 8px; }
  .item-top { display: flex; gap: 8px; align-items: flex-start; }
  .item-top .qty { width: 56px; font-family: 'Inter', system-ui, sans-serif; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; font-size: 11px; font-weight: 700; color: #78716c; }
  .item-top .name { flex: 1; font-size: 12px; font-weight: 600; }
  .item-top .line { font-family: 'Inter', system-ui, sans-serif; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; font-size: 12px; font-weight: 800; }
  .item-sub { margin-left: 64px; font-size: 10px; color: #a8a29e; }
  .total-band { display: flex; justify-content: space-between; align-items: center; background: #1c1917; color: #fff; border-radius: 8px; padding: 8px 12px; margin-top: 4px; font-size: 13px; font-weight: 900; }
  .total-band .amount { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
  .foot { text-align: center; margin-top: 12px; }
  .foot .thanks { font-size: 13px; font-weight: 800; }
  .foot .small { font-size: 9px; color: #a8a29e; margin-top: 3px; }
</style></head>
<body>
  <div class="head">
    <h1>JESYON MAGAZEN</h1>
    <div class="store">${esc(r.storeName)}</div>
    <div class="label">${isPayment ? "RESI PEMAN DÈT" : "RESI"}</div>
  </div>
  ${spacedRule}
  <div style="display:flex;justify-content:space-between;align-items:center">
    <span class="badge">${esc(copyLabel(r.copyType))}</span>
    <span style="font-size:11px;font-weight:700;color:#78716c">N° ${esc(r.receiptNumber)}</span>
  </div>
  <div class="meta">
    ${row(isPayment ? "Dèt" : "Vant", esc(r.saleNumber), true)}
    ${row("Dat", esc(fmtDateTime(r.createdAt)))}
    ${row("Kesye", `${esc(r.cashier.name)} · ${esc(r.cashier.role)}`, true)}
    ${r.customer ? row("Kliyan", esc(r.customer.name)) + (r.customer.idCard ? row("ID", esc(r.customer.idCard), true) : "") + (r.customer.phone ? row("Tel", esc(r.customer.phone)) : "") : ""}
  </div>
  ${spacedRule}
  ${isPayment ? `<div class="items">${items}</div>` : `<div class="items">${items}</div>`}
  ${spacedRule}
  ${isPayment ? "" : row("Sou-total", money(r.subtotal))}
  ${!isPayment && r.discount > 0 ? row("Escompte", `− ${money(r.discount)}`, false, "#B00020") : ""}
  <div class="total-band"><span>${isPayment ? "TOTAL PEMAN" : "TOTAL"}</span><span class="amount">${money(r.total)}</span></div>
  <div style="margin-top:8px">${paymentBlock}</div>
  <div class="foot">
    <div class="thanks">${isPayment ? "Mèsi pou peyi dèt la!" : "Mèsi pou acha w!"}</div>
    <div class="small">${esc(r.storeName)} · ${esc(fmtDateTime(r.createdAt))}</div>
    <div class="small">Jesyon Magazen · Resi ofisyèl</div>
  </div>
</body>
</html>`;
}
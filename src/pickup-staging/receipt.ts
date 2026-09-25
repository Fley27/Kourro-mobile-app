// Pickup receipt: normal-receipt look, ALL products (even fully taken).
// Per product: Achte (price only here) / Livre (qty only) / Disponib (bold).
// Footer: total, change, credit balance, sale type.
import { fmtG, fmt } from "../format";
import { palette } from "../theme";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

export type PickupReceiptLine = {
  name: string;
  bought: number;
  taken: number;
  remaining: number;
  unitPrice?: number;
  lineTotal?: number;
};

export type PickupReceiptInput = {
  kind: "partial" | "redeem";
  storeName: string;
  saleNumber: string;
  saleId: string;
  createdAt: string;
  cashierName: string;
  customerName?: string | null;
  lines: PickupReceiptLine[];
  total: number;
  change?: number;
  balance?: number;
  saleType: string;
  isCredit?: boolean;
};

function dt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

const money = (n: any) => `${fmtG(Number(n ?? 0))}`;

function achteText(l: PickupReceiptLine): string {
  if (l.unitPrice != null && Number(l.unitPrice) > 0) {
    const lt = l.lineTotal != null ? Number(l.lineTotal) : Number(l.bought) * Number(l.unitPrice);
    return `${l.bought} × ${fmtG(Number(l.unitPrice))} = ${money(lt)}`;
  }
  return `${l.bought}`;
}

export function pickupReceiptToText(input: PickupReceiptInput): string {
  const L: string[] = [];
  L.push("     JESYON MAGAZEN");
  L.push(input.kind === "partial" ? "      RESI BALANS" : "    RESI REKIPERE");
  L.push("------------------------------------");
  L.push(`Vant: ${input.saleNumber}`);
  L.push(`ID: ${input.saleId}`);
  L.push(`Dat: ${dt(input.createdAt)}`);
  L.push(`Kesye: ${input.cashierName}`);
  if (input.customerName) L.push(`Kliyan: ${input.customerName}`);
  L.push("------------------------------------");
  for (const l of input.lines) {
    L.push(`${l.name}`);
    L.push(`  Achte: ${achteText(l)}`);
    L.push(`  Livre: ${l.taken}`);
    L.push(`  Disponib: ${l.remaining}`);
  }
  L.push("------------------------------------");
  L.push(`TOTAL: ${money(input.total)}`);
  if (Number(input.change ?? 0) > 0) L.push(`Monnen: ${money(input.change)}`);
  if (input.isCredit) L.push(`Balans kredi: ${money(input.balance)}`);
  L.push(`Vant: ${input.saleType}`);
  L.push("------------------------------------");
  if (input.lines.some(l => l.remaining > 0.000001)) {
    L.push(`ID pou rekipere: ${input.saleId}`);
  } else {
    L.push("Tout pran. Balans 0.");
  }
  L.push("Mèsi!");
  L.push(input.storeName);
  return L.join("\n");
}

function esc(s: any): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildPickupReceiptHtml(input: PickupReceiptInput): string {
  const open = input.lines.some(l => l.remaining > 0.000001);
  const rows = input.lines.map(l => {
    const up = l.unitPrice != null && Number(l.unitPrice) > 0
      ? `${l.bought} × ${fmtG(Number(l.unitPrice))} = ${money(l.lineTotal != null ? l.lineTotal : Number(l.bought) * Number(l.unitPrice))}`
      : `${l.bought}`;
    return `
    <div class="line"><div class="top"><span class="name">${esc(l.name)}</span></div>
    <div class="kv"><span>Achte</span><strong>${esc(up)}</strong></div>
    <div class="kv"><span>Livre</span><span>${l.taken}</span></div>
    <div class="kv big"><span>Disponib</span><strong>${l.remaining}</strong></div></div>`;
  }).join("");
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;color:${palette.ink};padding:10px 8px}.head{text-align:center}.head h1{font-size:18px;letter-spacing:2px}.head .store{font-size:11px;color:${palette.muted2};margin-top:2px}.head .kind{font-size:20px;font-weight:900;letter-spacing:4px;margin-top:4px}.rule{border-top:1px dashed ${palette.muted3};margin:10px 0}.row{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:2px 0}.row strong{font-weight:800}.line{margin-bottom:10px}.line .top{display:flex;justify-content:space-between;gap:8px;font-size:13px;font-weight:700}.line .kv{display:flex;justify-content:space-between;font-size:12px;padding:1px 0;color:${palette.inkSoft}}.line .kv.big{font-size:13px}.line .kv.big strong{font-weight:900;font-size:14px;color:${palette.warning}}.total-band{display:flex;justify-content:space-between;align-items:center;background:${palette.ink2};color:#fff;border-radius:8px;padding:8px 12px;margin-top:4px;font-size:13px;font-weight:900}.foot{text-align:center;margin-top:10px;font-size:11px;color:${palette.muted2}}.idbox{margin-top:8px;background:${palette.warningBg};border:1px solid ${palette.warningBd};border-radius:8px;padding:8px;font-size:11px;color:${palette.warning};text-align:center}</style></head>
  <body><div class="head"><h1>JESYON MAGAZEN</h1><div class="store">${esc(input.storeName)}</div><div class="kind">${input.kind === "partial" ? "RESI BALANS" : "RESI REKIPERE"}</div></div><div class="rule"></div>
  <div class="row"><span>Vant</span><strong>${esc(input.saleNumber)}</strong></div>
  <div class="row"><span>ID</span><span>${esc(input.saleId)}</span></div>
  <div class="row"><span>Dat</span><span>${esc(dt(input.createdAt))}</span></div>
  <div class="row"><span>Kesye</span><strong>${esc(input.cashierName)}</strong></div>
  ${input.customerName ? `<div class="row"><span>Kliyan</span><span>${esc(input.customerName)}</span></div>` : ""}
  <div class="rule"></div>${rows}<div class="rule"></div>
  <div class="total-band"><span>TOTAL</span><span>${money(input.total)}</span></div>
  <div style="margin-top:6px">
  ${Number(input.change ?? 0) > 0 ? `<div class="row"><span>Monnen</span><span>${money(input.change)}</span></div>` : ""}
  ${input.isCredit ? `<div class="row"><span>Balans kredi</span><strong>${money(input.balance)}</strong></div>` : ""}
  <div class="row"><span>Vant</span><strong>${esc(input.saleType)}</strong></div>
  </div>
  ${open ? `<div class="idbox">ID pou rekipere: ${esc(input.saleId)}</div>` : `<div class="idbox">Tout pran. Balans 0.</div>`}
  <div class="foot">Mèsi! · ${esc(input.storeName)}</div></body></html>`;
}

export async function printPickupReceipt(input: PickupReceiptInput): Promise<void> {
  const html = buildPickupReceiptHtml(input);
  const file = await Print.printToFileAsync({ html, base64: false });
  if (!file.uri) throw new Error("no-file");
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/pdf",
      dialogTitle: "Resi balans (PDF)",
      UTI: "com.adobe.pdf",
    });
  }
}

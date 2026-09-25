// STAGING-PICKUP: DB helpers. Additive only; never called when flag OFF,
// so the current checkout path is untouched. Decimal-safe (parseFloat).
import { getDb } from "../db";

export function toNum(v: any): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export function remainingOf(item: any): number {
  const paid = toNum(item.quantity);
  const delivered = toNum(item.quantity_delivered ?? paid);
  return Math.max(0, Math.round((paid - delivered) * 100) / 100);
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Find a sale by raw id OR human sale_number (mirrors salesCorrection.findSaleDetail). */
export async function findSaleForPickup(storeId: string, query: string) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return null;
  const db = await getDb();
  const sales = ((await db.getAllAsync("SELECT * FROM sales")) as any[]) ?? [];
  const sale = sales.find((s: any) => {
    const sid = String(s.store_id ?? storeId);
    if (sid !== String(storeId) && sid !== "demo-store-id" && String(storeId) !== "demo-store-id") return false;
    return String(s.id ?? "").toLowerCase() === q || String(s.sale_number ?? s.id ?? "").toLowerCase() === q;
  });
  if (!sale) return null;
  const allItems = ((await db.getAllAsync("SELECT * FROM sale_items WHERE sale_id = ?", [sale.id])) as any[]) ?? [];
  const items = allItems.map((it: any) => ({ ...it, __remaining: remainingOf(it) }));
  let history: any[] = [];
  try { history = ((await db.getAllAsync("SELECT * FROM sale_pickups WHERE sale_id = ?", [sale.id])) as any[]) ?? []; } catch { history = []; }
  let customer: any | null = null;
  try {
    const customers = ((await db.getAllAsync("SELECT * FROM customers")) as any[]) ?? [];
    customer = customers.find((c: any) => c.id === sale.customer_id) ?? null;
  } catch {}
  return { sale, items, history, customer };
}

/** Record one pickup event across 1+ lines. Throws on over-redeem. Supports multi-visit. */
export async function recordPickup(opts: {
  storeId: string;
  saleId: string;
  taken: Record<string, number>; // sale_item_id -> qty taken now (decimals allowed)
  cashierId?: string | null;
}) {
  const db = await getDb();
  const items = ((await db.getAllAsync("SELECT * FROM sale_items WHERE sale_id = ?", [opts.saleId])) as any[]) ?? [];
  const now = new Date().toISOString();
  const touched: any[] = [];
  for (const it of items) {
    const want = toNum(opts.taken[it.id]);
    if (!(want > 0)) continue;
    const paid = toNum(it.quantity);
    const rem = remainingOf(it);
    if (want - rem > 0.000001) {
      throw new Error(`"${it.product_name}": achte ${paid}, rete ${rem} — ou mande ${want}.`);
    }
    const next = Math.round((toNum(it.quantity_delivered ?? it.quantity) + want) * 100) / 100;
    await db.runAsync("UPDATE sale_items SET quantity_delivered = ? WHERE id = ?", [next, it.id]);
    await db.runAsync("INSERT INTO sale_pickups (id, store_id, sale_id, sale_item_id, quantity, picked_up_by, created_at) VALUES (?,?,?,?,?,?,?)", [
      uid("pkp"), opts.storeId, opts.saleId, it.id, want, opts.cashierId ?? null, now,
    ]);
    touched.push({ ...it, takenNow: want, remainingAfter: Math.round((toNum(it.quantity) - next) * 100) / 100 });
  }
  if (!touched.length) throw new Error("Antre yon kantite > 0 pou omwen yon atik.");
  return touched;
}

/**
 * Post-sale "take with them": set the TOTAL taken per line (not additive).
 * Blank input = untouched line. Cap per product = amount bought (quantity paid).
 * Balance per product = bought − taken. Works as a correction if reopened.
 */
export async function setTakenTotal(opts: {
  storeId: string;
  saleId: string;
  taken: Record<string, number>; // sale_item_id -> TOTAL taken with them (decimals allowed)
  cashierId?: string | null;
}) {
  const db = await getDb();
  const items = ((await db.getAllAsync("SELECT * FROM sale_items WHERE sale_id = ?", [opts.saleId])) as any[]) ?? [];
  const now = new Date().toISOString();
  const touched: any[] = [];
  for (const it of items) {
    if (!(it.id in opts.taken)) continue; // blank = untouched
    const want = toNum(opts.taken[it.id]);
    const paid = toNum(it.quantity);
    if (!(want >= 0) || want - paid > 0.000001) {
      throw new Error(`"${it.product_name}": pa ka depase ${paid} achte (ou mete ${opts.taken[it.id]}).`);
    }
    const prev = toNum(it.quantity_delivered ?? paid);
    const next = Math.round(want * 100) / 100;
    if (Math.abs(next - prev) < 0.000000001) continue; // unchanged
    await db.runAsync("UPDATE sale_items SET quantity_delivered = ? WHERE id = ?", [next, it.id]);
    const delta = Math.round((next - prev) * 100) / 100;
    await db.runAsync("INSERT INTO sale_pickups (id, store_id, sale_id, sale_item_id, quantity, picked_up_by, created_at) VALUES (?,?,?,?,?,?,?)", [
      uid("pkp"), opts.storeId, opts.saleId, it.id, delta, opts.cashierId ?? null, now,
    ]);
    touched.push({ ...it, takenNow: next, remainingAfter: Math.round((paid - next) * 100) / 100 });
  }
  if (!touched.length) throw new Error("Pa gen chanjman — antre kantite y ap pran avèk yo.");
  return touched;
}

/** List sales with open balance for lost-receipt lookup (customer/date/item filter). */
export async function listOpenPickups(storeId: string, filter?: { q?: string; from?: string; to?: string }) {
  const db = await getDb();
  const sales = ((await db.getAllAsync("SELECT * FROM sales")) as any[]) ?? [];
  const items = ((await db.getAllAsync("SELECT * FROM sale_items")) as any[]) ?? [];
  const customers = ((await db.getAllAsync("SELECT * FROM customers")) as any[]) ?? [];
  const q = String(filter?.q ?? "").trim().toLowerCase();
  const bySale = new Map<string, any[]>();
  for (const it of items) {
    if (remainingOf(it) <= 0) continue;
    if (!bySale.has(it.sale_id)) bySale.set(it.sale_id, []);
    bySale.get(it.sale_id)!.push(it);
  }
  let out = sales
    .filter(s => bySale.has(s.id))
    .map(s => ({
      sale: s,
      openItems: bySale.get(s.id)!,
      customer: customers.find((c: any) => c.id === s.customer_id) ?? null,
    }))
    .sort((a, b) => String(b.sale.created_at ?? "").localeCompare(String(a.sale.created_at ?? "")));
  if (filter?.from) out = out.filter(r => String(r.sale.created_at ?? "") >= filter.from!);
  if (filter?.to) out = out.filter(r => String(r.sale.created_at ?? "") <= filter.to!);
  if (q) {
    out = out.filter(r =>
      String(r.sale.sale_number ?? "").toLowerCase().includes(q) ||
      String(r.sale.id ?? "").toLowerCase().includes(q) ||
      String(r.customer?.name ?? "").toLowerCase().includes(q) ||
      String(r.customer?.phone ?? "").toLowerCase().includes(q) ||
      r.openItems.some((it: any) => String(it.product_name ?? "").toLowerCase().includes(q))
    );
  }
  void storeId;
  return out;
}

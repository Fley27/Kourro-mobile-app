// Proformat / discount / coupon data operations — the DB half of the
// promotions system (pure math lives in promoMath.ts, audit in audit.ts).
// Every write goes: row insert/update → outbox → promo_audit.
import { insertOutbox } from "../db";
import { loadCatalogModel, currentCanonicalCost, minItemFactor, itemFactor, costForItem, type CatalogModel } from "../catalogModel";
import { logPromo } from "./audit";
import {
  EXPIRY_PRESETS, expiryFromDays, fmtExpiryDate, generateCouponCode, generateReceiptNumber,
  isExpired, newId, parseMin, round2, serializeMin, type Coupon, type CouponMin, type CouponType,
  type Discount, type PromoActor, type Proformat, type ProformatItem,
} from "./types";
import {
  amountFromProfit, buildCouponMessage, clampToLines, eligibleLines,
  scopeProfitOf, type CouponLine,
} from "./promoMath";

function fail(title: string, message: string): never {
  throw { title, message };
}

function actorCols(a?: PromoActor | null) {
  return { created_by: a?.id ?? null, created_by_name: a?.name ?? null, created_by_role: a?.role ?? null };
}

// ---------- Proformats ----------

/** Canonical (smallest-unit) qty for a line — mirrors checkout's canonFactor. */
function canonQtyFor(chainItems: any[], productId: string, unitItemId: string | null | undefined, factor: number, qty: number): number {
  const f = Number(factor) || 1;
  if (!unitItemId) return (Number(qty) || 0) * f;
  const full = itemFactor(chainItems, unitItemId);
  const m = minItemFactor(chainItems, productId);
  const rel = full > 0 && m > 0 ? full / m : f;
  return (Number(qty) || 0) * rel;
}

/**
 * Cost of ONE article of a line — the container actually sold.
 * Persisted items.cost first (maintained from batches / supplier quotes /
 * ratio chain / owner entry), else the batch-derived cost at that item
 * level, else the canonical batch cost converted to the line's unit
 * (unpriced legacy lines). Profit per line = resell − this × qty.
 */
export function articleCost(model: CatalogModel, productId: string, unitId: string | null | undefined, factor: number): number {
  if (unitId) {
    const it = model.items.find(i => String(i.id) === String(unitId));
    const persisted = Number(it?.cost) || 0;
    if (persisted > 0) return persisted;
    const derived = costForItem(model.items, model.batches, productId, unitId);
    if (derived > 0) return derived;
  }
  const canon = currentCanonicalCost(model.items, model.batches, productId);
  if (!(canon > 0)) return 0;
  let rel = Number(factor) || 1;
  if (unitId) {
    const full = itemFactor(model.items, unitId);
    const m = minItemFactor(model.items, productId);
    if (full > 0 && m > 0) rel = full / m;
  }
  return canon * (rel > 0 ? rel : 1);
}

export type ProformatLineInput = {
  product_id: string;
  name: string;
  unit_id?: string | null;
  unit_name?: string | null;
  factor?: number;
  variant?: string;
  qty: number;
  unit_price: number;
  base_price?: number | null;
};

/**
 * Create an immutable proformat. Customer must already be a resolved
 * customers row (resolveCustomerByPhone) — no loose name/phone text here.
 * Cost basis per line is snapshotted from the catalog as the ARTICLE cost of
 * the unit sold (items.cost, batch fallback — see articleCost). This is what
 * the profit-scope math reads when a coupon is issued from this record:
 * profit = Σ(line_total − cost) = Σ qty × (resell − article cost).
 */
export async function createProformat(db: any, args: {
  storeId: string;
  deviceId?: string;
  actor: PromoActor;
  customerId: string;
  lines: ProformatLineInput[];
}): Promise<Proformat> {
  if (!args.customerId) fail("Kliyan obligatwa", "Resolwe nimewo telefòn kliyan an anvan.");
  if (!args.lines.length) fail("Pwodwi obligatwa", "Ajoute omwen yon pwodwi sou proformat la.");

  const model = await loadCatalogModel(db);
  const items: ProformatItem[] = args.lines.map(l => {
    const qty = Number(l.qty) || 0;
    const unitPrice = round2(Number(l.unit_price) || 0);
    const lineTotal = round2(qty * unitPrice);
    const unitCost = articleCost(model, String(l.product_id), l.unit_id ?? null, Number(l.factor) || 1);
    return {
      product_id: String(l.product_id),
      name: String(l.name),
      unit_id: l.unit_id ?? null,
      unit_name: l.unit_name ?? null,
      factor: Number(l.factor) || 1,
      variant: l.variant ?? "Regular",
      qty, unit_price: unitPrice, line_total: lineTotal,
      cost: round2(qty * unitCost),
      base_price: l.base_price == null || isNaN(Number(l.base_price)) ? unitPrice : round2(Number(l.base_price)),
    };
  });
  const subtotal = round2(items.reduce((s, i) => s + i.line_total, 0));
  const now = new Date().toISOString();

  // Unique receipt number — regenerate on the (rare) collision.
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = {
      id: newId("pfo"),
      store_id: args.storeId,
      receipt_number: generateReceiptNumber(),
      customer_id: String(args.customerId),
      items: JSON.stringify(items),
      subtotal,
      total: subtotal,
      ...actorCols(args.actor),
      device_id: args.deviceId ?? null,
      lamport_clock: Date.now(),
      created_at: now,
      updated_at: now,
      is_deleted: 0,
      dirty: 1,
    };
    try {
      await db.runAsync(
        "INSERT INTO proformats (id,store_id,receipt_number,customer_id,items,subtotal,total,created_by,created_by_name,created_by_role,device_id,lamport_clock,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [row.id, row.store_id, row.receipt_number, row.customer_id, row.items, row.subtotal, row.total,
          row.created_by, row.created_by_name, row.created_by_role, row.device_id, row.lamport_clock,
          row.created_at, row.updated_at, row.is_deleted, row.dirty]
      );
      await insertOutbox("proformats", "create", row, db);
      await logPromo(db, {
        store_id: args.storeId, action: "proformat_created", entity_type: "proformat",
        entity_id: row.id, proformat_id: row.id, actor: args.actor,
        snapshot: { receipt_number: row.receipt_number, customer_id: row.customer_id, total: subtotal, items: items.length },
      });
      return { ...row, items } as Proformat;
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "");
      if (!/UNIQUE|unique/i.test(msg)) throw e; // only receipt collisions retry
    }
  }
  return fail("Erè proformat", "Pa jwenn yon nimewo rekò lib — eseye ankò.");
}

/**
 * One-time repair for the article-cost snapshot: rewrites every proformat
 * line's cost with the articleCost formula (the old snapshot used a
 * canonical-qty × base-cost product that could explode past the resell
 * price), marks each changed row dirty and queues a FULL-row outbox update
 * so the correction syncs (sync appliers REPLACE from the payload).
 * Idempotent — unchanged rows are skipped. Returns rows rewritten.
 */
export async function repairProformatCosts(db: any): Promise<number> {
  let rows: any[] = [];
  try { rows = ((await db.getAllAsync("SELECT * FROM proformats")) as any[]) ?? []; } catch { return 0; }
  if (!rows.length) return 0;
  const model = await loadCatalogModel(db);
  let changed = 0;
  for (const row of rows) {
    let items: any[] = [];
    try { items = JSON.parse(String(row.items ?? "[]")) || []; } catch { continue; }
    if (!Array.isArray(items) || !items.length) continue;
    let touched = false;
    for (const line of items) {
      if (!line || typeof line !== "object") continue;
      const qty = Number(line.qty) || 0;
      const cost = round2(qty * articleCost(model, String(line.product_id ?? ""), line.unit_id ?? null, Number(line.factor) || 1));
      if (Math.abs(cost - (Number(line.cost) || 0)) > 0.009) {
        line.cost = cost;
        touched = true;
      }
    }
    if (!touched) continue;
    const itemsJson = JSON.stringify(items);
    // +1ms: beats the row's previous updated_at outright (LWW tie rule).
    const updatedAt = new Date(Date.now() + 1).toISOString();
    try {
      await db.runAsync("UPDATE proformats SET items = ?, updated_at = ?, dirty = 1 WHERE id = ?",
        [itemsJson, updatedAt, String(row.id)]);
      await insertOutbox("proformats", "update", { ...row, items: itemsJson, updated_at: updatedAt }, db);
      changed++;
    } catch {}
  }
  return changed;
}

function hydrateProformat(row: any): Proformat {
  let items: ProformatItem[] = [];
  try { items = JSON.parse(String(row.items ?? "[]")) || []; } catch { items = []; }
  return { ...row, items, subtotal: Number(row.subtotal ?? 0), total: Number(row.total ?? 0) };
}

export async function getProformat(db: any, id: string): Promise<Proformat | null> {
  try {
    const rows = ((await db.getAllAsync("SELECT * FROM proformats WHERE id = ?", [id])) as any[]) ?? [];
    return rows[0] ? hydrateProformat(rows[0]) : null;
  } catch { return null; }
}

// ---------- Paid state (derived from the sale link, never stored on the record) ----------

/** The sale that converted a proformat. Derived live from sales.proformat_id,
 *  so voiding/deleting the sale clears the paid state on every reader. */
export type ProformatPaidInfo = {
  sale_id: string;
  sale_number: string;
  paid_at: string;
  total: number;
  amount_due: number;
};

export async function paidSaleForProformat(db: any, proformatId: string): Promise<ProformatPaidInfo | null> {
  try {
    const rows = ((await db.getAllAsync(
      "SELECT id, sale_number, created_at, total, amount_due FROM sales WHERE proformat_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY created_at ASC LIMIT 1",
      [String(proformatId)]
    )) as any[]) ?? [];
    const s = rows[0];
    return s ? {
      sale_id: String(s.id),
      sale_number: String(s.sale_number ?? s.id),
      paid_at: String(s.created_at ?? ""),
      total: Number(s.total ?? 0),
      amount_due: Number(s.amount_due ?? 0),
    } : null;
  } catch { return null; }
}

/** Earliest linked sale per proformat for a whole store (one query for the list). */
async function paidMapForStore(db: any, storeId: string): Promise<Map<string, ProformatPaidInfo>> {
  const map = new Map<string, ProformatPaidInfo>();
  try {
    const rows = ((await db.getAllAsync(
      "SELECT proformat_id, id, sale_number, created_at, total, amount_due FROM sales WHERE store_id = ? AND proformat_id IS NOT NULL AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY created_at ASC",
      [storeId]
    )) as any[]) ?? [];
    for (const s of rows) {
      const key = String(s.proformat_id ?? "");
      if (!key || map.has(key)) continue;
      map.set(key, {
        sale_id: String(s.id),
        sale_number: String(s.sale_number ?? s.id),
        paid_at: String(s.created_at ?? ""),
        total: Number(s.total ?? 0),
        amount_due: Number(s.amount_due ?? 0),
      });
    }
  } catch {}
  return map;
}

/** List with joined customer display fields (join, never stored on the row). */
export async function listProformats(db: any, storeId: string, query?: string): Promise<Array<Proformat & {
  customer_name: string; customer_phone: string | null; paid: ProformatPaidInfo | null;
}>> {
  let rows: any[] = [];
  try {
    rows = ((await db.getAllAsync(
      "SELECT * FROM proformats WHERE store_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY created_at DESC",
      [storeId]
    )) as any[]) ?? [];
  } catch { rows = []; }
  let customers: any[] = [];
  try { customers = ((await db.getAllAsync("SELECT id, name, phone FROM customers")) as any[]) ?? []; } catch {}
  const byId = new Map(customers.map(c => [String(c.id), c]));
  const paidByPfo = await paidMapForStore(db, storeId);
  let list = rows.map(r => {
    const c = byId.get(String(r.customer_id));
    return {
      ...hydrateProformat(r),
      customer_name: String(c?.name ?? ""),
      customer_phone: c?.phone ?? null,
      paid: paidByPfo.get(String(r.id)) ?? null,
    };
  });
  const q = String(query ?? "").trim().toLowerCase();
  if (q) {
    list = list.filter(p =>
      p.receipt_number.toLowerCase().includes(q) ||
      p.customer_name.toLowerCase().includes(q)
    );
  }
  return list;
}

// ---------- Discounts ----------

export async function listDiscounts(db: any, storeId: string): Promise<Discount[]> {
  try {
    const rows = ((await db.getAllAsync(
      "SELECT * FROM discounts WHERE store_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY created_at DESC",
      [storeId]
    )) as any[]) ?? [];
    return rows.map(r => ({ ...r, percentage: Number(r.percentage ?? 0) }));
  } catch { return []; }
}

export async function createDiscount(db: any, args: {
  storeId: string; deviceId?: string; actor: PromoActor; percentage: number;
}): Promise<Discount> {
  const pct = Number(args.percentage);
  if (!Number.isFinite(pct) || pct <= 0) fail("Pri valab", "Antre yon pousantrap ki pi gran pase 0.");
  const now = new Date().toISOString();
  const row = {
    id: newId("dsp"),
    store_id: args.storeId,
    percentage: pct,
    ...actorCols(args.actor),
    device_id: args.deviceId ?? null,
    lamport_clock: Date.now(),
    created_at: now,
    updated_at: now,
    is_deleted: 0,
    dirty: 1,
  };
  await db.runAsync(
    "INSERT INTO discounts (id,store_id,percentage,created_by,created_by_name,created_by_role,device_id,lamport_clock,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [row.id, row.store_id, row.percentage, row.created_by, row.created_by_name, row.created_by_role,
      row.device_id, row.lamport_clock, row.created_at, row.updated_at, row.is_deleted, row.dirty]
  );
  await insertOutbox("discounts", "create", row, db);
  await logPromo(db, {
    store_id: args.storeId, action: "discount_created", entity_type: "discount",
    entity_id: row.id, discount_id: row.id, actor: args.actor,
    snapshot: { percentage: pct },
  });
  return row as Discount;
}

// ---------- Sleepy products (conditional requirements source) ----------

export type SleepyProduct = { product_id: string; name: string; stock_quantity: number; sold30: number };

/**
 * The system-generated list of currently low-selling items to push via a
 * conditional coupon: active, in-stock goods ranked by 30-day units sold
 * ascending (0 = sleepiest) — the 15 sleepiest form the pool — then the
 * 5 with the MOST stock, displayed stock descending (high stock + no sales
 * is exactly what a coupon push should move).
 * Regenerated on every wizard open — sleepiness is time-sensitive and is
 * never stored on a reusable discount.
 */
export async function sleepyProducts(db: any): Promise<SleepyProduct[]> {
  let products: any[] = [];
  try {
    products = ((await db.getAllAsync(
      "SELECT id, name, stock_quantity FROM products WHERE is_deleted = 0 AND (status IS NULL OR status = 'active') AND (item_type IS NULL OR item_type = 'goods') AND stock_quantity > 0 ORDER BY name"
    )) as any[]) ?? [];
  } catch { products = []; }
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sold = new Map<string, number>();
  try {
    // Aggregated in JS: the memory backend does not evaluate GROUP BY.
    const rows = ((await db.getAllAsync(
      "SELECT product_id, quantity, updated_at, is_deleted FROM sale_items WHERE updated_at >= ?",
      [cutoff]
    )) as any[]) ?? [];
    for (const it of rows) {
      if (!it || it.is_deleted) continue;
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;
      const pid = String(it.product_id ?? "");
      sold.set(pid, (sold.get(pid) ?? 0) + qty);
    }
  } catch {}
  const pool = products
    .map(p => ({ product_id: String(p.id), name: String(p.name ?? ""), stock_quantity: Number(p.stock_quantity ?? 0), sold30: sold.get(String(p.id)) ?? 0 }))
    .sort((a, b) => a.sold30 - b.sold30 || a.name.localeCompare(b.name))
    .slice(0, 15);
  return pool
    .sort((a, b) => b.stock_quantity - a.stock_quantity || a.name.localeCompare(b.name))
    .slice(0, 5);
}

// ---------- Coupons ----------

function couponFromRow(row: any): Coupon {
  return {
    ...row,
    discount_percentage: Number(row.discount_percentage ?? 0),
    flat_amount_goud: row.flat_amount_goud == null ? null : Number(row.flat_amount_goud),
    cap: row.cap == null ? null : Number(row.cap),
    min: parseMin(row.min),
  };
}

/** Profit-scope at issuance (proformat flow): conditional → required product
 *  lines only; unconditional → the whole record. */
export function proformatScopeProfit(p: Proformat, coupon: { type: CouponType; min: CouponMin | null }): number {
  const req = coupon.min?.products ?? [];
  const useRequired = coupon.type === "conditional" && req.length > 0;
  const ids = new Set(req.map(r => String(r.product_id)));
  let profit = 0;
  for (const item of p.items) {
    if (useRequired && !ids.has(String(item.product_id))) continue;
    profit += (Number(item.line_total) || 0) - (Number(item.cost) || 0);
  }
  return round2(profit);
}

export async function issueCoupon(db: any, args: {
  storeId: string;
  deviceId?: string;
  actor: PromoActor;
  customerId: string;
  customerName: string;
  discount: Discount;
  type: CouponType;
  min?: CouponMin | null;
  cap?: number | null;
  expiryDays: number;
  proformat?: Proformat | null;
}): Promise<Coupon> {
  const preset = EXPIRY_PRESETS.find(p => p.days === Number(args.expiryDays));
  if (!preset) fail("Echèans", "Chwazi yon dat ekspirasyon (3 jou / 1 semèn / 15 jou / 1 mwa).");
  if (!args.customerId) fail("Kliyan obligatwa", "Resolwe nimewo telefòn kliyan an anvan.");

  const min = args.min ?? null;
  const type: CouponType = args.type === "conditional" ? "conditional" : "unconditional";
  if (type === "conditional" && !(min?.products?.length)) {
    fail("Kondisyon obligatwa", "Yon koupon kondisyone dwe gen pwodwi ak kantite (lis pwodui ki pa vann byen).");
  }
  const cap = Number(args.cap ?? 0) > 0 ? round2(Number(args.cap)) : null;
  const proformat = args.proformat ?? null;

  // Only one coupon may ever attach to a proformat (any status, any discount).
  if (proformat) {
    let existing: any[] = [];
    try {
      existing = ((await db.getAllAsync(
        "SELECT id FROM coupons WHERE store_id = ? AND proformat_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)",
        [args.storeId, proformat.id]
      )) as any[]) ?? [];
    } catch {}
    if (existing.length) {
      fail("Deja gen koupon", "Proformat sa a gen deja yon koupon — pa ka ajoute youn ankò.");
    }
  }

  // Nothing is frozen at issuance: the discount is calculated from the cart's
  // total profit when the sale is saved, so the record carries no goud figure
  // and neither does the outreach message (see buildCouponMessage).
  const flatGoud: number | null = null;

  const now = new Date().toISOString();
  let code = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = generateCouponCode();
    try {
      const taken = ((await db.getAllAsync("SELECT id FROM coupons WHERE code = ?", [candidate])) as any[]) ?? [];
      if (!taken.length) { code = candidate; break; }
    } catch { code = candidate; break; }
  }
  if (!code) fail("Erè koupon", "Pa jwenn yon kòd lib — eseye ankò.");

  const expiresAt = expiryFromDays(preset.days);
  const message = buildCouponMessage({
    customerName: args.customerName,
    code,
    expiresAt,
    type,
    min,
    proformatReceipt: proformat?.receipt_number ?? null,
    expiryLabel: fmtExpiryDate(expiresAt),
  });

  const row = {
    id: newId("cpn"),
    store_id: args.storeId,
    code,
    discount_id: args.discount.id,
    discount_percentage: Number(args.discount.percentage),
    proformat_id: proformat?.id ?? null,
    customer_id: String(args.customerId),
    type,
    min: serializeMin(min),
    cap,
    expires_at: expiresAt,
    status: "unused",
    flat_amount_goud: flatGoud,
    message,
    ...actorCols(args.actor),
    device_id: args.deviceId ?? null,
    lamport_clock: Date.now(),
    created_at: now,
    updated_at: now,
    is_deleted: 0,
    dirty: 1,
  };
  await db.runAsync(
    "INSERT INTO coupons (id,store_id,code,discount_id,discount_percentage,proformat_id,customer_id,type,min,cap,expires_at,status,flat_amount_goud,message,created_by,created_by_name,created_by_role,device_id,lamport_clock,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [row.id, row.store_id, row.code, row.discount_id, row.discount_percentage, row.proformat_id,
      row.customer_id, row.type, row.min, row.cap, row.expires_at, row.status, row.flat_amount_goud,
      row.message, row.created_by, row.created_by_name, row.created_by_role, row.device_id,
      row.lamport_clock, row.created_at, row.updated_at, row.is_deleted, row.dirty]
  );
  await insertOutbox("coupons", "create", row, db);
  await logPromo(db, {
    store_id: args.storeId, action: "coupon_issued", entity_type: "coupon", entity_id: row.id,
    coupon_id: row.id, discount_id: row.discount_id, proformat_id: row.proformat_id, actor: args.actor,
    snapshot: {
      code, type, percentage: row.discount_percentage, min: row.min, cap,
      expires_at: expiresAt, flat_amount_goud: flatGoud, customer_id: row.customer_id,
      proformat_receipt: proformat?.receipt_number ?? null,
    },
  });
  return couponFromRow(row);
}

/** Lazy expiry: an unused coupon past its date flips to expired once (with
 *  audit) wherever it is first read — list or lookup. */
async function flipExpired(db: any, row: any, actor?: PromoActor | null): Promise<any> {
  if (String(row.status) !== "unused") return row;
  if (!isExpired({ expires_at: row.expires_at, status: row.status })) return row;
  const now = new Date().toISOString();
  try {
    await db.runAsync("UPDATE coupons SET status = 'expired', updated_at = ?, lamport_clock = ?, dirty = 1 WHERE id = ? AND status = 'unused'",
      [now, Date.now(), row.id]);
    await insertOutbox("coupons", "update", { id: row.id, status: "expired", updated_at: now, lamport_clock: Date.now(), dirty: 1 }, db);
    await logPromo(db, {
      store_id: String(row.store_id), action: "coupon_expired", entity_type: "coupon",
      entity_id: row.id, coupon_id: row.id, proformat_id: row.proformat_id ?? null, actor: actor ?? null,
      snapshot: { code: row.code, expires_at: row.expires_at },
    });
  } catch {}
  return { ...row, status: "expired", updated_at: now };
}

export async function listCoupons(db: any, storeId: string, query?: string): Promise<Array<Coupon & {
  customer_name: string; proformat_receipt: string | null;
}>> {
  let rows: any[] = [];
  try {
    rows = ((await db.getAllAsync(
      "SELECT * FROM coupons WHERE store_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY created_at DESC",
      [storeId]
    )) as any[]) ?? [];
  } catch { rows = []; }
  let customers: any[] = [];
  try { customers = ((await db.getAllAsync("SELECT id, name FROM customers")) as any[]) ?? []; } catch {}
  let proformats: any[] = [];
  try { proformats = ((await db.getAllAsync("SELECT id, receipt_number FROM proformats")) as any[]) ?? []; } catch {}
  const cust = new Map(customers.map(c => [String(c.id), c]));
  const pfo = new Map(proformats.map(p => [String(p.id), p]));
  let list: Array<Coupon & { customer_name: string; proformat_receipt: string | null }> = [];
  for (const raw of rows) {
    const row = await flipExpired(db, raw);
    const c = cust.get(String(row.customer_id));
    list.push({
      ...couponFromRow(row),
      customer_name: String(c?.name ?? ""),
      proformat_receipt: row.proformat_id ? String(pfo.get(String(row.proformat_id))?.receipt_number ?? "") || null : null,
    });
  }
  const q = String(query ?? "").trim().toLowerCase();
  if (q) {
    list = list.filter(c =>
      c.code.toLowerCase().includes(q) ||
      (c.proformat_receipt ?? "").toLowerCase().includes(q) ||
      c.customer_name.toLowerCase().includes(q)
    );
  }
  return list;
}

/** Lookup by code (case-insensitive) with the lazy expiry flip applied. */
export async function findCouponByCode(db: any, storeId: string, code: string): Promise<Coupon | null> {
  const q = String(code ?? "").trim().toUpperCase();
  if (!q) return null;
  let row: any = null;
  try {
    const rows = ((await db.getAllAsync("SELECT * FROM coupons WHERE upper(code) = ?", [q])) as any[]) ?? [];
    row = rows[0] ?? null;
  } catch { row = null; }
  if (!row) return null;
  if (String(row.store_id) && String(row.store_id) !== String(storeId)) return null;
  return couponFromRow(await flipExpired(db, row));
}

// ---------- Redemption preview (pay-time amount) ----------

export type PreviewLine = { id: string; qty: number; unitId?: string | null; factor?: number; lineTotal: number };

/** Read-only FIFO cost estimate for one line — the same consumption order
 *  persistSale will apply, without mutating stock. */
async function estimateLineCost(db: any, line: PreviewLine, serviceIds: Set<string>, chainItems: any[]): Promise<number> {
  if (serviceIds.has(String(line.id))) return 0;
  const need = canonQtyFor(chainItems, String(line.id), line.unitId ?? null, line.factor ?? 1, line.qty);
  if (!(need > 0)) return 0;
  let remaining = need;
  let cost = 0;
  try {
    const rows = ((await db.getAllAsync(
      "SELECT * FROM stock_movements WHERE product_id = ? AND type = 'in' AND remaining_qty > 0 AND status = 'delivered' ORDER BY created_at ASC, id ASC",
      [line.id]
    )) as any[]) ?? [];
    for (const br of rows) {
      if (remaining <= 0) break;
      const consume = Math.min(Number(br.remaining_qty) || 0, remaining);
      if (consume <= 0) continue;
      const withTransport = Number(br.quantity) > 0 && br.allocated_transport
        ? Number(br.unit_cost) + Number(br.allocated_transport) / Number(br.quantity)
        : Number(br.unit_cost);
      cost += consume * withTransport;
      remaining -= consume;
    }
  } catch {}
  if (!(cost > 0)) {
    try {
      const m = await loadCatalogModel(db);
      // Same source the proformat / wizard estimate uses: persisted items.cost
      // first, else the batch-derived cost for this line's unit — never a
      // number that disagrees with the estimate shown when the coupon was issued.
      cost = articleCost(m, String(line.id), line.unitId ?? null, Number(line.factor) || 1) * (Number(line.qty) || 0);
    } catch {}
  }
  return round2(cost);
}

async function serviceIdSet(db: any, lines: PreviewLine[]): Promise<Set<string>> {
  const ids = [...new Set(lines.map(l => String(l.id)))];
  const out = new Set<string>();
  if (!ids.length) return out;
  try {
    const rows = ((await db.getAllAsync(
      `SELECT id, item_type FROM products WHERE id IN (${ids.map(() => "?").join(",")})`, ids
    )) as any[]) ?? [];
    for (const r of rows) if (String(r.item_type ?? "goods") === "service") out.add(String(r.id));
  } catch {}
  return out;
}

/**
 * The number that will be applied at save time — computed the same way for
 * the banner shown after applying a code and for the validation/persistence
 * at confirmPay, so all three can never disagree.
 * Always the percentage of the eligible lines' profit (FIFO cost basis),
 * rounded to goud, capped, then line-clamped. Nothing is frozen: what the
 * cart is worth when the sale is saved is what the discount is drawn from.
 */
export async function previewCouponAmount(db: any, lines: PreviewLine[], coupon: Coupon): Promise<number> {
  const elig = eligibleLines(lines as CouponLine[], coupon);
  if (!elig.length) return 0;
  const cap = coupon.cap ?? null;
  const serviceIds = await serviceIdSet(db, lines);
  const chain = ((await loadCatalogModel(db)).items) ?? [];
  const costs: number[] = [];
  for (const l of lines) costs.push(await estimateLineCost(db, l, serviceIds, chain));
  const idxs = lines.map((_, i) => i).filter(i => elig.includes(lines[i] as CouponLine));
  const profit = scopeProfitOf(idxs.map(i => lines[i] as CouponLine), idxs.map(i => costs[i]));
  const amount = amountFromProfit(coupon.discount_percentage, profit, cap);
  return clampToLines(amount, elig);
}

// ---------- Redemption write (checkout calls this at save) ----------

/**
 * Authoritative redemption record: one append-only coupon_redemptions row
 * (who redeemed, which sale, how much) + the single-use status flip on the
 * coupon + the audit entry. The log is what broadcast/multi-person coupons
 * will count on later — the status flag is only the fast single-use check.
 */
export async function recordCouponRedemption(db: any, args: {
  storeId: string;
  coupon: Coupon;
  saleId: string;
  saleNumber: string;
  actor: PromoActor;
  amountApplied: number;
}): Promise<void> {
  const now = new Date().toISOString();
  const logRow = {
    id: newId("crd"),
    store_id: args.storeId,
    coupon_id: args.coupon.id,
    sale_id: args.saleId,
    sale_number: args.saleNumber,
    redeemed_by: args.actor.id ?? null,
    redeemed_by_name: args.actor.name ?? null,
    redeemed_by_role: args.actor.role ?? null,
    amount_applied: round2(args.amountApplied),
    lamport_clock: Date.now(),
    created_at: now,
    updated_at: now,
    is_deleted: 0,
    dirty: 1,
  };
  await db.runAsync(
    "INSERT INTO coupon_redemptions (id,store_id,coupon_id,sale_id,sale_number,redeemed_by,redeemed_by_name,redeemed_by_role,amount_applied,lamport_clock,created_at,updated_at,is_deleted,dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [logRow.id, logRow.store_id, logRow.coupon_id, logRow.sale_id, logRow.sale_number,
      logRow.redeemed_by, logRow.redeemed_by_name, logRow.redeemed_by_role, logRow.amount_applied,
      logRow.lamport_clock, logRow.created_at, logRow.updated_at, logRow.is_deleted, logRow.dirty]
  );
  await insertOutbox("coupon_redemptions", "create", logRow, db);

  try {
    await db.runAsync("UPDATE coupons SET status = 'redeemed', updated_at = ?, lamport_clock = ?, dirty = 1 WHERE id = ? AND status = 'unused'",
      [now, Date.now(), args.coupon.id]);
    await insertOutbox("coupons", "update", { id: args.coupon.id, status: "redeemed", updated_at: now, lamport_clock: Date.now(), dirty: 1 }, db);
  } catch {}

  await logPromo(db, {
    store_id: args.storeId, action: "coupon_redeemed", entity_type: "sale", entity_id: args.saleId,
    sale_id: args.saleId, coupon_id: args.coupon.id, discount_id: args.coupon.discount_id,
    proformat_id: args.coupon.proformat_id ?? null, actor: args.actor,
    snapshot: {
      code: args.coupon.code, sale_number: args.saleNumber, amount_applied: round2(args.amountApplied),
      coupon_type: args.coupon.type, flat_amount_goud: args.coupon.flat_amount_goud, cap: args.coupon.cap,
    },
  });
}

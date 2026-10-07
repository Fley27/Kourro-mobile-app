// Sale checkout pipeline — one smooth path for the whole sale process:
// validate → build record → persist (sale + FIFO stock + credit + receipts).
// Pure wrt React state: takes explicit inputs, returns explicit results.
// POSScreen orchestrates UI (pending commit, resets, modals) around it.
import { insertOutbox } from "../db";
import { buildReceipts, type ReceiptData } from "../receipts";
import { fmtG, fmt } from "../format";
import { loadCatalogModel, currentCanonicalCost, minItemFactor, itemFactor } from "../catalogModel";
import { inLocalDay, isStandbyWindow, localDayKey } from "../businessGuard";
import { USERS, USER_IDS } from "../users";
import { allocateDiscount, checkMin, eligibleIndices } from "../promos/promoMath";
import { previewCouponAmount, recordCouponRedemption } from "../promos/promosModel";
import { round2, type Coupon } from "../promos/types";
import { FALLBACK_STORE_ID } from "../db/ids";
import { reportIdForDay } from "../db/ids";
import { mintId } from "../db/ids";

export type CheckoutLine = {
  id: string;
  name: string;
  unitId: string | null;
  unitName: string | null;
  factor: number;
  variant: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type CheckoutPayment = {
  method: "cash" | "mobile" | "credit";
  mobileProvider?: "moncash" | "natcash";
  amountGiven?: number; // cash: what the client handed over (undefined = exact)
  akompte?: number; // credit: down payment
  clientLegalName?: string;
  clientPhone?: string;
};

export type CheckoutCustomer = {
  id: string;
  name: string;
  id_card_number?: string | null;
  phone?: string | null;
  email?: string | null;
  total_debt?: number;
  credit_limit?: number | null;
  credit_limit_source?: string | null;
  is_high_risk?: boolean | number;
  open_debt_count?: number;
} | null;

export type CheckoutError = { title: string; message: string };

export function cartSubtotal(lines: CheckoutLine[]): number {
  return lines.reduce((s, it) => s + (Number(it.lineTotal ?? 0) || 0), 0);
}

/** All pre-save guards. Throws CheckoutError (caller shows Alert). */
export function validateCheckout(args: {
  lines: CheckoutLine[];
  payment: CheckoutPayment;
  customer: CheckoutCustomer;
  canProcessCreditSale: boolean;
  creditDueDate: string;
  appliedCoupon?: Coupon | null;
  /** Flat goud the banner showed — every money guard below runs on the payable total. */
  expectedDiscount?: number;
}): void {
  const { lines, payment, customer, canProcessCreditSale, creditDueDate, appliedCoupon, expectedDiscount } = args;
  const subtotal = cartSubtotal(lines);
  let discount = appliedCoupon ? Math.max(0, round2(Number(expectedDiscount) || 0)) : 0;
  // A discount can never exceed the coupon's cap — the guards below (credit
  // limit, cash given, the payable shown) must all run on the number that
  // will actually be charged.
  const capNum = appliedCoupon ? Number(appliedCoupon.cap ?? 0) : 0;
  if (capNum > 0) discount = Math.min(discount, round2(capNum));
  const payable = Math.max(0, round2(subtotal - discount));
  if (!lines.length) throw { title: "Panyen vid", message: "" } as CheckoutError;
  if (appliedCoupon) {
    if (appliedCoupon.status !== "unused") {
      throw { title: "Koupon pa valab", message: "Koupon sa a deja itilize oswa ekspire." } as CheckoutError;
    }
    const t = Date.parse(String(appliedCoupon.expires_at ?? ""));
    if (Number.isFinite(t) && t < Date.now()) {
      throw { title: "Koupon ekspire", message: `Koupon sa a fini anvan ${new Date(t).toLocaleDateString()}.` } as CheckoutError;
    }
    if (appliedCoupon.customer_id && String(customer?.id ?? "") !== String(appliedCoupon.customer_id)) {
      throw { title: "Kliyan pa matche", message: "Koupon sa a anrejistre pou yon lòt kliyan — chwazi oswa rechwazi li." } as CheckoutError;
    }
    const gate = checkMin(lines, appliedCoupon.min);
    if (!gate.ok) throw { title: "Kondisyon pa satisfè", message: gate.reason } as CheckoutError;
  }
  if (payment.method === "cash" && payment.amountGiven != null && payment.amountGiven < payable) {
    throw {
      title: "Kòb ensifizan",
      message: `Kliyan bay ${fmtG(payment.amountGiven)}, total se ${fmtG(payable)}. Rès pou peye: ${fmtG(payable - payment.amountGiven)}`,
    };
  }
  if (payment.method === "credit" && !canProcessCreditSale) {
    throw {
      title: "Pa gen dwa",
      message: "Se Manager ak pi wo ka fè vant sou kredi. Kesye pa ka fè vant sou kredi.",
    };
  }
  if (payment.method === "credit") {
    if (!customer) throw { title: "Kliyan obligatwa", message: "Chwazi yon kliyan ki anrejistre anvan vant kredi — verifye kat idantite" };
    if (!customer.id_card_number) throw { title: "ID obligatwa", message: "Kliyan sa a pa gen nimewo kat idantite — enskri ak NIF/CIN pou distenge menm non" };
    const bal = Number(customer.total_debt ?? 0);
    const lim = customer.credit_limit === null || customer.credit_limit === undefined || Number(customer.credit_limit) === 0
      ? null : Number(customer.credit_limit);
    if (bal < 0) {
      throw {
        title: "⚠️ Balans negatif",
        message: `${customer.name} (${customer.id_card_number}) gen dèt negatif (${fmtG(bal)}). Pa konseye bay kredi — mande kach oswa kontakte Manadjè.`,
      };
    }
    if (lim !== null && bal + payable > lim) {
      throw {
        title: "⚠️ Depase limit kredi — BLOKE",
        message: `${customer.name} (${customer.id_card_number}) • Limit: ${fmtG(lim)} (${customer.credit_limit_source ?? "manyèl/oto"}) • Dèt kounye a: ${fmtG(bal)} • Apre vant: ${fmtG(bal + payable)}\n\nSistèm bloke vant kredi sa a!`,
      };
    }
    if (!creditDueDate || isNaN(new Date(creditDueDate).getTime())) {
      throw { title: "Echèans obligatwa", message: "Chwazi yon dat echèans pou kredi a (7/15/30/60 jou oswa lòt dat)" };
    }
    const ak = payment.akompte ?? 0;
    if (ak < 0 || ak > payable) {
      throw { title: "Akompte pa valab", message: `Akompte a dwe ant 0 ak ${fmtG(payable)}` };
    }
  }
}

export type CheckoutResult = {
  sale: any;
  receipts: { customer: ReceiptData; store: ReceiptData };
  finalChange: number;
  customerPatch: { total_debt: number; is_high_risk: boolean; open_debt_count: number } | null;
};

/**
 * Persist a validated sale: sales row → FIFO batch consumption → sale_items
 * (fully delivered by default) → stock decrement → outbox → resumed-tab
 * completion → credit + akompte + debt rollup → receipts (both copies).
 */
export async function persistSale(args: {
  db: any;
  storeId: string;
  deviceId: string;
  storeName: string;
  cashier: { id: string | null; name: string; role: string };
  lines: CheckoutLine[];
  payment: CheckoutPayment;
  customer: CheckoutCustomer;
  creditDueDate: string;
  resumedTabId: string | null;
  logTabEvent: (db: any, tabId: string, action: string, note?: string) => Promise<void>;
  appliedCoupon?: Coupon | null;
  /** Flat goud from the confirm screen (single source of truth for banner + write). */
  expectedDiscount?: number;
  proformatId?: string | null;
}): Promise<CheckoutResult> {
  const { db, storeId, deviceId, storeName, cashier, lines, payment, customer, creditDueDate, resumedTabId, logTabEvent,
    appliedCoupon, proformatId } = args;
  const finalSubtotal = cartSubtotal(lines);
  const saleId = mintId();
  const saleNumber = `VTE-${Date.now().toString().slice(-6)}`;
  const isCashLike = payment.method === "cash" || payment.method === "mobile";
  // Discount: split across eligible lines BEFORE anything is written, so the
  // sale row, sale_items, credit, receipts and the banner all share one number.
  const coupon = appliedCoupon ?? null;
  const eligIdx = coupon ? eligibleIndices(lines, coupon) : [];
  let discountTarget = 0;
  if (coupon) {
    // Authoritative: pct × the cart's total profit, rounded, capped and
    // line-clamped. The banner number is only a fallback if the estimate
    // fails, and even then it can never pass the cap.
    try {
      discountTarget = await previewCouponAmount(db, lines, coupon);
    } catch {
      discountTarget = Math.max(0, round2(Number(args.expectedDiscount) || 0));
      const capNum = Number(coupon.cap ?? 0);
      if (capNum > 0) discountTarget = Math.min(discountTarget, round2(capNum));
    }
  }
  const lineShares: number[] = new Array(lines.length).fill(0);
  if (coupon && eligIdx.length && discountTarget > 0) {
    const shares = allocateDiscount(eligIdx.map(i => lines[i].lineTotal), discountTarget);
    eligIdx.forEach((li, k) => { lineShares[li] = shares[k] ?? 0; });
  }
  const discountApplied = round2(lineShares.reduce((s, x) => s + x, 0));
  const payableTotal = Math.max(0, round2(finalSubtotal - discountApplied));
  const akompteNum = payment.method === "credit" ? Math.min(Math.max(payment.akompte ?? 0, 0), payableTotal) : 0;
  const amountPaid = isCashLike ? (payment.amountGiven != null ? payment.amountGiven : payableTotal) : akompteNum;
  const pm: string = payment.method === "mobile" ? (payment.mobileProvider ?? "moncash") : payment.method;
  const now = new Date().toISOString();
  // Business Guard standby: sales rung while the seller's own report for
  // today is locked (submitted/confirmed) and before their next clock-in.
  let standbyFlag = 0;
  if (cashier.id) {
    try {
      const day = localDayKey(now);
      const reports = ((await db.getAllAsync("SELECT * FROM daily_reports").catch(() => [])) ?? []) as any[];
      const myReport = reports.find((r: any) => r.user_id === cashier.id && r.report_date === day && (r.store_id ?? storeId) === storeId);
      const shifts = ((await db.getAllAsync("SELECT * FROM shifts").catch(() => [])) ?? []) as any[];
      const shiftsToday = shifts.filter((x: any) => (x.cashier_id ?? null) === cashier.id && inLocalDay(x.start_time, day));
      if (isStandbyWindow(myReport, shiftsToday)) standbyFlag = 1;
    } catch {}
  }
  const sale = {
    id: saleId, store_id: storeId, sale_number: saleNumber,
    customer_id: customer?.id ?? null, status: payment.method === "credit" ? "credit" : "completed",
    payment_method: pm, subtotal: finalSubtotal, discount: discountApplied, total: payableTotal, amount_paid: amountPaid,
    amount_due: Math.max(0, payableTotal - amountPaid),
    seller_id: cashier.id, seller_role: cashier.role, standby: standbyFlag,
    proformat_id: proformatId ?? coupon?.proformat_id ?? null,
    device_id: deviceId, lamport_clock: Date.now(), created_at: now, updated_at: now, is_deleted: false,
  };

  await db.runAsync("INSERT INTO sales (id,store_id,sale_number,customer_id,status,payment_method,subtotal,discount,total,amount_paid,amount_due,seller_id,seller_role,standby,proformat_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [sale.id, sale.store_id, sale.sale_number, sale.customer_id, sale.status, sale.payment_method, sale.subtotal, sale.discount, sale.total, sale.amount_paid, sale.amount_due, sale.seller_id, sale.seller_role, sale.standby, sale.proformat_id, sale.created_at, sale.updated_at]);

  // Canonical smallest-unit counts (chain-only: base can be biggest now).
  let chainItems: any[] = [];
  try {
    chainItems = (((await db.getAllAsync("SELECT * FROM items").catch(() => [])) ?? []) as any[])
      .filter((r: any) => !r.is_deleted);
  } catch { chainItems = []; }
  const canonFactor = (productId: string, unitItemId: string | null, factor: number): number => {
    const f = Number(factor) || 1;
    if (!unitItemId) return f;
    const full = itemFactor(chainItems as any, unitItemId);
    const m = minItemFactor(chainItems as any, productId);
    return full > 0 && m > 0 ? full / m : f;
  };

  // Services carry no stock — never deducted, whatever the factors say.
  let serviceIds = new Set<string>();
  // Lines queued for the outbox — pushed after the sale row (FK order).
  const saleItemRows: any[] = [];
  try {
    const ids = [...new Set(lines.map(l => l.id))];
    if (ids.length) {
      const trows = (((await db.getAllAsync(`SELECT id, item_type FROM products WHERE id IN (${ids.map(() => "?").join(",")})`, ids).catch(() => [])) ?? []) as any[]);
      serviceIds = new Set(trows.filter((r: any) => String(r.item_type ?? "goods") === "service").map((r: any) => String(r.id)));
    }
  } catch {}

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const it = lines[lineIdx];
    // uuid, like every other row — the cloud column is uuid, and receipts /
    // pickups key off whatever id the row carries (nothing rebuilds the old
    // `${saleId}_${lineIdx}_${productId}` composite, which would bounce on push).
    const itemId = mintId();
    // FIFO batch consumption in CANONICAL units (selected qty × factor,
    // normalized to smallest — identical numbers for legacy small-base chains).
    // Services never touch stock at all.
    const baseQty = serviceIds.has(it.id)
      ? 0
      : Math.round((Number(it.qty) || 0) * canonFactor(it.id, it.unitId, it.factor));
    let remainingToSell = baseQty;
    let consumedCost = 0;
    const batchRows = ((await db.getAllAsync(
      "SELECT * FROM stock_movements WHERE product_id = ? AND type = 'in' AND remaining_qty > 0 AND status = 'delivered' ORDER BY created_at ASC, id ASC",
      [it.id]
    )) as any[])
      .filter((br: any) => br && br.type === "in" && Number(br.remaining_qty) > 0 && br.status === "delivered")
      .sort((a: any, b: any) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || (a.id ?? "").localeCompare(b.id ?? ""));
    for (const br of batchRows) {
      if (remainingToSell <= 0) break;
      const consume = Math.min(br.remaining_qty, remainingToSell);
      const unitCostWithTransport = br.quantity > 0 && br.allocated_transport ? (Number(br.unit_cost) + Number(br.allocated_transport) / Number(br.quantity)) : Number(br.unit_cost);
      consumedCost += consume * unitCostWithTransport;
      await db.runAsync("UPDATE stock_movements SET remaining_qty = remaining_qty - ? WHERE id = ?", [consume, br.id]);
      remainingToSell -= consume;
    }
    if (!(consumedCost > 0)) {
      // No receiving history (e.g. seed stock) → fall back to the derived
      // base cost (latest received batch) so profit reports carry a real
      // cost basis instead of 0.
      try {
        const m = await loadCatalogModel(db);
        const unitCost = currentCanonicalCost(m.items, m.batches, it.id);
        if (unitCost > 0) consumedCost = unitCost * baseQty;
      } catch {}
    }
    // Fully delivered by default — partial pickup adjusts down afterwards.
    // Unit/line written AFTER the coupon share lands on this line, so
    // sale_items sums to the sale's total exactly (per-line `discount` lives
    // on the sale row — lines just store their already-discounted amounts).
    const share = round2(lineShares[lineIdx] || 0);
    const dLineTotal = share > 0 ? Math.max(0, round2(it.lineTotal - share)) : it.lineTotal;
    const dUnitPrice = share > 0 ? (Number(it.qty) > 0 ? round2(dLineTotal / Number(it.qty)) : dLineTotal) : it.unitPrice;
    const saleItemRow = {
      id: itemId, store_id: storeId, sale_id: saleId, product_id: it.id, product_name: it.name,
      unit_id: it.unitId || null, variant: it.variant || null, quantity: it.qty,
      unit_price: dUnitPrice, cost_price: consumedCost, line_total: dLineTotal,
      quantity_delivered: it.qty, updated_at: now, is_deleted: false,
    };
    await db.runAsync("INSERT INTO sale_items (id,store_id,sale_id,product_id,product_name,unit_id,variant,quantity,unit_price,cost_price,line_total,quantity_delivered,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [itemId, storeId, saleId, it.id, it.name, it.unitId || null, it.variant || null, it.qty, dUnitPrice, consumedCost, dLineTotal, it.qty, now]);
    saleItemRows.push(saleItemRow);
    if (!serviceIds.has(it.id)) {
      await db.runAsync("UPDATE products SET stock_quantity = stock_quantity - ?, current_amount_available = current_amount_available - ? WHERE id = ?", [baseQty, baseQty, it.id]);
    }
  }
  await insertOutbox("sales", "create", sale);
  // The lines travel AFTER the sale row: the cloud enforces sale_items.sale_id
  // -> sales.id, and a pushed sale with no lines reaches every other register
  // as an empty transaction (this is what the tablet was showing).
  for (const row of saleItemRows) {
    try { await insertOutbox("sale_items", "create", row); } catch {}
  }

  // Coupon redemption: log row + status flip + audit, once the sale exists.
  if (coupon && eligIdx.length) {
    await recordCouponRedemption(db, {
      storeId, coupon, saleId, saleNumber,
      actor: { id: cashier.id, name: cashier.name, role: cashier.role },
      amountApplied: discountApplied,
    });
  }

  // Standby handover: cash from post-lock sales is handed to the manager
  // immediately — timestamped hand rows (one per lock event, so multi-shift
  // days don't collide); reconciliation rolls confirmed hands into the next
  // report (daily_reports.standby_carry).
  if (standbyFlag && cashier.id) {
    try {
      const day = localDayKey(now);
      // Overnight-proof: standby sales from before midnight belong to the
      // still-open shift too.
      const prevKey = localDayKey(new Date(now).getTime() - 86400000);
      const inDays = (ts: any) => inLocalDay(ts, day) || inLocalDay(ts, prevKey);
      const mine = (((await db.getAllAsync("SELECT * FROM sales").catch(() => [])) ?? []) as any[])
        .filter((x: any) => x.seller_id === cashier.id && x.store_id === storeId && Number(x.standby ?? 0) === 1
          && x.payment_method === "cash" && inDays(x.created_at) && !Number(x.is_deleted ?? 0));
      const amount = mine.reduce((a, x) => a + Number(x.total ?? 0), 0);
      const count = mine.length;
      // The locked report this handover belongs to: latest submitted/closed
      // report of the cashier (per-shift ids), else the legacy per-day id.
      const myReports = (((await db.getAllAsync("SELECT * FROM daily_reports").catch(() => [])) ?? []) as any[])
        .filter((r: any) => String(r.user_id ?? "") === String(cashier.id)
          && (String(r.status ?? "") === "submitted" || String(r.status ?? "") === "closed"))
        .sort((a: any, b: any) => String(b.submitted_at ?? b.created_at ?? "").localeCompare(String(a.submitted_at ?? a.created_at ?? "")));
      const lockedRepId = myReports[0]?.id ?? reportIdForDay(cashier.id, day);
      const handId = mintId();
      const hands = ((await db.getAllAsync("SELECT * FROM standby_hands").catch(() => [])) ?? []) as any[];
      // Only sales not already swept into a report count: subtract what
      // carried hands already took, so a second handover (or second shift)
      // never double-counts the same cash.
      const carriedHands = hands.filter((h: any) => String(h.cashier_id ?? "") === String(cashier.id)
        && inLocalDay(h.handed_at ?? h.created_at, day)
        && h.carried_into_report_id != null && String(h.carried_into_report_id) !== "");
      const carriedAmt = carriedHands.reduce((a: any, h: any) => a + Number(h.amount ?? 0), 0);
      const carriedCount = carriedHands.reduce((a: any, h: any) => a + Number(h.sale_count ?? 0), 0);
      const freshAmount = Math.max(0, amount - carriedAmt);
      const freshCount = Math.max(0, count - carriedCount);
      const existing = hands.find((h: any) => String(h.cashier_id ?? "") === String(cashier.id)
        && inLocalDay(h.handed_at ?? h.created_at, day)
        && (h.carried_into_report_id == null || String(h.carried_into_report_id) === ""));
      if (existing) {
        await db.runAsync("UPDATE standby_hands SET amount = ?, sale_count = ?, report_id = ?, updated_at = ?, dirty = ? WHERE id = ?",
          [freshAmount, freshCount, lockedRepId, now, 1, (existing as any).id]);
      } else {
        const managers = USERS.filter(u => (u.role === "manager" || u.role === "admin" || u.role === "owner")
          && u.id !== cashier.id && (u.store === storeName || u.role === "owner" || storeId === FALLBACK_STORE_ID));
        const managerId = managers[0]?.id ?? USER_IDS.manager;
        const row = {
          id: handId, store_id: storeId, cashier_id: cashier.id, manager_id: managerId,
          report_id: lockedRepId, carried_into_report_id: null,
          sale_count: freshCount, amount: freshAmount, handed_at: now, cashier_confirmed: 0, confirmed_at: null,
          carried_at: null, created_at: now, updated_at: now, is_deleted: 0, dirty: 1,
        };
        await db.runAsync(
          "INSERT INTO standby_hands (id, store_id, cashier_id, manager_id, report_id, sale_count, amount, handed_at, cashier_confirmed, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          [row.id, row.store_id, row.cashier_id, row.manager_id, row.report_id, row.sale_count, row.amount, row.handed_at, row.cashier_confirmed, row.created_at, row.updated_at]);
        for (const t of managers.slice(0, 4)) {
          try {
            await db.runAsync("INSERT INTO notifications (id, user_id, type, reference_id, message, status, created_at) VALUES (?,?,?,?,?,?,?)",
              [mintId(), t.id, "standby_hand", handId,
                `${cashier.name} rantre ${fmtG(freshAmount)} standby (${freshCount} vant) apre rapò li — kòb la pou ou resevwa.`, "pending", now]);
          } catch {}
        }
      }
    } catch {}
  }

  if (resumedTabId) {
    await db.runAsync("UPDATE suspended_sales SET status = ?, completed_sale_id = ? WHERE id = ?", ["completed", saleId, resumedTabId]);
    await logTabEvent(db, resumedTabId, "completed", `${saleNumber} • ${fmtG(payableTotal)}`);
  }

  let customerPatch: CheckoutResult["customerPatch"] = null;
  if (payment.method === "credit" && customer) {
    const creditBalance = Math.max(0, payableTotal - akompteNum);
    const credit = {
      // A real uuid — the cloud's credits.id column is uuid, and the old
      // `cr_`-prefixed id bounced on every push (so other registers never saw
      // the debt and Credit Analytics stayed stale).
      id: mintId(), store_id: storeId, sale_id: saleId, customer_id: customer.id,
      amount: payableTotal, amount_paid: akompteNum, balance: creditBalance,
      status: creditBalance <= 0 ? "paid" : (akompteNum > 0 ? "partial" : "pending"),
      due_date: creditDueDate, updated_at: now,
      // Sync columns the push needs alongside the row (mirror the sale above).
      created_at: now, lamport_clock: Date.now(), is_deleted: false, will_be_late: false,
    };
    await db.runAsync("INSERT INTO credits (id,store_id,sale_id,customer_id,amount,amount_paid,balance,status,due_date,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [credit.id, credit.store_id, credit.sale_id, credit.customer_id, credit.amount, credit.amount_paid, credit.balance, credit.status, credit.due_date, credit.updated_at]);
    await insertOutbox("credits", "create", credit);
    // First installment — down payment (if any)
    if (akompteNum > 0) {
      const receipt = `REC-${now.slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const { activeShiftIdFor } = await import("./creditPayments");
      const downShiftId = await activeShiftIdFor(db, cashier.id);
      const downPayment = {
        id: mintId(), store_id: storeId, credit_id: credit.id, debt_id: credit.id,
        amount: akompteNum, payment_method: "cash", receipt_number: receipt,
        created_at: now, collected_by: cashier.id, shift_id: downShiftId,
        updated_at: now, lamport_clock: Date.now(), is_deleted: false,
      };
      await db.runAsync("INSERT INTO credit_payments (id, store_id, credit_id, debt_id, amount, payment_method, receipt_number, created_at, collected_by, shift_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [downPayment.id, downPayment.store_id, downPayment.credit_id, downPayment.debt_id, downPayment.amount, downPayment.payment_method, downPayment.receipt_number, downPayment.created_at, downPayment.collected_by, downPayment.shift_id]);
      await insertOutbox("credit_payments", "create", downPayment);
    }
    // Only the unpaid remainder becomes debt
    customerPatch = {
      total_debt: Number(customer.total_debt ?? 0) + creditBalance,
      is_high_risk: creditBalance > 0,
      open_debt_count: Number(customer.open_debt_count ?? 0) + (creditBalance > 0 ? 1 : 0),
    };
    await db.runAsync("UPDATE customers SET total_debt = ? WHERE id = ?", [customerPatch.total_debt, customer.id]);
    await db.runAsync("UPDATE customers SET is_high_risk = ? WHERE id = ?", [customerPatch.is_high_risk ? 1 : 0, customer.id]);
    await db.runAsync("UPDATE customers SET open_debt_count = ? WHERE id = ?", [customerPatch.open_debt_count, customer.id]);
    // The debt change must travel too — otherwise the other register keeps the
    // customer's old balance even though the credit itself synced.
    await insertOutbox("customers", "update", {
      id: customer.id,
      total_debt: customerPatch.total_debt,
      is_high_risk: customerPatch.is_high_risk,
      open_debt_count: customerPatch.open_debt_count,
      updated_at: now, lamport_clock: Date.now(),
    });
  }

  const finalChange = payment.method === "cash" && payment.amountGiven != null ? Math.max(0, payment.amountGiven - payableTotal) : 0;
  let receiptCustomer: { name: string; idCard?: string | null; phone?: string | null; email?: string | null } | null = null;
  if (customer) {
    receiptCustomer = { name: customer.name, idCard: customer.id_card_number ?? null, phone: customer.phone ?? null, email: customer.email ?? null };
  } else if (payment.method === "mobile" && payment.clientLegalName?.trim()) {
    receiptCustomer = { name: payment.clientLegalName.trim(), idCard: null, phone: payment.clientPhone?.trim() || null };
  }
  const receipts = buildReceipts({
    saleId,
    saleNumber,
    storeName,
    createdAt: now,
    cashier: { id: cashier.id, name: cashier.name, role: cashier.role },
    customer: receiptCustomer,
    customerId: customer?.id ?? null,
    items: lines.map(it => ({
      name: it.name,
      variant: it.variant ?? null,
      unitName: it.unitName ?? null,
      qty: it.qty,
      unitPrice: it.unitPrice,
      lineTotal: it.lineTotal,
    })),
    subtotal: finalSubtotal,
    discount: discountApplied,
    total: payableTotal,
    paymentMethod: pm,
    amountPaid,
    amountDue: Math.max(0, payableTotal - amountPaid),
    change: finalChange,
    dueDate: payment.method === "credit" ? creditDueDate : null,
  });
  for (const r of [receipts.customer, receipts.store]) {
    await db.runAsync(
      "INSERT INTO receipts (id,store_id,sale_id,copy_type,receipt_number,sale_number,cashier_id,cashier_name,cashier_role,content,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [r.id, storeId, saleId, r.copyType, r.receiptNumber, saleNumber, r.cashier.id, r.cashier.name, r.cashier.role, JSON.stringify(r), r.createdAt]
    );
  }
  // Realtime: notify Home/Analytics instantly without polling delay
  try { const { salesEvents } = await import("../salesEvents"); salesEvents.emit(); } catch {}

  return { sale, receipts, finalChange, customerPatch };
}

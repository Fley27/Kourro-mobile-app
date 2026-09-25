// Sale checkout pipeline — one smooth path for the whole sale process:
// validate → build record → persist (sale + FIFO stock + credit + receipts).
// Pure wrt React state: takes explicit inputs, returns explicit results.
// POSScreen orchestrates UI (pending commit, resets, modals) around it.
import { insertOutbox } from "../db";
import { buildReceipts, type ReceiptData } from "../receipts";
import { fmtG, fmt } from "../format";
import { loadCatalogModel, currentCanonicalCost, minItemFactor, itemFactor } from "../catalogModel";

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
}): void {
  const { lines, payment, customer, canProcessCreditSale, creditDueDate } = args;
  const subtotal = cartSubtotal(lines);
  if (!lines.length) throw { title: "Panyen vid", message: "" } as CheckoutError;
  if (payment.method === "cash" && payment.amountGiven != null && payment.amountGiven < subtotal) {
    throw {
      title: "Kòb ensifizan",
      message: `Kliyan bay ${fmtG(payment.amountGiven)}, total se ${fmtG(subtotal)}. Rès pou peye: ${fmtG(subtotal - payment.amountGiven)}`,
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
    if (lim !== null && bal + subtotal > lim) {
      throw {
        title: "⚠️ Depase limit kredi — BLOKE",
        message: `${customer.name} (${customer.id_card_number}) • Limit: ${fmtG(lim)} (${customer.credit_limit_source ?? "manyèl/oto"}) • Dèt kounye a: ${fmtG(bal)} • Apre vant: ${fmtG(bal + subtotal)}\n\nSistèm bloke vant kredi sa a!`,
      };
    }
    if (!creditDueDate || isNaN(new Date(creditDueDate).getTime())) {
      throw { title: "Echèans obligatwa", message: "Chwazi yon dat echèans pou kredi a (7/15/30/60 jou oswa lòt dat)" };
    }
    const ak = payment.akompte ?? 0;
    if (ak < 0 || ak > subtotal) {
      throw { title: "Akompte pa valab", message: `Akompte a dwe ant 0 ak ${fmtG(subtotal)}` };
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
}): Promise<CheckoutResult> {
  const { db, storeId, deviceId, storeName, cashier, lines, payment, customer, creditDueDate, resumedTabId, logTabEvent } = args;
  const finalSubtotal = cartSubtotal(lines);
  const saleId = `sale_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const saleNumber = `VTE-${Date.now().toString().slice(-6)}`;
  const isCashLike = payment.method === "cash" || payment.method === "mobile";
  const akompteNum = payment.method === "credit" ? Math.min(Math.max(payment.akompte ?? 0, 0), finalSubtotal) : 0;
  const amountPaid = isCashLike ? (payment.amountGiven != null ? payment.amountGiven : finalSubtotal) : akompteNum;
  const pm: string = payment.method === "mobile" ? (payment.mobileProvider ?? "moncash") : payment.method;
  const now = new Date().toISOString();
  const sale = {
    id: saleId, store_id: storeId, sale_number: saleNumber,
    customer_id: customer?.id ?? null, status: payment.method === "credit" ? "credit" : "completed",
    payment_method: pm, subtotal: finalSubtotal, discount: 0, total: finalSubtotal, amount_paid: amountPaid,
    amount_due: Math.max(0, finalSubtotal - amountPaid),
    seller_id: cashier.id, seller_role: cashier.role,
    device_id: deviceId, lamport_clock: Date.now(), created_at: now, updated_at: now, is_deleted: false,
  };

  await db.runAsync("INSERT INTO sales (id,store_id,sale_number,customer_id,status,payment_method,subtotal,total,amount_paid,amount_due,seller_id,seller_role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [sale.id, sale.store_id, sale.sale_number, sale.customer_id, sale.status, sale.payment_method, sale.subtotal, sale.total, sale.amount_paid, sale.amount_due, sale.seller_id, sale.seller_role, sale.created_at, sale.updated_at]);

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
  try {
    const ids = [...new Set(lines.map(l => l.id))];
    if (ids.length) {
      const trows = (((await db.getAllAsync(`SELECT id, item_type FROM products WHERE id IN (${ids.map(() => "?").join(",")})`, ids).catch(() => [])) ?? []) as any[]);
      serviceIds = new Set(trows.filter((r: any) => String(r.item_type ?? "goods") === "service").map((r: any) => String(r.id)));
    }
  } catch {}

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const it = lines[lineIdx];
    const itemId = `${saleId}_${lineIdx}_${it.id}`;
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
    await db.runAsync("INSERT INTO sale_items (id,store_id,sale_id,product_id,product_name,unit_id,variant,quantity,unit_price,cost_price,line_total,quantity_delivered,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [itemId, storeId, saleId, it.id, it.name, it.unitId || null, it.variant || null, it.qty, it.unitPrice, consumedCost, it.lineTotal, it.qty, now]);
    if (!serviceIds.has(it.id)) {
      await db.runAsync("UPDATE products SET stock_quantity = stock_quantity - ?, current_amount_available = current_amount_available - ? WHERE id = ?", [baseQty, baseQty, it.id]);
    }
  }
  await insertOutbox("sales", "create", sale);

  if (resumedTabId) {
    await db.runAsync("UPDATE suspended_sales SET status = ?, completed_sale_id = ? WHERE id = ?", ["completed", saleId, resumedTabId]);
    await logTabEvent(db, resumedTabId, "completed", `${saleNumber} • ${fmtG(finalSubtotal)}`);
    try { await insertOutbox("suspended_sales", "update", { id: resumedTabId, status: "completed" }); } catch {}
  }

  let customerPatch: CheckoutResult["customerPatch"] = null;
  if (payment.method === "credit" && customer) {
    const creditBalance = Math.max(0, finalSubtotal - akompteNum);
    const credit = {
      id: `cr_${saleId}`, store_id: storeId, sale_id: saleId, customer_id: customer.id,
      amount: finalSubtotal, amount_paid: akompteNum, balance: creditBalance,
      status: creditBalance <= 0 ? "paid" : (akompteNum > 0 ? "partial" : "pending"),
      due_date: creditDueDate, updated_at: now,
    };
    await db.runAsync("INSERT INTO credits (id,store_id,sale_id,customer_id,amount,amount_paid,balance,status,due_date,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [credit.id, credit.store_id, credit.sale_id, credit.customer_id, credit.amount, credit.amount_paid, credit.balance, credit.status, credit.due_date, credit.updated_at]);
    await insertOutbox("credits", "create", credit);
    // First installment — down payment (if any)
    if (akompteNum > 0) {
      const receipt = `REC-${now.slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      await db.runAsync("INSERT INTO credit_payments (id, store_id, credit_id, debt_id, amount, payment_method, receipt_number, created_at, collected_by) VALUES (?,?,?,?,?,?,?,?,?)",
        [`pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, storeId, credit.id, credit.id, akompteNum, "cash", receipt, now, cashier.id]);
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
  }

  const finalChange = payment.method === "cash" && payment.amountGiven != null ? Math.max(0, payment.amountGiven - finalSubtotal) : 0;
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
      variant: it.variant !== "Regular" ? it.variant : null,
      unitName: it.unitName ?? null,
      qty: it.qty,
      unitPrice: it.unitPrice,
      lineTotal: it.lineTotal,
    })),
    subtotal: finalSubtotal,
    discount: 0,
    total: finalSubtotal,
    paymentMethod: pm,
    amountPaid,
    amountDue: Math.max(0, finalSubtotal - amountPaid),
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

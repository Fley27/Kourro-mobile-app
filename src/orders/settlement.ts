// Assisted ordering — settlement: lock the order, turn the collapsed billing
// lines into one sale, then close the order against that sale.
//
// Collapsing happens here and nowhere else (rules.collapseForBilling): the
// live order keeps every round distinct, the receipt shows one summed line per
// identical variant. Payment is blocked by checkSettlement until every line is
// delivered or cancelled, and the manager override exists precisely so a stuck
// line never reaches this file.
import { getDb } from "../db";
import { persistSale, validateCheckout, type CheckoutCustomer, type CheckoutLine, type CheckoutPayment } from "../sales/checkout";
import type { ReceiptData } from "../receipts";
import { billingLines, checkSettlement, closeOrder, lockOrder } from "./store";
import type { Actor } from "./types";

export type SettleSuccess = {
  ok: true;
  saleId: string;
  saleNumber: string;
  total: number;
  change: number;
  receipts: { customer: ReceiptData; store: ReceiptData };
};
export type SettleFailure = { ok: false; error: string; stuckNames: string[] };
export type SettleResult = SettleSuccess | SettleFailure;

export async function settleOrder(args: {
  orderId: string;
  storeId: string;
  deviceId: string;
  storeName: string;
  cashier: Actor;
  payment: CheckoutPayment;
}): Promise<SettleResult> {
  const gate = await checkSettlement(args.orderId);
  const order = gate.order;
  if (!order) return { ok: false, error: "Kòmand lan pa jwenn.", stuckNames: [] };
  if (order.status === "closed") return { ok: false, error: "Kòmand lan deja fèmen.", stuckNames: [] };
  if (order.status === "cancelled") return { ok: false, error: "Kòmand lan anile.", stuckNames: [] };

  // open/ready → the gate must pass and we lock first; settling → a previous
  // attempt already locked it (persist failed mid-way), so retry straight through.
  if (order.status === "open" || order.status === "ready") {
    if (!gate.ok) {
      return {
        ok: false,
        error: gate.error ?? "Kòmand lan pa pare.",
        stuckNames: gate.stuck.map(l => l.name ?? "Atik"),
      };
    }
    const locked = await lockOrder(args.orderId, args.cashier);
    if (!locked.ok) return { ok: false, error: locked.error, stuckNames: [] };
  }

  const bill = await billingLines(args.orderId);
  if (!bill.length) {
    return { ok: false, error: "Poko gen liy livre — pa gen kantite pou peye.", stuckNames: [] };
  }
  const lines: CheckoutLine[] = bill.map(b => ({
    id: b.product_id ?? b.key,
    name: b.name,
    unitId: b.unit_id,
    unitName: b.unit_name,
    factor: b.factor,
    variant: b.variant ?? "Regular",
    qty: b.qty,
    unitPrice: b.unit_price,
    lineTotal: b.line_total,
  }));

  // The customer picked on the order rides into the sale (customer_id on the
  // sale row + receipt name) — no re-picking at the tender step.
  const db = await getDb();
  let customer: CheckoutCustomer = null;
  if (order.customer_id) {
    // getAllAsync (not getFirstAsync): the RAM/web mock only implements
    // getAllAsync — a missing method here throws synchronously and the whole
    // settlement rejects, so an order WITH a customer could never be paid.
    const rows = ((await db
      .getAllAsync("SELECT * FROM customers WHERE id = ?", [order.customer_id])
      .catch(() => [])) ?? []) as Record<string, any>[];
    const row = rows[0] ?? null;
    if (row) {
      customer = {
        id: String(row.id),
        name: String(row.name ?? order.customer_name ?? ""),
        id_card_number: row.id_card_number ?? null,
        phone: row.phone ?? null,
        email: row.email ?? null,
        total_debt: Number(row.total_debt ?? 0),
        credit_limit: row.credit_limit ?? null,
        credit_limit_source: row.credit_limit_source ?? null,
        is_high_risk: row.is_high_risk ?? 0,
        open_debt_count: Number(row.open_debt_count ?? 0),
      };
    }
  }

  try {
    validateCheckout({
      lines,
      payment: args.payment,
      customer,
      canProcessCreditSale: false,
      creditDueDate: "",
    });
  } catch (e: any) {
    return {
      ok: false,
      error: [e?.title, e?.message].filter(Boolean).join(" — ") || "Peyman an pa valab.",
      stuckNames: [],
    };
  }

  let sale: any;
  let receipts: { customer: ReceiptData; store: ReceiptData };
  let change = 0;
  try {
    const res = await persistSale({
      db,
      storeId: args.storeId,
      deviceId: args.deviceId,
      storeName: args.storeName,
      cashier: { id: args.cashier.id, name: args.cashier.name, role: args.cashier.role },
      lines,
      payment: args.payment,
      customer,
      creditDueDate: "",
      resumedTabId: null,
      logTabEvent: async () => {},
    });
    sale = res.sale;
    receipts = res.receipts;
    change = res.finalChange;
  } catch {
    return {
      ok: false,
      error: "Peyman an pa pase — kòmand lan rete nan eta «ap peye». Eseye ankò.",
      stuckNames: [],
    };
  }

  const closed = await closeOrder(args.orderId, sale.id, args.cashier);
  if (!closed.ok) return { ok: false, error: closed.error, stuckNames: [] };

  return {
    ok: true,
    saleId: sale.id,
    saleNumber: sale.sale_number ?? "",
    total: Number(sale.total ?? 0),
    change,
    receipts,
  };
}

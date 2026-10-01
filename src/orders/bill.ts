import type { ReceiptData, ReceiptItem } from "../receipts";
import { orderCodeLabel } from "./rules";
import type { Order, OrderLine } from "./types";

/**
 * Build the synthetic "Fakti" for an open order — a bill over the order's
 * active lines. Pure: no DB writes, no sale, no settlement. The printed /
 * shared result is a regular ReceiptData with kind "order_bill" so the
 * existing ReceiptModal + receipt renderers serve it unchanged.
 *
 * - waiting / progress / delivered lines are all billed (a table check shows
 *   everything not cancelled, unlike payment which bills delivered only).
 * - a closed order prints as already paid; anything else reads "Pa peye".
 */
export function buildOrderBill(input: {
  order: Order;
  lines: OrderLine[];
  storeName: string;
}): { customer: ReceiptData; store: ReceiptData } {
  const { order, lines, storeName } = input;
  const active = lines.filter(l => l.status !== "cancelled" && !l.is_deleted);
  const items: ReceiptItem[] = active.map(l => ({
    name: l.name ?? "Atik",
    unitName: l.unit_name ?? null,
    variant: l.variant ?? null,
    qty: Number(l.qty) || 0,
    unitPrice: Number(l.unit_price) || 0,
    lineTotal: Number(l.line_total) || 0,
  }));
  const total = Math.round(items.reduce((s, it) => s + it.lineTotal, 0) * 100) / 100;
  const paid = order.status === "closed";
  const code = orderCodeLabel(order);
  const base: ReceiptData = {
    id: `bill-${order.id}`,
    kind: "order_bill",
    copyType: "customer",
    receiptNumber: `FAKTI-${code}`,
    saleNumber: code,
    saleId: order.id,
    storeName,
    createdAt: order.created_at,
    cashier: {
      id: order.created_by,
      name: order.created_by_name ?? "—",
      role: order.mode === "restaurant" ? "Sèvè" : "Vandè",
    },
    customer: order.customer_name
      ? { name: order.customer_name, phone: order.customer_phone ?? null }
      : null,
    customerId: null,
    items,
    subtotal: total,
    discount: 0,
    total,
    paymentMethod: "order_bill",
    amountPaid: paid ? total : 0,
    amountDue: paid ? 0 : total,
    change: 0,
    dueDate: null,
  };
  return {
    customer: { ...base, id: `bill-${order.id}-customer`, copyType: "customer" },
    store: { ...base, id: `bill-${order.id}-store`, copyType: "store", receiptNumber: `FAKTI-${code}-M` },
  };
}

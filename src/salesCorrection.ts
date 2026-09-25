import { fmtG, fmt } from "./format";
import { getUserById } from "./users";
import { insertOutbox } from "./db";
import { buildReceipts } from "./receipts";

export type PaymentMethod = "cash" | "moncash" | "natcash" | "credit";

export type SaleDetail = {
  sale: any;
  items: any[];
  customer: any | null;
  credit: any | null;
  payments: any[];
};

export async function findSaleDetail(db: any, storeId: string, query: string): Promise<SaleDetail | null> {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return null;
  const sales = (await db.getAllAsync("SELECT * FROM sales")) as any[];
  const sale = sales.find((s: any) => {
    const store = s.store_id ?? storeId;
    if (String(store) !== storeId && String(store) !== "demo-store-id") return false;
    return String(s.id ?? "").toLowerCase() === q || String(s.sale_number ?? s.id ?? "").toLowerCase() === q;
  });
  if (!sale) return null;
  const items = ((await db.getAllAsync("SELECT * FROM sale_items")) as any[]).filter((it: any) => it.sale_id === sale.id);
  const customers = (await db.getAllAsync("SELECT * FROM customers")) as any[];
  const customer = customers.find((c: any) => c.id === sale.customer_id) ?? null;
  const credit = ((await db.getAllAsync("SELECT * FROM credits")) as any[]).find((c: any) => c.sale_id === sale.id || c.id === `cr_${sale.id}`) ?? null;
  let payments: any[] = [];
  if (credit) {
    payments = ((await db.getAllAsync("SELECT * FROM credit_payments")) as any[]).filter((p: any) => p.credit_id === credit.id || p.debt_id === credit.id);
  }
  return { sale, items, customer, credit, payments };
}

export function describeChange(detail: SaleDetail, target: "cash" | "credit") {
  const { sale, credit } = detail;
  const total = Number(sale.total ?? 0);
  if (target === "cash") {
    const outstanding = Math.max(0, Number(credit?.balance ?? 0));
    return {
      to: "Kach",
      fromLabel: "Kredi",
      toLabel: "Kach",
      total,
      outstandingRemoved: outstanding,
      paymentsKept: detail.payments.length,
    };
  }
  return {
    to: "Kredi",
    fromLabel: "Kach",
    toLabel: "Kredi",
    total,
    newOutstanding: total,
    customerName: detail.customer?.name ?? null,
  };
}

export async function changeSalePaymentMethod(
  detail: SaleDetail,
  target: "cash" | "credit",
  opts: { db: any; storeId: string; storeName: string; currentUser: any }
): Promise<{ sale: any; receiptNumber: string; previous: string; target: string }> {
  const { sale, items, customer, credit } = detail;
  const db = opts.db;
  const now = new Date().toISOString();
  const previous = String(sale.payment_method ?? "cash").toLowerCase();
  if (target === previous) {
    const e: any = new Error("Vant sa a deja anrejistre konsa");
    e.code = "already";
    throw e;
  }
  const total = Number(sale.total ?? 0);
  if (target === "credit" && !customer) {
    const e: any = new Error("Vant sa a pa gen kliyan asosye. Ou dwe ajoute kliyan an anvan konvèti an kredi.");
    e.code = "no_customer";
    throw e;
  }
  const cashierName = ((await db.getAllAsync("SELECT * FROM employees")) as any[]).find((e2: any) => e2.id === sale.seller_id)?.full_name
    ?? getUserById(sale.seller_id)?.name
    ?? "Kesye";

  const newPaymentMethod = target as string;
  const newStatus = target === "credit" ? "pending" : "completed";
  const newPaid = target === "credit" ? 0 : total;
  const newDue = target === "credit" ? total : 0;

  if (target === "cash") {
    if (credit) {
      const cid = credit.id ?? `cr_${sale.id}`;
      const outstanding = Math.max(0, Number(credit.balance ?? 0));
      if (customer) {
        const custTotal = Math.max(0, Number(customer.total_debt ?? 0) - outstanding);
        await db.runAsync(
          "UPDATE customers SET total_debt = ?, is_high_risk = ?, open_debt_count = ? WHERE id = ?",
          [custTotal, custTotal > 0 ? 1 : 0, Math.max(0, (Number(customer.open_debt_count ?? 0)) - (outstanding > 0 ? 1 : 0)), customer.id]
        );
      }
      await db.runAsync("DELETE FROM credits WHERE id = ?", [cid]);
      try { await insertOutbox("credits", "delete", { id: cid, sale_id: sale.id }); } catch {}
    }
  } else {
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30);
    const ds = dueDate.toISOString().slice(0, 10);
    const creditRec = {
      id: `cr_${sale.id}`,
      store_id: opts.storeId,
      sale_id: sale.id,
      customer_id: customer.id,
      amount: total,
      amount_paid: 0,
      balance: total,
      status: "pending",
      due_date: ds,
      updated_at: now,
    };
    await db.runAsync(
      "INSERT INTO credits (id,store_id,sale_id,customer_id,amount,amount_paid,balance,status,due_date,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [creditRec.id, creditRec.store_id, creditRec.sale_id, creditRec.customer_id, creditRec.amount, creditRec.amount_paid, creditRec.balance, creditRec.status, creditRec.due_date, creditRec.updated_at]
    );
    const custTotal = Number(customer.total_debt ?? 0) + total;
    await db.runAsync(
      "UPDATE customers SET total_debt = ?, is_high_risk = ?, open_debt_count = open_debt_count + 1 WHERE id = ?",
      [custTotal, 1, customer.id]
    );
    try { await insertOutbox("credits", "create", creditRec); } catch {}
  }

  const updatedSale = {
    ...sale,
    payment_method: newPaymentMethod,
    amount_paid: newPaid,
    amount_due: newDue,
    status: newStatus,
    updated_at: now,
  };
  await db.runAsync(
    "UPDATE sales SET payment_method = ?, amount_paid = ?, amount_due = ?, status = ?, updated_at = ? WHERE id = ?",
    [newPaymentMethod, newPaid, newDue, newStatus, now, sale.id]
  );
  try { await insertOutbox("sales", "update", updatedSale); } catch {}

  const receiptItems = items.map((it: any) => ({
    name: it.product_name ?? it.name ?? "—",
    variant: it.variant && it.variant !== "Regular" ? it.variant : null,
    unitName: it.unit_id ?? null,
    qty: Number(it.quantity ?? 0),
    unitPrice: Number(it.unit_price ?? 0),
    lineTotal: Number(it.line_total ?? 0),
  }));
  const receipts = buildReceipts({
    saleId: sale.id,
    saleNumber: sale.sale_number ?? sale.id,
    storeName: opts.storeName,
    createdAt: sale.created_at ?? now,
    cashier: { id: sale.seller_id ?? null, name: cashierName, role: sale.seller_role ?? "cashier" },
    customer: customer ? { name: customer.name, idCard: customer.id_card_number ?? null, phone: customer.phone ?? null, email: customer.email ?? null } : null,
    customerId: customer?.id ?? null,
    items: receiptItems,
    subtotal: Number(sale.subtotal ?? total),
    discount: Number(sale.discount ?? 0),
    total,
    paymentMethod: newPaymentMethod,
    amountPaid: newPaid,
    amountDue: newDue,
    change: 0,
    dueDate: target === "credit" ? (new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)) : null,
  });
  for (const r of [receipts.customer, receipts.store]) {
    await db.runAsync(
      "INSERT OR REPLACE INTO receipts (id,store_id,sale_id,copy_type,receipt_number,sale_number,cashier_id,cashier_name,cashier_role,content,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [r.id, opts.storeId, sale.id, r.copyType, r.receiptNumber, sale.sale_number ?? sale.id, r.cashier.id, r.cashier.name, r.cashier.role, JSON.stringify(r), r.createdAt]
    );
  }

  return { sale: updatedSale, receiptNumber: receipts.customer.receiptNumber, previous, target };
}

export function salePaymentLabel(p: string): string {
  if (p === "cash") return "Kach";
  if (p === "moncash") return "MonCash";
  if (p === "natcash") return "NatCash";
  if (p === "credit") return "Kredi";
  return p;
}

export function formatMoney(n: number): string {
  return `${fmtG(n)}`;
}
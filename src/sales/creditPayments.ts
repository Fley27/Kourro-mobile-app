import { fmtG } from "../format";
import { mintId } from "../db/ids";
import { insertOutbox } from "../db";
// Shared credit reimbursement — the same flow as Credits screen pay,
// usable from transaction detail (Customers, POS) without duplicating writes.
export type CreditPayResult = {
  payId: string;
  receipt: string;
  amount: number;
  finalBalance: number;
  createdAt: string;
};

// The shift a cash collection belongs to: the cashier's live (open/pending)
// shift, else the one whose window contains the moment. Null when unresolvable.
export async function activeShiftIdFor(db: any, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const nowIso = new Date().toISOString();
    const mine = ((await db.getAllAsync(
      "SELECT id, status, start_time, end_time FROM shifts WHERE cashier_id = ? ORDER BY start_time DESC LIMIT 20",
      [userId]
    ).catch(() => [])) ?? []) as any[];
    const live = mine.find((s: any) => s.status === "open" || s.status === "pending")
      ?? mine.find((s: any) => String(s.start_time ?? "") <= nowIso && (!s.end_time || String(s.end_time) >= nowIso));
    return live?.id ? String(live.id) : null;
  } catch { return null; }
}

export async function payCreditDebt(
  db: any,
  debt: any,
  customer: any | null,
  amount: number,
  collectedBy: string | null
): Promise<CreditPayResult> {
  const payments = ((await db.getAllAsync(
    "SELECT * FROM credit_payments WHERE credit_id = ? OR debt_id = ?",
    [debt.id, debt.id]
  ).catch(() => [])) as any[]) ?? [];
  const paidSoFar = payments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const computedDue = Math.max(0, Number(debt.amount || 0) - paidSoFar);
  if (!(amount > 0)) throw new Error("Montan pa valab");
  if (amount > computedDue) throw new Error(`Rès dèt sa a se sèlman ${fmtG(computedDue)}`);
  const receipt = `REC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const payId = mintId();
  const createdAt = new Date().toISOString();
  // Pin the payment to the shift it was collected in — reports must only show
  // collections under that exact shift (multi-shift days, overnight windows).
  const shiftId = await activeShiftIdFor(db, collectedBy);
  const payment = {
    id: payId, store_id: debt.store_id, credit_id: debt.id, debt_id: debt.id,
    amount, payment_method: "cash", receipt_number: receipt,
    created_at: createdAt, collected_by: collectedBy, shift_id: shiftId,
    updated_at: createdAt, lamport_clock: Date.now(), is_deleted: false,
  };
  await db.runAsync(
    "INSERT INTO credit_payments (id, store_id, credit_id, debt_id, amount, payment_method, receipt_number, created_at, collected_by, shift_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [payment.id, payment.store_id, payment.credit_id, payment.debt_id, payment.amount, payment.payment_method, payment.receipt_number, payment.created_at, payment.collected_by, payment.shift_id]
  );
  // Realtime: without these queues the payment stays on this device and the
  // other register's Credit Analytics keeps showing the old balance.
  try { await insertOutbox("credit_payments", "create", payment); } catch {}
  const newPaid = paidSoFar + amount;
  const finalBalance = Math.max(0, Number(debt.amount || 0) - newPaid);
  const newStatus = finalBalance <= 0 ? "paid" : "partial";
  await db.runAsync("UPDATE credits SET amount_paid = ?, balance = ?, status = ? WHERE id = ?", [
    newPaid,
    finalBalance,
    newStatus,
    debt.id,
  ]);
  try {
    await insertOutbox("credits", "update", {
      id: debt.id,
      amount_paid: newPaid,
      balance: finalBalance,
      status: newStatus,
      updated_at: createdAt, lamport_clock: Date.now(),
    });
  } catch {}
  if (customer) {
    const newTotal = Math.max(0, Number(customer.total_debt || 0) - amount);
    await db.runAsync("UPDATE customers SET total_debt = ?, is_high_risk = ? WHERE id = ?", [
      newTotal,
      newTotal > 0 ? 1 : 0,
      customer.id,
    ]);
    const wasOverdue = debt.due_date && new Date(debt.due_date) < new Date();
    const existingLimit =
      customer.credit_limit === null || customer.credit_limit === undefined || customer.credit_limit === 0
        ? null
        : Number(customer.credit_limit);
    let nextLimit: number | null = null;
    if (wasOverdue && finalBalance === 0) {
      const overdueAmount = Number(debt.amount || 0) - amount;
      const penaltyCut = existingLimit !== null ? Math.max(0, existingLimit * 0.25) : Math.max(0, overdueAmount * 0.25);
      nextLimit = existingLimit !== null ? Math.max(0, existingLimit - penaltyCut) : Math.max(0, overdueAmount * 0.75);
      await db.runAsync("UPDATE customers SET credit_limit = ?, credit_limit_source = ? WHERE id = ?", [
        nextLimit,
        "auto",
        customer.id,
      ]);
    }
    // One queue entry carries the whole debt/limit change to the other devices.
    try {
      await insertOutbox("customers", "update", {
        id: customer.id,
        total_debt: newTotal,
        is_high_risk: newTotal > 0,
        ...(nextLimit !== null ? { credit_limit: nextLimit, credit_limit_source: "auto" } : {}),
        updated_at: createdAt, lamport_clock: Date.now(),
      });
    } catch {}
  }
  return { payId, receipt, amount, finalBalance, createdAt };
}

export async function creditDueFor(db: any, debtId: string, amount: number): Promise<{ due: number; paid: number; payments: any[] }> {
  const payments = ((await db.getAllAsync(
    "SELECT * FROM credit_payments WHERE credit_id = ? OR debt_id = ? ORDER BY created_at DESC",
    [debtId, debtId]
  ).catch(() => [])) as any[]) ?? [];
  const paid = payments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  return { due: Math.max(0, Number(amount || 0) - paid), paid, payments };
}

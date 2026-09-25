import { fmtG } from "../format";
// Shared credit reimbursement — the same flow as Credits screen pay,
// usable from transaction detail (Customers, POS) without duplicating writes.
export type CreditPayResult = {
  payId: string;
  receipt: string;
  amount: number;
  finalBalance: number;
  createdAt: string;
};

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
  const payId = `pay-${Date.now()}`;
  const createdAt = new Date().toISOString();
  await db.runAsync(
    "INSERT INTO credit_payments (id, store_id, credit_id, debt_id, amount, payment_method, receipt_number, created_at, collected_by) VALUES (?,?,?,?,?,?,?,?,?)",
    [payId, debt.store_id, debt.id, debt.id, amount, "cash", receipt, createdAt, collectedBy]
  );
  const newPaid = paidSoFar + amount;
  const finalBalance = Math.max(0, Number(debt.amount || 0) - newPaid);
  await db.runAsync("UPDATE credits SET amount_paid = ?, balance = ?, status = ? WHERE id = ?", [
    newPaid,
    finalBalance,
    finalBalance <= 0 ? "paid" : "partial",
    debt.id,
  ]);
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
    if (wasOverdue && finalBalance === 0) {
      const overdueAmount = Number(debt.amount || 0) - amount;
      const penaltyCut = existingLimit !== null ? Math.max(0, existingLimit * 0.25) : Math.max(0, overdueAmount * 0.25);
      const nextLimit = existingLimit !== null ? Math.max(0, existingLimit - penaltyCut) : Math.max(0, overdueAmount * 0.75);
      await db.runAsync("UPDATE customers SET credit_limit = ?, credit_limit_source = ? WHERE id = ?", [
        nextLimit,
        "auto",
        customer.id,
      ]);
    }
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

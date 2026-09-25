// Shared customer data operations — one edit here applies everywhere
// (cart sheet, tablet panel, pay modal, receipt flow).
import { fullNameOf, composeAddress, EMPTY_CUSTOMER_FORM, type CustomerFormData } from "../components/CustomerForm";

function splitName(full: string): { first: string; last: string } {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

// Single record -> form mapper, used by every Edit entry point (POS, receipt,
// Customers screen). One edit here applies everywhere.
export function customerToFormData(c: any): CustomerFormData {
  const { first, last } = splitName(c?.name ?? "");
  return {
    ...EMPTY_CUSTOMER_FORM,
    firstName: c?.first_name ?? first,
    lastName: c?.last_name ?? last,
    idDoc: c?.id_card_number ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    marketingConsent: !!c?.marketing_consent,
    country: c?.country ?? "HT",
    department: c?.department ?? "",
    commune: c?.commune ?? "",
    line1: c?.address_line1 ?? "",
    line2: c?.address_line2 ?? "",
    birthDay: c?.birth_day ?? "",
    birthMonth: c?.birth_month ?? "",
    birthYear: c?.birth_year ?? "",
  };
}

export async function insertCustomerRecord(db: any, storeId: string, data: CustomerFormData): Promise<any> {
  const id = `cust-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const fresh: any = {
    id, store_id: storeId, name: fullNameOf(data),
    phone: data.phone.trim() || null, address: composeAddress(data),
    id_card_number: data.idDoc.trim(), total_debt: 0,
    credit_limit: null, credit_limit_source: null,
    is_high_risk: false, open_debt_count: 0,
    email: data.email.trim() || null,
    first_name: data.firstName.trim(), last_name: data.lastName.trim(),
    birth_day: data.birthDay, birth_month: data.birthMonth, birth_year: data.birthYear,
    country: data.country, department: data.department.trim() || null,
    commune: data.commune.trim(), address_line1: data.line1.trim(),
    address_line2: data.line2.trim() || null,
    marketing_consent: data.marketingConsent ? 1 : 0,
    created_at: new Date().toISOString(),
  };
  await db.runAsync("INSERT INTO customers (id, store_id, name, phone, address, id_card_number, total_debt, credit_limit, credit_limit_source, is_high_risk, open_debt_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [fresh.id, fresh.store_id, fresh.name, fresh.phone, fresh.address, fresh.id_card_number, fresh.total_debt, fresh.credit_limit, fresh.credit_limit_source, fresh.is_high_risk ? 1 : 0, fresh.open_debt_count]);
  if (fresh.email) {
    try { await db.runAsync("UPDATE customers SET email = ? WHERE id = ?", [fresh.email, fresh.id]); } catch {}
  }
  try {
    await db.runAsync("UPDATE customers SET first_name = ?, last_name = ?, birth_day = ?, birth_month = ?, birth_year = ?, country = ?, department = ?, commune = ?, address_line1 = ?, address_line2 = ?, marketing_consent = ? WHERE id = ?",
      [fresh.first_name, fresh.last_name, fresh.birth_day, fresh.birth_month, fresh.birth_year, fresh.country, fresh.department, fresh.commune, fresh.address_line1, fresh.address_line2, fresh.marketing_consent, fresh.id]);
  } catch {}
  return fresh;
}

export async function updateCustomerRecord(db: any, id: string, data: CustomerFormData): Promise<any> {
  const patch = {
    name: fullNameOf(data),
    phone: data.phone.trim() || null,
    address: composeAddress(data),
    id_card_number: data.idDoc.trim(),
    email: data.email.trim() || null,
    first_name: data.firstName.trim(),
    last_name: data.lastName.trim(),
    birth_day: data.birthDay,
    birth_month: data.birthMonth,
    birth_year: data.birthYear,
    country: data.country,
    department: data.department.trim() || null,
    commune: data.commune.trim(),
    address_line1: data.line1.trim(),
    address_line2: data.line2.trim() || null,
    marketing_consent: data.marketingConsent ? 1 : 0,
  };
  await db.runAsync("UPDATE customers SET name = ?, phone = ?, address = ?, id_card_number = ?, email = ?, first_name = ?, last_name = ?, birth_day = ?, birth_month = ?, birth_year = ?, country = ?, department = ?, commune = ?, address_line1 = ?, address_line2 = ?, marketing_consent = ? WHERE id = ?",
    [patch.name, patch.phone, patch.address, patch.id_card_number, patch.email, patch.first_name, patch.last_name, patch.birth_day, patch.birth_month, patch.birth_year, patch.country, patch.department, patch.commune, patch.address_line1, patch.address_line2, patch.marketing_consent, id]);
  return patch;
}

export async function fetchCustomerStats(db: any, customerId: string): Promise<{ visits: number; spent: number; lastVisit: string | null; firstVisit: string | null }> {
  try {
    const sales = ((await db.getAllAsync("SELECT * FROM sales WHERE customer_id = ?", [customerId]).catch(() => [])) as any[]) ?? [];
    const done = sales.filter((s: any) => String(s.status ?? "") !== "cancelled");
    const dates = done.map((s: any) => String(s.created_at ?? "")).filter(Boolean).sort();
    const lastVisit = dates.length ? dates[dates.length - 1] : null;
    return {
      visits: done.length,
      spent: done.reduce((s: number, x: any) => s + Number(x.total ?? 0), 0),
      lastVisit,
      firstVisit: dates.length ? dates[0] : null,
    };
  } catch {
    return { visits: 0, spent: 0, lastVisit: null, firstVisit: null };
  }
}

export async function fetchCustomerNotes(db: any, customerId: string): Promise<any[]> {
  try {
    const notes = ((await db.getAllAsync("SELECT * FROM customer_notes WHERE customer_id = ?", [customerId]).catch(() => [])) as any[]) ?? [];
    return notes.sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  } catch {
    return [];
  }
}

export async function addCustomerNote(db: any, storeId: string, customerId: string, text: string, createdBy: string | null): Promise<any> {
  const row = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    store_id: storeId, customer_id: customerId, text,
    created_by: createdBy, created_at: new Date().toISOString(),
  };
  await db.runAsync("INSERT INTO customer_notes (id, store_id, customer_id, text, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [row.id, row.store_id, row.customer_id, row.text, row.created_by, row.created_at]);
  return row;
}

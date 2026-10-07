// Shared customer data operations — one edit here applies everywhere
// (cart sheet, tablet panel, pay modal, receipt flow).
import { fullNameOf, composeAddress, EMPTY_CUSTOMER_FORM, type CustomerFormData } from "../components/CustomerForm";
import { normalizePhoneInput, inferPhoneIso, phonePatternFor } from "../phoneFormat";
import { insertOutbox } from "../db";
import { mintId } from "../db/ids";

/**
 * Canonical identity key for a phone number: digits-only with any known
 * international prefix dropped, so "+509 3712 3456", "50937123456" and
 * "37123456" all resolve to the same person. Phone numbers are unique —
 * this key is how proformat/coupon customer resolution recognizes them.
 */
export function phoneKey(value: string | null | undefined): string {
  const digits = normalizePhoneInput(String(value ?? ""));
  if (!digits) return "";
  const iso = inferPhoneIso(digits);
  if (iso) {
    const p = phonePatternFor(iso);
    if (p && digits.startsWith(p.dial) && digits.length > p.len) {
      return digits.slice(p.dial.length);
    }
  }
  return digits;
}

export type ResolveCustomerResult = { customer: any; created: boolean };

/**
 * Resolve a customer by phone (proformat / coupon issuance).
 * Found → the existing record wins (linked as-is, typed name ignored).
 * Not found → a new customer record is created, flagged as a prospect until
 * staff confirms it. Never stores loose name/phone text — callers keep the
 * returned customer id.
 */
export async function resolveCustomerByPhone(
  db: any,
  storeId: string,
  args: { phone: string; name?: string; allowCreate?: boolean }
): Promise<ResolveCustomerResult> {
  const key = phoneKey(args.phone);
  if (!key) throw { title: "Telefòn obligatwa", message: "Antre yon nimewo telefòn valab." } as any;
  let rows: any[] = [];
  try {
    rows = ((await db.getAllAsync(
      "SELECT * FROM customers WHERE (store_id = ? OR store_id IS NULL) AND (is_deleted = 0 OR is_deleted IS NULL)",
      [storeId]
    )) as any[]) ?? [];
  } catch { rows = []; }
  // Deterministic pick when legacy data holds duplicates: newest record wins.
  const matches = rows
    .filter(c => phoneKey(c?.phone) === key)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  if (matches.length) return { customer: matches[0], created: false };

  if (args.allowCreate === false) {
    throw { title: "Pa jwenn kliyan", message: "Nimewo telefòn sa a pa gen kliyan ankò." } as any;
  }
  const name = String(args.name ?? "").trim();
  if (!name) throw { title: "Non obligatwa", message: "Antre non kliyan an — nimewo sa a poko egziste." } as any;
  const parts = name.split(/\s+/).filter(Boolean);
  const data: CustomerFormData = {
    ...EMPTY_CUSTOMER_FORM,
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
    phone: normalizePhoneInput(args.phone),
  };
  const customer = await insertCustomerRecord(db, storeId, data, { isProspect: true });
  try { await insertOutbox("customers", "create", { ...customer, is_prospect: 1 }, db); } catch {}
  return { customer, created: true };
}

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
    prospect: !!c?.is_prospect,
    clearProspect: false,
  };
}

export async function insertCustomerRecord(
  db: any,
  storeId: string,
  data: CustomerFormData,
  opts?: { isProspect?: boolean }
): Promise<any> {
  const id = mintId();
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
  if (opts?.isProspect) {
    // Phone-resolution auto-creations start as prospects — staff confirms later.
    try { await db.runAsync("UPDATE customers SET is_prospect = 1 WHERE id = ?", [fresh.id]); fresh.is_prospect = 1; } catch {}
  }
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
  if (data.clearProspect) {
    // Staff confirmed the auto-created record: prospect flag comes off (manual
    // clear only — nothing else in the app ever flips it back).
    try { await db.runAsync("UPDATE customers SET is_prospect = 0 WHERE id = ?", [id]); } catch {}
    return { ...patch, is_prospect: 0 };
  }
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
    id: mintId(),
    store_id: storeId, customer_id: customerId, text,
    created_by: createdBy, created_at: new Date().toISOString(),
  };
  await db.runAsync("INSERT INTO customer_notes (id, store_id, customer_id, text, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [row.id, row.store_id, row.customer_id, row.text, row.created_by, row.created_at]);
  return row;
}

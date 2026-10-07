import { mintId } from "../db/ids";
// Promotions core types + the small math helpers everything else shares.
// Three entities: proformat (immutable price-check record), discount (bare
// reusable percentage), coupon (single-use activation layer) — plus the
// redemption log and audit trail they write into.

export type PromoActor = { id: string | null; name: string; role: string };

/** One line of a proformat. Immutable snapshot: frozen price AND the cost
 *  basis at creation time (the profit-scope math reads `cost` later). */
export type ProformatItem = {
  product_id: string;
  name: string;
  unit_id: string | null;
  unit_name: string | null;
  factor: number;
  variant: string;
  qty: number;
  unit_price: number;
  line_total: number;
  /** Total cost basis for the line (canonical cost × canonical qty). */
  cost: number;
  /** Base (pre-bundle) unit price — what the POS cart freezes on load. */
  base_price?: number | null;
};

export type Proformat = {
  id: string;
  store_id: string;
  receipt_number: string;
  customer_id: string;
  items: ProformatItem[];
  subtotal: number;
  total: number;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_role?: string | null;
  device_id?: string | null;
  lamport_clock?: number;
  created_at?: string | null;
  updated_at?: string | null;
  is_deleted?: number | boolean;
  dirty?: number;
};

export type Discount = {
  id: string;
  store_id: string;
  percentage: number;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_role?: string | null;
  device_id?: string | null;
  lamport_clock?: number;
  created_at?: string | null;
  updated_at?: string | null;
  is_deleted?: number | boolean;
  dirty?: number;
};

/** The general purchase gate — checked with AND semantics at redemption.
 *  Conditional sleepy-products are just `products`; any coupon may also
 *  carry a minimum spend and/or a minimum item count. */
export type CouponMinProduct = { product_id: string; name: string; qty: number };
export type CouponMin = {
  products?: CouponMinProduct[];
  min_amount?: number | null;
  min_items?: number | null;
};

export type CouponType = "unconditional" | "conditional";
export type CouponStatus = "unused" | "redeemed" | "expired";

export type Coupon = {
  id: string;
  store_id: string;
  code: string;
  discount_id: string;
  discount_percentage: number;
  proformat_id?: string | null;
  customer_id: string;
  type: CouponType;
  min?: CouponMin | null;
  cap?: number | null;
  expires_at: string;
  status: CouponStatus;
  /** Legacy column, always null now: every discount is computed at redemption. */
  flat_amount_goud?: number | null;
  message?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_role?: string | null;
  device_id?: string | null;
  lamport_clock?: number;
  created_at?: string | null;
  updated_at?: string | null;
  is_deleted?: number | boolean;
  dirty?: number;
};

export type ExpiryPreset = { key: string; label: string; days: number };

/** Fixed presets — the only expiry choices the issue flow offers. */
export const EXPIRY_PRESETS: ExpiryPreset[] = [
  { key: "3d", label: "3 jou", days: 3 },
  { key: "7d", label: "1 semèn", days: 7 },
  { key: "15d", label: "15 jou", days: 15 },
  { key: "30d", label: "1 mwa", days: 30 },
];

/** Standard rounding to whole goud: under fifty cents down, fifty or higher up. */
export function toGoud(x: number): number {
  return Math.round(Number(x) || 0);
}

export function round2(x: number): number {
  return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}

export function expiryFromDays(days: number, from: Date = new Date()): string {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function isExpired(coupon: Pick<Coupon, "expires_at" | "status">, now: Date = new Date()): boolean {
  if (coupon.status !== "unused") return false;
  const t = Date.parse(String(coupon.expires_at ?? ""));
  return Number.isFinite(t) && t < now.getTime();
}

export function fmtExpiryDate(iso: string): string {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
const rand = (n: number) => {
  let s = "";
  for (let i = 0; i < n; i++) s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return s;
};

/** PFO-YYMMDD-XXXX — unique enforced by index; caller retries on conflict. */
export function generateReceiptNumber(at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${String(at.getFullYear()).slice(-2)}${p(at.getMonth() + 1)}${p(at.getDate())}`;
  return `PFO-${date}-${rand(4)}`;
}

/** System-wide single-use code. 7 chars × 32 alphabet ≈ 10¹² combos. */
export function generateCouponCode(): string {
  return `KPN-${rand(7)}`;
}

export function newId(_prefix: string): string {
  return mintId();
}

export function parseMin(raw: unknown): CouponMin | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as CouponMin;
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === "object" ? (v as CouponMin) : null;
  } catch {
    return null;
  }
}

export function serializeMin(min: CouponMin | null | undefined): string | null {
  if (!min) return null;
  const products = (min.products ?? []).filter(p => p && p.product_id && Number(p.qty) > 0);
  const amount = Number(min.min_amount ?? 0) || 0;
  const items = Number(min.min_items ?? 0) || 0;
  if (!products.length && amount <= 0 && items <= 0) return null;
  return JSON.stringify({
    ...(products.length ? { products: products.map(p => ({ product_id: p.product_id, name: p.name, qty: Number(p.qty) })) } : {}),
    ...(amount > 0 ? { min_amount: amount } : {}),
    ...(items > 0 ? { min_items: items } : {}),
  });
}

export function isEmptyMin(min: CouponMin | null | undefined): boolean {
  return !serializeMin(min ?? null);
}

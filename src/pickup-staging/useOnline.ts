// Connectivity for receipt-by-email gating — re-exported from the shared
// connectivity module (one probe, refcounted across all consumers).
export { useOnline } from "../net/connectivity";

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? "").trim());
}

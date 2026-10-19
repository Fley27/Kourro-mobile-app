/**
 * Active store for the whole app.
 *
 * Every write (sales, stock, tabs, outbox) and the sync loop itself are keyed
 * by store, so this must be ONE value — resolved from the user's roster in
 * live mode (never the hardcoded demo locations), persisted per user, and
 * readable from non-React code (autoSync, checkout, cart drafts).
 */
import { FALLBACK_STORE_ID } from "./db/ids";

let current: string = FALLBACK_STORE_ID;

export function getActiveStoreId(): string {
  return current;
}

export function setActiveStoreId(id: string | null | undefined): void {
  if (id) current = id;
}

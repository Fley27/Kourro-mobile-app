import { v4 as uuidv4, v5 as uuidv5 } from "uuid";

export const ID_NAMESPACE = "f6f3a9d1-2b4c-4d5e-8f90-1a2b3c4d5e6f";

export function mintId(): string {
  return uuidv4();
}

export function stableId(key: string): string {
  return uuidv5(key, ID_NAMESPACE);
}

export function deriveId(...parts: Array<string | number | null | undefined>): string {
  return uuidv5(parts.map((p) => String(p ?? "")).join("|"), ID_NAMESPACE);
}

/** Stable uuids for the seeded store locations (legacy ids: st-petyonvil / st-delma). */
export const STORE_IDS = {
  petionVille: stableId("st-petyonvil"),
  delmas: stableId("st-delma"),
} as const;

/** Stable uuids for the seeded catalog categories (legacy ids: food, drinks, ...). */
export const CATEGORY_IDS = {
  food: stableId("food"),
  drinks: stableId("drinks"),
  household: stableId("household"),
  dairy: stableId("dairy"),
  bakery: stableId("bakery"),
  produce: stableId("produce"),
} as const;

/**
 * Daily cash report ids are derived rather than minted, so the same report is
 * found again after a restart. Legacy rows used `rep-<user>-<day>` and
 * `rep-<shift>`; both shapes now land on their own uuid namespace.
 */
export function reportIdForDay(userId: string, day: string): string {
  return deriveId("report", userId, day);
}

export function reportIdForShift(shiftId: string): string {
  return deriveId("report", shiftId);
}

/**
 * Store id used whenever no real location is known yet. It is the active store
 * uuid, never the legacy "demo-store-id" string, so every write is a valid
 * foreign key against stores.id.
 */
export const FALLBACK_STORE_ID = STORE_IDS.petionVille;


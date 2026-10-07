// Catalog flow shared types + small helpers (create chain + manage reuse).
import type { Category } from "../CatalogShared";
import type { Item, Variant, Batch } from "../../catalogModel";
import { mintId } from "../../db/ids";

export type FlowRole = string;

export type FlowCtx = {
  role: FlowRole;
  currentUser?: any;
  categories: Category[];
  reload: () => void;
};

export const canManageCatalog = (role?: string) =>
  role === "owner" || role === "admin" || role === "manager";

export const canHandleBatches = (role?: string) =>
  role === "owner" || role === "admin" || role === "manager";

export function slugifyName(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function uniqueId(_prefix: string, taken: Set<string>, _base: string): string {
  let id = mintId();
  while (taken.has(id)) id = mintId();
  taken.add(id);
  return id;
}

export type { Item, Variant, Batch };

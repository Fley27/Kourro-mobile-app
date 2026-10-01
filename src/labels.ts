// Display labels. Dependency-free on purpose: the app's one product-variant
// name lives here so every screen (POS, receipts, catalog, analytics) prints
// it identically.

/** Variant names with no distinguishing value — skippable in display. */
export const GENERIC_VARIANT_NAMES = ["standard", "regular", "default"];

/** A variant carries no distinguishing value — it never displays. */
export function isStandardVariant(variantName: string | null | undefined): boolean {
  const v = String(variantName ?? "").trim().toLowerCase();
  return v === "" || v === "standard" || v === "regular";
}

/**
 * The app's ONE product-variant label: "{item} {product} {variant}" —
 * "Kès Prestige 350ml Cho". Spaces between tokens; a standard variant
 * ("Standard" / "Regular" / blank) drops out, leaving "{item} {product}".
 * Tokens are trimmed and an exact repeat of the previous token is dropped.
 */
export function formatCheckoutRow(
  itemName: string | null | undefined,
  productName: string | null | undefined,
  variantName: string | null | undefined
): string {
  const out: string[] = [];
  for (const raw of [itemName, productName, isStandardVariant(variantName) ? "" : variantName]) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    if (out.length && out[out.length - 1].toLowerCase() === t.toLowerCase()) continue;
    out.push(t);
  }
  return out.join(" ");
}

/**
 * Sales-list display string — same pattern as formatCheckoutRow.
 * variantCountForItem is kept for call-site compatibility; a standard
 * variant drops out regardless of how many variants the item has.
 */
export function formatSaleLine(
  productName: string | null | undefined,
  variantName: string | null | undefined,
  itemName: string | null | undefined,
  variantCountForItem: number
): string {
  void variantCountForItem;
  return formatCheckoutRow(itemName, productName, variantName);
}

/**
 * sale_items-style row → "{item} {product} {variant}". Uses the precomputed
 * `.label` when the row was loaded through attachLineLabels (receipts.ts);
 * otherwise builds the label from what the row carries (no item token).
 */
export function saleLineLabel(row: any, fallback = "—"): string {
  const attached = row?.label;
  if (typeof attached === "string" && attached) return attached;
  return formatCheckoutRow("", row?.product_name ?? row?.name ?? fallback, row?.variant ?? null);
}

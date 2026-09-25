// Active-cart draft cache — resume an unfinished sale after leaving POS,
// switching tabs, or restarting the app. Stored per store + cashier in the
// _meta key-value table (works on SQLite and the in-memory fallback, no
// schema migration needed).
//
// Cleared on: completed sale, clear-cart, suspend/update-tab (lines move to
// the tab), shift end, logout. The 10s pending line is intentionally transient
// and is NOT cached.
export type CartDraft = {
  lines: any[];
  customer: any | null;
  updatedAt: string;
};

const keyFor = (storeId: string, cashierId: string | null) =>
  `cart_draft:${storeId}:${cashierId ?? "anon"}`;

export async function saveCartDraft(
  db: any,
  storeId: string,
  cashierId: string | null,
  draft: { lines: any[]; customer: any | null }
): Promise<void> {
  try {
    await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", [
      keyFor(storeId, cashierId),
      JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }),
    ]);
  } catch {}
}

export async function loadCartDraft(
  db: any,
  storeId: string,
  cashierId: string | null
): Promise<CartDraft | null> {
  try {
    const rows = (await db.getAllAsync("SELECT * FROM _meta WHERE key = ?", [
      keyFor(storeId, cashierId),
    ])) as any[];
    if (!rows?.length) return null;
    const d = JSON.parse(rows[0].value ?? "null");
    if (!d || !Array.isArray(d.lines)) return null;
    return { lines: d.lines, customer: d.customer ?? null, updatedAt: d.updatedAt ?? "" };
  } catch {
    return null;
  }
}

// Empty-write (not DELETE) so it works identically on SQLite + the fallback.
export async function clearCartDraft(
  db: any,
  storeId: string,
  cashierId: string | null
): Promise<void> {
  await saveCartDraft(db, storeId, cashierId, { lines: [], customer: null });
}

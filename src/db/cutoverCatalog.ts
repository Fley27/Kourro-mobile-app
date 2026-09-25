// Catalog v2 full cutover — option (a): migrate old rows, repoint readers,
// no parallel system. One transaction, guarded by _meta flag
// `cutover_catalog_v2` (idempotent: deterministic ids + OR REPLACE).
//
// Mapping:
//   units → items (chain by ascending factor; first = base)
//   distinct (unit, variant-string) carrying prices/bundles → variants
//   product_prices → variant_prices (date = old updated_at)
//   product_bundles re-keyed unit → variant (variant_id backfilled)
//   product_supplier_costs → opening batches (qty 1, received, legacy-import)
//   products.stock_quantity carries forward untouched (system-maintained,
//     batch-receive path only); products.cost_price column dropped.
// Stock is NOT recomputed here — legacy numbers stay exactly as they are.
const FLAG = "cutover_catalog_v2";

// Local outbox writer (avoids a db/index ↔ cutover import cycle).
async function putOutbox(db: any, table: string, operation: string, rec: any) {
  try {
    await db.runAsync(
      "INSERT INTO outbox (id, table_name, operation, payload, created_at) VALUES (?,?,?,?,?)",
      [`${table}-${rec.id ?? Date.now()}-${Date.now()}`, table, operation, JSON.stringify(rec), new Date().toISOString()]
    );
  } catch {}
}

function slug(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function uniq(base: string, taken: Set<string>): string {
  let id = base;
  let n = 2;
  while (!id || taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

// Removes silent auto-base units ("Single"/"Sèvis" anchors shaped
// `item-<productId>-base` or `item-<productId>-single`) that were never
// user-created — but ONLY when unused: no batches, no variants, no prices.
// Runs on every startup (idempotent). A sole "Single" that is a product's
// only item is always kept (it may be the user's real unit or a needed
// service anchor); orphans with no product are always junk.
export async function cleanupAutoBaseJunk(db: any): Promise<void> {
  const now = new Date().toISOString();
  const items = (((await db.getAllAsync("SELECT id, product_id, name FROM items").catch(() => [])) ?? []) as any[])
    .filter((i: any) => !i.is_deleted);
  const cands = items.filter((i: any) =>
    /^item-.*-(base|single)$/.test(String(i.id)) && (String(i.name) === "Single" || String(i.name) === "Sèvis"));
  if (!cands.length) return;
  const batches = (((await db.getAllAsync("SELECT id, item_id FROM batches").catch(() => [])) ?? []) as any[])
    .filter((b: any) => !b.is_deleted);
  const variants = (((await db.getAllAsync("SELECT id, item_id FROM variants").catch(() => [])) ?? []) as any[])
    .filter((v: any) => !v.is_deleted);
  const prices = (((await db.getAllAsync("SELECT id, variant_id FROM variant_prices").catch(() => [])) ?? []) as any[])
    .filter((p: any) => !p.is_deleted);
  for (const c of cands) {
    const cid = String(c.id);
    if (batches.some((b: any) => String(b.item_id) === cid)) continue;
    const cVars = variants.filter((v: any) => String(v.item_id) === cid);
    if (cVars.length) continue;
    if (prices.some((p: any) => cVars.some((v: any) => String(p.variant_id) === String(v.id)))) continue;
    const pid = String(c.product_id ?? "");
    if (pid !== "" && !items.some((i: any) => String(i.id) !== cid && String(i.product_id) === pid)) continue;
    try {
      await db.runAsync("UPDATE items SET is_deleted = 1, updated_at = ?, dirty = 1 WHERE id = ?", [now, cid]);
      await putOutbox(db, "items", "update", { id: cid, is_deleted: 1, updated_at: now });
    } catch {}
  }
}

const INV_FLAG = "migrate_inventory_batches_v2";

// One-time bridge to the single v2 batch system: legacy stock_batches /
// stock_movements become v2 batches (source 'legacy-inventory-import').
// Pending lots stay pending (receivable from Inventory Ap vini); delivered
// ones arrive as received WITHOUT touching stock (already counted).
// Best-effort mapping: movement → product base item, supplier name matched
// or created. Legacy tables are left in place, unread after this.
export async function migrateInventoryBatches(db: any): Promise<void> {
  let flagged: any[] = [];
  try {
    flagged = ((await db.getAllAsync("SELECT * FROM _meta WHERE key = ?", [INV_FLAG]).catch(() => [])) ?? []) as any[];
  } catch { flagged = []; }
  if (flagged.length > 0) return;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const norm = (s: any) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  try {
    const sb = (((await db.getAllAsync("SELECT * FROM stock_batches").catch(() => [])) ?? []) as any[]);
    const movs = (((await db.getAllAsync("SELECT * FROM stock_movements").catch(() => [])) ?? []) as any[]);
    if (sb.length && movs.length) {
      const supRows = (((await db.getAllAsync("SELECT id, name FROM suppliers").catch(() => [])) ?? []) as any[])
        .filter((s: any) => !s.is_deleted);
      const supByName = new Map<string, string>();
      for (const s of supRows) supByName.set(norm(s.name), String(s.id));
      const itemRows = (((await db.getAllAsync("SELECT * FROM items").catch(() => [])) ?? []) as any[])
        .filter((i: any) => !i.is_deleted);
      const baseItemOf = (pid: string) =>
        itemRows.filter((i: any) => String(i.product_id) === pid).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0] ?? null;
      const getSupplier = async (name: any): Promise<string> => {
        const nm = String(name ?? "").trim();
        if (nm) {
          const hit = supByName.get(norm(nm));
          if (hit) return hit;
          const id = `sup-legacy-${slug(nm) || "x"}`;
          try {
            await db.runAsync(
              "INSERT OR REPLACE INTO suppliers (id, store_id, name, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?)",
              [id, "demo-store-id", nm, now, now, 0, 1]
            );
            await putOutbox(db, "suppliers", "create", { id, store_id: "demo-store-id", name: nm, created_at: now, updated_at: now, is_deleted: false });
          } catch {}
          supByName.set(norm(nm), id);
          return id;
        }
        if (!supByName.has("")) {
          try {
            await db.runAsync(
              "INSERT OR REPLACE INTO suppliers (id, store_id, name, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?)",
              ["sup-legacy-import", "demo-store-id", "Enpòte", now, now, 0, 1]
            );
            await putOutbox(db, "suppliers", "create", { id: "sup-legacy-import", store_id: "demo-store-id", name: "Enpòte", created_at: now, updated_at: now, is_deleted: false });
          } catch {}
          supByName.set("", "sup-legacy-import");
        }
        return supByName.get("")!;
      };
      for (const b of sb) {
        try {
          const received = (b.status ?? "pending") === "delivered";
          const sid = await getSupplier(b.supplier);
          const date = String(b.received_at ?? b.created_at ?? now).slice(0, 10) || today;
          const lines = movs.filter((m: any) => String(m.batch_id) === String(b.id) && String(m.type ?? "in") === "in");
          for (const m of lines) {
            try {
              const base = baseItemOf(String(m.product_id));
              if (!base) continue;
              const id = `batch-legacy-inv-${String(m.id)}`;
              const rec = {
                id, item_id: String(base.id), supplier_id: sid, date,
                quantity: Number(m.quantity) || 0, total_paid: Number(m.total_cost) || 0,
                status: received ? "received" : "pending",
                received_by: received ? String(m.created_by ?? "system") : null,
                received_at: received ? String(m.delivered_at ?? date) : null,
                denied_by: null, denied_at: null, reason: received ? "legacy-import" : null,
                delivery_ref: String(b.reference ?? ""),
                transport_share: Number(m.allocated_transport) || 0,
                source: "legacy-inventory-import", created_at: now, updated_at: now, is_deleted: 0,
              };
              await db.runAsync(
                "INSERT OR REPLACE INTO batches (id, item_id, supplier_id, date, quantity, total_paid, status, received_by, received_at, denied_by, denied_at, reason, delivery_ref, transport_share, source, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [rec.id, rec.item_id, rec.supplier_id, rec.date, rec.quantity, rec.total_paid, rec.status, rec.received_by, rec.received_at, rec.denied_by, rec.denied_at, rec.reason, rec.delivery_ref, rec.transport_share, rec.source, rec.created_at, rec.updated_at, 0, 1]
              );
              await putOutbox(db, "batches", "create", { ...rec, is_deleted: false });
            } catch {}
          }
        } catch {}
      }
    }
  } catch (e) { console.log("[migrate] inventory batches skipped:", String(e)); }
  try { await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", [INV_FLAG, "1"]); } catch {}
}

// Backfills SKU-XXXX on products created without one (creation minted
// none before). Idempotent: only touches blank SKUs, skips collisions.
export async function backfillSkus(db: any): Promise<void> {
  try {
    const rows = (((await db.getAllAsync("SELECT id, sku FROM products").catch(() => [])) ?? []) as any[]);
    const taken = new Set(rows.map((r: any) => String(r.sku ?? "")));
    const blank = rows.filter((r: any) => !String(r.sku ?? "").trim() && !r.is_deleted);
    if (!blank.length) return;
    const now = new Date().toISOString();
    for (const r of blank) {
      let sku = "";
      for (let i = 0; i < 50 && !sku; i++) {
        const cand = `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
        if (!taken.has(cand)) sku = cand;
      }
      if (!sku) sku = `SKU-${Date.now().toString(36).toUpperCase()}`;
      taken.add(sku);
      try {
        await db.runAsync("UPDATE products SET sku = ?, updated_at = ?, dirty = 1 WHERE id = ?", [sku, now, String(r.id)]);
        await putOutbox(db, "products", "update", { id: String(r.id), sku, updated_at: now, is_deleted: 0 });
      } catch {}
    }
  } catch (e) { console.log("[backfill] skus skipped:", String(e)); }
}

export async function runCatalogCutover(db: any): Promise<{ migrated: boolean }> {
  let flagged: any[] = [];
  try {
    flagged = ((await db.getAllAsync("SELECT * FROM _meta WHERE key = ?", [FLAG]).catch(() => [])) ?? []) as any[];
  } catch { flagged = []; }
  if (flagged.length > 0) return { migrated: false };

  const now = new Date().toISOString();
  const products = (((await db.getAllAsync("SELECT * FROM products").catch(() => [])) ?? []) as any[])
    .filter((p: any) => !p.is_deleted);
  const units = (((await db.getAllAsync("SELECT * FROM product_units").catch(() => [])) ?? []) as any[]);
  const prices = (((await db.getAllAsync("SELECT * FROM product_prices").catch(() => [])) ?? []) as any[]);
  const bundles = (((await db.getAllAsync("SELECT * FROM product_bundles").catch(() => [])) ?? []) as any[]);
  const costs = (((await db.getAllAsync("SELECT * FROM product_supplier_costs").catch(() => [])) ?? []) as any[])
    .filter((c: any) => !c.is_deleted);

  const unitToItem = new Map<string, string>();
  const variantOf = new Map<string, string>(); // `${unitId}|${variantLower}` -> variantId
  const takenItem = new Set<string>();
  const takenVariant = new Set<string>();

  await db.execAsync("BEGIN");
  try {
    // 1 — items: chain units per product by ascending factor.
    for (const p of products) {
      const us = units
        .filter((u: any) => String(u.product_id) === String(p.id))
        .map((u: any) => ({ id: String(u.id), name: String(u.unit_name ?? "Single"), factor: Number(u.conversion_factor) || 0 }))
        .filter(u => u.factor > 0)
        .sort((a: any, b: any) => a.factor - b.factor);
      const chain = us.length ? us : [{ id: `__base_${p.id}`, name: "Single", factor: 1 }];
      let prevItemId: string | null = null;
      let prevFactor = 1;
      for (let i = 0; i < chain.length; i++) {
        const u = chain[i];
        const itemId = uniq(`item-${p.id}-${slug(u.name) || "u"}`, takenItem);
        const isBase = i === 0;
        const rec = {
          id: itemId, product_id: String(p.id), name: u.name,
          ref_item_id: prevItemId, ratio: isBase ? null : u.factor / (prevFactor || 1),
          sort_order: i, created_at: now, updated_at: now, is_deleted: 0,
        };
        await db.runAsync(
          "INSERT OR REPLACE INTO items (id, product_id, name, ref_item_id, ratio, sort_order, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [rec.id, rec.product_id, rec.name, rec.ref_item_id, rec.ratio, rec.sort_order, rec.created_at, rec.updated_at, 0, 1]
        );
        try { await putOutbox(db, "items", "create", { ...rec, is_deleted: false }); } catch {}
        if (!String(u.id).startsWith("__base_")) unitToItem.set(String(u.id), itemId);
        prevItemId = itemId;
        prevFactor = u.factor;
      }
    }

    // 2 — variants: distinct (unit, variant-string) carrying prices/bundles.
    const needVariant = new Map<string, { itemId: string; name: string }>();
    const touchVariant = (unitId: string, variant: string) => {
      const itemId = unitToItem.get(String(unitId));
      const nm = String(variant ?? "Regular") || "Regular";
      if (!itemId) return;
      const k = `${unitId}|${nm.toLowerCase()}`;
      if (!needVariant.has(k)) needVariant.set(k, { itemId, name: nm });
    };
    for (const r of prices) touchVariant(r.unit_id, r.variant);
    for (const b of bundles) touchVariant(b.unit_id, b.variant);
    for (const [k, v] of needVariant) {
      const varId = uniq(`var-${v.itemId}-${slug(v.name) || "v"}`, takenVariant);
      const rec = { id: varId, item_id: v.itemId, name: v.name, sort_order: 0, created_at: now, updated_at: now, is_deleted: 0 };
      await db.runAsync(
        "INSERT OR REPLACE INTO variants (id, item_id, name, sort_order, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
        [rec.id, rec.item_id, rec.name, rec.sort_order, rec.created_at, rec.updated_at, 0, 1]
      );
      try { await putOutbox(db, "variants", "create", { ...rec, is_deleted: false }); } catch {}
      variantOf.set(k, varId);
    }

    // 3 — variant_prices from old price rows (date = old updated_at).
    for (const r of prices) {
      const varId = variantOf.get(`${String(r.unit_id)}|${String(r.variant ?? "Regular").toLowerCase()}`);
      if (!varId) continue;
      const pid = `vpr-${String(r.id)}`;
      const rec = {
        id: pid, variant_id: varId, price: Number(r.price) || 0,
        date: String(r.updated_at ?? now), created_at: now, updated_at: now, is_deleted: 0,
      };
      await db.runAsync(
        "INSERT OR REPLACE INTO variant_prices (id, variant_id, price, date, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)",
        [rec.id, rec.variant_id, rec.price, rec.date, rec.created_at, rec.updated_at, 0, 1]
      );
      try { await putOutbox(db, "variant_prices", "create", { ...rec, is_deleted: false }); } catch {}
    }

    // 4 — bundles re-keyed unit → variant (via full-row replace: mock-safe).
    try { await db.execAsync("ALTER TABLE product_bundles ADD COLUMN variant_id TEXT"); } catch {}
    for (const b of bundles) {
      const varId = variantOf.get(`${String(b.unit_id)}|${String(b.variant ?? "Regular").toLowerCase()}`);
      if (!varId) continue;
      await db.runAsync(
        "INSERT OR REPLACE INTO product_bundles (id, unit_id, variant_id, variant, min_quantity, bundle_price, created_at) VALUES (?,?,?,?,?,?,?)",
        [b.id, b.unit_id, varId, b.variant, b.min_quantity, b.bundle_price, b.created_at ?? now]
      );
    }
    try { await db.execAsync("ALTER TABLE product_bundles DROP COLUMN unit_id"); } catch {}

    // 5 — old supplier costs → opening batches (qty 1, received, legacy-import).
    // Never touches stock: legacy stock_quantity carries forward untouched.
    for (const c of costs) {
      const itemId = unitToItem.get(String(c.unit_id));
      if (!itemId) continue;
      const bid = `batch-legacy-${String(c.id)}`;
      const rec = {
        id: bid, item_id: itemId, supplier_id: String(c.supplier_id),
        date: now, quantity: 1, total_paid: Number(c.cost) || 0,
        status: "received", received_by: "system", received_at: now,
        denied_by: null, denied_at: null, reason: "legacy-import",
        source: "legacy-import", created_at: now, updated_at: now, is_deleted: 0,
      };
      await db.runAsync(
        "INSERT OR REPLACE INTO batches (id, item_id, supplier_id, date, quantity, total_paid, status, received_by, received_at, denied_by, denied_at, reason, source, created_at, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [rec.id, rec.item_id, rec.supplier_id, rec.date, rec.quantity, rec.total_paid, rec.status, rec.received_by, rec.received_at, rec.denied_by, rec.denied_at, rec.reason, rec.source, rec.created_at, rec.updated_at, 0, 1]
      );
      try { await putOutbox(db, "batches", "create", { ...rec, is_deleted: false }); } catch {}
    }

    // 6 — products slimmed: cost_price dropped (stock_quantity stays,
    // system-maintained by the batch-receive path).
    try { await db.execAsync("ALTER TABLE products DROP COLUMN cost_price"); } catch {}

    await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", [FLAG, "1"]);
    await db.execAsync("COMMIT");
  } catch (e) {
    try { await db.execAsync("ROLLBACK"); } catch {}
    throw e;
  }
  return { migrated: true };
}

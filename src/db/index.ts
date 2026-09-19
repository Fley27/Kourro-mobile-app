import { SCHEMA_SQL } from "./schema";

// Web fallback: in-memory mock when expo-sqlite not available (Expo web)
let SQLite: any = null;
try {
  SQLite = require("expo-sqlite");
} catch {
  // expo-sqlite not available on this platform (e.g. web without native) — use mock
}

let db: any | null = null;
const memStore = new Map<string, any[]>();

const mockProductsSeed = [
  { id: "prod-1", store_id: "demo-store-id", sku: "RICE-25KG", name: "Rice 25kg", name_ht: "Diri 25kg", unit: "sack", cost_price: 2500, selling_price: 3200, stock_quantity: 40, current_amount_available: 40, low_stock_threshold: 5 },
  { id: "prod-2", store_id: "demo-store-id", sku: "OIL-5L", name: "Cooking Oil 5L", name_ht: "Lwil 5L", unit: "pcs", cost_price: 800, selling_price: 1100, stock_quantity: 25, current_amount_available: 25, low_stock_threshold: 5 },
  { id: "prod-3", store_id: "demo-store-id", sku: "PREST-330", name: "Prestige Beer", name_ht: "Prestige", unit: "pcs", cost_price: 75, selling_price: 100, stock_quantity: 3, current_amount_available: 3, low_stock_threshold: 20 },
  { id: "prod-4", store_id: "demo-store-id", sku: "SOAP-001", name: "Laundry Soap", name_ht: "Savon", unit: "pcs", cost_price: 30, selling_price: 50, stock_quantity: 200, current_amount_available: 200, low_stock_threshold: 30 },
  { id: "prod-5", store_id: "demo-store-id", sku: "FARIN-25KG", name: "Flour 25kg", name_ht: "Farin 25kg", unit: "sack", cost_price: 2200, selling_price: 2800, stock_quantity: 30, current_amount_available: 30, low_stock_threshold: 5 },
  { id: "prod-6", store_id: "demo-store-id", sku: "SIK-10KG", name: "White Sugar 10kg", name_ht: "Sik Blan 10kg", unit: "sack", cost_price: 700, selling_price: 950, stock_quantity: 35, current_amount_available: 35, low_stock_threshold: 5 },
  { id: "prod-7", store_id: "demo-store-id", sku: "PASTA-500", name: "Spaghetti 500g", name_ht: "Pasta 500g", unit: "pcs", cost_price: 45, selling_price: 75, stock_quantity: 80, current_amount_available: 80, low_stock_threshold: 15 },
  { id: "prod-8", store_id: "demo-store-id", sku: "TOMAT-400", name: "Tomato Paste 400g", name_ht: "Tomat 400g", unit: "pcs", cost_price: 80, selling_price: 120, stock_quantity: 60, current_amount_available: 60, low_stock_threshold: 10 },
  { id: "prod-9", store_id: "demo-store-id", sku: "SARDINE-120", name: "Sardine Tin 120g", name_ht: "Sardine 120g", unit: "pcs", cost_price: 55, selling_price: 85, stock_quantity: 100, current_amount_available: 100, low_stock_threshold: 20 },
  { id: "prod-10", store_id: "demo-store-id", sku: "LET-400", name: "Milk Powder 400g", name_ht: "Lèt 400g", unit: "pcs", cost_price: 480, selling_price: 650, stock_quantity: 40, current_amount_available: 40, low_stock_threshold: 8 },
  { id: "prod-11", store_id: "demo-store-id", sku: "KAFE-200", name: "Rea Coffee 200g", name_ht: "Kafe 200g", unit: "pcs", cost_price: 320, selling_price: 450, stock_quantity: 50, current_amount_available: 50, low_stock_threshold: 10 },
  { id: "prod-12", store_id: "demo-store-id", sku: "BISK-30", name: "Sayo Biscuit", name_ht: "Biskè Sayo", unit: "pcs", cost_price: 15, selling_price: 25, stock_quantity: 150, current_amount_available: 150, low_stock_threshold: 30 },
  { id: "prod-13", store_id: "demo-store-id", sku: "KOLA-500", name: "Couronne Cola 500ml", name_ht: "Kola 500ml", unit: "pcs", cost_price: 30, selling_price: 50, stock_quantity: 90, current_amount_available: 90, low_stock_threshold: 20 },
  { id: "prod-14", store_id: "demo-store-id", sku: "DLO-19L", name: "Water 5gal", name_ht: "Dlo 5 gal", unit: "pcs", cost_price: 100, selling_price: 150, stock_quantity: 25, current_amount_available: 25, low_stock_threshold: 5 },
  { id: "prod-15", store_id: "demo-store-id", sku: "SAVON-DET", name: "Detergent Powder 1kg", name_ht: "Savon Poud 1kg", unit: "pcs", cost_price: 85, selling_price: 120, stock_quantity: 45, current_amount_available: 45, low_stock_threshold: 10 },
  { id: "prod-16", store_id: "demo-store-id", sku: "PAT-COLG", name: "Colgate Toothpaste", name_ht: "Pat Colgate", unit: "pcs", cost_price: 130, selling_price: 180, stock_quantity: 60, current_amount_available: 60, low_stock_threshold: 10 },
  { id: "prod-17", store_id: "demo-store-id", sku: "MAYI-10KG", name: "Corn Meal 10kg", name_ht: "Mayi 10kg", unit: "sack", cost_price: 600, selling_price: 800, stock_quantity: 20, current_amount_available: 20, low_stock_threshold: 5 },
  { id: "prod-18", store_id: "demo-store-id", sku: "SEL-5KG", name: "Salt 5kg", name_ht: "Sèl 5kg", unit: "sack", cost_price: 200, selling_price: 300, stock_quantity: 30, current_amount_available: 30, low_stock_threshold: 5 },
];
memStore.set("products", [...mockProductsSeed]);

const customersSeed = [
  { id: "cust-1", store_id: "demo-store-id", name: "Jean Baptiste", id_card_number: "004-123-4567", phone: "+509 3810 0001", address: "Delmas 33, Port-au-Prince", total_debt: 3500, credit_limit: 5000, credit_limit_source: "manual", is_high_risk: true, open_debt_count: 1 },
  { id: "cust-2", store_id: "demo-store-id", name: "Marie Claire", id_card_number: "004-987-6543", phone: "+509 3820 0002", address: "Pétion-Ville, Rue Panaméricaine", total_debt: 0, credit_limit: null, is_high_risk: false, open_debt_count: 0 },
  { id: "cust-3", store_id: "demo-store-id", name: "Frantz Delmas", id_card_number: "004-111-2222", phone: "+509 3833 0003", address: "Carrefour, Bizoton", total_debt: 0, credit_limit: null, is_high_risk: false, open_debt_count: 0 },
];
const creditsSeed = [
  { id: "debt-1", store_id: "demo-store-id", customer_id: "cust-1", sale_id: "sale-debt-1", amount: 3500, amount_paid: 0, balance: 3500, status: "pending", due_date: new Date(Date.now() - 5*24*3600*1000).toISOString().slice(0,10), created_at: new Date(Date.now() - 10*24*3600*1000).toISOString() },
];

export async function getDb(): Promise<any> {
  if (db) return db;
  if (SQLite) {
    try {
      db = await SQLite.openDatabaseAsync("jesyon.db");
      await db.execAsync(SCHEMA_SQL);
      try { await db.execAsync("ALTER TABLE customers ADD COLUMN address TEXT"); } catch {}
      // --- migrations for sales seller attribution + created_at ---
      try { await db.execAsync("ALTER TABLE sales ADD COLUMN seller_id TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE sales ADD COLUMN seller_role TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE sales ADD COLUMN created_at TEXT"); } catch {}
      // --- migrations for stores enhanced + categories ---
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN location TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN code TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN created_at TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN disabled INTEGER DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN breach_flagged INTEGER DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN breached_at TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN revoked_by TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stores ADD COLUMN dirty INTEGER DEFAULT 0"); } catch {}
      // --- migration: received_at for stock_batches (manual date of arrival) ---
      try { await db.execAsync("ALTER TABLE stock_batches ADD COLUMN received_at TEXT"); } catch {}
      // --- migration: FIFO batch accounting ---
      try { await db.execAsync("ALTER TABLE products ADD COLUMN current_amount_available REAL DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE stock_movements ADD COLUMN initial_qty REAL DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE stock_movements ADD COLUMN remaining_qty REAL DEFAULT 0"); } catch {}
      // --- migration: loading-dock (pending -> delivered) ---
      try { await db.execAsync("ALTER TABLE stock_batches ADD COLUMN status TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stock_batches ADD COLUMN delivered_at TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stock_movements ADD COLUMN status TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE stock_movements ADD COLUMN delivered_at TEXT"); } catch {}
      // Legacy rows hit the shelf before this migration, so treat them as delivered
      try { await db.execAsync("UPDATE stock_batches SET status = 'delivered' WHERE status IS NULL"); } catch {}
      try { await db.execAsync("UPDATE stock_movements SET status = 'delivered' WHERE status IS NULL"); } catch {}
      // --- migration: multi-variant selling model (units / prices / bundles) ---
      try {
        const flagged = await db.getAllAsync("SELECT * FROM _meta WHERE key = ?", ["seed_variants_v1"]);
        if (flagged.length === 0) {
          const now2 = new Date().toISOString();
          let legacy: any[] = [];
          try { legacy = await db.getAllAsync("SELECT id, selling_price, unit FROM products"); } catch { legacy = []; }
          for (const p of legacy) {
            let has: any[] = [{ id: 1 }];
            try { has = await db.getAllAsync("SELECT id FROM product_units WHERE product_id = ?", [p.id]); } catch {}
            if (has.length === 0) {
              const uid = `unit-${p.id}-base`;
              await db.runAsync("INSERT OR REPLACE INTO product_units (id, product_id, unit_name, conversion_factor, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                [uid, p.id, p.unit || "Unit", 1, now2, now2]);
              await db.runAsync("INSERT OR REPLACE INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
                [`price-${p.id}-regular`, uid, "Regular", Number(p.selling_price ?? 0), now2]);
            }
          }
          // Demo variant data (spec example): Prestige Cold single 200 HTG, 3 for 500
          try {
            const baseUnit = await db.getAllAsync("SELECT id FROM product_units WHERE id = ?", ["unit-prod-3-base"]);
            const cold = await db.getAllAsync("SELECT id FROM product_prices WHERE id = ?", ["price-prod-3-cold"]);
            if (baseUnit.length > 0 && cold.length === 0) {
              await db.runAsync("INSERT OR REPLACE INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
                ["price-prod-3-cold", "unit-prod-3-base", "Cold", 200, now2]);
              await db.runAsync("INSERT OR REPLACE INTO product_bundles (id, unit_id, variant, min_quantity, bundle_price, created_at) VALUES (?,?,?,?,?,?)",
                ["bundle-prod-3-cold-3", "unit-prod-3-base", "Cold", 3, 500, now2]);
            }
          } catch {}
          await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", ["seed_variants_v1", "1"]);
        }
      } catch {}
      // Drop legacy single-price columns (SQLite >= 3.35; ignored when absent/unsupported)
      try { await db.execAsync("ALTER TABLE products DROP COLUMN selling_price"); } catch {}
      try { await db.execAsync("ALTER TABLE products DROP COLUMN unit"); } catch {}
      // sale_items variant tracking (how each line was sold: unit + variant)
      try { await db.execAsync("ALTER TABLE sale_items ADD COLUMN unit_id TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE sale_items ADD COLUMN variant TEXT"); } catch {}
      // opening register FSM columns
      try { await db.execAsync("ALTER TABLE cash_register_checks ADD COLUMN check_date TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE cash_register_checks ADD COLUMN set_by TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE cash_register_checks ADD COLUMN set_by_role TEXT"); } catch {}
      try { await db.execAsync("ALTER TABLE cash_register_checks ADD COLUMN is_default INTEGER DEFAULT 0"); } catch {}
      try { await db.execAsync("ALTER TABLE credit_payments ADD COLUMN collected_by TEXT"); } catch {}
      // deficit settlements table
      try { await db.execAsync(`CREATE TABLE IF NOT EXISTS deficit_settlements (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, cashier_id TEXT NOT NULL,
        period_start TEXT NOT NULL, period_end TEXT NOT NULL, deficit_ids TEXT,
        total REAL DEFAULT 0, paid REAL DEFAULT 0, status TEXT DEFAULT 'open',
        created_by TEXT, paid_by TEXT, paid_at TEXT, created_at TEXT, updated_at TEXT
      )`); } catch {}
      // --- first-launch demo seed (persistent, runs once) ---
      try {
        const seeded = await db.getAllAsync("SELECT * FROM _meta WHERE key = ?", ["seed_v1"]);
        if (seeded.length === 0) {
          const now = new Date().toISOString();
          const CATS = [
            ["food", "Manje", "🍚", "#0f172a", 1],
            ["drinks", "Bwason", "🥤", "#0f172a", 2],
            ["household", "Kay", "🧴", "#0f172a", 3],
            ["dairy", "Letye", "🥛", "#0f172a", 4],
            ["bakery", "Boulanjri", "🥐", "#0f172a", 5],
            ["produce", "Lejume", "🥬", "#0f172a", 6],
          ];
          for (const [id, name, icon, color, sort] of CATS) {
            await db.runAsync("INSERT OR REPLACE INTO categories (id, store_id, name, icon, color, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
              [id, "demo-store-id", name, icon, color, sort, now, now]);
          }
          for (const p of mockProductsSeed) {
            await db.runAsync("INSERT OR REPLACE INTO products (id, store_id, sku, barcode, name, cost_price, stock_quantity, current_amount_available, low_stock_threshold, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
              [p.id, p.store_id, p.sku, p.sku, p.name, p.cost_price, p.stock_quantity, p.current_amount_available, p.low_stock_threshold, now]);
            // Default sell unit + Regular price (legacy selling_price/unit live on here)
            await db.runAsync("INSERT OR REPLACE INTO product_units (id, product_id, unit_name, conversion_factor, created_at, updated_at) VALUES (?,?,?,?,?,?)",
              [`unit-${p.id}-base`, p.id, (p as any).unit ?? "Unit", 1, now, now]);
            await db.runAsync("INSERT OR REPLACE INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
              [`price-${p.id}-regular`, `unit-${p.id}-base`, "Regular", (p as any).selling_price ?? 0, now]);
          }
          // Demo variant data (spec example): Prestige Cold single 200 HTG, 3 for 500
          await db.runAsync("INSERT OR REPLACE INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
            ["price-prod-3-cold", "unit-prod-3-base", "Cold", 200, now]);
          await db.runAsync("INSERT OR REPLACE INTO product_bundles (id, unit_id, variant, min_quantity, bundle_price, created_at) VALUES (?,?,?,?,?,?)",
            ["bundle-prod-3-cold-3", "unit-prod-3-base", "Cold", 3, 500, now]);
          for (const pc of [
            ["prod-1", "food"], ["prod-2", "drinks"], ["prod-3", "drinks"], ["prod-4", "household"], ["prod-5", "food"],
            ["prod-6", "food"], ["prod-7", "food"], ["prod-8", "produce"], ["prod-9", "produce"], ["prod-10", "dairy"],
            ["prod-11", "dairy"], ["prod-12", "bakery"], ["prod-13", "drinks"], ["prod-14", "drinks"], ["prod-15", "household"],
            ["prod-16", "household"], ["prod-17", "food"], ["prod-18", "food"],
          ]) {
            await db.runAsync("INSERT OR REPLACE INTO product_categories (product_id, category_id) VALUES (?,?)", [pc[0], pc[1]]);
          }
          for (const c of customersSeed) {
            await db.runAsync("INSERT OR REPLACE INTO customers (id, store_id, name, phone, address, id_card_number, total_debt, credit_limit, credit_limit_source, is_high_risk, open_debt_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              [c.id, c.store_id, c.name, c.phone, c.address, c.id_card_number, c.total_debt, c.credit_limit, c.credit_limit_source, c.is_high_risk ? 1 : 0, c.open_debt_count]);
          }
          for (const c of creditsSeed) {
            await db.runAsync("INSERT OR REPLACE INTO credits (id, store_id, customer_id, sale_id, amount, amount_paid, balance, status, due_date, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
              [c.id, c.store_id, c.customer_id, c.sale_id, c.amount, c.amount_paid, c.balance, c.status, c.due_date, c.created_at]);
          }
          await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", ["seed_v1", "1"]);
        }
      } catch {}
      return db;
    } catch {
      // Fallback to mock if native SQLite fails (e.g. web)
      SQLite = null;
    }
  }
  // Seed stores + categories for persistent testing (except users)
  if (!memStore.has("stores")) {
    memStore.set("stores", [
      { id: "st-petyonvil", name: "Pétion-Ville", location: "Petyonvil", code: "PV-4821", created_at: new Date().toISOString(), disabled: 0, breach_flagged: 0, breached_at: null, revoked_by: null, currency: "HTG", updated_at: new Date().toISOString() },
      { id: "st-delma", name: "Delmas", location: "Dèlma", code: "DL-9034", created_at: new Date().toISOString(), disabled: 0, breach_flagged: 0, breached_at: null, revoked_by: null, currency: "HTG", updated_at: new Date().toISOString() },
    ]);
  }
  if (!memStore.has("categories")) {
    memStore.set("categories", [
      { id: "food", store_id: "demo-store-id", name: "Manje", icon: "🍚", color: "#0f172a", sort_order: 1, created_at: new Date().toISOString() },
      { id: "drinks", store_id: "demo-store-id", name: "Bwason", icon: "🥤", color: "#0f172a", sort_order: 2, created_at: new Date().toISOString() },
      { id: "household", store_id: "demo-store-id", name: "Kay", icon: "🧴", color: "#0f172a", sort_order: 3, created_at: new Date().toISOString() },
      { id: "dairy", store_id: "demo-store-id", name: "Letye", icon: "🥛", color: "#0f172a", sort_order: 4, created_at: new Date().toISOString() },
      { id: "bakery", store_id: "demo-store-id", name: "Boulanjri", icon: "🥐", color: "#0f172a", sort_order: 5, created_at: new Date().toISOString() },
      { id: "produce", store_id: "demo-store-id", name: "Lejume", icon: "🥬", color: "#0f172a", sort_order: 6, created_at: new Date().toISOString() },
    ]);
  }
  if (!memStore.has("product_categories")) memStore.set("product_categories", []);
  if (!memStore.has("suspended_sales")) memStore.set("suspended_sales", []);
  if (!memStore.has("suspended_sale_items")) memStore.set("suspended_sale_items", []);
  if (!memStore.has("suspended_sale_events")) memStore.set("suspended_sale_events", []);
  if (!memStore.has("product_units")) {
    const nowm = new Date().toISOString();
    const prods = memStore.get("products") ?? [];
    memStore.set("product_units", prods.map((p: any) => ({ id: `unit-${p.id}-base`, product_id: p.id, unit_name: p.unit ?? "Unit", conversion_factor: 1, created_at: nowm, updated_at: nowm })));
  }
  if (!memStore.has("product_prices")) {
    const nowm = new Date().toISOString();
    const units = memStore.get("product_units") ?? [];
    const prices = units.map((u: any) => {
      const prod = (memStore.get("products") ?? []).find((p: any) => p.id === u.product_id);
      return { id: `price-${u.product_id}-regular`, unit_id: u.id, variant: "Regular", price: Number(prod?.selling_price ?? 0), updated_at: nowm };
    });
    prices.push({ id: "price-prod-3-cold", unit_id: "unit-prod-3-base", variant: "Cold", price: 200, updated_at: nowm });
    memStore.set("product_prices", prices);
  }
  if (!memStore.has("product_bundles")) {
    memStore.set("product_bundles", [{ id: "bundle-prod-3-cold-3", unit_id: "unit-prod-3-base", variant: "Cold", min_quantity: 3, bundle_price: 500, created_at: new Date().toISOString() }]);
  }
  if (!memStore.has("stock_batches")) memStore.set("stock_batches", []);
  if (!memStore.has("stock_movements")) memStore.set("stock_movements", []);
  if (!memStore.has("_meta")) memStore.set("_meta", []);
  if (!memStore.has("receipts")) memStore.set("receipts", []);
  if (!memStore.has("report_reviews")) memStore.set("report_reviews", []);
  // Seed sales for demo shift report (today)
  if (!memStore.has("sales")) {
    memStore.set("sales", []);
    memStore.set("sale_items", []);
    memStore.set("customers", [...customersSeed]);
    memStore.set("customer_history", []);
    memStore.set("employees", [
      { id: "emp-1", store_id: "demo-store-id", full_name: "Jacques Owner", role: "owner", phone: "+509 1000 0001", salary: 85000, address: "Delmas 33, Port-au-Prince", is_active: 1, online_status: 1 },
      { id: "emp-2", store_id: "demo-store-id", full_name: "Marie Admin", role: "admin", phone: "+509 1000 0002", salary: 65000, address: "Pétion-Ville, Rue Panaméricaine", is_active: 1, online_status: 1 },
      { id: "emp-3", store_id: "demo-store-id", full_name: "Pierre Manager", role: "manager", phone: "+509 1000 0003", salary: 45000, address: "Carrefour, Bizoton", is_active: 1, online_status: 0 },
      { id: "emp-4", store_id: "demo-store-id", full_name: "Sophie Cashier", role: "cashier", phone: "+509 1000 0004", salary: 25000, address: "Tabarre, Route de l'Aéroport", is_active: 1, online_status: 0 },
      { id: "emp-5", store_id: "demo-store-id", full_name: "Jean-Louis Dupont", role: "cashier", phone: "+509 3456 7890", salary: 22000, address: "Jacmel, Centre-Ville", is_active: 0, online_status: 0 },
      { id: "emp-6", store_id: "demo-store-id", full_name: "Marie-Claire Fontaine", role: "manager", phone: "+509 4567 8901", salary: 48000, address: "Cap-Haïtien, Bas-Rivière", is_active: 1, online_status: 1 },
      { id: "emp-7", store_id: "demo-store-id", full_name: "Robenson Saintil", role: "cashier", phone: "+509 5678 9012", salary: 20000, address: "Les Cayes, Boucan Rouge", is_active: 0, online_status: 0 },
      { id: "emp-8", store_id: "demo-store-id", full_name: "Tatiana Beaumont", role: "admin", phone: "+509 6789 0123", salary: 60000, address: "Pétion-Ville, Nazon", is_active: 1, online_status: 1 },
    ]);
    memStore.set("shifts", []);
    memStore.set("cash_movements", []);
    memStore.set("debt_collections", []);
    memStore.set("cash_requests", []);
    memStore.set("cash_discrepancies", []);
    memStore.set("notifications", []);
    memStore.set("daily_reports", []);
    memStore.set("cashier_deficits", []);
    memStore.set("monthly_losses", []);
    memStore.set("cash_register_checks", []);
    memStore.set("deficit_settlements", []);
    memStore.set("salary_deductions", []);
    memStore.set("credits", [...creditsSeed]);
    memStore.set("credit_payments", []);
  }
  // in-memory mock for web
  db = {
    execAsync: async () => {},
    runAsync: async (sql: string, params: any[]) => {
      if (sql.includes("INSERT INTO outbox")) {
        const arr = memStore.get("outbox") ?? [];
        arr.push({ id: params[0], table_name: params[1], operation: params[2], payload: params[3], created_at: params[4] });
        memStore.set("outbox", arr);
      } else if (sql.includes("INSERT INTO products")) {
        const products = memStore.get("products") ?? [];
        const id = params[0];
        if (!products.some((p: any) => p.id === id)) {
          products.push({
            id: params[0],
            store_id: params[1],
            sku: params[2],
            barcode: params[2],
            name: params[3],
            category_id: params[4],
            cost_price: Number(params[5] ?? 0),
            stock_quantity: Number(params[6] ?? 0),
            current_amount_available: Number(params[6] ?? 0),
            low_stock_threshold: Number(params[7] ?? 5),
            updated_at: new Date().toISOString(),
            is_deleted: 0,
            dirty: 1,
          });
          memStore.set("products", products);
        }
      } else if (sql.includes("INTO product_units")) {
        const arr = memStore.get("product_units") ?? [];
        const rec = { id: params[0], product_id: params[1], unit_name: params[2], conversion_factor: Number(params[3] ?? 1), created_at: params[4] ?? new Date().toISOString(), updated_at: params[5] ?? new Date().toISOString() };
        const ui = arr.findIndex((x: any) => x.id === rec.id);
        if (ui >= 0) arr[ui] = { ...arr[ui], ...rec }; else arr.push(rec);
        memStore.set("product_units", arr);
      } else if (sql.includes("INTO product_prices")) {
        const arr = memStore.get("product_prices") ?? [];
        const rec = { id: params[0], unit_id: params[1], variant: params[2], price: Number(params[3] ?? 0), updated_at: params[4] ?? new Date().toISOString() };
        const ui = arr.findIndex((x: any) => x.id === rec.id);
        if (ui >= 0) arr[ui] = { ...arr[ui], ...rec }; else arr.push(rec);
        memStore.set("product_prices", arr);
      } else if (sql.includes("INTO product_bundles")) {
        const arr = memStore.get("product_bundles") ?? [];
        const rec = { id: params[0], unit_id: params[1], variant: params[2], min_quantity: Number(params[3] ?? 0), bundle_price: Number(params[4] ?? 0), created_at: params[5] ?? new Date().toISOString() };
        const ui = arr.findIndex((x: any) => x.id === rec.id);
        if (ui >= 0) arr[ui] = { ...arr[ui], ...rec }; else arr.push(rec);
        memStore.set("product_bundles", arr);
      } else if (sql.includes("UPDATE product_prices SET") || sql.includes("UPDATE product_units SET")) {
        const target = sql.includes("UPDATE product_prices SET") ? "product_prices" : "product_units";
        const arr = memStore.get(target) ?? [];
        const id = params[params.length - 1];
        const rec = arr.find((x: any) => x.id === id);
        if (rec) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          setPart.split(",").forEach((c, i) => {
            const plain = c.trim().match(/^(\w+)\s*=\s*\?$/);
            if (plain && params[i] !== undefined) (rec as any)[plain[1]] = params[i];
          });
          rec.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE products SET") && sql.includes("current_amount_available")) {
        const products = memStore.get("products") ?? [];
        const id = params[params.length - 1];
        const p = products.find((x: any) => x.id === id);
        if (p) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          setPart.split(",").forEach((c, i) => {
            const c2 = c.trim();
            const plus = c2.match(/^(\w+)\s*=\s*(\w+)\s*\+\s*\?$/);
            const minus = c2.match(/^(\w+)\s*=\s*(\w+)\s*-\s*\?$/);
            const plain = c2.match(/^(\w+)\s*=\s*\?$/);
            if (plus && plus[1] === plus[2]) p[plus[1]] = Number(p[plus[1]] ?? 0) + Number(params[i] ?? 0);
            else if (minus && minus[1] === minus[2]) p[minus[1]] = Number(p[minus[1]] ?? 0) - Number(params[i] ?? 0);
            else if (plain) p[plain[1]] = params[i];
          });
          p.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE stock_movements SET")) {
        const movs = memStore.get("stock_movements") ?? [];
        const id = params[params.length - 1];
        const m = movs.find((x: any) => x.id === id);
        if (m) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          setPart.split(",").forEach((c, i) => {
            const c2 = c.trim();
            const minus = c2.match(/^(\w+)\s*=\s*(\w+)\s*-\s*\?$/);
            const plain = c2.match(/^(\w+)\s*=\s*\?$/);
            if (minus && minus[1] === minus[2]) m[minus[1]] = Number(m[minus[1]] ?? 0) - Number(params[i] ?? 0);
            else if (plain) m[plain[1]] = params[i];
          });
          m.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE stock_batches SET")) {
        const batches = memStore.get("stock_batches") ?? [];
        const id = params[params.length - 1];
        const b = batches.find((x: any) => x.id === id);
        if (b) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          setPart.split(",").forEach((c, i) => {
            const c2 = c.trim();
            const plain = c2.match(/^(\w+)\s*=\s*\?$/);
            if (plain) b[plain[1]] = params[i];
          });
          b.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE products SET")) {
        const products = memStore.get("products") ?? [];
        // Handle both stock_quantity +/- and generic column updates (selling_price, name, sku, category_id, etc.)
        if (sql.includes("stock_quantity")) {
          const qty = Number(params[0] ?? 0);
          const id = params[1];
          const p = products.find((x: any) => x.id === id);
          if (p) {
            if (sql.includes("stock_quantity + ?")) p.stock_quantity = (Number(p.stock_quantity ?? 0) + qty);
            else if (sql.includes("stock_quantity - ?")) p.stock_quantity = (Number(p.stock_quantity ?? 0) - qty);
            else p.stock_quantity = Number(params[0] ?? p.stock_quantity);
            if (sql.includes("selling_price")) {
              // case: UPDATE products SET stock_quantity = ..., selling_price = ? WHERE id = ?
              // params[0]=qty, params[1]=price, params[2]=id → handled separately below as generic
            }
            p.updated_at = new Date().toISOString();
          }
        } else {
          const id = params[params.length - 1];
          const p = products.find((x: any) => x.id === id);
          if (p) {
            const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
            const cols = setPart.split(",").map(c => c.trim().replace(/\s*=\s*\??$/, "").trim());
            cols.forEach((col, i) => {
              if (params[i] !== undefined) (p as any)[col] = params[i];
            });
            p.updated_at = new Date().toISOString();
          }
        }
      } else if (sql.includes("INSERT INTO sales")) {
        const sales = memStore.get("sales") ?? [];
        // params: id,store_id,sale_number,customer_id,status,payment_method,subtotal,total,amount_paid,amount_due,[seller_id][,seller_role][,created_at],updated_at
        let created_at = new Date().toISOString();
        let updated_at = new Date().toISOString();
        let seller_id = null, seller_role = null;
        // Last param is updated_at when explicit
        const last = params[params.length - 1];
        if (typeof last === "string" && /\d{4}-\d{2}-\d{2}T/.test(last)) updated_at = last;
        // Detect seller fields before timestamps
        // If there are >= 12 params, params[10] is seller_id, params[11] seller_role, params[12] created_at
        if (params.length >= 12) seller_id = params[10] ?? null;
        if (params.length >= 12) seller_role = params[11] ?? null;
        if (params.length >= 13) created_at = params[12] ?? created_at;
        sales.push({ id: params[0], store_id: params[1], sale_number: params[2], customer_id: params[3], status: params[4], payment_method: params[5], subtotal: params[6], total: params[7], amount_paid: params[8], amount_due: params[9], seller_id, seller_role, created_at, updated_at });
        memStore.set("sales", sales);
      } else if (sql.includes("INSERT INTO daily_reports")) {
        const arr = memStore.get("daily_reports") ?? [];
        arr.push({ id: params[0], store_id: params[1], report_date: params[2], role: params[3], user_id: params[4], status: params[5] ?? "pending", opening_balance: params[6] ?? 0, expected_cash: params[7] ?? 0, actual_cash: params[8] ?? null, cash_sales: params[9] ?? 0, moncash_sales: params[10] ?? 0, natcash_sales: params[11] ?? 0, credit_sales: params[12] ?? 0, credit_collected_cash: params[13] ?? 0, credit_collected_moncash: params[14] ?? 0, credit_collected_natcash: params[15] ?? 0, withdrawals_total: params[16] ?? 0, inventory_total: params[17] ?? 0, deficit: params[18] ?? 0, submitted_at: params[19] ?? null, closed_at: params[20] ?? null, created_at: params[21] ?? new Date().toISOString(), updated_at: params[22] ?? new Date().toISOString(), reviewed_by: params[23] ?? null, reviewed_at: params[24] ?? null });
        memStore.set("daily_reports", arr);
      } else if (sql.includes("INSERT INTO cashier_deficits")) {
        const arr = memStore.get("cashier_deficits") ?? [];
        const cd = { id: params[0], store_id: params[1], cashier_id: params[2], date: params[3], deficit: params[4] ?? 0, status: params[5] ?? "open", resolution: params[6] ?? null, resolved_by: params[7] ?? null, resolved_at: params[8] ?? null, notes: params[9] ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        if (params.length === 7) { cd.status = params[5] ?? "open"; cd.created_at = params[6] ?? new Date().toISOString(); }
        arr.push(cd);
        memStore.set("cashier_deficits", arr);
      } else if (sql.includes("INSERT INTO monthly_losses")) {
        const arr = memStore.get("monthly_losses") ?? [];
        arr.push({ id: params[0], store_id: params[1], month: params[2], cashier_id: params[3], amount: params[4] ?? 0, origin: params[5] ?? null, reason: params[6] ?? null, registered_by: params[7] ?? null, created_at: params[8] ?? new Date().toISOString() });
        memStore.set("monthly_losses", arr);
      } else if (sql.includes("INSERT INTO report_reviews")) {
        const arr = memStore.get("report_reviews") ?? [];
        arr.push({
          id: params[0], store_id: params[1], report_id: params[2], cashier_id: params[3],
          report_date: params[4], deficit: Number(params[5] ?? 0), decision: params[6],
          decided_by: params[7] ?? null, decided_by_role: params[8] ?? null,
          decided_by_rank: Number(params[9] ?? 0), reason: params[10] ?? null,
          previous_review_id: params[11] ?? null, created_at: params[12] ?? new Date().toISOString(),
          lamport_clock: Number(params[13] ?? 0), updated_at: params[12] ?? new Date().toISOString(),
        });
        memStore.set("report_reviews", arr);
      } else if (sql.includes("INSERT INTO cash_register_checks")) {
        const arr = memStore.get("cash_register_checks") ?? [];
        const ts = new Date().toISOString();
        let c: any;
        if (params.length >= 15 && sql.includes("check_date")) {
          c = { id: params[0], store_id: params[1], report_id: params[2], cashier_id: params[3], check_date: params[4] ?? ts.slice(0,10), stated_amount: params[5] ?? 0, program_amount: params[6] ?? 0, status: params[7] ?? "pending", action: params[8] ?? null, set_by: params[9] ?? "owner-1", set_by_role: params[10] ?? "owner", is_default: params[11] ?? 0, approved_by: params[12] ?? null, correct_amount: params[13] ?? null, created_at: params[14] ?? ts, updated_at: ts };
        } else if (params.length === 11) {
          const created = params[10] ?? ts;
          c = { id: params[0], store_id: params[1], report_id: params[2], cashier_id: params[3], check_date: created.slice(0,10), stated_amount: params[4] ?? 0, program_amount: params[5] ?? 0, status: params[6] ?? "pending", action: params[7] ?? null, set_by: "owner-1", set_by_role: "owner", is_default: 1, approved_by: params[8] ?? null, correct_amount: params[9] ?? null, created_at: created, updated_at: ts };
        } else {
          const created = params[8] ?? ts;
          c = { id: params[0], store_id: params[1], report_id: params[2], cashier_id: params[3], check_date: created.slice(0,10), stated_amount: params[4] ?? 0, program_amount: params[5] ?? 0, status: params[6] ?? "pending", action: params[7] ?? null, set_by: "owner-1", set_by_role: "owner", is_default: 1, approved_by: null, correct_amount: null, created_at: created, updated_at: ts };
          if (params.length === 9) { c.action = params[7] ?? null; c.created_at = params[8] ?? ts; c.updated_at = ts; }
        }
        arr.push(c);
        memStore.set("cash_register_checks", arr);
      } else if (sql.includes("INSERT INTO deficit_settlements")) {
        const arr = memStore.get("deficit_settlements") ?? [];
        const ts = new Date().toISOString();
        const s = { id: params[0], store_id: params[1], cashier_id: params[2], period_start: params[3], period_end: params[4], deficit_ids: params[5] ?? "[]", total: Number(params[6] ?? 0), paid: Number(params[7] ?? 0), status: params[8] ?? "open", created_by: params[9] ?? null, paid_by: params[10] ?? null, paid_at: params[11] ?? null, created_at: params[12] ?? ts, updated_at: ts };
        if (s.paid >= s.total && s.total > 0) s.status = "paid";
        else if (s.paid > 0) s.status = "partial";
        arr.push(s);
        memStore.set("deficit_settlements", arr);
      } else if (sql.includes("INSERT INTO salary_deductions")) {
        const arr = memStore.get("salary_deductions") ?? [];
        arr.push({ id: params[0], store_id: params[1], cashier_id: params[2], amount: params[3] ?? 0, deficit_ids: params[4] ?? null, registered_by: params[5] ?? null, created_at: params[6] ?? new Date().toISOString() });
        memStore.set("salary_deductions", arr);
      } else if (sql.includes("INSERT INTO sale_items")) {
        const items = memStore.get("sale_items") ?? [];
        // params: id,store_id,sale_id,product_id,product_name,unit_id,variant,quantity,unit_price,cost_price,line_total,updated_at
        items.push({ id: params[0], store_id: params[1], sale_id: params[2], product_id: params[3], product_name: params[4], unit_id: params[5] ?? null, variant: params[6] ?? null, quantity: params[7], unit_price: params[8], cost_price: params[9], line_total: params[10], created_at: params[11] ?? new Date().toISOString() });
        memStore.set("sale_items", items);
      } else if (sql.includes("INTO receipts")) {
        const arr = memStore.get("receipts") ?? [];
        const idx = arr.findIndex((x: any) => x.id === params[0]);
        const rec = { id: params[0], store_id: params[1], sale_id: params[2], copy_type: params[3], receipt_number: params[4], sale_number: params[5], cashier_id: params[6] ?? null, cashier_name: params[7] ?? null, cashier_role: params[8] ?? null, content: params[9], created_at: params[10] ?? new Date().toISOString() };
        if (idx >= 0) arr[idx] = rec; else arr.push(rec);
        memStore.set("receipts", arr);
      } else if (sql.includes("INSERT INTO credits")) {
        const credits = memStore.get("credits") ?? [];
        if (params.length >= 10 && sql.includes("due_date")) {
          // 10-col: id,store_id,sale_id,customer_id,amount,amount_paid,balance,status,due_date,updated_at
          credits.push({ id: params[0], store_id: params[1], sale_id: params[2], customer_id: params[3], amount: params[4], amount_paid: params[5], balance: params[6], status: params[7], due_date: params[8] ?? null, created_at: params[9] ?? new Date().toISOString(), updated_at: params[9] ?? new Date().toISOString() });
        } else if (params.length >= 9 && sql.includes("due_date")) {
          // new 9-col: id,store_id,sale_id,customer_id,amount,balance,status,due_date,updated_at
          credits.push({ id: params[0], store_id: params[1], sale_id: params[2], customer_id: params[3], amount: params[4], balance: params[5], status: params[6], due_date: params[7] ?? null, created_at: params[8] ?? new Date().toISOString(), updated_at: params[8] ?? new Date().toISOString() });
        } else {
          credits.push({ id: params[0], store_id: params[1], sale_id: params[2], customer_id: params[3], amount: params[4], balance: params[5], status: params[6], created_at: params[7] ?? new Date().toISOString(), updated_at: params[7] ?? new Date().toISOString() });
        }
        memStore.set("credits", credits);
      } else if (sql.includes("INSERT INTO credit_payments")) {
        const payments = memStore.get("credit_payments") ?? [];
        payments.push({
          id: params[0],
          store_id: params[1],
          credit_id: params[2],
          debt_id: params[3],
          amount: params[4],
          payment_method: params[5],
          receipt_number: params[6],
          created_at: params[7] ?? new Date().toISOString(),
          collected_by: params[8] ?? null,
        });
        memStore.set("credit_payments", payments);
      } else if (sql.includes("INSERT INTO shifts")) {
        const shifts = memStore.get("shifts") ?? [];
        shifts.push({ id: params[0], store_id: params[1], cashier_id: params[2], manager_id: params[3], opening_balance: params[4], status: params[5], start_time: params[6], end_time: params[7], cashier_confirmed: params[8], manager_confirmed: params[9], supervisor_confirmed: params[10] });
        memStore.set("shifts", shifts);
      } else if (sql.includes("INSERT INTO cash_movements")) {
        const cms = memStore.get("cash_movements") ?? [];
        let cm: any;
        // Support both 9 and 10 params (with taken_by)
        if (params.length === 10) {
          cm = { id: params[0], shift_id: params[1], store_id: params[2], type: params[3], amount: params[4], reason: params[5], created_by: params[6], taken_by: params[7], validated_by: params[8], created_at: params[9] };
        } else {
          cm = { id: params[0], shift_id: params[1], store_id: params[2], type: params[3], amount: params[4], reason: params[5], created_by: params[6], validated_by: params[7], created_at: params[8] };
        }
        cms.push(cm);
        memStore.set("cash_movements", cms);
        // Notify all supervisors of the store on any cash movement OUT (withdrawal / inventory)
        if (cm.type === "withdrawal" || cm.type === "inventory") {
          const notifs = memStore.get("notifications") ?? [];
          const label = cm.type === "inventory" ? `Kach envantè ${cm.amount} HTG` : `Retrè ${cm.amount} HTG`;
          for (const sup of ["owner-1", "admin-1", "manager-1"]) {
            if (sup === cm.created_by) continue;
            notifs.push({ id: `notif-${Date.now()}-${sup}-${Math.random().toString(36).slice(2, 4)}`, user_id: sup, type: cm.type === "inventory" ? "inventory_pickup" : "withdrawal", reference_id: cm.id, message: `${label} — ${cm.reason ?? ""}`.trim(), status: "pending", created_at: new Date().toISOString() });
          }
          memStore.set("notifications", notifs);
        }
      } else if (sql.includes("INSERT INTO debt_collections")) {
        const dcs = memStore.get("debt_collections") ?? [];
        dcs.push({ id: params[0], shift_id: params[1], customer_id: params[2], amount: params[3], created_at: params[4] });
        memStore.set("debt_collections", dcs);
      } else if (sql.includes("INSERT INTO customer_history")) {
        const history = memStore.get("customer_history") ?? [];
        history.push({ id: params[0], customer_id: params[1], user_id: params[2], action: params[3], field_name: params[4], old_value: params[5], new_value: params[6], created_at: params[7] });
        memStore.set("customer_history", history);
      } else if (sql.includes("INSERT INTO cash_requests")) {
        const crs = memStore.get("cash_requests") ?? [];
        crs.push({ id: params[0], shift_id: params[1], amount: params[2], reason: params[3], created_by: params[4], status: params[5], created_at: params[6] });
        memStore.set("cash_requests", crs);
      } else if (sql.includes("INSERT INTO notifications")) {
        const notifs = memStore.get("notifications") ?? [];
        notifs.push({
          id: params[0],
          user_id: params[1],
          type: params[2],
          reference_id: params[3],
          message: params[4],
          status: params[5],
          created_at: params[6] ?? new Date().toISOString(),
        });
        memStore.set("notifications", notifs);
      } else if (sql.includes("INSERT INTO employees")) {
        const emps = memStore.get("employees") ?? [];
        emps.push({ id: params[0], store_id: params[1], full_name: params[2], role: params[3], phone: params[4], salary: params[5], address: params[6], is_active: params[7], online_status: params[8], created_at: params[9] ?? new Date().toISOString() });
        memStore.set("employees", emps);
      } else if (sql.includes("UPDATE employees SET")) {
        const emps = memStore.get("employees") ?? [];
        const id = params[params.length - 1];
        const emp = emps.find((x: any) => x.id === id);
        if (emp) {
          if (sql.includes("full_name")) emp.full_name = params[0];
          if (sql.includes("role")) emp.role = params[0];
          if (sql.includes("phone")) emp.phone = params[0];
          if (sql.includes("salary")) emp.salary = params[0];
          if (sql.includes("address")) emp.address = params[0];
          if (sql.includes("is_active")) emp.is_active = params[0];
          if (sql.includes("online_status")) emp.online_status = params[0];
          emp.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("INSERT INTO cash_discrepancies")) {
        const cds = memStore.get("cash_discrepancies") ?? [];
        cds.push({ id: params[0], shift_id: params[1], manager_amount: params[2], cashier_amount: params[3], difference: params[4], status: params[5], created_by: params[6], reassigned_amount: params[7] ?? null, created_at: params[8] ?? new Date().toISOString() });
        memStore.set("cash_discrepancies", cds);
        // Create notifications for all supervisors
        const notifs = memStore.get("notifications") ?? [];
        for (const sup of ["owner-1", "admin-1", "manager-1"]) {
          notifs.push({ id: `notif-${Date.now()}-${sup}-${Math.random().toString(36).slice(2,4)}`, user_id: sup, type: "cash_discrepancy", reference_id: params[0], message: `Kesye rapòte ${params[3]} HTG olye de ${params[2]} HTG — manke ${params[4]} HTG`, status: "pending", created_at: new Date().toISOString() });
        }
        memStore.set("notifications", notifs);
      } else if (sql.includes("UPDATE notifications SET")) {
        const notifs = memStore.get("notifications") ?? [];
        const id = params[params.length - 1];
        const notif = notifs.find((x: any) => x.id === id);
        if (notif) {
          if (sql.includes("status")) notif.status = params[0];
          if (sql.includes("message")) notif.message = params[0];
        }
      } else if (sql.includes("INSERT INTO customers")) {
        const customers = memStore.get("customers") ?? [];
        const newId = params[0];
        if (!customers.some((c: any) => c.id === newId)) {
          if (params.length === 11) {
            customers.push({ id: params[0], store_id: params[1], name: params[2], phone: params[3], address: params[4], id_card_number: params[5], total_debt: params[6], credit_limit: params[7], credit_limit_source: params[8], is_high_risk: params[9], open_debt_count: params[10] });
          } else {
            customers.push({ id: params[0], store_id: params[1], name: params[2], phone: params[3], id_card_number: params[4], total_debt: params[5], credit_limit: params[6], credit_limit_source: params[7], is_high_risk: params[8], open_debt_count: params[9], address: null });
          }
          memStore.set("customers", customers);
        }
      } else if (sql.includes("UPDATE customers SET")) {
        const customers = memStore.get("customers") ?? [];
        const id = params[params.length - 1];
        const c = customers.find((x: any) => x.id === id);
        if (c) {
          if (sql.includes("total_debt")) c.total_debt = params[0];
          if (sql.includes("credit_limit")) c.credit_limit = params[0];
          if (sql.includes("credit_limit_source")) c.credit_limit_source = params[0];
          if (sql.includes("is_high_risk")) c.is_high_risk = params[0];
          if (sql.includes("open_debt_count")) c.open_debt_count = params[0];
        }
      } else if (sql.includes("UPDATE credits SET")) {
        const credits = memStore.get("credits") ?? [];
        const id = params[params.length - 1];
        const credit = credits.find((x: any) => x.id === id);
        if (credit) {
          if (sql.includes("amount_paid")) credit.amount_paid = params[0];
          if (sql.includes("balance")) credit.balance = params[0];
          if (sql.includes("status")) credit.status = params[0];
          if (sql.includes("updated_at")) credit.updated_at = params[0];
        }
      } else if (sql.includes("UPDATE cash_requests SET")) {
        const crs = memStore.get("cash_requests") ?? [];
        const id = params[1];
        const cr = crs.find((x: any) => x.id === id);
        if (cr) cr.status = params[0];
      } else if (sql.includes("UPDATE cash_discrepancies SET")) {
        const cds = memStore.get("cash_discrepancies") ?? [];
        const id = params[params.length - 1];
        const cd = cds.find((x: any) => x.id === id);
        if (cd) {
          if (sql.includes("status")) cd.status = params[0];
          if (sql.includes("reassigned_amount")) cd.reassigned_amount = params[0];
          if (sql.includes("cashier_amount") && params.length > 2) cd.cashier_amount = params[0];
        }
      } else if (sql.includes("UPDATE daily_reports SET")) {
        const arr = memStore.get("daily_reports") ?? [];
        const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
        const cols = setPart.split(",").map(p => p.trim().replace(/=\s*\?\s*,?$/, "").replace(/=$/, "").trim()).filter(Boolean);
        const tail = params.slice(cols.length);
        const whereSql = (sql.match(/WHERE\s+(.*)$/i)?.[1] ?? "").toLowerCase();
        let r: any | undefined;
        if (whereSql.includes("user_id")) {
          const [uid, rdate, sid] = tail;
          r = arr.find((x: any) => x.user_id === uid && x.report_date === rdate && (x.store_id ?? sid) === sid);
        } else if (tail.length > 0) {
          r = arr.find((x: any) => x.id === tail[tail.length - 1]);
        }
        if (r) {
          cols.forEach((col, i) => { if (params[i] !== undefined) r[col] = params[i]; });
          r.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE cashier_deficits SET")) {
        const arr = memStore.get("cashier_deficits") ?? [];
        const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
        const cols = setPart.split(",").map(p => p.trim().replace(/=\s*\?\s*,?$/, "").replace(/=$/, "").trim()).filter(Boolean);
        const tail = params.slice(cols.length);
        const d = arr.find((x: any) => x.id === tail[tail.length - 1]);
        if (d) {
          cols.forEach((col, i) => { if (params[i] !== undefined) d[col] = params[i]; });
          d.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE cash_register_checks SET")) {
        const arr = memStore.get("cash_register_checks") ?? [];
        const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
        const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
        const id = params[params.length - 1];
        const c = arr.find((x: any) => x.id === id);
        if (c) {
          const terminal = new Set(["approved","rejected","resolved"]);
          const newStatus = cols.includes("status") ? params[cols.indexOf("status")] : c.status;
          if (terminal.has(c.status) && newStatus !== c.status) { /* blocked */ }
          else {
            const allowed: Record<string,string[]> = { pending:["approved","contested","rejected"], contested:["approved","rejected","resolved"], approved:[], rejected:[], resolved:[] };
            if (newStatus !== c.status && !(allowed[c.status] ?? []).includes(newStatus)) { /* blocked */ }
            else cols.forEach((col,i)=>{ if(params[i]!==undefined) (c as any)[col]=params[i]; });
          }
          c.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE deficit_settlements SET")) {
        const arr = memStore.get("deficit_settlements") ?? [];
        const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
        const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
        const id = params[params.length - 1];
        const s = arr.find((x: any) => x.id === id);
        if (s) {
          const terminal = new Set(["paid","waived"]);
          if (terminal.has(s.status)) { /* no transitions */ }
          else {
            cols.forEach((col,i)=>{ if(params[i]!==undefined) (s as any)[col]=params[i]; });
            if (!cols.includes("status")) {
              if (s.status !== "waived") {
                if (s.paid >= s.total && s.total > 0) s.status = "paid";
                else if (s.paid > 0) s.status = "partial";
                else s.status = "open";
                if (s.status === "paid") s.paid_at = new Date().toISOString();
              }
            }
          }
          s.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE sales SET")) {
        const sales = memStore.get("sales") ?? [];
        const id = params[params.length - 1];
        const s = sales.find((x: any) => x.id === id);
        if (s) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
          cols.forEach((col, i) => {
            if (params[i] !== undefined) (s as any)[col] = params[i];
          });
        }
      } else if (sql.includes("UPDATE shifts SET")) {
        const shifts = memStore.get("shifts") ?? [];
        // Destination row is the last param (WHERE id = ?). The SET placeholders come before it.
        const id = params[params.length - 1];
        const s = shifts.find((x: any) => x.id === id);
        if (s) {
          // Parse the SET assignments in order to pair each column with its param.
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
          cols.forEach((col, i) => {
            if (params[i] !== undefined) (s as any)[col] = params[i];
          });
        }
      } else if (sql.includes("INTO categories")) {
        const cats = memStore.get("categories") ?? [];
        // INSERT OR REPLACE or INSERT
        const id = params[0];
        const existingIdx = cats.findIndex((c: any) => c.id === id);
        const rec = { id: params[0], store_id: params[1], name: params[2], icon: params[3], color: params[4], sort_order: params[5] ?? cats.length + 1, created_at: params[6] ?? new Date().toISOString(), updated_at: params[7] ?? new Date().toISOString(), is_deleted: 0, dirty: 1 };
        if (sql.includes("OR REPLACE") && existingIdx >= 0) cats[existingIdx] = { ...cats[existingIdx], ...rec };
        else if (existingIdx >= 0) { /* ignore duplicate */ } else cats.push(rec);
        memStore.set("categories", cats);
      } else if (sql.includes("INTO stores")) {
        const stores = memStore.get("stores") ?? [];
        const id = params[0];
        const idx = stores.findIndex((s: any) => s.id === id);
        const rec: any = {};
        // Handle both full INSERT and OR REPLACE variants: map by position if 10+ params else try to infer
        if (params.length >= 7) {
          // Expected: id, name, location, code, currency, created_at, updated_at, disabled, breach_flagged, breached_at, revoked_by
          rec.id = params[0]; rec.name = params[1]; rec.location = params[2]; rec.code = params[3]; rec.currency = params[4] ?? "HTG"; rec.created_at = params[5]; rec.updated_at = params[6]; rec.disabled = params[7] ?? 0; rec.breach_flagged = params[8] ?? 0; rec.breached_at = params[9] ?? null; rec.revoked_by = params[10] ?? null;
        } else {
          rec.id = params[0]; rec.name = params[1] ?? rec.id; rec.location = params[2] ?? ""; rec.code = params[3] ?? "";
        }
        if (idx >= 0) stores[idx] = { ...stores[idx], ...rec, updated_at: new Date().toISOString() };
        else stores.push(rec);
        memStore.set("stores", stores);
      } else if (sql.includes("INTO _meta") || sql.includes("INSERT OR REPLACE INTO _meta")) {
        const meta = memStore.get("_meta") ?? [];
        const key = params[0]; const value = params[1];
        const idx = meta.findIndex((m: any) => m.key === key);
        if (idx >= 0) meta[idx].value = value;
        else meta.push({ key, value });
        memStore.set("_meta", meta);
      } else if (sql.includes("UPDATE categories SET")) {
        const cats = memStore.get("categories") ?? [];
        const id = params[params.length - 1];
        const c = cats.find((x: any) => x.id === id);
        if (c) {
          if (sql.includes("name")) c.name = params[0];
          if (sql.includes("icon")) c.icon = params[0];
          c.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE stores SET")) {
        const stores = memStore.get("stores") ?? [];
        const id = params[params.length - 1];
        const s = stores.find((x: any) => x.id === id);
        if (s) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          const cols = setPart.split(",").map(p => p.trim().replace(/\s*=\s*\??$/, "").trim());
          cols.forEach((col, i) => { if (params[i] !== undefined) (s as any)[col] = params[i]; });
          s.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("UPDATE _meta SET")) {
        const meta = memStore.get("_meta") ?? [];
        const key = params[params.length - 1];
        const m = meta.find((x: any) => x.key === key);
        if (m) m.value = params[0];
      } else if (sql.includes("INTO product_categories")) {
        const pcs = memStore.get("product_categories") ?? [];
        if (!pcs.some((r: any) => r.product_id === params[0] && r.category_id === params[1])) {
          pcs.push({ product_id: params[0], category_id: params[1] });
          memStore.set("product_categories", pcs);
        }
      } else if (sql.includes("DELETE FROM product_categories")) {
        const pcs = memStore.get("product_categories") ?? [];
        if (sql.includes("category_id")) {
          memStore.set("product_categories", pcs.filter((r: any) => !(r.product_id === params[0] && r.category_id === params[1])));
        } else {
          memStore.set("product_categories", pcs.filter((r: any) => r.product_id !== params[0]));
        }
      } else if (sql.includes("INTO stock_batches")) {
        const batches = memStore.get("stock_batches") ?? [];
        const id = params[0];
        const rec = { id: params[0], store_id: params[1], reference: params[2], supplier: params[3], transport_cost: Number(params[4] ?? 0), notes: params[5], total_items_cost: Number(params[6] ?? 0), total_cost: Number(params[7] ?? 0), received_at: params[8] ?? null, created_by: params[9], created_at: params[10] ?? new Date().toISOString(), updated_at: params[11] ?? new Date().toISOString(), status: params[12] ?? 'delivered', delivered_at: params[13] ?? null };
        const idx = batches.findIndex((b: any) => b.id === id);
        if (idx >= 0) batches[idx] = { ...batches[idx], ...rec };
        else batches.push(rec);
        memStore.set("stock_batches", batches);
      } else if (sql.includes("INTO stock_movements")) {
        const movs = memStore.get("stock_movements") ?? [];
        const rec = { id: params[0], batch_id: params[1], store_id: params[2], product_id: params[3], type: params[4], quantity: Number(params[5] ?? 0), initial_qty: Number(params[6] ?? 0), remaining_qty: Number(params[7] ?? 0), unit_cost: Number(params[8] ?? 0), total_cost: Number(params[9] ?? 0), allocated_transport: Number(params[10] ?? 0), reason: params[11], status: params[14] ?? "delivered", delivered_at: params[15] ?? null, created_by: params[12], created_at: params[13] ?? new Date().toISOString() };
        movs.push(rec);
        memStore.set("stock_movements", movs);
      } else if (sql.includes("DELETE FROM categories")) {
        const cats = memStore.get("categories") ?? [];
        memStore.set("categories", cats.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM stores")) {
        const stores = memStore.get("stores") ?? [];
        memStore.set("stores", stores.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM credits")) {
        const credits = memStore.get("credits") ?? [];
        memStore.set("credits", credits.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM credit_payments")) {
        const payments = memStore.get("credit_payments") ?? [];
        memStore.set("credit_payments", payments.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM outbox")) {
        const outbox = memStore.get("outbox") ?? [];
        memStore.set("outbox", outbox.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM product_bundles")) {
        const arr = memStore.get("product_bundles") ?? [];
        memStore.set("product_bundles", sql.includes("unit_id") ? arr.filter((x: any) => x.unit_id !== params[0]) : arr.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM product_prices")) {
        const arr = memStore.get("product_prices") ?? [];
        memStore.set("product_prices", sql.includes("unit_id") ? arr.filter((x: any) => x.unit_id !== params[0]) : arr.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("INTO suspended_sale_items")) {
        const arr = memStore.get("suspended_sale_items") ?? [];
        arr.push({ id: params[0], suspended_sale_id: params[1], store_id: params[2], product_id: params[3], product_name: params[4], unit_id: params[5] ?? null, unit_name: params[6] ?? null, factor: Number(params[7] ?? 1), variant: params[8] ?? null, quantity: Number(params[9] ?? 0), base_price: Number(params[10] ?? 0), unit_price: Number(params[11] ?? 0), line_total: Number(params[12] ?? 0), bundle_applied: params[13] ? 1 : 0, created_at: params[14] ?? new Date().toISOString() });
        memStore.set("suspended_sale_items", arr);
      } else if (sql.includes("INTO suspended_sale_events")) {
        const arr = memStore.get("suspended_sale_events") ?? [];
        arr.push({ id: params[0], suspended_sale_id: params[1], actor_id: params[2] ?? null, actor_name: params[3] ?? null, action: params[4], note: params[5] ?? null, created_at: params[6] ?? new Date().toISOString() });
        memStore.set("suspended_sale_events", arr);
      } else if (sql.includes("INTO suspended_sales")) {
        const arr = memStore.get("suspended_sales") ?? [];
        const rec = { id: params[0], store_id: params[1], label: params[2], customer_id: params[3] ?? null, cashier_id: params[4] ?? null, cashier_name: params[5] ?? null, seller_role: params[6] ?? null, status: params[7] ?? "open", total: Number(params[8] ?? 0), completed_sale_id: params[9] ?? null, device_id: params[10] ?? null, created_at: params[11] ?? new Date().toISOString(), updated_at: params[12] ?? new Date().toISOString() };
        const ui = arr.findIndex((x: any) => x.id === rec.id);
        if (ui >= 0) arr[ui] = { ...arr[ui], ...rec }; else arr.push(rec);
        memStore.set("suspended_sales", arr);
      } else if (sql.includes("UPDATE suspended_sales SET")) {
        const arr = memStore.get("suspended_sales") ?? [];
        const id = params[params.length - 1];
        const rec = arr.find((x: any) => x.id === id);
        if (rec) {
          const setPart = (sql.match(/SET\s+(.*?)\s+WHERE/i)?.[1] ?? "").trim();
          setPart.split(",").forEach((c, i) => {
            const plain = c.trim().match(/^(\w+)\s*=\s*\?$/);
            if (plain && params[i] !== undefined) (rec as any)[plain[1]] = params[i];
          });
          rec.updated_at = new Date().toISOString();
        }
      } else if (sql.includes("DELETE FROM product_units")) {
        const arr = memStore.get("product_units") ?? [];
        memStore.set("product_units", arr.filter((x: any) => x.id !== params[0]));
      } else if (sql.includes("DELETE FROM suspended_sale_items")) {
        const arr = memStore.get("suspended_sale_items") ?? [];
        memStore.set("suspended_sale_items", arr.filter((x: any) => x.suspended_sale_id !== params[0]));
      }
      return { lastInsertRowId: 0, changes: 1 };
    },
    getAllAsync: async (sql: string, params?: any[]) => {
      if (sql.includes("FROM outbox")) return memStore.get("outbox") ?? [];
      if (sql.includes("FROM products")) {
        const all = memStore.get("products") ?? [];
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        return all;
      }
      if (sql.includes("FROM sales")) {
        const all = memStore.get("sales") ?? [];
        if (sql.includes("WHERE customer_id")) {
          const cid = params?.[0];
          return all.filter((x: any) => x.customer_id === cid);
        }
        return all;
      }
      if (sql.includes("FROM sale_items")) {
        const all = memStore.get("sale_items") ?? [];
        if (sql.includes("WHERE sale_id")) {
          const saleId = params?.[0] ?? sql.match(/sale_id = '([^']+)'/)?.[1];
          return all.filter((x: any) => x.sale_id === saleId);
        }
        return all;
      }
      if (sql.includes("FROM receipts")) {
        const all = memStore.get("receipts") ?? [];
        if (sql.includes("WHERE sale_id")) {
          const saleId = params?.[0] ?? sql.match(/sale_id = '([^']+)'/)?.[1];
          return all.filter((x: any) => x.sale_id === saleId);
        }
        return all;
      }
      if (sql.includes("FROM customers")) return memStore.get("customers") ?? [];
      if (sql.includes("FROM employees")) return memStore.get("employees") ?? [];
      if (sql.includes("FROM customer_history")) {
        const history = memStore.get("customer_history") ?? [];
        if (sql.includes("WHERE customer_id")) {
          const cid = params?.[0];
          return history.filter((x: any) => x.customer_id === cid);
        }
        return history;
      }
      if (sql.includes("FROM credits")) {
        const all = memStore.get("credits") ?? [];
        if (sql.includes("WHERE customer_id")) {
          const cid = params?.[0];
          return all.filter((x: any) => x.customer_id === cid);
        }
        return all;
      }
      if (sql.includes("FROM credit_payments")) return memStore.get("credit_payments") ?? [];
      if (sql.includes("FROM shifts")) return memStore.get("shifts") ?? [];
      if (sql.includes("FROM cash_movements")) {
        const all = memStore.get("cash_movements") ?? [];
        if (sql.includes("WHERE shift_id")) {
          const sid = params?.[0];
          return all.filter((x: any) => x.shift_id === sid);
        }
        return all;
      }
      if (sql.includes("FROM debt_collections")) {
        const all = memStore.get("debt_collections") ?? [];
        if (sql.includes("WHERE shift_id")) {
          const sid = params?.[0];
          return all.filter((x: any) => x.shift_id === sid);
        }
        return all;
      }
      if (sql.includes("FROM cash_requests")) {
        const all = memStore.get("cash_requests") ?? [];
        if (sql.includes("WHERE shift_id")) {
          const sid = params?.[0];
          return all.filter((x: any) => x.shift_id === sid);
        }
        return all;
      }
      if (sql.includes("FROM cash_discrepancies")) {
        const all = memStore.get("cash_discrepancies") ?? [];
        if (sql.includes("WHERE shift_id")) {
          const sid = params?.[0];
          return all.filter((x: any) => x.shift_id === sid);
        }
        return all;
      }
      if (sql.includes("FROM notifications")) {
        const all = memStore.get("notifications") ?? [];
        if (sql.includes("WHERE user_id")) {
          const uid = params?.[0];
          return all.filter((x: any) => x.user_id === uid);
        }
        if (sql.includes("WHERE status")) {
          return all.filter((x: any) => x.status === "pending");
        }
        return all;
      }
      if (sql.includes("FROM daily_reports")) {
        const all = memStore.get("daily_reports") ?? [];
        if (sql.includes("WHERE user_id")) { const v = params?.[0]; return all.filter((x: any) => x.user_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE report_date")) { const v = params?.[0]; return all.filter((x: any) => x.report_date === v); }
        return all;
      }
      if (sql.includes("FROM cashier_deficits")) {
        const all = memStore.get("cashier_deficits") ?? [];
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE status")) { const v = params?.[0]; return all.filter((x: any) => x.status === v); }
        return all;
      }
      if (sql.includes("FROM report_reviews")) {
        const all = memStore.get("report_reviews") ?? [];
        if (sql.includes("WHERE report_id")) { const v = params?.[0]; return all.filter((x: any) => x.report_id === v); }
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        return all;
      }
      if (sql.includes("FROM monthly_losses")) {
        const all = memStore.get("monthly_losses") ?? [];
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE month")) { const v = params?.[0]; return all.filter((x: any) => x.month === v); }
        return all;
      }
      if (sql.includes("FROM deficit_settlements")) {
        const all = memStore.get("deficit_settlements") ?? [];
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE status")) { const v = params?.[0]; return all.filter((x: any) => x.status === v); }
        return all;
      }
      if (sql.includes("FROM cash_register_checks")) {
        const all = memStore.get("cash_register_checks") ?? [];
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE report_id")) { const v = params?.[0]; return all.filter((x: any) => x.report_id === v); }
        return all;
      }
      if (sql.includes("FROM salary_deductions")) {
        const all = memStore.get("salary_deductions") ?? [];
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0]; return all.filter((x: any) => x.cashier_id === v); }
        return all;
      }
      if (sql.includes("FROM categories")) {
        const all = memStore.get("categories") ?? [];
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM product_categories")) {
        const all = memStore.get("product_categories") ?? [];
        if (sql.includes("WHERE product_id") && sql.includes("category_id")) { const pid = params?.[0]; const cid = params?.[1]; return all.filter((x: any) => x.product_id === pid && x.category_id === cid); }
        if (sql.includes("WHERE product_id")) { const v = params?.[0]; return all.filter((x: any) => x.product_id === v); }
        if (sql.includes("WHERE category_id")) { const v = params?.[0]; return all.filter((x: any) => x.category_id === v); }
        return all;
      }
      if (sql.includes("FROM stock_batches")) {
        const all = memStore.get("stock_batches") ?? [];
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        if (sql.includes("WHERE status")) { const v = params?.[0]; return all.filter((x: any) => x.status === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        return all;
      }
      if (sql.includes("FROM stock_movements")) {
        const all = memStore.get("stock_movements") ?? [];
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        if (sql.includes("WHERE batch_id")) { const v = params?.[0]; return all.filter((x: any) => x.batch_id === v); }
        if (sql.includes("WHERE product_id")) { const v = params?.[0]; return all.filter((x: any) => x.product_id === v); }
        if (sql.includes("WHERE store_id")) { const v = params?.[0]; return all.filter((x: any) => x.store_id === v); }
        return all;
      }
      if (sql.includes("FROM product_units")) {
        const all = memStore.get("product_units") ?? [];
        if (sql.includes("WHERE product_id")) { const v = params?.[0]; return all.filter((x: any) => x.product_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM product_prices")) {
        const all = memStore.get("product_prices") ?? [];
        if (sql.includes("WHERE unit_id")) { const v = params?.[0]; return all.filter((x: any) => x.unit_id === v); }
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM product_bundles")) {
        const all = memStore.get("product_bundles") ?? [];
        if (sql.includes("WHERE unit_id")) { const v = params?.[0]; return all.filter((x: any) => x.unit_id === v); }
        return all;
      }
      if (sql.includes("FROM suspended_sale_items")) {
        const all = memStore.get("suspended_sale_items") ?? [];
        if (sql.includes("WHERE suspended_sale_id")) { const v = params?.[0] ?? sql.match(/suspended_sale_id\s*=\s*'([^']+)'/i)?.[1]; return all.filter((x: any) => x.suspended_sale_id === v); }
        return all;
      }
      if (sql.includes("FROM suspended_sale_events")) {
        const all = memStore.get("suspended_sale_events") ?? [];
        if (sql.includes("WHERE suspended_sale_id")) { const v = params?.[0] ?? sql.match(/suspended_sale_id\s*=\s*'([^']+)'/i)?.[1]; return all.filter((x: any) => x.suspended_sale_id === v); }
        return all;
      }
      if (sql.includes("FROM suspended_sales")) {
        const all = memStore.get("suspended_sales") ?? [];
        if (sql.includes("WHERE id")) { const v = params?.[0] ?? sql.match(/WHERE id\s*=\s*'([^']+)'/i)?.[1]; return all.filter((x: any) => x.id === v); }
        if (sql.includes("WHERE cashier_id")) { const v = params?.[0] ?? sql.match(/cashier_id\s*=\s*'([^']+)'/i)?.[1]; return all.filter((x: any) => x.cashier_id === v); }
        if (sql.includes("WHERE status")) { const v = params?.[0] ?? sql.match(/status\s*=\s*'([^']+)'/i)?.[1]; return all.filter((x: any) => x.status === v); }
        return all;
      }
      if (sql.includes("FROM stores")) {
        const all = memStore.get("stores") ?? [];
        if (sql.includes("WHERE id")) { const v = params?.[0]; return all.filter((x: any) => x.id === v); }
        return all;
      }
      if (sql.includes("FROM _meta")) {
        const all = memStore.get("_meta") ?? [];
        if (sql.includes("WHERE key")) { const v = params?.[0]; return all.filter((x: any) => x.key === v); }
        return all;
      }
      return [];
    },
  };
  return db;
}

// Generic helpers
export async function insertOutbox(table: string, operation: "create"|"update"|"delete", payload: any) {
  const d = await getDb();
  const { v4 } = await import("uuid");
  // use uuid v4 for JS env
  const id = payload.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await d.runAsync(
    "INSERT INTO outbox (id, table_name, operation, payload, created_at) VALUES (?,?,?,?,?)",
    [id + ":" + Date.now(), table, operation, JSON.stringify(payload), new Date().toISOString()]
  );
}

export async function getDirtyChanges(): Promise<{ table: string; operation: string; payload: any }[]> {
  const d = await getDb();
  const rows = await d.getAllAsync("SELECT * FROM outbox ORDER BY created_at ASC LIMIT 100");
  return (rows as any[]).map(r => ({ table: r.table_name, operation: r.operation, payload: JSON.parse(r.payload) }));
}

export async function clearOutbox(ids: string[]) {
  const d = await getDb();
  for (const id of ids) await d.runAsync("DELETE FROM outbox WHERE id = ?", [id]);
}

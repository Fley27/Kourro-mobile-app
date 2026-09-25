// SQLite schema — mirrors Postgres, offline-first
export const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  code TEXT,
  currency TEXT DEFAULT 'HTG',
  created_at TEXT,
  updated_at TEXT,
  disabled INTEGER DEFAULT 0,
  breach_flagged INTEGER DEFAULT 0,
  breached_at TEXT,
  revoked_by TEXT,
  lamport_clock INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '◈',
  color TEXT DEFAULT '#0f172a',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  sku TEXT, barcode TEXT,
  name TEXT NOT NULL, name_ht TEXT,
  category_id TEXT,
  item_type TEXT DEFAULT 'goods',
  is_available INTEGER DEFAULT 1,
  -- NOTE (catalog v2 cutover): cost_price was dropped — cost basis now
  -- derives from received batches. stock_quantity is system-maintained
  -- (batch-receive path only, base units); nobody edits it directly.
  -- Chain-only rule (one base item per product) is what keeps this
  -- unambiguous — see items/ratio lock in catalogModel.ts.
  -- status: 'draft' while the create chain is unfinished (never listed),
  -- 'active' once finished. Lists must filter accordingly.
  stock_quantity REAL DEFAULT 0,
  current_amount_available REAL DEFAULT 0,
  low_stock_threshold REAL DEFAULT 5,
  status TEXT DEFAULT 'active',
  device_id TEXT, lamport_clock INTEGER DEFAULT 0,
  updated_at TEXT, is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);

-- Catalog v2: Product (abstract: name + categories) → Item (purchasable
-- container chain) → Variant (sellable presentation) → VariantPrice
-- (effective-dated). Cost enters only via batches.
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ref_item_id TEXT,
  ratio REAL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_product ON items(product_id);

-- Costless sourcing link: which suppliers may supply a product.
CREATE TABLE IF NOT EXISTS product_suppliers (
  id TEXT,
  product_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0,
  PRIMARY KEY (product_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier ON product_suppliers(supplier_id);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  date TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  total_paid REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  received_by TEXT,
  received_at TEXT,
  denied_by TEXT,
  denied_at TEXT,
  reason TEXT,
  delivery_ref TEXT,
  transport_share REAL DEFAULT 0,
  source TEXT DEFAULT 'user',
  created_at TEXT,
  updated_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_batches_item ON batches(item_id);
CREATE INDEX IF NOT EXISTS idx_batches_supplier ON batches(supplier_id);

CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_variants_item ON variants(item_id);

CREATE TABLE IF NOT EXISTS variant_prices (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  price REAL NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_variant_prices_variant ON variant_prices(variant_id);
-- Catalog is global: products are unique by SKU (and barcode) across all locations
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_unique ON products(sku) WHERE sku IS NOT NULL AND sku != '' AND is_deleted=0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique ON products(barcode) WHERE barcode IS NOT NULL AND barcode != '' AND is_deleted=0;

CREATE TABLE IF NOT EXISTS product_categories (
  product_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  PRIMARY KEY (product_id, category_id)
);

-- Category polyhierarchy (DAG): a category may have MULTIPLE parents
-- (Beer -> Drinks and Alcohol). Roots have no parents. Cycle-checked at seed/write.
CREATE TABLE IF NOT EXISTS category_links (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  device_id TEXT,
  lamport_clock INTEGER DEFAULT 0,
  updated_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_links_unique
  ON category_links(child_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_category_links_child ON category_links(child_id);
CREATE INDEX IF NOT EXISTS idx_category_links_parent ON category_links(parent_id);

-- Multi-variant selling model: a product sells in several units (Unit, Box...),
-- each unit has per-variant prices (Cold, Hot, Regular...), plus bundle rules.
-- condition is the second variant dimension (cold / room temperature, nullable);
-- variant text on prices/sale_items mirrors it during the transition.
CREATE TABLE IF NOT EXISTS product_units (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  unit_name TEXT NOT NULL,
  condition TEXT,
  conversion_factor REAL NOT NULL DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_units_unique
  ON product_units(product_id, unit_name, COALESCE(condition, ''));

CREATE TABLE IF NOT EXISTS product_prices (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  price REAL NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS product_bundles (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  min_quantity REAL NOT NULL,
  bundle_price REAL NOT NULL,
  created_at TEXT
);

-- Catalog x Supplier (global join): one row per (product, supplier, unit).
-- Cost only — resell is one-per-unit in product_prices. No store_id:
-- same business, all locations. Editing one row never touches siblings.
CREATE TABLE IF NOT EXISTS product_supplier_costs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  last_updated TEXT,
  device_id TEXT,
  lamport_clock INTEGER DEFAULT 0,
  updated_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_psc_unique
  ON product_supplier_costs(product_id, supplier_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_psc_product ON product_supplier_costs(product_id);
CREATE INDEX IF NOT EXISTS idx_psc_supplier ON product_supplier_costs(supplier_id);

CREATE TABLE IF NOT EXISTS stock_batches (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  reference TEXT,
  supplier TEXT,
  supplier_id TEXT,
  transport_cost REAL DEFAULT 0,
  notes TEXT,
  total_items_cost REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  received_at TEXT,
  status TEXT DEFAULT 'pending',
  delivered_at TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  type TEXT NOT NULL,
  quantity REAL NOT NULL,
  initial_qty REAL DEFAULT 0,
  remaining_qty REAL DEFAULT 0,
  unit_cost REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  allocated_transport REAL DEFAULT 0,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  delivered_at TEXT,
  created_by TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  id_card_number TEXT,
  first_name TEXT,
  last_name TEXT,
  birth_day TEXT,
  birth_month TEXT,
  birth_year TEXT,
  country TEXT,
  department TEXT,
  commune TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  marketing_consent INTEGER DEFAULT 0,
  total_debt REAL DEFAULT 0,
  credit_limit REAL DEFAULT NULL,
  credit_limit_source TEXT,
  is_high_risk INTEGER DEFAULT 0,
  open_debt_count INTEGER DEFAULT 0,
  lamport_clock INTEGER DEFAULT 0, updated_at TEXT, is_deleted INTEGER DEFAULT 0, dirty INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_history (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL
);

-- Free-text notes about a customer (e.g. promised discount), newest first.
CREATE TABLE IF NOT EXISTS customer_notes (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON customer_notes(customer_id, created_at);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  sale_number TEXT NOT NULL,
  customer_id TEXT, status TEXT, payment_method TEXT,
  subtotal REAL, discount REAL, total REAL, amount_paid REAL, amount_due REAL,
  seller_id TEXT,
  seller_role TEXT,
  is_complimentary INTEGER DEFAULT 0,
  complimentary_reason TEXT,
  approved_by TEXT,
  created_at TEXT,
  lamport_clock INTEGER DEFAULT 0, updated_at TEXT, is_deleted INTEGER DEFAULT 0, dirty INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL, product_name TEXT NOT NULL,
  unit_id TEXT, variant TEXT,
  quantity REAL, unit_price REAL, cost_price REAL, line_total REAL,
  quantity_delivered REAL DEFAULT 0,
  is_complimentary INTEGER DEFAULT 0,
  approved_by TEXT,
  lamport_clock INTEGER DEFAULT 0, updated_at TEXT, is_deleted INTEGER DEFAULT 0, dirty INTEGER DEFAULT 0
);

-- Partial pickup / delivery tracking (staging, additive only).
-- quantity (paid) is source of truth; remaining = quantity - quantity_delivered.
-- sale_pickups is append-only history (one row per pickup event, supports multi-visit).
CREATE TABLE IF NOT EXISTS sale_pickups (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  sale_item_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  picked_up_by TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sale_pickups_sale ON sale_pickups(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_pickups_item ON sale_pickups(sale_item_id);

-- Receipts: two copies per sale — one for the customer, one for the store.
-- copy_type: 'customer' | 'store'; content holds a JSON snapshot of the receipt
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  copy_type TEXT NOT NULL,
  receipt_number TEXT NOT NULL,
  sale_number TEXT NOT NULL,
  cashier_id TEXT,
  cashier_name TEXT,
  cashier_role TEXT,
  content TEXT NOT NULL,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_receipts_sale ON receipts(sale_id);
CREATE INDEX IF NOT EXISTS idx_receipts_copy ON receipts(sale_id, copy_type);

CREATE TABLE IF NOT EXISTS credits (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  sale_id TEXT NOT NULL, customer_id TEXT NOT NULL,
  amount REAL, amount_paid REAL DEFAULT 0, balance REAL, status TEXT,
  due_date TEXT,
  will_be_late INTEGER DEFAULT 0,
  lamport_clock INTEGER DEFAULT 0, updated_at TEXT, is_deleted INTEGER DEFAULT 0, dirty INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS credit_payments (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  credit_id TEXT NOT NULL,
  debt_id TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  receipt_number TEXT,
  collected_by TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  created_at TEXT
);

-- Open sales / tabs (Vant an Atann): suspended carts with frozen variant prices.
-- Price freeze: base_price is snapshotted at suspend time; bundles stay live.
CREATE TABLE IF NOT EXISTS suspended_sales (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  label TEXT NOT NULL,
  customer_id TEXT,
  cashier_id TEXT,
  cashier_name TEXT,
  seller_role TEXT,
  status TEXT DEFAULT 'open',
  total REAL DEFAULT 0,
  completed_sale_id TEXT,
  device_id TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS suspended_sale_items (
  id TEXT PRIMARY KEY,
  suspended_sale_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_id TEXT,
  unit_name TEXT,
  factor REAL DEFAULT 1,
  variant TEXT,
  quantity REAL,
  base_price REAL DEFAULT 0,
  unit_price REAL,
  line_total REAL,
  bundle_applied INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS suspended_sale_events (
  id TEXT PRIMARY KEY,
  suspended_sale_id TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY,
  store_id TEXT, product_id TEXT,
  old_cost REAL, new_cost REAL, old_price REAL, new_price REAL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT,
  salary REAL DEFAULT 0,
  address TEXT,
  is_active INTEGER DEFAULT 1,
  online_status INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  lamport_clock INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);

-- Employee <-> store assignments (many-to-many; every employee belongs to at
-- least one store location). Legacy single-store values migrate here on load.
CREATE TABLE IF NOT EXISTS employee_stores (
  employee_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  PRIMARY KEY (employee_id, store_id)
);

-- Suppliers (Founisè). bank_info is sensitive: owner-only view/edit.
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  payment_terms TEXT,
  bank_info TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);

-- Orders (Kòmand): stock/catalog need requests.
-- Status flow: requested -> approved -> ordered -> received (cancelled anytime).
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  qty REAL DEFAULT 1,
  unit TEXT,
  supplier_name TEXT,
  note TEXT,
  status TEXT DEFAULT 'requested',
  requested_by TEXT,
  requested_by_name TEXT,
  approved_by TEXT,
  created_at TEXT,
  updated_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  report_date TEXT NOT NULL,
  role TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  opening_balance REAL DEFAULT 0,
  expected_cash REAL DEFAULT 0,
  actual_cash REAL DEFAULT NULL,
  cash_sales REAL DEFAULT 0,
  moncash_sales REAL DEFAULT 0,
  natcash_sales REAL DEFAULT 0,
  credit_sales REAL DEFAULT 0,
  credit_collected_cash REAL DEFAULT 0,
  credit_collected_moncash REAL DEFAULT 0,
  credit_collected_natcash REAL DEFAULT 0,
  withdrawals_total REAL DEFAULT 0,
  inventory_total REAL DEFAULT 0,
  deficit REAL DEFAULT 0,
  submitted_at TEXT,
  closed_at TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS cashier_deficits (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  date TEXT NOT NULL,
  deficit REAL DEFAULT 0,
  status TEXT DEFAULT 'open',
  resolution TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS monthly_losses (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  month TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  amount REAL DEFAULT 0,
  origin TEXT,
  reason TEXT,
  registered_by TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS cash_register_checks (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  check_date TEXT,
  stated_amount REAL DEFAULT 0,
  program_amount REAL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  action TEXT,
  set_by TEXT,
  set_by_role TEXT,
  is_default INTEGER DEFAULT 0,
  approved_by TEXT,
  correct_amount REAL DEFAULT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS deficit_settlements (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  deficit_ids TEXT,
  total REAL DEFAULT 0,
  paid REAL DEFAULT 0,
  status TEXT DEFAULT 'open',
  created_by TEXT,
  paid_by TEXT,
  paid_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS salary_deductions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  amount REAL DEFAULT 0,
  deficit_ids TEXT,
  registered_by TEXT,
  created_at TEXT
);

-- Append-only audit journal for daily-report review decisions.
-- The *current* decision for a report is the latest row by created_at.
-- Immutable: never UPDATE/DELETE; higher-rank overrides append a new row
-- (e.g. a supervisor swaps a waiver back to an open debt via "revoke_to_debt").
CREATE TABLE IF NOT EXISTS report_reviews (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  report_date TEXT NOT NULL,
  deficit REAL DEFAULT 0,
  decision TEXT NOT NULL,             -- debt | waived_negligible | approved | revoke_to_debt | approve_waive
  decided_by TEXT,
  decided_by_role TEXT,
  decided_by_rank INTEGER DEFAULT 0,
  reason TEXT,
  previous_review_id TEXT,            -- when this row revokes/replaces another decision
  created_at TEXT,
  lamport_clock INTEGER DEFAULT 0,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_reviews_report ON report_reviews(report_id);
CREATE INDEX IF NOT EXISTS idx_report_reviews_cashier ON report_reviews(cashier_id, report_date);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  manager_id TEXT,
  opening_balance REAL DEFAULT 0,
  status TEXT,
  start_time TEXT,
  end_time TEXT,
  actual_cash REAL,
  cashier_confirmed INTEGER DEFAULT 0,
  manager_confirmed INTEGER DEFAULT 0,
  supervisor_confirmed INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0,
  lamport_clock INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT,
  reference_id TEXT,
  message TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT,
  store_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL DEFAULT 0,
  reason TEXT,
  created_by TEXT,
  taken_by TEXT,
  validated_by TEXT,
  created_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cash_discrepancies (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL,
  manager_amount REAL DEFAULT 0,
  cashier_amount REAL DEFAULT 0,
  difference REAL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_by TEXT,
  reassigned_amount REAL,
  created_at TEXT,
  is_deleted INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS debt_collections (
  id TEXT PRIMARY KEY,
  shift_id TEXT,
  store_id TEXT,
  customer_id TEXT,
  amount REAL DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS cash_requests (
  id TEXT PRIMARY KEY,
  shift_id TEXT,
  store_id TEXT,
  amount REAL DEFAULT 0,
  reason TEXT,
  created_by TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT
);
`;

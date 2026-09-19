import React, { useEffect, useState, useMemo } from "react";
import { palette, radius, shadow } from "../theme";
import { View, Text, Pressable, TextInput, Alert, Modal, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb } from "../db";
import type { Role } from "../users";
import {
  loadPricing, ensurePricingForProducts, getUnitsForProduct, getPricesForUnit,
  getDefaultUnit, getDisplayPrice, type PricingMaps,
  type ProductUnit, type ProductPrice, type ProductBundle,
} from "../pricing";
import { fmt } from "../format";
import { useResponsive, sheetBox } from "../responsive";
import { StockPhone } from "./StockPhone";
import { StockTablet } from "./StockTablet";
import {
  UnitDropdown, DEFAULT_CATEGORIES, getCategoryForProduct, nid, slugify,
  type Category, type Product, type StockBatch, type StockMovement,
  type NewPriceRow, type NewBundleRow, type NewUnitRow,
} from "./StockShared";

export default function StockScreen({ role = "cashier", currentUser, onOpenInventory, inventoryVersion }: { role?: Role; currentUser?: any; onOpenInventory?: () => void; inventoryVersion?: number }) {
  const { width, isTablet, isLandscape, padH, fabRight } = useResponsive();
  // Master-detail needs landscape width; portrait tablets use phone layout.
  const showTablet = isTablet && isLandscape;
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [productCategories, setProductCategories] = useState<{ product_id: string; category_id: string }[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [q, setQ] = useState("");
  const [barcode, setBarcode] = useState("");
  const [cat, setCat] = useState("all");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddChoice, setShowAddChoice] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [stockTab, setStockTab] = useState<"store" | "incoming">("store");
  const [deliverBatch, setDeliverBatch] = useState<StockBatch | null>(null);
  const [deliverFee, setDeliverFee] = useState("");
  const [delivering, setDelivering] = useState(false);
  const [infoProduct, setInfoProduct] = useState<Product | null>(null);
  const [showNameEdit, setShowNameEdit] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [showUnitEdit, setShowUnitEdit] = useState(false);
  const [unitInput, setUnitInput] = useState("");
  const [newCategory, setNewCategory] = useState({ name: "", icon: "◈" });
  // Info-modal pricing editors: units (manual factors), variant prices, bundles
  const [infoUnits, setInfoUnits] = useState<ProductUnit[]>([]);
  const [infoPrices, setInfoPrices] = useState<ProductPrice[]>([]);
  const [infoBundles, setInfoBundles] = useState<ProductBundle[]>([]);
  const [newInfoUnitName, setNewInfoUnitName] = useState("");
  const [newInfoUnitFactor, setNewInfoUnitFactor] = useState("");
  const [showAddInfoPrice, setShowAddInfoPrice] = useState(false);
  const [infoPriceUnit, setInfoPriceUnit] = useState("");
  const [infoPriceVariant, setInfoPriceVariant] = useState("");
  const [infoPriceValue, setInfoPriceValue] = useState("");
  const [showAddInfoBundle, setShowAddInfoBundle] = useState(false);
  const [infoBundleUnit, setInfoBundleUnit] = useState("");
  const [infoBundleVariant, setInfoBundleVariant] = useState("");
  const [infoBundleMin, setInfoBundleMin] = useState("");
  const [infoBundlePrice, setInfoBundlePrice] = useState("");

  async function reloadInfoPricing(pid: string) {
    try {
      const db = await getDb();
      const u = ((await db.getAllAsync("SELECT * FROM product_units WHERE product_id = ?", [pid]).catch(() => [])) ?? []) as ProductUnit[];
      setInfoUnits(u);
      const pr: ProductPrice[] = [];
      const bu: ProductBundle[] = [];
      for (const unit of u) {
        const r = ((await db.getAllAsync("SELECT * FROM product_prices WHERE unit_id = ?", [unit.id]).catch(() => [])) ?? []) as ProductPrice[];
        pr.push(...r);
        const b = ((await db.getAllAsync("SELECT * FROM product_bundles WHERE unit_id = ?", [unit.id]).catch(() => [])) ?? []) as ProductBundle[];
        bu.push(...b);
      }
      setInfoPrices(pr);
      setInfoBundles(bu);
      setInfoPriceUnit(prev => u.some(x => x.id === prev) ? prev : (u[0]?.id ?? ""));
      setInfoBundleUnit(prev => u.some(x => x.id === prev) ? prev : (u[0]?.id ?? ""));
    } catch (e) { console.log("[info pricing] failed:", e); }
  }
  useEffect(() => {
    if (infoProduct) reloadInfoPricing(infoProduct.id);
    else {
      setInfoUnits([]); setInfoPrices([]); setInfoBundles([]);
      setShowAddInfoPrice(false); setShowAddInfoBundle(false);
      setNewInfoUnitName(""); setNewInfoUnitFactor("");
      setInfoPriceVariant(""); setInfoPriceValue("");
      setInfoBundleVariant(""); setInfoBundleMin(""); setInfoBundlePrice("");
    }
  }, [infoProduct?.id]);

  async function refreshPricingMaps() {
    try { const db = await getDb(); setPricing(await loadPricing(db)); } catch {}
  }
  async function saveInfoUnit(u: ProductUnit, name: string, factorStr: string) {
    const nm = name.trim();
    if (!nm) return Alert.alert("Non obligatwa", "Bay non inite a (ex. Box)");
    const isBase = Number(u.conversion_factor) === 1;
    const factor = isBase ? 1 : parseFloat(factorStr) || 0;
    if (!isBase && !(factor > 0)) return Alert.alert("Faktè pa valab", `Faktè pou "${nm}" dwe > 0 — ex. 6 pou yon Box Corona, 24 pou yon Box Prestige`);
    if (nm === u.unit_name && factor === Number(u.conversion_factor)) return;
    try {
      const db = await getDb();
      await db.runAsync("UPDATE product_units SET unit_name = ?, conversion_factor = ?, updated_at = ? WHERE id = ?", [nm, factor, new Date().toISOString(), u.id]);
      await reloadInfoPricing(u.product_id);
      await refreshPricingMaps();
    } catch (e: any) { Alert.alert("Erè", e?.message ?? "Sove inite echwe"); }
  }
  async function addInfoUnit() {
    if (!infoProduct) return;
    const nm = newInfoUnitName.trim();
    const factor = parseFloat(newInfoUnitFactor) || 0;
    if (!nm) return Alert.alert("Non obligatwa", "Bay non inite a (ex. Box, Case)");
    if (!(factor > 0)) return Alert.alert("Faktè pa valab", "Bay faktè konvèsyon an — konbyen inite baz nan youn (ex. 6)");
    try {
      const db = await getDb();
      let uid = `unit-${infoProduct.id}-${slugify(nm) || "u"}`;
      const taken = ((await db.getAllAsync("SELECT id FROM product_units WHERE id = ?", [uid]).catch(() => [])) ?? []) as any[];
      if (taken.length) uid = `${uid}-${Date.now().toString().slice(-4)}`;
      const now = new Date().toISOString();
      await db.runAsync("INSERT OR REPLACE INTO product_units (id, product_id, unit_name, conversion_factor, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        [uid, infoProduct.id, nm, factor, now, now]);
      setNewInfoUnitName(""); setNewInfoUnitFactor("");
      await reloadInfoPricing(infoProduct.id);
      await refreshPricingMaps();
    } catch (e: any) { Alert.alert("Erè", e?.message ?? "Ajoute inite echwe"); }
  }
  function deleteInfoUnit(u: ProductUnit) {
    if (infoUnits.length <= 1) return Alert.alert("Pa ka efase", "Kenbe omwen yon inite vant.");
    Alert.alert("Efase inite?", `"${u.unit_name}" + tout pri ak bundle li yo pral efase.`, [
      { text: "Anile", style: "cancel" },
      {
        text: "Efase", style: "destructive", onPress: () => { (async () => {
          try {
            const db = await getDb();
            await db.runAsync("DELETE FROM product_bundles WHERE unit_id = ?", [u.id]);
            await db.runAsync("DELETE FROM product_prices WHERE unit_id = ?", [u.id]);
            await db.runAsync("DELETE FROM product_units WHERE id = ?", [u.id]);
            await reloadInfoPricing(u.product_id);
            await refreshPricingMaps();
          } catch (e: any) { Alert.alert("Erè", e?.message ?? "Efase inite echwe"); }
        })(); },
      },
    ]);
  }
  async function addInfoPrice() {
    const unitId = infoPriceUnit || infoUnits[0]?.id;
    if (!unitId) return Alert.alert("Pa gen inite", "Kreye yon inite vant anvan");
    const variant = infoPriceVariant.trim() || "Regular";
    const price = parseFloat(infoPriceValue) || 0;
    if (!(price > 0)) return Alert.alert("Pri pa valab", "Antre yon pri > 0");
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const existing = ((await db.getAllAsync("SELECT * FROM product_prices WHERE unit_id = ?", [unitId]).catch(() => [])) ?? []) as any[];
      const row = existing.find((r: any) => String(r.variant).toLowerCase() === variant.toLowerCase());
      if (row) await db.runAsync("UPDATE product_prices SET price = ?, updated_at = ? WHERE id = ?", [price, now, row.id]);
      else await db.runAsync("INSERT INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
        [`price-${unitId}-${Date.now().toString().slice(-6)}`, unitId, variant, price, now]);
      setInfoPriceVariant(""); setInfoPriceValue(""); setShowAddInfoPrice(false);
      await reloadInfoPricing(infoUnits.find(x => x.id === unitId)?.product_id ?? infoProduct?.id ?? "");
      await refreshPricingMaps();
    } catch (e: any) { Alert.alert("Erè", e?.message ?? "Ajoute pri echwe"); }
  }
  function deleteInfoPrice(r: ProductPrice) {
    Alert.alert("Efase pri?", `${r.variant} · ${fmt(Number(r.price))} HTG`, [
      { text: "Anile", style: "cancel" },
      {
        text: "Efase", style: "destructive", onPress: () => { (async () => {
          try {
            const db = await getDb();
            await db.runAsync("DELETE FROM product_prices WHERE id = ?", [r.id]);
            await reloadInfoPricing(infoUnits.find(x => x.id === r.unit_id)?.product_id ?? infoProduct?.id ?? "");
            await refreshPricingMaps();
          } catch (e: any) { Alert.alert("Erè", e?.message ?? "Efase pri echwe"); }
        })(); },
      },
    ]);
  }
  async function addInfoBundle() {
    const unitId = infoBundleUnit || infoUnits[0]?.id;
    if (!unitId) return Alert.alert("Pa gen inite", "Kreye yon inite vant anvan");
    const variant = infoBundleVariant.trim() || "Regular";
    const minQty = parseFloat(infoBundleMin) || 0;
    const price = parseFloat(infoBundlePrice) || 0;
    if (!(minQty > 0)) return Alert.alert("Kantite pa valab", "Bay kantite minimòm nan (ex. 6 pou Corona, 3 pou Prestige)");
    if (!(price > 0)) return Alert.alert("Pri pa valab", "Bay pri bundle la (ex. 500 HTG)");
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      const existing = ((await db.getAllAsync("SELECT * FROM product_bundles WHERE unit_id = ?", [unitId]).catch(() => [])) ?? []) as any[];
      const row = existing.find((r: any) => String(r.variant).toLowerCase() === variant.toLowerCase() && Number(r.min_quantity) === minQty);
      if (row) await db.runAsync("UPDATE product_bundles SET bundle_price = ? WHERE id = ?", [price, row.id]);
      else await db.runAsync("INSERT INTO product_bundles (id, unit_id, variant, min_quantity, bundle_price, created_at) VALUES (?,?,?,?,?,?)",
        [`bundle-${unitId}-${Date.now().toString().slice(-6)}`, unitId, variant, minQty, price, now]);
      setInfoBundleVariant(""); setInfoBundleMin(""); setInfoBundlePrice(""); setShowAddInfoBundle(false);
      await reloadInfoPricing(infoUnits.find(x => x.id === unitId)?.product_id ?? infoProduct?.id ?? "");
      await refreshPricingMaps();
    } catch (e: any) { Alert.alert("Erè", e?.message ?? "Ajoute bundle echwe"); }
  }
  function deleteInfoBundle(r: ProductBundle) {
    Alert.alert("Efase bundle?", `${r.variant} · min ${r.min_quantity} pou ${fmt(Number(r.bundle_price))} HTG`, [
      { text: "Anile", style: "cancel" },
      {
        text: "Efase", style: "destructive", onPress: () => { (async () => {
          try {
            const db = await getDb();
            await db.runAsync("DELETE FROM product_bundles WHERE id = ?", [r.id]);
            await reloadInfoPricing(infoUnits.find(x => x.id === r.unit_id)?.product_id ?? infoProduct?.id ?? "");
            await refreshPricingMaps();
          } catch (e: any) { Alert.alert("Erè", e?.message ?? "Efase bundle echwe"); }
        })(); },
      },
    ]);
  }
  const [categoryError, setCategoryError] = useState("");
  const [newProd, setNewProd] = useState({ name: "", sku: "", categoryIds: [] as string[], low_stock_threshold: "5" });
  // Multi-variant catalog: units defined first, then price/bundle rows pick a unit
  const [newProdUnits, setNewProdUnits] = useState<NewUnitRow[]>([
    { key: "u0", name: "Unit", factor: "1" },
  ]);
  const [newProdPrices, setNewProdPrices] = useState<NewPriceRow[]>([
    { key: "p0", unitKey: "", variant: "", price: "" },
  ]);
  const [newProdBundles, setNewProdBundles] = useState<NewBundleRow[]>([]);
  function resetNewProdForm() {
    setNewProd({ name: "", sku: "", categoryIds: [], low_stock_threshold: "5" });
    setNewProdUnits([{ key: nid("u"), name: "Unit", factor: "1" }]);
    setNewProdPrices([{ key: nid("p"), unitKey: "", variant: "", price: "" }]);
    setNewProdBundles([]);
  }
  const patchUnit = (key: string, patch: Partial<NewUnitRow>) =>
    setNewProdUnits(prev => prev.map(u => u.key === key ? { ...u, ...patch } : u));
  const addUnitRow = () =>
    setNewProdUnits(prev => [...prev, { key: nid("u"), name: "", factor: "" }]);
  const removeUnitRow = (key: string) =>
    setNewProdUnits(prev => (prev.length <= 1 ? prev : prev.filter(u => u.key !== key)));
  const addPriceRow = () =>
    setNewProdPrices(prev => [...prev, { key: nid("p"), unitKey: "", variant: "", price: "" }]);
  const patchPriceRow = (pk: string, patch: Partial<NewPriceRow>) =>
    setNewProdPrices(prev => prev.map(r => r.key === pk ? { ...r, ...patch } : r));
  const removePriceRow = (pk: string) =>
    setNewProdPrices(prev => prev.filter(r => r.key !== pk));
  const addBundleRow = () =>
    setNewProdBundles(prev => [...prev, { key: nid("b"), unitKey: "", variant: "", minQty: "", price: "" }]);
  const patchBundleRow = (bk: string, patch: Partial<NewBundleRow>) =>
    setNewProdBundles(prev => prev.map(r => r.key === bk ? { ...r, ...patch } : r));
  const removeBundleRow = (bk: string) =>
    setNewProdBundles(prev => prev.filter(r => r.key !== bk));
  const [editQty, setEditQty] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [reduceQty, setReduceQty] = useState("");
  const [reduceReason, setReduceReason] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // catalog edit
  const [editCatalog, setEditCatalog] = useState<{ name: string; sku: string; categoryIds: string[]; selling_price: string; low: string; unit: string } | null>(null);
  // Multi-variant pricing maps (units / Cold-Hot prices / bundles)
  const [pricing, setPricing] = useState<PricingMaps>({ units: [], prices: [], bundles: [] });

  const canAdd = role === "owner" || role === "admin" || role === "manager";
  const canAddMore = role === "owner" || role === "admin" || role === "manager";
  const canReduce = role === "owner" || role === "admin";
  const canDelete = role === "owner";
  const canEdit = canAddMore || canReduce || canDelete;

  async function load() {
    try {
    const db = await getDb();
    const rows = (await db.getAllAsync("SELECT * FROM products WHERE is_deleted=0 OR is_deleted IS NULL")) as Product[];
    setProducts(rows);
    try {
      const pm = await ensurePricingForProducts(db, rows);
      setPricing(pm);
    } catch (e) { console.log("[Stock pricing] failed:", e); }
    try {
      const catRows = (await db.getAllAsync("SELECT * FROM categories")) as any[];
      if (catRows.length === 0) {
        for (const c of DEFAULT_CATEGORIES.filter(x => x.id !== "all")) {
          await db.runAsync("INSERT OR REPLACE INTO categories (id, store_id, name, icon, color, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [c.id, "demo-store-id", c.name, c.icon, c.color, DEFAULT_CATEGORIES.findIndex(x => x.id === c.id), new Date().toISOString(), new Date().toISOString()]);
        }
        setCategories(DEFAULT_CATEGORIES);
      } else {
        const dbCats: Category[] = catRows.filter((r: any) => !r.is_deleted).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((r: any) => ({ id: r.id, name: r.name, icon: r.icon ?? "◈", color: r.color ?? "#0f172a" }));
        setCategories([{ id: "all", name: "Tout", icon: "⊞", color: palette.ink2 } as Category, ...dbCats]);
      }
      // product_categories
      try { const pc = (await db.getAllAsync("SELECT * FROM product_categories")) as any[]; setProductCategories(pc); } catch { setProductCategories([]); }
      // batches & movements
      try { const b = (await db.getAllAsync("SELECT * FROM stock_batches ORDER BY created_at DESC")) as any[]; setBatches(b); } catch { setBatches([]); }
      try { const m = (await db.getAllAsync("SELECT * FROM stock_movements ORDER BY created_at DESC")) as any[]; setMovements(m); } catch { setMovements([]); }
    } catch {}
    } catch (e) { console.log("[Stock load] failed:", e); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (inventoryVersion) load(); }, [inventoryVersion]);
  useEffect(() => {
    if (selected) {
      const cats = getProductCats(selected.id);
      setEditCatalog({ name: selected.name, sku: selected.sku ?? "", categoryIds: cats.length ? cats : (selected.category_id ? [selected.category_id] : ["food"]), selling_price: String(displayPriceOf(selected)), low: String(selected.low_stock_threshold), unit: defaultUnitOf(selected.id)?.unit_name ?? selected.unit ?? "pcs" });
    }
  }, [selected?.id]);

  function getProductCats(productId: string): string[] {
    const linked = productCategories.filter(pc => pc.product_id === productId).map(pc => pc.category_id);
    if (linked.length) return linked;
    const prod = products.find(p => p.id === productId);
    if (prod?.category_id) return [prod.category_id];
    if (prod) return [getCategoryForProduct(prod)];
    return [];
  }
  function getProductCategoriesDisplay(productId: string): Category[] {
    const ids = getProductCats(productId);
    return ids.map(id => categories.find(c => c.id === id)).filter(Boolean) as Category[];
  }

  // ---- multi-variant pricing ----
  function defaultUnitOf(productId: string) {
    return getDefaultUnit(getUnitsForProduct(pricing, productId));
  }
  function displayPriceOf(p: Product): number {
    const d = getDisplayPrice(pricing, p.id);
    if (d && d.price > 0) return d.price;
    return Number(p.selling_price ?? 0) || 0;
  }
  async function defaultUnitRow(db: any, productId: string, fallbackName = "Unit") {
    const now = new Date().toISOString();
    const units = ((await db.getAllAsync("SELECT * FROM product_units WHERE product_id = ?", [productId]).catch(() => [])) ?? []) as any[];
    let u = units.find((x: any) => Number(x.conversion_factor) === 1) ?? units[0];
    if (!u) {
      const nuid = `unit-${productId}-base`;
      await db.runAsync("INSERT OR REPLACE INTO product_units (id, product_id, unit_name, conversion_factor, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        [nuid, productId, fallbackName, 1, now, now]);
      u = { id: nuid };
    }
    return u;
  }
  async function upsertDefaultPrice(db: any, productId: string, price: number) {
    const now = new Date().toISOString();
    const u = await defaultUnitRow(db, productId);
    const rows = ((await db.getAllAsync("SELECT * FROM product_prices WHERE unit_id = ?", [u.id]).catch(() => [])) ?? []) as any[];
    const row = rows.find((r: any) => r.variant === "Regular") ?? rows[0];
    if (row) await db.runAsync("UPDATE product_prices SET price = ?, updated_at = ? WHERE id = ?", [price, now, row.id]);
    else await db.runAsync("INSERT INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
      [`price-${productId}-regular`, u.id, "Regular", price, now]);
    try { setPricing(await loadPricing(db)); } catch {}
  }
  async function renameDefaultUnit(db: any, productId: string, name: string) {
    const u = await defaultUnitRow(db, productId, name);
    await db.runAsync("UPDATE product_units SET unit_name = ?, updated_at = ? WHERE id = ?", [name, new Date().toISOString(), u.id]);
    try { setPricing(await loadPricing(db)); } catch {}
  }

  const filtered = useMemo(() => products.filter(p => {
    const matchQ = !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku ?? "").toLowerCase().includes(q.toLowerCase()) || (p.barcode ?? "").toLowerCase().includes(q.toLowerCase());
    const prodCats = getProductCats(p.id);
    const matchCat = cat === "all" || prodCats.includes(cat);
    const matchLow = !showLowOnly || p.stock_quantity <= p.low_stock_threshold;
    const matchBarcode = !barcode || (p.barcode ?? p.sku ?? "").toLowerCase() === barcode.toLowerCase();
    return matchQ && matchCat && matchLow && (!barcode || matchBarcode);
  }), [products, q, cat, showLowOnly, barcode, productCategories, categories]);

  const lowCount = products.filter(p => p.stock_quantity <= p.low_stock_threshold).length;
  const totalValue = products.reduce((s, p) => s + p.stock_quantity * displayPriceOf(p), 0);
  const totalCostValue = products.reduce((s, p) => s + p.stock_quantity * p.cost_price, 0);
  const avgTransportShare = useMemo(() => {
    const withTransport = movements.filter(m => m.allocated_transport > 0);
    if (!withTransport.length) return 0;
    const totalAlloc = withTransport.reduce((s, m) => s + m.allocated_transport, 0);
    const totalCost = withTransport.reduce((s, m) => s + m.total_cost, 0);
    return totalCost ? (totalAlloc / totalCost) * 100 : 0;
  }, [movements]);

  const pendingBatches = useMemo(() => batches.filter(b => (b.status ?? "pending") === "pending"), [batches]);
  const pendingLineCount = useMemo(() => {
    const ids = new Set(pendingBatches.map(b => b.id));
    return movements.filter(m => ids.has(m.batch_id ?? "")).length;
  }, [pendingBatches, movements]);
  const pendingTotalCost = pendingBatches.reduce((s, b) => s + (b.total_cost || 0), 0);
  const deliveredBatches = useMemo(() => batches.filter(b =>
    (b.status ?? "pending") === "delivered" &&
    !((b.reference ?? "").startsWith("AJOUT-") || (b.reference ?? "").startsWith("RETIRE-"))
  ), [batches]);


  async function handleAddStock() {
    if (!selected) return;
    try {
    const add = parseInt(editQty, 10);
    const price = parseFloat(editPrice);
    const reduce = parseInt(reduceQty, 10);
    const db = await getDb();
    if (role === "manager" && (reduceQty.trim() || showDeleteConfirm)) {
      return Alert.alert("Pa gen dwa", "Manadjè ka sèlman ajoute stòk, pa diminye oswa efase. Kontakte Admin/Owner.");
    }
    if (role === "admin" && showDeleteConfirm) {
      return Alert.alert("Pa gen dwa", "Admin pa ka efase pwodwi. Sèlman Owner ka efase. Ou ka diminye ak rezon.");
    }
    let hasChange = false;
    let msgParts: string[] = [];
    // price edit -> default variant price (multi-variant model)
    if (editPrice.trim() && !isNaN(price)) {
      if (!canAddMore) return Alert.alert("Pa gen dwa", "Ou pa gen dwa modifye pri");
      await upsertDefaultPrice(db, selected.id, price);
      hasChange = true;
      msgParts.push(`nouvo pri ${price} HTG`);
    }
    // add stock via inventory movement (batch for traceability)
    if (editQty.trim()) {
      if (isNaN(add) || add <= 0) return Alert.alert("Kantite pa valab");
      const batchId = `batch-${Date.now()}`;
      const now = new Date().toISOString();
      // simple single-line batch, no transport
      await db.runAsync("INSERT INTO stock_batches (id, store_id, reference, supplier, transport_cost, notes, total_items_cost, total_cost, received_at, created_by, created_at, updated_at, status, delivered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [batchId, "demo-store-id", `AJOUT-${selected.sku ?? selected.id.slice(0, 4)}`, "Ajout rapid", 0, "Ajout via Modifye", add * (selected.cost_price || 0), add * (selected.cost_price || 0), now, currentUser?.id ?? "system", now, now, "delivered", now]);
      await db.runAsync("INSERT INTO stock_movements (id, batch_id, store_id, product_id, type, quantity, initial_qty, remaining_qty, unit_cost, total_cost, allocated_transport, reason, created_by, created_at, status, delivered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [`mov-${Date.now()}`, batchId, "demo-store-id", selected.id, "in", add, add, add, selected.cost_price || 0, add * (selected.cost_price || 0), 0, "Ajout rapid", currentUser?.id ?? "system", now, "delivered", now]);
      await db.runAsync("UPDATE products SET stock_quantity = stock_quantity + ?, current_amount_available = current_amount_available + ? WHERE id = ?", [add, add, selected.id]);
      hasChange = true;
      msgParts.push(`+${add} ajoute (ak istwa)`);
    }
    if (reduceQty.trim()) {
      if (!canReduce) return Alert.alert("Pa gen dwa", "Ou pa gen dwa diminye stòk");
      if (isNaN(reduce) || reduce <= 0) return Alert.alert("Kantite pa valab");
      if (!reduceReason.trim()) return Alert.alert("Rezon obligatwa", "Lè ou diminye stòk (erè), ou dwe bay rezon");
      if (reduce > selected.stock_quantity) return Alert.alert("Stòk ensifizan", `Pa ka retire ${reduce}, rete sèlman ${selected.stock_quantity}`);
      const batchId = `batch-${Date.now()}`;
      const now = new Date().toISOString();
      await db.runAsync("INSERT INTO stock_batches (id, store_id, reference, supplier, transport_cost, notes, total_items_cost, total_cost, received_at, created_by, created_at, updated_at, status, delivered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [batchId, "demo-store-id", `RETIRE-${selected.sku ?? selected.id.slice(0, 4)}`, "Koreksyon", 0, reduceReason.trim(), 0, 0, now, currentUser?.id ?? "system", now, now, "delivered", now]);
      await db.runAsync("INSERT INTO stock_movements (id, batch_id, store_id, product_id, type, quantity, initial_qty, remaining_qty, unit_cost, total_cost, allocated_transport, reason, created_by, created_at, status, delivered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [`mov-${Date.now()}`, batchId, "demo-store-id", selected.id, "out", reduce, 0, 0, selected.cost_price || 0, reduce * (selected.cost_price || 0), 0, reduceReason.trim(), currentUser?.id ?? "system", now, "delivered", now]);
      await db.runAsync("UPDATE products SET stock_quantity = stock_quantity - ?, current_amount_available = current_amount_available - ? WHERE id = ?", [reduce, reduce, selected.id]);
      hasChange = true;
      msgParts.push(`-${reduce} retire (Rezon: ${reduceReason})`);
    }
    if (showDeleteConfirm) {
      if (!canDelete) return Alert.alert("Pa gen dwa", "Sèlman Owner ka efase pwodwi. Admin ka sèlman diminye ak rezon.");
      await db.runAsync("DELETE FROM products WHERE id = ?", [selected.id]);
      await db.runAsync("DELETE FROM product_categories WHERE product_id = ?", [selected.id]);
      Alert.alert("Pwodwi efase", `${selected.name} efase pa Owner`);
      setShowDeleteConfirm(false);
      setSelected(null);
      setEditQty(""); setEditPrice(""); setReduceQty(""); setReduceReason("");
      load();
      return;
    }
    if (!hasChange) {
      Alert.alert("Pa gen chanjman");
      return;
    }
    Alert.alert("Stòk mete ajou", `${selected.name} • ${msgParts.join(" • ")}`);
    setEditQty(""); setEditPrice(""); setReduceQty(""); setReduceReason(""); setShowDeleteConfirm(false);
    setSelected(null);
    load();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete stòk ajou echwe");
    }
  }

  async function handleDeliver(batch: StockBatch, extraFeeInput: string) {
    const db = await getDb();
    const batchMovs = movements.filter(m => m.batch_id === batch.id && m.type === "in");
    if (!batchMovs.length) return;
    const now = new Date().toISOString();
    const extra = Math.max(0, parseFloat(extraFeeInput) || 0);
    setDelivering(true);
    try {
      if (extra > 0) {
        // Re-allocate the extra cost proportionally across the batch lines (by items cost)
        const totalItems = batchMovs.reduce((s, m) => s + ((m.total_cost || 0) - (m.allocated_transport || 0)), 0);
        for (const m of batchMovs) {
          const lineItems = (m.total_cost || 0) - (m.allocated_transport || 0);
          const add = totalItems > 0 ? extra * (lineItems / totalItems) : extra / batchMovs.length;
          const newAlloc = (m.allocated_transport || 0) + add;
          await db.runAsync("UPDATE stock_movements SET allocated_transport = ?, total_cost = ? WHERE id = ?", [Math.round(newAlloc * 100) / 100, Math.round((lineItems + newAlloc) * 100) / 100, m.id]);
        }
        await db.runAsync("UPDATE stock_batches SET transport_cost = ?, total_cost = ?, status = ?, delivered_at = ? WHERE id = ?", [(batch.transport_cost || 0) + extra, (batch.total_cost || 0) + extra, "delivered", now, batch.id]);
      } else {
        await db.runAsync("UPDATE stock_batches SET status = ?, delivered_at = ? WHERE id = ?", ["delivered", now, batch.id]);
      }
      for (const m of batchMovs) {
        await db.runAsync("UPDATE stock_movements SET status = ?, delivered_at = ? WHERE id = ?", ["delivered", now, m.id]);
        const qty = Number(m.quantity || 0);
        if (qty <= 0) continue;
        try {
          const cur = (await db.getAllAsync("SELECT * FROM products WHERE id = ?", [m.product_id])) as any[];
          if (cur[0]) {
            const prevQty = Number(cur[0].stock_quantity ?? 0);
            const prevCost = Number(cur[0].cost_price ?? 0);
            const newQty = prevQty + qty;
            const newAvg = newQty > 0 ? (prevQty * prevCost + (m.total_cost || 0)) / newQty : 0;
            await db.runAsync("UPDATE products SET stock_quantity = stock_quantity + ?, current_amount_available = current_amount_available + ?, cost_price = ? WHERE id = ?", [qty, qty, Math.round(newAvg * 100) / 100, m.product_id]);
          }
        } catch {}
      }
      Alert.alert("Livrezon rive ✓", `${batch.reference} • ${batchMovs.length} atik ajoute nan stòk${extra > 0 ? ` • +${fmt(extra)} HTG frè anplis` : ""}`, [
        { text: "OK", onPress: () => { setDeliverBatch(null); setDeliverFee(""); } }
      ]);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Imposib delivre livrezon an");
    }
    setDelivering(false);
    load();
  }

  async function handleCatalogSave() {
    if (!selected || !editCatalog) return;
    if (!editCatalog.name.trim()) return Alert.alert("Non obligatwa");
    if (!editCatalog.categoryIds.length) return Alert.alert("Chwazi omwen yon kategori");
    if (editCatalog.categoryIds.includes("all")) return Alert.alert("Kategori pa valab");
    // Enforce global uniqueness (catalog is shared across all locations)
    try {
    const skuNorm = (editCatalog.sku.trim() || selected.sku || "").toLowerCase();
    if (skuNorm && products.some(p => p.id !== selected.id && ((p.sku?.trim().toLowerCase() === skuNorm) || (p.barcode?.trim().toLowerCase() === skuNorm)))) {
      return Alert.alert("SKU deja egziste", `SKU "${editCatalog.sku.trim() || selected.sku}" deja itilize pa yon lòt pwodwi — dwe inik`);
    }
    const nameNorm = editCatalog.name.trim().toLowerCase();
    if (products.some(p => p.id !== selected.id && p.name.trim().toLowerCase() === nameNorm)) {
      return Alert.alert("Non deja egziste", `"${editCatalog.name.trim()}" deja nan katalòg`);
    }
    const price = parseFloat(editCatalog.selling_price) || 0;
    const low = parseInt(editCatalog.low, 10) || 5;
    const db = await getDb();
    await db.runAsync("UPDATE products SET name = ?, sku = ?, low_stock_threshold = ?, category_id = ? WHERE id = ?", [editCatalog.name.trim(), editCatalog.sku.trim() || selected.sku, low, editCatalog.categoryIds[0] ?? null, selected.id]);
    await upsertDefaultPrice(db, selected.id, price);
    if (editCatalog.unit.trim()) await renameDefaultUnit(db, selected.id, editCatalog.unit.trim());
    await db.runAsync("DELETE FROM product_categories WHERE product_id = ?", [selected.id]);
    for (const cid of editCatalog.categoryIds) {
      await db.runAsync("INSERT INTO product_categories (product_id, category_id) VALUES (?,?)", [selected.id, cid]);
    }
    Alert.alert("Katalòg mete ajou", `${editCatalog.name} • ${editCatalog.categoryIds.length} kategori`);
    setSelected(null);
    load();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Mete katalòg ajou echwe");
    }
  }

  async function handleChangeName() {
    if (!infoProduct) return;
    const name = nameInput.trim();
    if (!name) return Alert.alert("Non obligatwa", "Non pwodwi pa ka vid");
    if (name === infoProduct.name) return Alert.alert("Pa gen chanjman");
    const nameNorm = name.toLowerCase();
    if (products.some(p => p.id !== infoProduct.id && p.name.trim().toLowerCase() === nameNorm)) {
      return Alert.alert("Non deja egziste", `"${name}" deja nan katalòg — chak pwodwi dwe inik`);
    }
    try {
    const db = await getDb();
    await db.runAsync("UPDATE products SET name = ? WHERE id = ?", [name, infoProduct.id]);
    Alert.alert("Non chanje ✓", `${infoProduct.name} → ${name}`);
    setShowNameEdit(false);
    load();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Chanje non echwe");
    }
  }

  async function handleChangeUnit() {
    if (!infoProduct) return;
    const unit = unitInput.trim();
    if (!unit) return Alert.alert("Inite obligatwa", "Antre yon inite");
    const curUnit = defaultUnitOf(infoProduct.id)?.unit_name ?? infoProduct.unit ?? "pcs";
    if (unit.toLowerCase() === curUnit.toLowerCase()) return Alert.alert("Pa gen chanjman");
    try {
    const db = await getDb();
    await renameDefaultUnit(db, infoProduct.id, unit);
    Alert.alert("Inite chanje ✓", `${infoProduct.name} • ${unit}`);
    setShowUnitEdit(false);
    load();
    reloadInfoPricing(infoProduct.id);
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Chanje inite echwe");
    }
  }

  async function handleCreateProduct() {
    if (!newProd.name.trim()) return Alert.alert("Non obligatwa", "Non pwodwi obligatwa pou katalòg");
    if (!newProd.categoryIds.length) return Alert.alert("Kategori obligatwa", "Chwazi omwen yon kategori — pwodwi dwe konekte ak kategori");
    // 1 — units first (first named row = base unit, factor 1)
    const named = newProdUnits.filter(u => u.name.trim());
    if (!named.length) return Alert.alert("Inite obligatwa", "Bay omwen yon inite vant (ex. Boutèy)");
    const cleanUnits = named.map((u, j) => ({ key: u.key, name: u.name.trim(), factor: j === 0 ? 1 : parseFloat(u.factor) || 0 }));
    for (const u of cleanUnits.slice(1)) {
      if (!(u.factor > 0)) return Alert.alert("Faktè pa valab", `Faktè konvèsyon pou "${u.name}" dwe > 0 (ex. Bwat-6 ×6, Kès ×24)`);
    }
    // 2 — prices: empty rows skipped, half-filled rows block loudly (never silent)
    const cleanPrices: { unitIdx: number; variant: string; price: number }[] = [];
    const seenPrice = new Set<string>();
    for (const r of newProdPrices) {
      if (!r.variant.trim() && !r.price.trim() && !r.unitKey) continue; // untouched row
      const ui = cleanUnits.findIndex(u => u.key === r.unitKey);
      if (ui < 0) return Alert.alert("Chwazi inite", `Pri "${r.variant.trim() || "?"}${r.price.trim() ? ` (${r.price} HTG)` : ""}" pa gen inite — louvri dropdown lan epi chwazi inite a.`);
      const variant = r.variant.trim() || "Regular";
      const price = parseFloat(r.price) || 0;
      if (!(price > 0)) return Alert.alert("Pri pa valab", `Mete pri a pou ${variant} sou ${cleanUnits[ui].name} (ex. 1150).`);
      const dk = `${ui}|${variant.toLowerCase()}`;
      if (seenPrice.has(dk)) return Alert.alert("Pri double", `${variant} sou ${cleanUnits[ui].name} parèt 2 fwa — efase youn.`);
      seenPrice.add(dk);
      cleanPrices.push({ unitIdx: ui, variant, price });
    }
    // 3 — bundles: same strictness (ex. 6 Bwat-6 Cold pou 900)
    const cleanBundles: { unitIdx: number; variant: string; minQty: number; price: number }[] = [];
    const seenBundle = new Set<string>();
    for (const r of newProdBundles) {
      if (!r.variant.trim() && !r.minQty.trim() && !r.price.trim() && !r.unitKey) continue;
      const ui = cleanUnits.findIndex(u => u.key === r.unitKey);
      if (ui < 0) return Alert.alert("Chwazi inite", "Yon bundle pa gen inite — louvri dropdown lan epi chwazi inite a.");
      const variant = r.variant.trim() || "Regular";
      const minQty = parseFloat(r.minQty) || 0;
      const price = parseFloat(r.price) || 0;
      if (!(minQty > 0)) return Alert.alert("Kantite pa valab", `Bay kantite minimòm bundle lan sou ${cleanUnits[ui].name} (ex. 6).`);
      if (!(price > 0)) return Alert.alert("Pri pa valab", `Bay pri bundle lan sou ${cleanUnits[ui].name} (ex. 900 HTG).`);
      const dk = `${ui}|${variant.toLowerCase()}|${minQty}`;
      if (seenBundle.has(dk)) return Alert.alert("Bundle double", `Bundle sa a parèt 2 fwa sou ${cleanUnits[ui].name} — efase youn.`);
      seenBundle.add(dk);
      cleanBundles.push({ unitIdx: ui, variant, minQty, price });
    }
    const low = parseInt(newProd.low_stock_threshold, 10) || 5;
    const id = `prod-${Date.now()}`;
    const sku = newProd.sku.trim() || id.toUpperCase();
    // Catalog is global (available for all locations immediately) — enforce unique SKU/name across all locations
    const skuNorm = sku.trim().toLowerCase();
    if (products.some(p => (p.sku?.trim().toLowerCase() === skuNorm) || (p.barcode?.trim().toLowerCase() === skuNorm))) {
      return Alert.alert("SKU deja egziste", `SKU "${sku}" deja nan katalòg — chak pwodwi dwe inik (global)`);
    }
    const nameNorm = newProd.name.trim().toLowerCase();
    if (products.some(p => p.name.trim().toLowerCase() === nameNorm)) {
      return Alert.alert("Non deja egziste", `"${newProd.name.trim()}" deja nan katalòg — chak pwodwi dwe inik`);
    }
    try {
    const db = await getDb();
    // Catalog only: stock 0, cost 0 — stock & price will come via Inventory / edition
    const now = new Date().toISOString();
    await db.runAsync("INSERT INTO products (id, store_id, sku, name, category_id, cost_price, stock_quantity, current_amount_available, low_stock_threshold, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [id, "demo-store-id", sku, newProd.name.trim(), newProd.categoryIds[0] ?? null, 0, 0, 0, low, now]);
    const unitIds: string[] = [];
    for (let i = 0; i < cleanUnits.length; i++) {
      const u = cleanUnits[i];
      const slug = u.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `u${i}`;
      const uid = i === 0 ? `unit-${id}-base` : `unit-${id}-${slug}`;
      unitIds.push(uid);
      await db.runAsync("INSERT OR REPLACE INTO product_units (id, product_id, unit_name, conversion_factor, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        [uid, id, u.name, u.factor, now, now]);
    }
    const baseUid = unitIds[0];
    let totalPrices = 0;
    if (!cleanPrices.length) {
      // Catalog-only default (old behavior): Regular price 0, set later via edition/Inventory
      await db.runAsync("INSERT OR REPLACE INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
        [`price-${id}-regular`, baseUid, "Regular", 0, now]);
    }
    let pi = 0;
    for (const r of cleanPrices) {
      await db.runAsync("INSERT INTO product_prices (id, unit_id, variant, price, updated_at) VALUES (?,?,?,?,?)",
        [`price-${id}-${pi++}`, unitIds[r.unitIdx] ?? baseUid, r.variant, r.price, now]);
      totalPrices++;
    }
    let totalBundles = 0;
    let bi = 0;
    for (const r of cleanBundles) {
      await db.runAsync("INSERT INTO product_bundles (id, unit_id, variant, min_quantity, bundle_price, created_at) VALUES (?,?,?,?,?,?)",
        [`bundle-${id}-${bi++}`, unitIds[r.unitIdx] ?? baseUid, r.variant, r.minQty, r.price, now]);
      totalBundles++;
    }
    for (const cid of newProd.categoryIds) {
      await db.runAsync("INSERT INTO product_categories (product_id, category_id) VALUES (?,?)", [id, cid]);
    }
    setProducts([...products, { id, name: newProd.name.trim(), sku, barcode: sku, category_id: newProd.categoryIds[0] ?? undefined, stock_quantity: 0, low_stock_threshold: low, cost_price: 0 } as Product]);
    setProductCategories(prev => [...prev, ...newProd.categoryIds.map(cid => ({ product_id: id, category_id: cid }))]);
    const createdSummary = `${cleanUnits.length} inite · ${totalPrices} pri · ${totalBundles} bundle`;
    resetNewProdForm();
    setShowAdd(false);
    Alert.alert("Katalòg kreye ✓", `${newProd.name.trim()} • ${newProd.categoryIds.length} kategori • ${createdSummary} • 0 pcs (ajoute via Inventaire)`);
    load();
    } catch (e: any) {
      Alert.alert("Erè", e?.message ?? "Kreye pwodwi echwe");
    }
  }

  const handleCreateCategory = async () => {
    const label = newCategory.name.trim();
    if (!label) { setCategoryError("Non kategori obligatwa."); return; }
    if (label.length < 2) { setCategoryError("Mete omwen 2 lèt."); return; }
    const id = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    if (!id || id === "all") { setCategoryError("Non pa valab."); return; }
    if (categories.some(c => c.id === id)) { setCategoryError("Kategori sa egziste deja."); return; }
    if (categories.some(c => c.name.toLowerCase() === label.toLowerCase())) { setCategoryError("Kategori sa egziste deja."); return; }
    const next: Category = { id, name: label, icon: (newCategory.icon.trim() || "◈").slice(0, 2), color: "#0f172a" };
    try {
      const db = await getDb();
      await db.runAsync("INSERT OR REPLACE INTO categories (id, store_id, name, icon, color, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [next.id, "demo-store-id", next.name, next.icon, next.color, categories.length, new Date().toISOString(), new Date().toISOString()]);
    } catch {}
    setCategories(prev => [...prev, next]);
    setNewCategory({ name: "", icon: "◈" });
    setCategoryError("");
    setShowAddCategory(false);
    setCat(id);
    setNewProd(v => ({ ...v, categoryIds: [...v.categoryIds, id] }));
  };


  function toggleProdCategory(id: string) {
    setNewProd(prev => {
      const has = prev.categoryIds.includes(id);
      return { ...prev, categoryIds: has ? prev.categoryIds.filter(x => x !== id) : [...prev.categoryIds, id] };
    });
  }
  function toggleEditCategory(id: string) {
    if (!editCatalog) return;
    const has = editCatalog.categoryIds.includes(id);
    setEditCatalog({ ...editCatalog, categoryIds: has ? editCatalog.categoryIds.filter(x => x !== id) : [...editCatalog.categoryIds, id] });
  }

  const tabletDetail: Product | null = infoProduct ?? selected;

  void padH; void lowCount; void totalValue; void totalCostValue; void pendingLineCount; void pendingTotalCost;
  void getUnitsForProduct; void getPricesForUnit;

  return (
    <View style={{ flex: 1, backgroundColor: "#F8F9FA", alignItems: showTablet ? "center" : undefined }}>
      {showTablet ? (
        <StockTablet
          role={role} products={products} categories={categories} batches={batches} movements={movements}
          q={q} setQ={setQ} barcode={barcode} setBarcode={setBarcode} cat={cat} setCat={setCat}
          stockTab={stockTab} setStockTab={setStockTab} avgTransportShare={avgTransportShare}
          filtered={filtered} pendingBatches={pendingBatches} deliveredBatches={deliveredBatches}
          canEdit={canEdit} displayPriceOf={displayPriceOf} defaultUnitOf={defaultUnitOf}
          getProductCats={getProductCats} getProductCategoriesDisplay={getProductCategoriesDisplay}
          selected={selected} setSelected={setSelected} infoProduct={infoProduct} setInfoProduct={setInfoProduct}
          tabletDetail={tabletDetail} infoUnits={infoUnits} infoPrices={infoPrices}
          showNameEdit={showNameEdit} setShowNameEdit={setShowNameEdit} nameInput={nameInput} setNameInput={setNameInput}
          handleChangeName={handleChangeName} showUnitEdit={showUnitEdit} setShowUnitEdit={setShowUnitEdit}
          unitInput={unitInput} setUnitInput={setUnitInput} handleChangeUnit={handleChangeUnit}
          setShowHistory={setShowHistory} setExpandedBatch={setExpandedBatch}
          setDeliverBatch={setDeliverBatch} setDeliverFee={setDeliverFee} delivering={delivering}
        />
      ) : (
        <StockPhone
          role={role} products={products} categories={categories} batches={batches} movements={movements}
          q={q} setQ={setQ} barcode={barcode} setBarcode={setBarcode} cat={cat} setCat={setCat}
          stockTab={stockTab} setStockTab={setStockTab} avgTransportShare={avgTransportShare}
          filtered={filtered} pendingBatches={pendingBatches} deliveredBatches={deliveredBatches}
          canEdit={canEdit} canAddMore={canAddMore} canReduce={canReduce} canDelete={canDelete}
          displayPriceOf={displayPriceOf} defaultUnitOf={defaultUnitOf}
          getProductCats={getProductCats} getProductCategoriesDisplay={getProductCategoriesDisplay}
          selected={selected} setSelected={setSelected} infoProduct={infoProduct} setInfoProduct={setInfoProduct}
          setShowHistory={setShowHistory} setExpandedBatch={setExpandedBatch}
          setDeliverBatch={setDeliverBatch} setDeliverFee={setDeliverFee} delivering={delivering}
          editCatalog={editCatalog} setEditCatalog={setEditCatalog} toggleEditCategory={toggleEditCategory}
          handleCatalogSave={handleCatalogSave} handleAddStock={handleAddStock}
          editQty={editQty} setEditQty={setEditQty} editPrice={editPrice} setEditPrice={setEditPrice} reduceQty={reduceQty} setReduceQty={setReduceQty}
          reduceReason={reduceReason} setReduceReason={setReduceReason}
          showDeleteConfirm={showDeleteConfirm} setShowDeleteConfirm={setShowDeleteConfirm}
          infoUnits={infoUnits} infoPrices={infoPrices} infoBundles={infoBundles}
          saveInfoUnit={saveInfoUnit} deleteInfoUnit={deleteInfoUnit}
          newInfoUnitName={newInfoUnitName} setNewInfoUnitName={setNewInfoUnitName}
          newInfoUnitFactor={newInfoUnitFactor} setNewInfoUnitFactor={setNewInfoUnitFactor} addInfoUnit={addInfoUnit}
          deleteInfoPrice={deleteInfoPrice} showAddInfoPrice={showAddInfoPrice} setShowAddInfoPrice={setShowAddInfoPrice}
          infoPriceUnit={infoPriceUnit} setInfoPriceUnit={setInfoPriceUnit}
          infoPriceVariant={infoPriceVariant} setInfoPriceVariant={setInfoPriceVariant}
          infoPriceValue={infoPriceValue} setInfoPriceValue={setInfoPriceValue} addInfoPrice={addInfoPrice}
          showAddInfoBundle={showAddInfoBundle} setShowAddInfoBundle={setShowAddInfoBundle}
          infoBundleUnit={infoBundleUnit} setInfoBundleUnit={setInfoBundleUnit}
          infoBundleVariant={infoBundleVariant} setInfoBundleVariant={setInfoBundleVariant}
          infoBundleMin={infoBundleMin} setInfoBundleMin={setInfoBundleMin}
          infoBundlePrice={infoBundlePrice} setInfoBundlePrice={setInfoBundlePrice}
          addInfoBundle={addInfoBundle} deleteInfoBundle={deleteInfoBundle}
          showNameEdit={showNameEdit} setShowNameEdit={setShowNameEdit} nameInput={nameInput} setNameInput={setNameInput}
          handleChangeName={handleChangeName} showUnitEdit={showUnitEdit} setShowUnitEdit={setShowUnitEdit}
          unitInput={unitInput} setUnitInput={setUnitInput} handleChangeUnit={handleChangeUnit}
        />
      )}

      {/* Floating Ajoute — NOUVO KREDI style */}
      {canEdit && (
        <View style={{ position: "absolute", bottom: 20, right: fabRight }}>
          <Pressable onPress={() => setShowAddChoice(true)} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: palette.ink2, borderWidth: 1, borderColor: "#3D3D40", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, justifyContent: "center", ...shadow.elevated }}>
            <Text style={{ fontSize: 16, color: palette.accentGold, fontWeight: "600", marginTop: -1 }}>+</Text>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13, letterSpacing: 0.4 }}>AJOUTE</Text>
          </Pressable>
        </View>
      )}

      {/* Apple choice — 3 options: produit / categorie / inventaire */}
      <Modal visible={showAddChoice} transparent animationType="fade" onRequestClose={() => setShowAddChoice(false)}>
        <Pressable onPress={() => setShowAddChoice(false)} style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.34)", justifyContent: "flex-end", padding: 16, gap: 10, alignItems: isTablet ? "center" : undefined }}>
          <View style={{ ...sheetBox(isTablet, width, 560), width: "100%", backgroundColor: palette.surface, borderRadius: radius.lg, overflow: "hidden", borderWidth: 0.5, borderColor: palette.hairline, ...shadow.elevated }}>
            <View style={{ padding: 14, paddingBottom: 10, borderBottomWidth: 0.5, borderColor: palette.separatorSoft }}>
              <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 10 }} />
              <Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink, letterSpacing: -0.2 }}>Ajoute — chwazi aksyon</Text>
              <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}>Katalòg ≠ Stòk — pwodwi defini, inventaire anrejistre arivaj ak frè transpò</Text>
            </View>
            <Pressable onPress={() => { resetNewProdForm(); setShowAddChoice(false); setShowAdd(true); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: 0.5, borderColor: palette.separatorSoft }}>
              <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: palette.ink2, borderWidth: 0.5, borderColor: "rgba(200,162,74,0.5)", alignItems: "center", justifyContent: "center" }}><Ionicons name="pricetag-outline" size={20} color={palette.accentGold} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Nouvo pwodwi (Katalòg)</Text>
                <Text style={{ fontSize: 11, color: palette.muted, marginTop: 1 }}>Defini atik la — plizyè kategori, pa gen stòk isit la</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={palette.muted2} />
            </Pressable>
            <Pressable onPress={() => { setShowAddChoice(false); setShowAddCategory(true); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: 0.5, borderColor: palette.separatorSoft }}>
              <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline, alignItems: "center", justifyContent: "center" }}><Ionicons name="layers-outline" size={20} color={palette.inkSoft} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Nouvo kategori</Text>
                <Text style={{ fontSize: 11, color: palette.muted, marginTop: 1 }}>{categories.length - 1} → {categories.length} • milti-kategori kounye a</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={palette.muted2} />
            </Pressable>
            <Pressable onPress={() => { setShowAddChoice(false); onOpenInventory?.(); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
              <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGold, alignItems: "center", justifyContent: "center" }}><Ionicons name="cube-outline" size={20} color={palette.accentGold} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Nouvo Livrezon (Inventaire)</Text>
                <Text style={{ fontSize: 11, color: palette.muted, marginTop: 1 }}>Chwazi pwodwi → kantite/pri → detay pakè + transpò</Text>
              </View>
              <View style={{ backgroundColor: palette.accentGold, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 }}><Text style={{ fontSize: 10, fontWeight: "800", color: "#fff" }}>BATCH</Text></View>
            </Pressable>
          </View>
          <Pressable onPress={() => setShowAddChoice(false)} style={{ ...sheetBox(isTablet, width, 560), width: "100%", backgroundColor: palette.surface, borderRadius: radius.md, padding: 14, alignItems: "center", borderWidth: 0.5, borderColor: palette.hairline }}>
            <Text style={{ fontWeight: "600", color: palette.ink }}>Anile</Text>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showAdd} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.46)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: palette.surface2, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "92%", overflow: "hidden" }}>
              <View style={{ backgroundColor: palette.surface, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: palette.separatorSoft, alignItems: "center" }}>
                <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, marginBottom: 12 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}><Ionicons name="pricetag-outline" size={18} color={palette.accentGold} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 16, color: palette.ink }}>Nouvo pwodwi — Katalòg</Text>
                    <Text style={{ fontSize: 11, color: palette.muted }}>Global · inik · disponib pou tout magazen imedyatman</Text>
                  </View>
                </View>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ padding: 14 }} contentContainerStyle={{ gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12 }}>
                  <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink, letterSpacing: -0.1 }}>Non pwodwi *</Text>
                  <TextInput placeholder="Eg. Farin 25kg, Dlo 5gal" placeholderTextColor={palette.muted3} value={newProd.name} onChangeText={v => setNewProd({ ...newProd, name: v })} style={{ borderWidth: 1, borderColor: newProd.name ? palette.ink2 : palette.hairline, borderRadius: radius.sm, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, fontSize: 14, color: palette.ink, backgroundColor: palette.surface, fontWeight: "500" }} />
                  <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink, marginTop: 12 }}>SKU / Kòd bar <Text style={{ fontWeight: "400", color: palette.muted3 }}>(inik global)</Text></Text>
                  <TextInput placeholder="FARIN-25KG — vid = oto, dwe inik" placeholderTextColor={palette.muted3} value={newProd.sku} onChangeText={v => setNewProd({ ...newProd, sku: v })} autoCapitalize="characters" style={{ borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, fontSize: 14, color: palette.ink, backgroundColor: palette.surface }} />
                  <Text style={{ fontSize: 10, color: palette.muted3, marginTop: 4 }}>SKU/barcode dwe inik — katalòg la pataje pou tout magazen</Text>
                  <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink, marginTop: 12 }}>1 — Defini inite yo *</Text>
                  <Text style={{ fontSize: 10, color: palette.muted3, marginTop: 2 }}>Premye inite = baz (faktè 1) — stòk konte ladan l. Ex. Corona: Boutèy ×1, Bwat-6 ×6, Kès ×24.</Text>
                  {newProdUnits.map((u, idx) => (
                    <View key={u.key} style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <TextInput placeholder={idx === 0 ? "Boutèy" : "Bwat-6"} placeholderTextColor={palette.muted3} value={u.name} onChangeText={v => patchUnit(u.key, { name: v })} style={{ flex: 2, borderWidth: 1, borderColor: u.name ? palette.ink2 : palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface }} />
                      <TextInput placeholder="×1" placeholderTextColor={palette.muted3} value={idx === 0 ? "1" : u.factor} onChangeText={v => patchUnit(u.key, { factor: v.replace(/[^0-9.]/g, "") })} keyboardType="numeric" editable={idx !== 0} style={{ flex: 1, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: idx === 0 ? palette.surfaceGrouped : palette.surface, textAlign: "center" }} />
                      {idx > 0 ? (
                        <Pressable onPress={() => removeUnitRow(u.key)} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: palette.dangerBg, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.dangerBd }}><Ionicons name="trash-outline" size={15} color={palette.danger} /></Pressable>
                      ) : (
                        <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: palette.accentGold }}><Text style={{ fontSize: 9, fontWeight: "800", color: palette.accentGold }}>BAZ</Text></View>
                      )}
                    </View>
                  ))}
                  <Pressable onPress={addUnitRow} style={{ marginTop: 8, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: palette.hairline, borderStyle: "dashed", alignItems: "center" }}><Text style={{ fontWeight: "700", fontSize: 12, color: palette.inkSoft }}>+ Ajoute inite (Kès ×24...)</Text></Pressable>
                </View>

                <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12 }}>
                  <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>2 — Pri pa variant</Text>
                  <Text style={{ fontSize: 10, color: palette.muted3, marginTop: 2 }}>Chwazi inite a, ekri variant lan (Cold / Hot / Regular), mete pri a. Ex. Bwat-6 · Regular · 1150.</Text>
                  {newProdPrices.map(row => {
                    const un = newProdUnits.find(x => x.key === row.unitKey)?.name.trim();
                    return (
                      <View key={row.key} style={{ marginTop: 10, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 10, borderWidth: 0.5, borderColor: palette.hairline }}>
                        <UnitDropdown units={newProdUnits} value={row.unitKey} onPick={k => patchPriceRow(row.key, { unitKey: k })} />
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
                          <TextInput placeholder="Cold" placeholderTextColor={palette.muted3} value={row.variant} onChangeText={v => patchPriceRow(row.key, { variant: v })} style={{ flex: 1, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface }} />
                          <TextInput placeholder="Pri HTG" placeholderTextColor={palette.muted3} value={row.price} onChangeText={v => patchPriceRow(row.key, { price: v.replace(/[^0-9.]/g, "") })} keyboardType="numeric" style={{ flex: 1, borderWidth: 1, borderColor: row.price ? palette.ink2 : palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface, textAlign: "center" }} />
                          <Pressable onPress={() => removePriceRow(row.key)} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.dangerBd }}><Ionicons name="trash-outline" size={14} color={palette.danger} /></Pressable>
                        </View>
                        {(row.variant.trim() || row.price.trim()) && un ? (
                          <Text style={{ fontSize: 11, color: palette.inkSoft, fontWeight: "600", marginTop: 6 }}>{un} · {row.variant.trim() || "…"} — {row.price.trim() ? `${row.price} HTG` : "…"}</Text>
                        ) : null}
                      </View>
                    );
                  })}
                  <Pressable onPress={addPriceRow} style={{ marginTop: 8, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: palette.hairline, borderStyle: "dashed", alignItems: "center" }}><Text style={{ fontWeight: "700", fontSize: 12, color: palette.inkSoft }}>+ Ajoute pri</Text></Pressable>
                </View>

                <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12 }}>
                  <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>3 — Bundle <Text style={{ fontWeight: "400", color: palette.muted3 }}>(opsyonèl)</Text></Text>
                  <Text style={{ fontSize: 10, color: palette.muted3, marginTop: 2 }}>Chwazi inite a, variant lan, kantite minimòm ak pri bundle lan.</Text>
                  {newProdBundles.map(row => {
                    const un = newProdUnits.find(x => x.key === row.unitKey)?.name.trim();
                    return (
                      <View key={row.key} style={{ marginTop: 10, backgroundColor: palette.accentGoldSoft, borderRadius: radius.sm, padding: 10, borderWidth: 0.5, borderColor: palette.accentGold }}>
                        <UnitDropdown units={newProdUnits} value={row.unitKey} onPick={k => patchBundleRow(row.key, { unitKey: k })} />
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
                          <TextInput placeholder="Cold" placeholderTextColor={palette.muted3} value={row.variant} onChangeText={v => patchBundleRow(row.key, { variant: v })} style={{ flex: 1, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface }} />
                          <TextInput placeholder="Min" placeholderTextColor={palette.muted3} value={row.minQty} onChangeText={v => patchBundleRow(row.key, { minQty: v.replace(/[^0-9.]/g, "") })} keyboardType="numeric" style={{ flex: 1, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface, textAlign: "center" }} />
                          <TextInput placeholder="Pri" placeholderTextColor={palette.muted3} value={row.price} onChangeText={v => patchBundleRow(row.key, { price: v.replace(/[^0-9.]/g, "") })} keyboardType="numeric" style={{ flex: 1, borderWidth: 1, borderColor: row.price ? palette.ink2 : palette.hairline, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface, textAlign: "center" }} />
                          <Pressable onPress={() => removeBundleRow(row.key)} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: palette.dangerBd }}><Ionicons name="trash-outline" size={14} color={palette.danger} /></Pressable>
                        </View>
                        {(row.minQty.trim() || row.price.trim()) && un ? (
                          <Text style={{ fontSize: 11, color: palette.accentGold, fontWeight: "700", marginTop: 6 }}>{row.minQty || "…"} {un} {row.variant.trim() || ""} pou {row.price || "…"} HTG</Text>
                        ) : null}
                      </View>
                    );
                  })}
                  <Pressable onPress={addBundleRow} style={{ marginTop: 8, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: palette.hairline, borderStyle: "dashed", alignItems: "center" }}><Text style={{ fontWeight: "700", fontSize: 12, color: palette.inkSoft }}>+ Ajoute bundle</Text></Pressable>
                </View>

                <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: newProd.categoryIds.length ? palette.ink2 : palette.hairline, padding: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>Kategori * — milti ({newProd.categoryIds.length})</Text>
                    <Text style={{ fontSize: 11, color: palette.muted3 }}>{newProd.categoryIds.length === 0 ? "Chwazi omwen 1" : "✓ OK"}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: palette.muted3, marginTop: 2 }}>Yon pwodwi ka nan plizyè kategori — klike pou ajoute/retire</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                    {categories.filter(c => c.id !== "all").map(c => {
                      const active = newProd.categoryIds.includes(c.id);
                      return (
                        <Pressable key={c.id} onPress={() => toggleProdCategory(c.id)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: active ? palette.ink2 : palette.surface, borderWidth: 1, borderColor: active ? palette.ink2 : palette.hairline }}>
                          <Text style={{ fontSize: 13 }}>{c.icon}</Text>
                          <Text style={{ fontWeight: "600", fontSize: 12, color: active ? "#fff" : palette.inkSoft }}>{c.name}</Text>
                          {active && <Ionicons name="checkmark" size={12} color="#fff" />}
                        </Pressable>
                      );
                    })}
                  </View>
                  {newProd.categoryIds.length === 0 && <View style={{ marginTop: 8, backgroundColor: palette.warningBg, borderWidth: 0.5, borderColor: palette.warningBd, borderRadius: radius.sm, padding: 8 }}><Text style={{ fontSize: 11, color: palette.warning, fontWeight: "600" }}>Chwazi omwen yon kategori pou katalòg la</Text></View>}
                </View>

                <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12 }}>
                  <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>Seuil fèb</Text>
                  <TextInput placeholder="5" placeholderTextColor={palette.muted3} value={newProd.low_stock_threshold} onChangeText={v => setNewProd({ ...newProd, low_stock_threshold: v })} keyboardType="numeric" style={{ borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, fontSize: 14, color: palette.ink }} />
                  <Text style={{ fontSize: 11, color: palette.muted3, marginTop: 6 }}>Alèt lè stòk rive nan nivo sa a</Text>
                </View>
                <View style={{ backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGold, borderRadius: radius.sm, padding: 10, flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Ionicons name="information-circle-outline" size={16} color={palette.accentGold} />
                  <Text style={{ flex: 1, fontSize: 11, color: palette.accentGold, lineHeight: 14, fontWeight: "500" }}>Katalòg sèlman: stòk inisyal se 0. Ale nan <Text style={{ fontWeight: "800" }}>Inventaire</Text> pou antre premye livrezon ak frè transpò.</Text>
                </View>
              </ScrollView>
              <View style={{ flexDirection: "row", gap: 8, padding: 14, backgroundColor: palette.surface, borderTopWidth: 0.5, borderColor: palette.separatorSoft }}>
                <Pressable onPress={() => setShowAdd(false)} style={{ flex: 1, paddingVertical: 14, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.hairline }}><Text style={{ fontWeight: "600", color: palette.inkSoft, fontSize: 14 }}>Anile</Text></Pressable>
                <Pressable onPress={handleCreateProduct} style={{ flex: 1, paddingVertical: 14, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: "rgba(200,162,74,0.4)", ...shadow.card }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Kreye katalòg</Text></Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>


      {/* Inventory History — surprise timeline */}
      <Modal visible={showHistory} transparent animationType="slide" onRequestClose={() => setShowHistory(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.46)", justifyContent: "flex-end" }}>
          <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: palette.surface2, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "88%", overflow: "hidden" }}>
            <View style={{ backgroundColor: palette.surface, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: palette.separatorSoft }}>
              <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center" }}><Ionicons name="time-outline" size={20} color={palette.accentGold} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", fontSize: 16, color: palette.ink }}>Istwa Livrezon — Batch</Text>
                  <Text style={{ fontSize: 11, color: palette.muted }}>{batches.length} livrezon • {movements.length} mouvman • transpò total {fmt(batches.reduce((s, b) => s + (b.transport_cost || 0), 0))} HTG</Text>
                </View>
                <Pressable onPress={() => setShowHistory(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={16} color={palette.muted} /></Pressable>
              </View>
            </View>
            <ScrollView style={{ padding: 14 }} contentContainerStyle={{ gap: 10, paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
              {batches.length === 0 ? (
                <View style={{ backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.md, padding: 24, alignItems: "center" }}><Text style={{ fontWeight: "600", color: palette.ink }}>Poko gen livrezon</Text><Text style={{ fontSize: 12, color: palette.muted, marginTop: 4, textAlign: "center" }}>Kreye premye livrezon ou via Ajoute → Inventaire — tout ap kalkile ak frè transpò</Text></View>
              ) : batches.map(b => {
                const movs = movements.filter(m => m.batch_id === b.id);
                const expanded = expandedBatch === b.id;
                return (
                  <View key={b.id} style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, overflow: "hidden", ...shadow.card }}>
                    <Pressable onPress={() => setExpandedBatch(expanded ? null : b.id)} style={{ padding: 14 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: palette.accentGoldSoft, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: palette.accentGold }}><Text style={{ fontSize: 12, fontWeight: "800", color: palette.accentGold }}>{b.reference.slice(0, 3)}</Text></View>
                          <View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }} numberOfLines={1}>{b.reference}</Text>
                              {(b.status ?? "pending") === "pending"
                                ? <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: palette.accentGold, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2 }}><View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: palette.accentGold }} /><Text style={{ fontSize: 9, fontWeight: "800", color: palette.accentGold, letterSpacing: 0.3 }}>AP VINI</Text></View>
                                : null}
                            </View>
                            {b.supplier ? <Text style={{ fontSize: 11, color: palette.muted, marginTop: 1 }} numberOfLines={1}>{b.supplier}</Text> : null}
                            <Text style={{ fontSize: 11, color: palette.muted, marginTop: 1 }}>{(b.status ?? "pending") === "pending" ? (b.received_at ? `Estimasyon ${new Date(b.received_at).toLocaleDateString()} · ` : "") : (b.delivered_at ? `Rive ${new Date(b.delivered_at).toLocaleDateString()} · ` : "")}{new Date(b.created_at).toLocaleDateString()} · {movs.length} atik · transpò {fmt(b.transport_cost)} HTG</Text>
                          </View>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ fontWeight: "800", fontSize: 13, color: palette.ink }}>{fmt(b.total_cost)} HTG</Text>
                          <Text style={{ fontSize: 11, color: palette.muted }}>{fmt(b.total_items_cost)} + {fmt(b.transport_cost)} transpò</Text>
                        </View>
                      </View>
                      <View style={{ height: 6, flexDirection: "row", borderRadius: 3, overflow: "hidden", marginTop: 10, backgroundColor: palette.surfaceGrouped }}>
                        {movs.map((m, i) => {
                          const colors = [palette.ink2, palette.accentGold, palette.success, "#8B5CF6", "#EC4899", "#06B6D4"];
                          const pct = b.total_items_cost ? (m.total_cost - m.allocated_transport) / b.total_items_cost * 100 : 100 / movs.length;
                          return <View key={m.id} style={{ width: `${pct}%` as any, backgroundColor: colors[i % colors.length] }} />;
                        })}
                      </View>
                    </Pressable>
                    {expanded && (
                      <View style={{ borderTopWidth: 0.5, borderColor: palette.separatorSoft, padding: 10, gap: 7, backgroundColor: palette.surface2 }}>
                        {movs.map(m => {
                          const prod = products.find(p => p.id === m.product_id);
                          return (
                            <View key={m.id} style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: palette.surface, borderWidth: 0.5, borderColor: palette.hairline, borderRadius: radius.sm, padding: 10 }}>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontWeight: "600", fontSize: 13, color: palette.ink }} numberOfLines={1}>{prod?.name ?? m.product_id}</Text>
                                <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}>{m.quantity} pcs × {fmt(m.unit_cost)} HTG = {fmt(m.quantity * m.unit_cost)} HTG {m.allocated_transport > 0 ? `+ ${fmt(Math.round(m.allocated_transport))} transpò` : ""}{m.type === "in" && m.remaining_qty != null ? ` · rete ${fmt(m.remaining_qty)}/${fmt(m.initial_qty ?? 0)}` : ""}</Text>
                              </View>
                              <Text style={{ fontWeight: "800", fontSize: 12, color: palette.ink }}>{fmt(Math.round(m.total_cost))} HTG</Text>
                            </View>
                          );
                        })}
                        {b.notes ? <View style={{ backgroundColor: palette.surfaceGrouped, padding: 8, borderRadius: radius.sm }}><Text style={{ fontSize: 11, color: palette.muted, fontStyle: "italic" }}>Nòt: {b.notes}</Text></View> : null}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Nouvo kategori — Apple sheet */}
      <Modal visible={showAddCategory} transparent animationType="slide" onRequestClose={() => setShowAddCategory(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.46)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: palette.surface2, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: "hidden", maxHeight: "84%" }}>
              <View style={{ backgroundColor: palette.surface, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: palette.separatorSoft, alignItems: "center" }}>
                <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, marginBottom: 12 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: palette.ink2, borderWidth: 0.5, borderColor: "rgba(200,162,74,0.5)", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 16, color: "#fff" }}>{newCategory.icon || "◈"}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 16, color: palette.ink, letterSpacing: -0.3 }}>Nouvo kategori</Text>
                    <Text style={{ fontSize: 11, color: palette.muted }}>Global · disponib pou tout magazen imedyatman</Text>
                  </View>
                </View>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ padding: 14 }} contentContainerStyle={{ gap: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12 }}>
                  <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>Non kategori *</Text>
                  <TextInput value={newCategory.name} onChangeText={v => { setNewCategory(p => ({ ...p, name: v })); if (categoryError) setCategoryError(""); }} placeholder="Eg. Fwi, Legim, Sanitè" placeholderTextColor={palette.muted3} style={{ borderWidth: 1, borderColor: newCategory.name ? palette.ink2 : palette.hairline, borderRadius: radius.sm, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, fontSize: 14, color: palette.ink, backgroundColor: palette.surface }} />
                  <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink, marginTop: 12 }}>Ikon</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
                    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.hairline, borderRadius: radius.sm, paddingHorizontal: 12, height: 44 }}>
                      <Text style={{ fontSize: 14, marginRight: 8 }}>{newCategory.icon || "◈"}</Text>
                      <TextInput value={newCategory.icon} onChangeText={v => setNewCategory(p => ({ ...p, icon: v.slice(0, 2) }))} placeholder="◈" maxLength={2} style={{ flex: 1, fontSize: 14, color: palette.ink }} />
                    </View>
                    <Text style={{ fontSize: 11, color: palette.muted3, backgroundColor: palette.surfaceGrouped, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.pill }}>1–2 karaktè</Text>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                    {["◈", "⬢", "⬣", "⬔", "⧉", "✦", "◆", "●", "■", "♥", "🍚", "🥤", "🧴", "🥐", "🥬"].map(ic => (
                      <Pressable key={ic} onPress={() => setNewCategory(p => ({ ...p, icon: ic }))} style={{ width: 36, height: 36, borderRadius: radius.pill, borderWidth: newCategory.icon === ic ? 1.5 : 0.5, borderColor: newCategory.icon === ic ? palette.accentGold : palette.hairline, backgroundColor: newCategory.icon === ic ? palette.ink2 : palette.surface, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 14, color: newCategory.icon === ic ? "#fff" : palette.ink }}>{ic}</Text></Pressable>
                    ))}
                  </View>
                  {categoryError ? <View style={{ marginTop: 10, backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.sm, padding: 10 }}><Text style={{ fontSize: 12, fontWeight: "600", color: palette.danger }}>{categoryError}</Text></View> : null}
                </View>
                <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12 }}>
                  <Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>Kategori ki egziste ({categories.length - 1})</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {categories.filter(c => c.id !== "all").map(c => (
                      <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: palette.surfaceGrouped, borderWidth: 0.5, borderColor: palette.hairline }}><Text style={{ fontSize: 12 }}>{c.icon}</Text><Text style={{ fontWeight: "600", fontSize: 12, color: palette.ink }}>{c.name}</Text></View>
                    ))}
                  </View>
                </View>
                <View style={{ backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, padding: 10, borderWidth: 0.5, borderColor: palette.hairline }}>
                  <Text style={{ fontSize: 11, color: palette.muted, lineHeight: 14, textAlign: "center" }}>Kategori ap parèt nan filtè stòk ak nan fòm pwodwi.</Text>
                </View>
              </ScrollView>
              <View style={{ flexDirection: "row", gap: 8, padding: 14, backgroundColor: palette.surface, borderTopWidth: 0.5, borderColor: palette.separatorSoft }}>
                <Pressable onPress={() => { setShowAddCategory(false); setCategoryError(""); }} style={{ flex: 1, paddingVertical: 14, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.hairline }}><Text style={{ fontWeight: "600", color: palette.inkSoft, fontSize: 14 }}>Anile</Text></Pressable>
                <Pressable onPress={handleCreateCategory} style={{ flex: 1, paddingVertical: 14, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: "rgba(200,162,74,0.4)", ...shadow.card }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Kreye kategori</Text></Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Deliver pending batch — final cost check + status flip */}
      <Modal visible={!!deliverBatch} transparent animationType="slide" onRequestClose={() => !delivering && setDeliverBatch(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(22,19,12,0.46)", justifyContent: "flex-end" }}>
            <View style={{ ...sheetBox(isTablet, width, 640), width: "100%", backgroundColor: palette.surface2, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: "hidden" }}>
              <View style={{ backgroundColor: palette.surface, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: palette.separatorSoft }}>
                <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 12 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: palette.successBg, alignItems: "center", justifyContent: "center" }}><Ionicons name="checkmark-circle-outline" size={20} color={palette.success} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 15, color: palette.ink, letterSpacing: -0.2 }}>{deliverBatch?.reference} rive!</Text>
                    <Text style={{ fontSize: 11, color: palette.muted, marginTop: 1 }}>{deliverBatch?.supplier ? `${deliverBatch.supplier} · ` : ""}{fmt(Math.round(deliverBatch?.total_cost ?? 0))} HTG</Text>
                  </View>
                </View>
              </View>
              <View style={{ padding: 14, gap: 12 }}>
                <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.successBd, padding: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name="cash-outline" size={15} color={palette.success} /><Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Frè anplis? <Text style={{ fontWeight: "400", color: palette.muted3, fontSize: 11 }}>(opsyonèl)</Text></Text></View>
                  <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}>Transpò oswa douan ki rive kounye a — ap ajoute nan pri revand a.</Text>
                  <TextInput
                    placeholder="Eg. 250"
                    placeholderTextColor={palette.muted3}
                    value={deliverFee}
                    onChangeText={setDeliverFee}
                    keyboardType="numeric"
                    style={{ borderWidth: 1, borderColor: deliverFee ? palette.ink2 : palette.hairline, borderRadius: radius.sm, paddingVertical: 13, paddingHorizontal: 12, marginTop: 8, fontWeight: "600", fontSize: 15, color: palette.ink, backgroundColor: palette.surface }}
                  />
                </View>
                <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, padding: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ionicons name="cube-outline" size={15} color={palette.ink} /><Text style={{ fontWeight: "700", fontSize: 13, color: palette.ink }}>Atik yo ap vin disponib</Text></View>
                  <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}>Lè ou konfime, kantite yo ap ajoute nan stòk ak FIFO ap aplike vrepri a.</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8, padding: 14, backgroundColor: palette.surface, borderTopWidth: 0.5, borderColor: palette.separatorSoft }}>
                <Pressable onPress={() => { setDeliverBatch(null); setDeliverFee(""); }} disabled={delivering} style={{ flex: 1, paddingVertical: 14, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.hairline }}><Text style={{ fontWeight: "600", color: palette.inkSoft, fontSize: 14 }}>Retounen</Text></Pressable>
                <Pressable onPress={() => deliverBatch && handleDeliver(deliverBatch, deliverFee)} disabled={delivering} style={{ flex: 1, paddingVertical: 14, backgroundColor: palette.success, borderRadius: radius.sm, alignItems: "center", borderWidth: 1, borderColor: palette.successBd, ...shadow.card }}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>{delivering ? "Ap delivre…" : "✓ Konfime rive"}</Text></Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

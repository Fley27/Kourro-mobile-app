import React, { useEffect, useState, useMemo } from "react";
import { palette, radius, topIconBtn } from "../theme";
import { View, Text, Pressable, Alert, ScrollView, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getDb } from "../db";
import { useSalesEvents } from "../salesEvents";
import type { Role } from "../users";
import {
  loadPricing, ensurePricingForProducts, getUnitsForProduct, getPricesForUnit,
  getDefaultUnit, getDisplayPrice, type PricingMaps,
  type ProductUnit, type ProductPrice, type ProductBundle,
} from "../pricing";
import { fmtG } from "../format";
import { uploadSuccess, uploadError } from "../components/UploadTransition";
import { useResponsive, sheetBox, IS_TABLET_DEVICE } from "../responsive";
import { CatalogPhone } from "./CatalogPhone";
import { CatalogTablet } from "./CatalogTablet";
import CategoryFormModal from "../components/CategoryFormModal";
import MissingPricesSheet from "../components/MissingPricesSheet";
import CatalogFlowModal, { type StepKey } from "./catalogFlow/CatalogFlowModal";
import BulkProductFlowModal from "./catalogFlow/BulkProductFlowModal";
import ProductDetail from "./ProductDetail";
import { loadCatalogModel, currentBaseCost, currentVariantPrice, unpricedVariantRows, type CatalogModel, type Item, type Batch, type Variant, type VariantPrice } from "../catalogModel";
import { itemCostsFor } from "../analytics/metrics";
import { FALLBACK_STORE_ID } from "../db/ids";
import {
  DEFAULT_CATEGORIES, getCategoryForProduct, slugify, isGoods, isService, isAvailable, categoryDisplayIcon, statusForProduct, ProductCard, normName,
  type Category, type Product,
} from "./CatalogShared";

export default function CatalogScreen({ role = "cashier", currentUser, onOpenInventory, inventoryVersion, onBack }: { role?: Role; currentUser?: any; onOpenInventory?: () => void; inventoryVersion?: number; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const { isTablet, isLandscape, padH, width } = useResponsive();
  // Master-detail shows in portrait; landscape tablets use phone layout.
  const showTablet = isTablet;
  const [products, setProducts] = useState<Product[]>([]);
  // First-load flag — skeleton cards instead of the "Pa gen pwodwi" flash.
  // Never reset: inventoryVersion reloads keep the list visible.
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [productCategories, setProductCategories] = useState<{ product_id: string; category_id: string }[]>([]);

  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  // Status filter (single-select, Transactions style): Aktif by default.
  const [statusSel, setStatusSel] = useState<"active" | "draft">("active");
  const [draftStatusSel, setDraftStatusSel] = useState<"active" | "draft">("active");
  const [showFilter, setShowFilter] = useState(false);
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [view, setView] = useState<"hub" | "products" | "categories" | "categoryDetail" | "productDetail">("hub");
  const [detailCatId, setDetailCatId] = useState<string | null>(null);
  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [detailReturn, setDetailReturn] = useState<"products" | "categoryDetail">("products");
  const [showEditCat, setShowEditCat] = useState(false);
  const [detailTitleVisible, setDetailTitleVisible] = useState(false);
  const [detailIdentityBottom, setDetailIdentityBottom] = useState(90);
  useEffect(() => { setDetailTitleVisible(false); }, [detailCatId, detailProductId, view]);
  const [links, setLinks] = useState<{ child_id: string; parent_id: string }[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [saleItems, setSaleItems] = useState<any[]>([]);
  const [showFlow, setShowFlow] = useState(false);
  const [flowProductId, setFlowProductId] = useState<string | null>(null);
  const [flowSection, setFlowSection] = useState<StepKey | null>(null);
  const [modelItems, setModelItems] = useState<Item[]>([]);
  const [modelBatches, setModelBatches] = useState<Batch[]>([]);
  const [modelVariants, setModelVariants] = useState<Variant[]>([]);
  const [modelPrices, setModelPrices] = useState<VariantPrice[]>([]);
  const [modelSuppliers, setModelSuppliers] = useState<{ product_id: string; supplier_id: string }[]>([]);
  const [modelCostRows, setModelCostRows] = useState<any[]>([]);
  const [supplierList, setSupplierList] = useState<{ id: string; name: string }[]>([]);

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [showDraftMenu, setShowDraftMenu] = useState(false);
  const [showFlowChoice, setShowFlowChoice] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [infoProduct, setInfoProduct] = useState<Product | null>(null);
  const [showNameEdit, setShowNameEdit] = useState(false);
  const [nameInput, setNameInput] = useState("");


  // Multi-variant pricing maps (units / Cold-Hot prices / bundles)
  const [pricing, setPricing] = useState<PricingMaps>({ units: [], prices: [], bundles: [] });

  const canAdd = role === "owner" || role === "admin" || role === "manager";
  const canAddMore = role === "owner" || role === "admin" || role === "manager";
  const canReduce = role === "owner" || role === "admin";
  const canDelete = role === "owner" || role === "admin";
  const canEdit = canAddMore || canReduce || canDelete;
  // Cost is owner/admin only; availability toggle extends to managers + cooks.
  const canViewCost = role === "owner" || role === "admin";
  const canToggleAvail = role === "owner" || role === "admin" || role === "manager" || role === "cook";

  async function toggleAvail(p: Product) {
    if (!isService(p)) return;
    if (!canToggleAvail) return Alert.alert("Pa gen dwa", "Se Owner/Admin/Manadjè/Cook ka chanje disponiblite.");
    const next = isAvailable(p) ? 0 : 1;
    try {
      const db = await getDb();
      await db.runAsync("UPDATE products SET is_available = ? WHERE id = ?", [next, p.id]);
      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, is_available: next } : x));
      setInfoProduct(prev => (prev && prev.id === p.id ? { ...prev, is_available: next } : prev));
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Chanje disponiblite echwe");
    }
  }

  async function load() {
    try {
    const db = await getDb();
      // Drafts load too — visibility is decided by the status filter.
      const rows = (await db.getAllAsync("SELECT * FROM products WHERE (is_deleted=0 OR is_deleted IS NULL)")) as Product[];
    setProducts(rows.map(r => ({ ...r, item_type: (r.item_type ?? "goods") as "goods" | "service", is_available: r.is_available ?? 1 })));
    try {
      const pm = await ensurePricingForProducts(db, rows);
      setPricing(pm);
    } catch (e) { console.log("[Stock pricing] failed:", e); }
    try {
      const catRows = (await db.getAllAsync("SELECT * FROM categories")) as any[];
      if (catRows.length === 0) {
        for (const c of DEFAULT_CATEGORIES.filter(x => x.id !== "all")) {
          await db.runAsync("INSERT OR REPLACE INTO categories (id, store_id, name, icon, color, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [c.id, FALLBACK_STORE_ID, c.name, c.icon, c.color, DEFAULT_CATEGORIES.findIndex(x => x.id === c.id), new Date().toISOString(), new Date().toISOString()]);
        }
        setCategories(DEFAULT_CATEGORIES);
      } else {
        const dbCats: Category[] = catRows.filter((r: any) => !r.is_deleted).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((r: any) => ({ id: r.id, name: r.name, icon: r.icon ?? "◈", color: r.color ?? "#0f172a", created_at: r.created_at ?? undefined }));
        setCategories([{ id: "all", name: "Tout", icon: "⊞", color: palette.ink2 } as Category, ...dbCats]);
      }
      // product_categories
      try { const pc = (await db.getAllAsync("SELECT * FROM product_categories")) as any[]; setProductCategories(pc); } catch { setProductCategories([]); }
      // category DAG edges (parents/children for the details view)
      try {
        const ln = ((await db.getAllAsync("SELECT * FROM category_links")) as any[]) ?? [];
        setLinks(ln.filter((r: any) => !r.is_deleted).map((r: any) => ({ child_id: String(r.child_id), parent_id: String(r.parent_id) })));
      } catch { setLinks([]); }
      // sales lines for per-category all-time revenue (cancelled excluded)
      try {
        const s = ((await db.getAllAsync("SELECT * FROM sales")) as any[]) ?? [];
        setSales(s.filter((x: any) => String(x.status ?? "") !== "cancelled"));
      } catch { setSales([]); }
      try { setSaleItems((((await db.getAllAsync("SELECT * FROM sale_items")) as any[]) ?? [])); } catch { setSaleItems([]); }
      // catalog v2 model (items / batches / variants / prices + suppliers)
      try {
        const m = await loadCatalogModel(db);
        setModelItems(m.items);
        setModelBatches(m.batches);
        setModelVariants(m.variants);
        setModelPrices(m.variantPrices);
        try {
          const ps = ((await db.getAllAsync("SELECT * FROM product_suppliers").catch(() => [])) ?? []) as any[];
          setModelSuppliers(ps.filter((r: any) => !r.is_deleted).map((r: any) => ({ product_id: String(r.product_id), supplier_id: String(r.supplier_id) })));
        } catch { setModelSuppliers([]); }
        const ss = ((await db.getAllAsync("SELECT id, name FROM suppliers WHERE is_deleted = 0 OR is_deleted IS NULL ORDER BY name COLLATE NOCASE").catch(() => [])) ?? []) as any[];
        setSupplierList(ss.map((s: any) => ({ id: String(s.id), name: String(s.name ?? "—") })));
        try {
          const sc = ((await db.getAllAsync("SELECT * FROM product_supplier_costs").catch(() => [])) ?? []) as any[];
          setModelCostRows(sc.filter((r: any) => !r.is_deleted));
        } catch { setModelCostRows([]); }
      } catch { setModelItems([]); setModelBatches([]); setModelVariants([]); setModelPrices([]); setSupplierList([]); setModelCostRows([]); }
    } catch {}
    } catch (e) { console.log("[Stock load] failed:", e); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (inventoryVersion) load(); }, [inventoryVersion]);
  // Live: catalog rows edited on another register arrive through autoSync.
  useSalesEvents(() => { load().catch(() => {}); });

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

  function catParents(id: string): Category[] {
    const ids = [...new Set(links.filter(l => l.child_id === id).map(l => l.parent_id))];
    return ids.map(pid => categories.find(c => c.id === pid)).filter(Boolean) as Category[];
  }
  function catChildren(id: string): Category[] {
    const ids = [...new Set(links.filter(l => l.parent_id === id).map(l => l.child_id))];
    return ids.map(cid => categories.find(c => c.id === cid)).filter(Boolean) as Category[];
  }

  // All-time revenue per category (full credit: a line counts wholly for
  // every category of its product). Cancelled sales excluded at load.
  const revenueByCat = useMemo(() => {
    const map = new Map<string, number>();
    const prodCats = new Map<string, string[]>();
    for (const p of products) prodCats.set(p.id, getProductCats(p.id));
    const saleIds = new Set(sales.map((s: any) => s.id));
    for (const l of saleItems) {
      if (!saleIds.has((l as any).sale_id)) continue;
      const total = Number((l as any).line_total ?? (Number((l as any).quantity ?? 0) * Number((l as any).unit_price ?? 0))) || 0;
      if (!total) continue;
      for (const cid of prodCats.get(String((l as any).product_id)) ?? []) {
        map.set(cid, (map.get(cid) ?? 0) + total);
      }
    }
    return map;
  }, [products, productCategories, categories, sales, saleItems]);

  function categoryLetter(name: string): string {
    const ch = (name.trim().charAt(0) || "#").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    return /^[A-Z]$/.test(ch) ? ch : "#";
  }

  // Categories grouped by first letter (A–Z, "#" last), alphabetical inside.
  const catSections = useMemo(() => {
    const list = categories.filter(c => c.id !== "all");
    const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const groups = new Map<string, Category[]>();
    for (const c of list) {
      const L = categoryLetter(c.name);
      if (!groups.has(L)) groups.set(L, []);
      groups.get(L)!.push(c);
    }
    return [...groups.entries()]
      .sort((a, b) => (a[0] === "#" ? 1 : b[0] === "#" ? -1 : a[0].localeCompare(b[0])))
      .map(([letter, cats]) => ({ letter, cats: cats.sort((x, y) => norm(x.name).localeCompare(norm(y.name))) }));
  }, [categories]);

  const costMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) map.set(p.id, currentBaseCost(modelItems, modelBatches, p.id));
    return map;
  }, [products, modelItems, modelBatches]);
  const getBaseCost = (pid: string) => costMap.get(pid) ?? 0;
  // Per-unit derived costs (batch → quote → stored, spread by the ratio
  // chain) — the read-only Cost section of product details reads these.
  const unitCostMap = useMemo(() => itemCostsFor(modelItems, modelBatches, modelCostRows), [modelItems, modelBatches, modelCostRows]);
  const getUnitCosts = (pid: string) => {
    const out = new Map<string, number>();
    for (const it of modelItems) {
      if (it.is_deleted || it.product_id !== pid) continue;
      const c = unitCostMap.get(String(it.id));
      if (c != null) out.set(String(it.id), c);
    }
    return out;
  };
  const v2: CatalogModel = useMemo(() => ({
    items: modelItems,
    productSuppliers: modelSuppliers,
    batches: modelBatches,
    variants: modelVariants,
    variantPrices: modelPrices,
  }), [modelItems, modelSuppliers, modelBatches, modelVariants, modelPrices]);

  function openManage(productId: string, section?: StepKey) {
    setFlowProductId(productId);
    setFlowSection(section ?? null);
    setShowFlow(true);
  }

  const detailCat: Category | null = detailCatId ? (categories.find(c => c.id === detailCatId) ?? null) : null;
  const isLive = (p: Product) => String((p as any).status ?? "active") !== "draft";
  const matchStatus = (p: Product) => statusSel === "active" ? isLive(p) : !isLive(p);
  const activeCount = useMemo(() => products.filter(isLive).length, [products]);
  const draftCount = useMemo(() => products.filter(p => !isLive(p)).length, [products]);
  const detailProducts = useMemo(
    () => (detailCat ? products.filter(p => matchStatus(p) && getProductCats(p.id).includes(detailCat.id)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, productCategories, categories, detailCatId, statusSel]
  );

  // ---- multi-variant pricing ----
  function defaultUnitOf(productId: string) {
    return getDefaultUnit(getUnitsForProduct(pricing, productId));
  }
  function displayPriceOf(p: Product): number {
    const d = getDisplayPrice(pricing, p.id);
    if (d && d.price > 0) return d.price;
    return Number(p.selling_price ?? 0) || 0;
  }


  const filtered = useMemo(() => {
    const list = products.filter(p => {
      if (!matchStatus(p)) return false;
      const nq = normName(q);
      const matchQ = !nq || normName(p.name).includes(nq) || normName(p.sku ?? "").includes(nq) || normName(p.barcode ?? "").includes(nq);
      const prodCats = getProductCats(p.id);
      const matchCat = cat === "all" || prodCats.includes(cat);
      const matchLow = !showLowOnly || (isGoods(p) && p.stock_quantity <= p.low_stock_threshold);
      return matchQ && matchCat && matchLow;
    });
    // Drafts order by creation date (oldest first).
    if (statusSel === "draft") {
      list.sort((a, b) => String((a as any).created_at ?? "").localeCompare(String((b as any).created_at ?? "")));
    }
    return list;
  }, [products, q, cat, showLowOnly, statusSel, productCategories, categories]);

  const missingPrices = useMemo(
    () => unpricedVariantRows(modelItems, modelVariants, modelPrices, products),
    [modelItems, modelVariants, modelPrices, products]
  );
  const lowCount = products.filter(p => isLive(p) && isGoods(p) && p.stock_quantity <= p.low_stock_threshold).length;

  /** Normalized similarity 0–1 (Levenshtein). Flags near-duplicate names. */
  function nameSimilarity(a: string, b: string): number {
    const x = normName(a.trim()), y = normName(b.trim());
    if (!x || !y) return 0;
    if (x === y) return 1;
    const dp: number[][] = Array.from({ length: x.length + 1 }, (_, i) => {
      const row = new Array(y.length + 1).fill(0);
      row[0] = i;
      return row;
    });
    for (let j = 0; j <= y.length; j++) dp[0][j] = j;
    for (let i = 1; i <= x.length; i++) {
      for (let j = 1; j <= y.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      }
    }
    return 1 - dp[x.length][y.length] / Math.max(x.length, y.length);
  }

  // Draft → active, gated: exact-name clash blocks, unfilled steps block,
  // ≥70% similar names warn (user confirms), then the flip writes + syncs.
  async function activateProduct(pid: string) {
    if (!canEdit) return Alert.alert("Pa gen dwa", "Sèlman Owner/Admin/Manadjè ka aktive pwodwi.");
    const p = products.find(x => x.id === pid);
    if (!p) return;
    const now = new Date().toISOString();
    const norm = normName(p.name);
    if (products.some(x => x.id !== pid && normName(x.name) === norm)) {
      return Alert.alert("Non deja egziste", `"${p.name}" deja nan katalòg — chak pwodwi dwe inik`);
    }
    const pItems = modelItems.filter(i => String(i.product_id) === pid && !i.is_deleted);
    const missing: string[] = [];
    if (!pItems.length) missing.push("• Inite (etap 2)");
    const svc = !isGoods(p);
    const pVars = modelVariants.filter(v => !v.is_deleted && pItems.some(i => String(i.id) === String(v.item_id)));
    for (const it of pItems) {
      if (!pVars.some(v => String(v.item_id) === String(it.id))) missing.push(`• Variant pou ${it.name} (etap 4)`);
    }
    if (!svc) {
      const hasBatch = modelBatches.some(b => !b.is_deleted && pItems.some(i => String(i.id) === String(b.item_id)));
      if (!hasBatch) missing.push("• Batch (etap 3)");
    }
    for (const v of pVars) {
      const cur = currentVariantPrice(modelPrices, String(v.id), now);
      if (!cur || !(Number(cur.price) > 0)) {
        const it = pItems.find(i => String(i.id) === String(v.item_id));
        missing.push(`• Pri pou ${it?.name ?? "?"} ${v.name} (etap 5)`);
      }
    }
    if (missing.length) {
      return Alert.alert("Poko pare pou aktive", `${p.name} manke:\n${missing.join("\n")}`);
    }
    const sims = products
      .filter(x => x.id !== pid)
      .map(x => ({ name: x.name, s: nameSimilarity(p.name, x.name) }))
      .filter(x => x.s >= 0.7)
      .sort((a, b) => b.s - a.s);
    const doActivate = async () => {
      try {
        const db = await getDb();
        await db.runAsync("UPDATE products SET status = ?, updated_at = ?, dirty = 1 WHERE id = ?", ["active", now, pid]);
        try {
          const { insertOutbox } = await import("../db");
          await insertOutbox("products", "update", { id: pid, status: "active", updated_at: now, is_deleted: 0 });
        } catch {}
        uploadSuccess("Pwodwi aktive ✓", `${p.name} parèt nan katalòg kounye a.`);
        load();
      } catch (e: any) {
        uploadError("Erè", e?.message ?? "Aktive echwe");
      }
    };
    if (sims.length) {
      Alert.alert(
        "Non sanble",
        `${p.name} sanble ak:\n${sims.map(s => `• ${s.name} (${Math.round(s.s * 100)}%)`).join("\n")}\n\nKontinye kanmenm?`,
        [
          { text: "Anile", style: "cancel" },
          { text: "Kontinye", onPress: () => { doActivate(); } },
        ]
      );
      return;
    }
    doActivate();
  }
  const totalValue = products.reduce((s, p) => s + p.stock_quantity * displayPriceOf(p), 0);


  // Delete a product + everything it owns (v2 rows). Soft-delete so sync
  // converges; stock moves only through the batch flow (no quick adjust).
  // Called with an id from the detail screen (pre-confirmed there), or
  // without one from legacy two-tap sheets (confirm gate applies).
  async function handleDeleteProduct(pid: string) {
    const target = pid;
    if (!canDelete) return Alert.alert("Pa gen dwa", "Sèlman Owner/Admin ka efase pwodwi.");
    const targetName = products.find(p => p.id === pid)?.name ?? "";
    try {
    const db = await getDb();
    const { softDeleteProduct } = await import("../catalogModel");
    await softDeleteProduct(db, target);
    uploadSuccess("Pwodwi efase", `${targetName} efase`);
    setInfoProduct(cur => (cur && cur.id === target ? null : cur));
    if (detailProductId === target) {
      setDetailProductId(null);
      setView(detailReturn === "categoryDetail" ? "categories" : "products");
    }
    load();
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Efase pwodwi echwe");
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
    uploadSuccess("Non chanje ✓", `${infoProduct.name} → ${name}`);
    setShowNameEdit(false);
    load();
    } catch (e: any) {
      uploadError("Erè", e?.message ?? "Chanje non echwe");
    }
  }

  function openNewCatForm() {
    setShowAddCategory(true);
  }


  const tabletDetail: Product | null = infoProduct;

  function openProductDetail(productId: string, from: "products" | "categoryDetail") {
    setDetailProductId(productId);
    setDetailReturn(from);
    setView("productDetail");
  }
  const detailProduct: Product | null = detailProductId ? (products.find(p => p.id === detailProductId) ?? null) : null;

  void lowCount; void totalValue;
  void getUnitsForProduct; void getPricesForUnit;

  // TABLET-SCREEN: both add-product flows run as inline content-area screens
  // (sidebar stays visible) — flag must match the flows' IS_TABLET_DEVICE.
  if (IS_TABLET_DEVICE && (showFlow || showBulk)) {
    return showFlow ? (
      <CatalogFlowModal
        visible
        onClose={() => { setShowFlow(false); setFlowProductId(null); setFlowSection(null); }}
        onDone={() => { load(); }}
        categories={categories}
        role={role}
        currentUser={currentUser}
        initialProductId={flowProductId}
        initialSection={flowSection}
      />
    ) : (
      <BulkProductFlowModal
        visible
        onClose={() => setShowBulk(false)}
        onDone={() => { load(); }}
        ctx={{ role, currentUser, categories, reload: () => { load(); } }}
      />
    );
  }

  if (view === "hub") {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: padH, paddingTop: 8 }}>
          {onBack ? (
            <Pressable onPress={onBack} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
            </Pressable>
          ) : (
            <View style={{ width: topIconBtn.size }} />
          )}
          <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }}>Katalòg</Text>
          <View style={{ width: topIconBtn.size }} />
        </View>
        <View style={{ height: 1, backgroundColor: "#262626", marginTop: 14 }} />
        {missingPrices.length > 0 && canEdit && (
          <Pressable onPress={() => setShowMissing(true)} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: padH, marginTop: 14, backgroundColor: "rgba(217,154,43,0.12)", borderWidth: 1, borderColor: "rgba(217,154,43,0.4)", borderRadius: 16, padding: 14 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(217,154,43,0.2)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="pricetag-outline" size={18} color="#d99a2b" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800", fontSize: 14, color: "#fff" }}>{missingPrices.length} variant san pri</Text>
              <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 1 }}>Yo pa parèt nan kes — tape pou mete pri</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
          </Pressable>
        )}
        <Pressable onPress={() => setView("products")} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: padH, paddingVertical: 20, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
          <Text style={{ flex: 1, fontWeight: "800", fontSize: 17, color: "#fff" }}>Pwodwi</Text>
          <Ionicons name="chevron-forward" size={20} color="#8e8e93" />
        </Pressable>
        <Pressable onPress={() => setView("categories")} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: padH, paddingVertical: 20, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
          <Text style={{ flex: 1, fontWeight: "800", fontSize: 17, color: "#fff" }}>Kategori</Text>
          <Ionicons name="chevron-forward" size={20} color="#8e8e93" />
        </Pressable>
        <MissingPricesSheet
          visible={showMissing}
          onClose={() => setShowMissing(false)}
          rows={missingPrices}
          onSaved={() => { setShowMissing(false); load(); }}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={{ width: "100%", flexDirection: "row", alignItems: "center", paddingHorizontal: padH, paddingTop: 8, paddingBottom: 8 }}>
        {view === "categoryDetail" && detailCat ? (
          <Pressable onPress={() => setView("categories")} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
          </Pressable>
        ) : view === "productDetail" && detailProduct ? (
          <Pressable onPress={() => setView(detailReturn === "categoryDetail" ? "categories" : "products")} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
          </Pressable>
        ) : (
          <Pressable onPress={() => setView("hub")} accessibilityLabel="Back" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={topIconBtn.iconSize} color={topIconBtn.icon} />
          </Pressable>
        )}
        <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", fontSize: 20, color: "#fff" }} numberOfLines={1}>
          {view === "products" ? "Pwodwi" : view === "categoryDetail" ? (detailTitleVisible && detailCat ? detailCat.name : "") : view === "productDetail" ? (detailTitleVisible && detailProduct ? detailProduct.name : "") : "Kategori"}
        </Text>
        {view === "categoryDetail" ? (
          canEdit ? (
            <Pressable onPress={() => setShowEditCat(true)} style={{ paddingHorizontal: 24, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontWeight: "800", fontSize: 15, color: "#000" }}>Edit</Text>
            </Pressable>
          ) : (
            <View style={{ width: topIconBtn.size }} />
          )
        ) : view === "productDetail" && detailProduct ? (
          canEdit ? (
            String((detailProduct as any).status ?? "active") === "draft" ? (
              <Pressable onPress={() => setShowDraftMenu(v => !v)} accessibilityLabel="Draft menu" style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="ellipsis-horizontal" size={topIconBtn.iconSize} color={topIconBtn.icon} />
              </Pressable>
            ) : (
              <Pressable onPress={() => openManage(detailProduct.id)} style={{ paddingHorizontal: 24, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontWeight: "800", fontSize: 15, color: "#000" }}>Edit</Text>
              </Pressable>
            )
          ) : (
            <View style={{ width: topIconBtn.size }} />
          )
        ) : canEdit ? (
          <Pressable
            onPress={() => {
              if (view === "products") setShowFlowChoice(true);
              else setShowAddCategory(true);
            }}
            accessibilityLabel={view === "products" ? "Ajoute pwodwi" : "Ajoute kategori"}
            style={{ width: topIconBtn.size, height: topIconBtn.size, borderRadius: topIconBtn.radius, backgroundColor: topIconBtn.bg, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="add" size={topIconBtn.iconSize} color={topIconBtn.icon} />
          </Pressable>
        ) : (
          <View style={{ width: topIconBtn.size }} />
        )}
      </View>
      <View style={{ height: 1, backgroundColor: "#262626", width: "100%" }} />
      {showDraftMenu && view === "productDetail" && detailProduct && String((detailProduct as any).status ?? "active") === "draft" ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}>
          <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={() => setShowDraftMenu(false)} />
          <View style={{ position: "absolute", top: 66, right: 16, width: 250, backgroundColor: "#1C1C1E", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 6 }}>
            <Pressable onPress={() => { setShowDraftMenu(false); activateProduct(detailProduct.id); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: "#2b2b2b", borderWidth: 0.5, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="checkmark-circle" size={19} color="#4cae7f" />
              </View>
              <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff" }}>Mete nan katalòg</Text>
            </Pressable>
            <Pressable onPress={() => { setShowDraftMenu(false); openManage(detailProduct.id); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12, borderBottomWidth: canDelete ? 0.5 : 0, borderBottomColor: "#262626" }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: "#2b2b2b", borderWidth: 0.5, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="create" size={19} color="#fff" />
              </View>
              <Text style={{ fontWeight: "700", fontSize: 14, color: "#fff" }}>Modifye</Text>
            </Pressable>
            {canDelete ? (
              <Pressable onPress={() => { setShowDraftMenu(false); handleDeleteProduct(detailProduct.id); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12 }}>
                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(224,108,91,0.12)", borderWidth: 0.5, borderColor: "rgba(224,108,91,0.4)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="trash" size={19} color="#e06c5b" />
                </View>
                <Text style={{ fontWeight: "700", fontSize: 14, color: "#e06c5b" }}>Efase</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      {view === "categories" ? (
        <ScrollView style={{ flex: 1, width: "100%" }} contentContainerStyle={{ padding: 16, paddingHorizontal: padH, paddingBottom: 96, gap: 10, width: "100%" }} showsVerticalScrollIndicator={false}>
          {catSections.map(sec => (
            <View key={sec.letter} style={{ gap: 10 }}>
              <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "800", letterSpacing: 1.2, marginTop: 6 }}>{sec.letter}</Text>
              {sec.cats.map(c => {
                const count = products.filter(p => getProductCats(p.id).includes(c.id)).length;
                return (
                  <Pressable key={c.id} onPress={() => { setDetailCatId(c.id); setCat(c.id); setView("categoryDetail"); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: radius.md, padding: 14 }}>
                    <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#2b2b2b", borderWidth: 0.5, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
                      {(() => { const gi = categoryDisplayIcon(c); return gi ? <Ionicons name={gi} size={22} color={"#fff"} /> : <Text style={{ fontSize: 20 }}>{c.icon}</Text>; })()}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }}>{c.name}</Text>
                      <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>{count} pwodwi</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      ) : view === "categoryDetail" && detailCat ? (
        <ScrollView
          style={{ flex: 1, width: "100%" }}
          contentContainerStyle={{ padding: 16, paddingHorizontal: padH, paddingBottom: 96, gap: 12, width: "100%" }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={e => setDetailTitleVisible(e.nativeEvent.contentOffset.y > detailIdentityBottom)}
        >
          {/* Identity: icon + name + created */}
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            onLayout={e => setDetailIdentityBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height - 73)}
          >
            <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: "#2b2b2b", borderWidth: 0.5, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }}>
              {(() => { const gi = categoryDisplayIcon(detailCat); return gi ? <Ionicons name={gi} size={30} color={"#fff"} /> : <Text style={{ fontSize: 26 }}>{detailCat.icon}</Text>; })()}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800", fontSize: 22, color: "#fff", letterSpacing: -0.4 }} numberOfLines={2}>{detailCat.name}</Text>
              <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>
                {detailCat.created_at && !isNaN(new Date(detailCat.created_at).getTime())
                  ? `Te kreye ${new Date(detailCat.created_at).toLocaleDateString()}`
                  : "Kategori"}
              </Text>
            </View>
          </View>
          {/* Linked categories */}
          <View style={{ gap: 10 }}>
            <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "800", letterSpacing: 1.2 }}>PARAN</Text>
            {catParents(detailCat.id).length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {catParents(detailCat.id).map(p => {
                  const gi = categoryDisplayIcon(p);
                  return (
                    <Pressable key={p.id} onPress={() => { setDetailCatId(p.id); setCat(p.id); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b" }}>
                      {gi ? <Ionicons name={gi} size={14} color={"#fff"} /> : <Text style={{ fontSize: 13 }}>{p.icon}</Text>}
                      <Text style={{ fontWeight: "600", fontSize: 12, color: "#fff" }}>{p.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={{ fontSize: 13, color: "#8e8e93" }}>Rasin (pa gen paran)</Text>
            )}
            <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "800", letterSpacing: 1.2, marginTop: 4 }}>PITIT</Text>
            {catChildren(detailCat.id).length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {catChildren(detailCat.id).map(ch => {
                  const gi = categoryDisplayIcon(ch);
                  return (
                    <Pressable key={ch.id} onPress={() => { setDetailCatId(ch.id); setCat(ch.id); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b" }}>
                      {gi ? <Ionicons name={gi} size={14} color={"#fff"} /> : <Text style={{ fontSize: 13 }}>{ch.icon}</Text>}
                      <Text style={{ fontWeight: "600", fontSize: 12, color: "#fff" }}>{ch.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={{ fontSize: 13, color: "#8e8e93" }}>Pa gen sou-kategori</Text>
            )}
          </View>
          {/* Stats: count + all-time revenue */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1, backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: radius.md, padding: 12 }}>
              <Text style={{ fontSize: 10, color: "#8e8e93", fontWeight: "800", letterSpacing: 0.6 }}>PWODWI</Text>
              <Text style={{ fontWeight: "900", fontSize: 20, color: "#fff", marginTop: 4 }}>{detailProducts.length}</Text>
              <Text style={{ fontSize: 10, color: "#8e8e93", marginTop: 2 }}>atik nan kategori sa</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: radius.md, padding: 12 }}>
              <Text style={{ fontSize: 10, color: "#8e8e93", fontWeight: "800", letterSpacing: 0.6 }}>REVNI TOTAL</Text>
              <Text style={{ fontWeight: "900", fontSize: 20, color: "#fff", marginTop: 4 }} numberOfLines={1}>{fmtG(Math.round(revenueByCat.get(detailCat.id) ?? 0))}</Text>
              <Text style={{ fontSize: 10, color: "#8e8e93", marginTop: 2 }}>tout tan · kategori sa sèlman</Text>
            </View>
          </View>
          {/* Products */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
            <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "800", letterSpacing: 1.2 }}>PWODWI ({detailProducts.length})</Text>
            {detailProducts.length > 0 ? (
              <Pressable onPress={() => setView("products")}><Text style={{ fontSize: 12, color: "#fff", fontWeight: "600" }}>Wè tout →</Text></Pressable>
            ) : null}
          </View>
          {detailProducts.length === 0 ? (
            <View style={{ backgroundColor: "#1C1C1E", borderWidth: 0.5, borderColor: "#2b2b2b", borderRadius: radius.md, padding: 24, alignItems: "center" }}>
              <Text style={{ color: "#8e8e93", fontWeight: "500", fontSize: 13 }}>Pa gen pwodwi nan kategori sa</Text>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              {detailProducts.map((item, index) => {
                const status = statusForProduct(item);
                const prodCats = getProductCategoriesDisplay(item.id);
                return (
                  <ProductCard
                    key={item.id}
                    item={item}
                    role={role}
                    prodCats={prodCats}
                    status={status}
                    recentMoves={[]}
                    displayPrice={displayPriceOf(item)}
                    unitName={defaultUnitOf(item.id)?.unit_name ?? item.unit ?? "pcs"}
                    isTablet={false}
                    canEdit={canEdit}
                    canViewCost={canViewCost}
                    canToggleAvail={canToggleAvail}
                    isFirst={index === 0}
                    isLast={index === detailProducts.length - 1}
                    stockItems={modelItems}
                    variants={v2.variants}
                    baseCost={getBaseCost(item.id)}
                    onPress={() => openProductDetail(item.id, "categoryDetail")}
                  />
                );
              })}
            </View>
          )}
        </ScrollView>
      ) : view === "productDetail" && detailProduct ? (
        <View style={{ flex: 1, width: "100%", backgroundColor: "#000" }}>
          <ProductDetail
            product={detailProduct}
            categories={categories}
            catIds={getProductCats(detailProduct.id)}
            v2={v2}
            supplierList={supplierList}
            displayPriceOf={displayPriceOf}
            getBaseCost={getBaseCost}
            getUnitCosts={getUnitCosts}
            canEdit={canEdit}
            canViewCost={canViewCost}
            canToggleAvail={canToggleAvail}
            onToggleAvail={toggleAvail}
            canDelete={canDelete}
            onManage={openManage}
            onOpenCategory={(cid) => { setDetailCatId(cid); setCat(cid); setView("categoryDetail"); }}
            onDeleteProduct={handleDeleteProduct}
            onDeleted={() => { load(); }}
            onChanged={() => { load(); }}
            onScrollY={y => setDetailTitleVisible(y > 80)}
          />
        </View>
      ) : showTablet ? (
        <CatalogTablet
          role={role} products={products} categories={categories}
          loading={loading}
          q={q} setQ={setQ} onOpenFilter={() => { setDraftStatusSel(statusSel); setShowFilter(true); }} filterOn={statusSel !== "active"} draftCount={draftCount} cat={cat} setCat={setCat}
          filtered={filtered}
          canEdit={canEdit} canAddMore={canAddMore} canReduce={canReduce} canDelete={canDelete} canViewCost={canViewCost} canToggleAvail={canToggleAvail} onToggleAvail={toggleAvail} displayPriceOf={displayPriceOf} defaultUnitOf={defaultUnitOf}
          getProductCats={getProductCats} getProductCategoriesDisplay={getProductCategoriesDisplay}
          infoProduct={infoProduct} setInfoProduct={setInfoProduct}
          tabletDetail={tabletDetail}
          showNameEdit={showNameEdit} setShowNameEdit={setShowNameEdit} nameInput={nameInput} setNameInput={setNameInput}
          handleChangeName={handleChangeName}
          v2={v2} supplierList={supplierList} getBaseCost={getBaseCost} getUnitCosts={getUnitCosts} onManageProduct={openManage}
          onOpenProduct={(id) => openProductDetail(id, "products")}
          onActivateProduct={activateProduct}
        />
      ) : (
        <CatalogPhone
          role={role} products={products} categories={categories}
          loading={loading}
          q={q} setQ={setQ} onOpenFilter={() => { setDraftStatusSel(statusSel); setShowFilter(true); }} filterOn={statusSel !== "active"} draftCount={draftCount} cat={cat} setCat={setCat}
          filtered={filtered}
          canEdit={canEdit}
          canViewCost={canViewCost} canToggleAvail={canToggleAvail}
          displayPriceOf={displayPriceOf} defaultUnitOf={defaultUnitOf}
          getProductCats={getProductCats} getProductCategoriesDisplay={getProductCategoriesDisplay}
          v2={v2} getBaseCost={getBaseCost}
          onOpenProduct={(id) => openProductDetail(id, "products")}
          onActivateProduct={activateProduct}
        />
      )}







      {/* Status filter (Transactions style, single-select): Aktif / Brouyon */}
      <Modal visible={showFilter} transparent animationType="slide" onRequestClose={() => setShowFilter(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowFilter(false)} />
          <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "#1c1c1e", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 32 + insets.bottom, maxHeight: "85%" }}>
            <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Text style={{ fontSize: 26, fontWeight: "800", color: "#fff" }}>Filtre</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => setDraftStatusSel("active")}
                  style={{ paddingHorizontal: 20, paddingVertical: 13, borderRadius: 26, backgroundColor: "#2b2b2b" }}
                >
                  <Text style={{ fontWeight: "700", fontSize: 14, color: draftStatusSel !== "active" ? "#fff" : "#6e6e73" }}>Clear All</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setStatusSel(draftStatusSel); setShowFilter(false); }}
                  style={{ paddingHorizontal: 26, paddingVertical: 13, borderRadius: 26, backgroundColor: "#fff" }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>Apply</Text>
                </Pressable>
              </View>
            </View>
            {(["active", "draft"] as const).map(key => {
              const checked = draftStatusSel === key;
              const label = key === "active" ? "Aktif" : "Brouyon";
              const sub = key === "active" ? "Pwodwi anrejistre" : "Chenn poko fini";
              const count = key === "active" ? activeCount : draftCount;
              return (
                <Pressable
                  key={key}
                  onPress={() => setDraftStatusSel(key)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 10 }}
                >
                  <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: checked ? "#fff" : "#6e6e73", backgroundColor: checked ? "#fff" : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {checked ? <Ionicons name="checkmark" size={16} color="#000" /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>{label}</Text>
                    <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 1 }}>{sub}</Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: "800", color: checked ? "#fff" : "#6e6e73" }}>{count}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* Flow choice: one product (chain) vs many (bulk setup) */}
      <Modal visible={showFlowChoice} transparent animationType="fade" onRequestClose={() => setShowFlowChoice(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowFlowChoice(false)} />
          <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "#1c1c1e", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 32 + insets.bottom }}>
            <View style={{ width: 36, height: 4, backgroundColor: "#3a3a3c", borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
            <Text style={{ fontSize: 20, fontWeight: "800", color: "#fff", marginBottom: 12 }}>Nouvo pwodwi</Text>
            <Pressable
              onPress={() => { setShowFlowChoice(false); setFlowProductId(null); setFlowSection(null); setShowFlow(true); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 14, padding: 14, marginBottom: 10 }}
            >
              <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="cube-outline" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }}>Ajoute yon pwodwi</Text>
                <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 1 }}>Pwodwi + batch + pri nan yon sèl fwa</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => { setShowFlowChoice(false); setShowBulk(true); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 14, padding: 14 }}
            >
              <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="layers-outline" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }}>Ajoute plizyè pwodwi</Text>
                <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 1 }}>Plizyè pwodwi yon sèl kou (batch/pri apre)</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </Modal>

      <BulkProductFlowModal
        visible={showBulk}
        onClose={() => setShowBulk(false)}
        onDone={() => { load(); }}
        ctx={{ role, currentUser, categories, reload: () => { load(); } }}
      />

      {/* Catalog five-step flow: create chain + manage existing */}
      <CatalogFlowModal
        visible={showFlow}
        onClose={() => { setShowFlow(false); setFlowProductId(null); setFlowSection(null); }}
        onDone={() => { load(); }}
        categories={categories}
        role={role}
        currentUser={currentUser}
        initialProductId={flowProductId}
        initialSection={flowSection}
      />


      {/* Pri mankan — backfill variants checkout hides (grouped by product) */}
      <MissingPricesSheet
        visible={showMissing}
        onClose={() => setShowMissing(false)}
        rows={missingPrices}
        onSaved={() => { setShowMissing(false); load(); }}
      />

      {/* Nouvo kategori — reusable full-screen black modal (chain up to 10).
          Same modal doubles as the existing-category editor from details. */}
      <CategoryFormModal
        visible={showAddCategory || showEditCat}
        onClose={() => { setShowAddCategory(false); setShowEditCat(false); }}
        onSaved={(ids) => {
          load();
          if (showEditCat) { if (ids[0]) { setDetailCatId(ids[0]); setCat(ids[0]); } }
          else if (ids[0]) setCat(ids[0]);
        }}
        categories={categories}
        editCategory={showEditCat ? detailCat : null}
        editParentIds={showEditCat && detailCat ? catParents(detailCat.id).map(c => c.id) : []}
        allLinks={links}
      />
    </View>
  );
}

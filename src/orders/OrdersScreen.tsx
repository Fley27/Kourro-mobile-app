// Assisted ordering — the Orders tab: the floor's board of open tables /
// customer orders. This screen owns the whole order flow (list, create,
// board, item picking) — checkout never runs in order mode anymore, so a
// cashier's sale is never covered by an open tab.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fmtG } from "../format";
import { PROD_DARK } from "../screens/POSShared";
import { getDb } from "../db";
import { useSalesEvents } from "../salesEvents";
import type { BusinessType, User } from "../users";
import {
  ORDER_STATUS_LABELS,
  type Actor,
  type Order,
} from "./types";
import { createOrder, listOrders, getOrderBundle } from "./store";
import { allLinesDelivered, canBill } from "./rules";
import { OrderBoard, orderCodeLabel } from "./OrderBoard";
import AddItemsModal from "./AddItemsModal";
import { buildOrderBill } from "./bill";
import ReceiptModal from "../components/ReceiptModal";
import type { ReceiptData } from "../receipts";
import { useOrderBundle } from "./useOrderBundle";
import { CustomerDetailBody, CustomerProfileBody, TxnDetailBody } from "../screens/cartViews";
import { attachLineLabels } from "../receipts";
import { palette } from "../theme";
import { GlobalUploadTransition, uploadError } from "../components/UploadTransition";
import { SkeletonOrderCard } from "../components/Skeleton";
import { ordersUI } from "../ordersUI";
import { notifUI, type NotifRoute } from "../notifRoute";
import { SafeScreen } from "../components/SafeScreen";
import { KeyboardSafeView } from "../components/KeyboardSafe";
import { KeyboardSafeScrollView } from "../components/KeyboardSafe";
import { useResponsive } from "../responsive";

export default function OrdersScreen({
  storeId,
  deviceId,
  storeName = "Pétion-Ville",
  role,
  currentUser,
  businessType = "retail",
  canSell = true,
  reloadKey = 0,
}: {
  storeId: string;
  deviceId: string;
  storeName?: string;
  role?: string;
  currentUser?: User | null;
  businessType?: BusinessType;
  canSell?: boolean;
  reloadKey?: number;
}) {
  const actor: Actor = {
    id: currentUser?.id ?? null,
    name: currentUser?.name ?? "",
    role: role ?? currentUser?.role ?? "",
  };
  const hospitality = businessType !== "retail";
  const { width, isTablet } = useResponsive();
  const paneW = Math.min(430, Math.max(330, Math.round(width * 0.36)));

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // Board (line actions + settlement) opened straight from a card.
  const [boardOrderId, setBoardOrderId] = useState<string | null>(null);
  // In-screen "Mete atik" picker staged for one order (opened from the
  // board's gold bar or right after creating a new order).
  const [pickerOrderId, setPickerOrderId] = useState<string | null>(null);
  const [billReceipts, setBillReceipts] = useState<{ customer: ReceiptData; store: ReceiptData } | null>(null);
  const [showBill, setShowBill] = useState(false);
  // Orders whose live lines are all delivered — the card-level half of the
  // shared Fakti gate (rules.canBill), filled by one grouped read in reload().
  const [billIds, setBillIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const reload = useCallback(async () => {
    const rows = await listOrders(storeId);
    setOrders(rows);
    // Keep the root OrdersFab badge in sync (not-yet-paid = the list itself).
    ordersUI.setCount(rows.length);
    // One grouped read over just these orders' lines so cards can apply the
    // same "all delivered" Fakti rule as the board without N bundle loads.
    try {
      const ids = rows.map(o => o.id);
      if (!ids.length) {
        setBillIds(new Set());
      } else {
        const db = await getDb();
        const ph = ids.map(() => "?").join(",");
        const agg = (await db.getAllAsync(
          `SELECT order_id, SUM(CASE WHEN status IN ('waiting','progress') THEN 1 ELSE 0 END) AS stuck, SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END) AS active FROM open_order_lines WHERE order_id IN (${ph}) AND (is_deleted = 0 OR is_deleted IS NULL) GROUP BY order_id`,
          ids,
        ).catch(() => [])) as { order_id: string; stuck: number; active: number }[];
        setBillIds(new Set(
          agg.filter(r => Number(r.active) > 0 && Number(r.stuck) === 0).map(r => String(r.order_id)),
        ));
      }
    } catch {
      setBillIds(new Set());
    }
    setLoading(false);
  }, [storeId]);

  React.useEffect(() => { reload(); }, [reload, reloadKey]);
  // Live: reload whenever a pull lands (another register opened/billed an
  // order) or a local change commits.
  useSalesEvents(() => { reload().catch(() => {}); });

  const { bundle: boardBundle, reload: reloadBoard } = useOrderBundle(boardOrderId);
  // The picker's order: prefer the live board bundle when both target the
  // same order, else fall back to the list (still fresh after onCreated).
  const pickerOrder = (pickerOrderId && pickerOrderId === boardOrderId && boardBundle) ? boardBundle.order : orders.find(o => o.id === pickerOrderId) ?? null;

  // The Mete atik overlay only exists inside the board window — closing the
  // board closes both (they can't be shown independently).
  const closeBoard = useCallback(() => {
    setBoardOrderId(null);
    setPickerOrderId(null);
  }, []);

  // --- Notification deep-link (src/notifRoute.ts) ---
  // "Ready to pay" pings name their order. The board reads off
  // `boardOrderId` alone — no waiting on the list reload — so the tapped
  // order is on screen as soon as this screen is.
  const notifHandler = useRef<(r: NotifRoute) => boolean>(() => false);
  useEffect(() => {
    notifHandler.current = (r) => {
      if (r.screen === "order") { setBoardOrderId(r.id); return true; }
      return false;
    };
  });
  useEffect(() => notifUI.register(r => notifHandler.current(r)), []);

  // Quick print from an order card: load a fresh bundle, build the synthetic
  // Fakti (pure — no DB writes, no settle), open the receipt modal in bill mode.
  const printBill = useCallback(async (o: Order) => {
    try {
      const b = await getOrderBundle(o.id);
      if (!b) { uploadError("Pa jwenn", "Kòmand sa a pa egziste ankò."); return; }
      // Same rule as the button that opened us — re-checked against fresh
      // lines so a just-added round can never slip a premature bill out.
      if (!canBill(b.order, allLinesDelivered(b.lines), actor)) {
        uploadError("Fakti pa disponib", "Tout atik dwe livre anvan ou ka printe fakti a.");
        return;
      }
      setBillReceipts(buildOrderBill({ order: b.order, lines: b.lines, storeName }));
      setShowBill(true);
    } catch (e: any) {
      uploadError("Pa posib", e?.message ?? "Erè pandan lèn fakti a.");
    }
  }, [storeName, actor.role, actor.id, actor.name]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const openCount = orders.filter(o => o.status === "open").length;
  const readyCount = orders.filter(o => o.status === "ready").length;
  const settling = orders.filter(o => o.status === "settling");
  // Search by tab number or customer name (also matches phone + full code label).
  const query = search.trim().toLowerCase();
  const filtered = !query ? orders : orders.filter(o =>
    String(o.table_no ?? "").toLowerCase().includes(query)
    || String(o.customer_name ?? "").toLowerCase().includes(query)
    || String(o.customer_phone ?? "").toLowerCase().includes(query)
    || orderCodeLabel(o).toLowerCase().includes(query)
  );

  const boardView = (
    <>
          {!boardBundle ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color="#2f80ed" />
            </View>
          ) : (
            <>
              {/* While the Mete atik overlay is up, the board is unmounted —
                  nothing of the ordered list can peek behind it. */}
              {!pickerOrder ? (
                <>
              {/* Board header: back • Tab + status • close */}
              <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#1c1c1f" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Pressable onPress={closeBoard} style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#1E1E22", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.7 }]}>
                    <Ionicons name="chevron-back" size={22} color="#fff" />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: -0.5 }}>{orderCodeLabel(boardBundle.order)}</Text>
                      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: boardBundle.order.status === "open" ? "rgba(74,222,128,0.12)" : boardBundle.order.status === "ready" ? "rgba(251,191,36,0.14)" : "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: boardBundle.order.status === "open" ? "rgba(74,222,128,0.45)" : boardBundle.order.status === "ready" ? "rgba(251,191,36,0.45)" : PROD_DARK.hair }}>
                        <Text style={{ color: boardBundle.order.status === "open" ? "#4ade80" : boardBundle.order.status === "ready" ? "#FBBF24" : "#fff", fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 0.8 }}>
                          {ORDER_STATUS_LABELS[boardBundle.order.status].toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 3 }} numberOfLines={1}>
                      <Text style={{ color: "#fff", fontFamily: "Inter_700Bold" }}>{boardBundle.order.created_by_name ?? "—"}</Text>
                    </Text>
                  </View>
                  <Pressable onPress={closeBoard} style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#1E1E22", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.7 }]}>
                    <Ionicons name="close" size={22} color="#fff" />
                  </Pressable>
                </View>
              </View>
              <OrderBoard
                order={boardBundle.order}
                lines={boardBundle.lines}
                requests={boardBundle.requests}
                actor={actor}
                canSell={canSell}
                storeId={storeId}
                deviceId={deviceId}
                storeName={storeName}
                showHeader={false}
                onChanged={() => { reloadBoard(); reload(); }}
                onAddItems={() => { if (boardOrderId) setPickerOrderId(boardOrderId); }}
              />
                </>
              ) : null}
              {/* Mete atik: staged round → addRound → uploadSuccess (no shift
                  /tender gate). An overlay INSIDE this modal window — a
                  sibling top-level Modal would mount under the board on iOS. */}
              {boardBundle && pickerOrder ? (
                <AddItemsModal
                  order={pickerOrder}
                  actor={actor}
                  onClose={() => setPickerOrderId(null)}
                  onAdded={() => { reloadBoard(); reload(); }}
                />
              ) : null}
            </>
          )}
          {/* In-window upload overlay — the app-root Modal version would
              present UNDER this board Modal on iOS. */}
          <GlobalUploadTransition overlay />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000", flexDirection: isTablet ? "row" : "column" }}>
      <View style={{ width: isTablet ? paneW : undefined, flex: isTablet ? undefined : 1, borderRightWidth: isTablet ? 1 : 0, borderRightColor: "#1c1c1f" }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View>
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 24, letterSpacing: -0.6 }}>Kòmand</Text>
            <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
              {openCount} louvri{readyCount ? ` • ${readyCount} pare pou peye` : ""}{settling.length ? ` • ${settling.length} ap peye` : ""}
            </Text>
          </View>
          {/* Only Associate/Server takes orders — everyone else never sees
              the create button (order creation is an associate job). */}
          {actor.role === "associate" ? (
            <Pressable
              // Orders never touch money — creating one needs no open shift.
              // The shift gate lives on settlement (OrderBoard pay), not here.
              onPress={() => setShowCreate(true)}
              style={({ pressed }) => [{
                width: 56, height: 56, borderRadius: 28, backgroundColor: "#2b2b2b",
                alignItems: "center", justifyContent: "center",
              }, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="add" size={26} color="#fff" />
            </Pressable>
          ) : null}
        </View>
        {/* Search bar — same pill shape as the customer picker's search. */}
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12 }}>
          <View style={{ flex: 1, height: 60, flexDirection: "row", alignItems: "center", backgroundColor: "#000", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 30, paddingHorizontal: 16 }}>
            <Ionicons name="search" size={18} color="#8e8e93" style={{ marginRight: 10 }} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Chèche tab oswa kliyan"
              placeholderTextColor="#8e8e93"
              style={{ flex: 1, fontSize: 15, color: "#fff", paddingVertical: 8 }}
              returnKeyType="search"
            />
            {search.length > 0 ? (
              <Pressable onPress={() => setSearch("")} hitSlop={8} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={18} color="#8e8e93" />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, padding: 16, paddingTop: 0 }}>
          <SkeletonOrderCard />
          <SkeletonOrderCard />
          <SkeletonOrderCard />
          <SkeletonOrderCard />
        </View>
      ) : (
        <KeyboardSafeScrollView
          contentContainerStyle={{ padding: 16, paddingTop: 0, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2f80ed" />}
        >
          {orders.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 64, paddingHorizontal: 24 }}>
              <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: "rgba(47,128,237,0.12)", borderWidth: 1, borderColor: "rgba(47,128,237,0.3)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="reader-outline" size={28} color="#2f80ed" />
              </View>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16, marginTop: 14, textAlign: "center" }}>Poko gen kòmand</Text>
              <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 6, textAlign: "center", lineHeight: 19 }}>
                {hospitality
                  ? "Kreye yon kòmand pou yon tab, lè sa a mete manje yo pandan plizyè wonn."
                  : "Kreye yon kòmand pou yon kliyan pou ou ka mete atik yo pandan plizyè vizit."}
              </Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 56, paddingHorizontal: 24 }}>
              <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: PROD_DARK.hair, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="search-outline" size={28} color={PROD_DARK.muted} />
              </View>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16, marginTop: 14, textAlign: "center" }}>Pa jwenn kòmand</Text>
              <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 6, textAlign: "center" }}>Eseye yon lòt rechèch</Text>
            </View>
          ) : (
            filtered.map(o => (
              <OrderCard
                key={o.id}
                order={o}
                billable={canBill(o, billIds.has(o.id), actor)}
                onOpen={() => setBoardOrderId(o.id)}
                onPrint={() => printBill(o)}
              />
            ))
          )}
        </KeyboardSafeScrollView>
      )}
      </View>
      {isTablet ? (
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {boardOrderId ? boardView : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
              <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: "rgba(47,128,237,0.12)", borderWidth: 1, borderColor: "rgba(47,128,237,0.3)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="reader-outline" size={28} color="#2f80ed" />
              </View>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16, marginTop: 14, textAlign: "center" }}>Chwazi yon kòmand</Text>
              <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 6, textAlign: "center", lineHeight: 19 }}>Tape yon kòmand nan lis la pou wè detay li isit la.</Text>
            </View>
          )}
        </View>
      ) : null}

      <Modal visible={!isTablet && !!boardOrderId} animationType="slide" onRequestClose={closeBoard}>
        <SafeScreen style={{ flex: 1, backgroundColor: "#000" }}>
          {boardView}
        </SafeScreen>
      </Modal>

      <CreateOrderSheet
        visible={showCreate}
        hospitality={hospitality}
        actor={actor}
        deviceId={deviceId}
        storeId={storeId}
        onClose={() => setShowCreate(false)}
        onCreated={(o) => { setShowCreate(false); setBoardOrderId(o.id); setPickerOrderId(o.id); }}
      />

      {/* Card quick print — same synthetic Fakti as the board's button. */}
      <ReceiptModal
        visible={showBill}
        receipts={billReceipts}
        onClose={() => { setShowBill(false); setBillReceipts(null); }}
      />
    </View>
  );
}

function OrderCard({ order, billable, onOpen, onPrint }: { order: Order; billable: boolean; onOpen: () => void; onPrint: () => void }) {
  const settle = order.status === "settling";
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [{
        backgroundColor: PROD_DARK.card, borderRadius: 16, borderWidth: 1,
        borderColor: settle ? "rgba(47,128,237,0.5)" : PROD_DARK.hair,
        padding: 14, marginBottom: 10,
      }, pressed && { opacity: 0.82 }]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: "rgba(200,162,74,0.14)", borderWidth: 1, borderColor: "rgba(200,162,74,0.35)", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={order.code_kind === "table" ? "grid-outline" : "person-outline"} size={19} color="#C8A24A" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>{orderCodeLabel(order)}</Text>
          <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 }}>
            {order.line_count} liy • pa {order.created_by_name ?? "—"}
          </Text>
        </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <Text style={{ color: "#4ade80", fontFamily: "Inter_700Bold", fontSize: 14 }}>{fmtG(order.delivered_total)}</Text>
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: settle ? "rgba(47,128,237,0.14)" : order.status === "ready" ? "rgba(251,191,36,0.14)" : "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: settle ? "rgba(47,128,237,0.5)" : order.status === "ready" ? "rgba(251,191,36,0.45)" : PROD_DARK.hair }}>
              <Text style={{ color: settle ? "#60a5fa" : order.status === "ready" ? "#FBBF24" : "#fff", fontFamily: "Inter_700Bold", fontSize: 10 }}>{ORDER_STATUS_LABELS[order.status]}</Text>
            </View>
          </View>
        {/* Fakti quick print — same gates as the board button (canBill):
            all delivered + payment-ready, never for Associate/Server. */}
        {billable ? (
          <Pressable
            onPress={onPrint}
            hitSlop={8}
            style={({ pressed }) => [{ width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(200,162,74,0.14)", borderWidth: 1, borderColor: "rgba(200,162,74,0.35)", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="receipt-outline" size={16} color="#C8A24A" />
          </Pressable>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={PROD_DARK.muted} />
      </View>
    </Pressable>
  );
}

type CustomerOption = { id: string; name: string; phone: string | null };
// One focused view at a time, same stack as checkout's cart customer flow.
type SheetView = "form" | "picker" | "profile" | "full" | "txn";
type CustStats = { visits: number; spent: number; lastVisit: string | null; firstVisit: string | null };

function CreateOrderSheet({
  visible, hospitality, actor, deviceId, storeId, onClose, onCreated,
}: {
  visible: boolean;
  hospitality: boolean;
  actor: Actor;
  deviceId: string;
  storeId: string;
  onClose: () => void;
  onCreated: (order: Order) => void;
}) {
  const [tableNo, setTableNo] = useState("");
  const [busy, setBusy] = useState(false);
  // Cartview-style customer flow: form → searchable list → short profile.
  const [view, setView] = useState<SheetView>("form");
  const [custSearch, setCustSearch] = useState("");
  const [picked, setPicked] = useState<CustomerOption | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  // Short-profile data for the picked customer (loads on row tap).
  const [profCustomer, setProfCustomer] = useState<any>(null);
  const [profStats, setProfStats] = useState<CustStats>({ visits: 0, spent: 0, lastVisit: null, firstVisit: null });
  const [profNotes, setProfNotes] = useState<any[]>([]);
  const [profTxns, setProfTxns] = useState<any[]>([]);
  const [lastVisitItems, setLastVisitItems] = useState<any[]>([]);
  const [profLoading, setProfLoading] = useState(false);
  const [txnDetail, setTxnDetail] = useState<{ sale: any; items: any[]; payments?: any[] } | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    getDb()
      .then(db => db.getAllAsync("SELECT id, name, phone FROM customers WHERE (is_deleted = 0 OR is_deleted IS NULL) ORDER BY name LIMIT 100"))
      .then(rows => { if (alive) setCustomers((rows ?? []) as CustomerOption[]); })
      .catch(() => {});
    return () => { alive = false; };
  }, [visible]);

  const query = custSearch.trim().toLowerCase();
  const matches = customers.filter(c =>
    !query || c.name.toLowerCase().includes(query) || String(c.phone ?? "").toLowerCase().includes(query)
  );

  // Short profile for the picked customer — same data checkout loads in
  // openCustomerDetail (POSScreen): stats, last visit items, notes, txns.
  async function openProfile(c: CustomerOption) {
    setView("profile");
    setProfLoading(true);
    setProfCustomer(c);
    setProfStats({ visits: 0, spent: 0, lastVisit: null, firstVisit: null });
    setProfNotes([]); setProfTxns([]); setLastVisitItems([]);
    try {
      const db = await getDb();
      const row = ((await db.getAllAsync("SELECT * FROM customers WHERE id = ?", [c.id]).catch(() => [])) as any[]) ?? [];
      if (row[0]) setProfCustomer(row[0]);
      const sales = ((await db.getAllAsync("SELECT * FROM sales WHERE customer_id = ?", [c.id]).catch(() => [])) as any[]) ?? [];
      const done = sales.filter((s: any) => String(s.status ?? "") !== "cancelled");
      const spent = done.reduce((s: number, x: any) => s + Number(x.total ?? 0), 0);
      const dates = done.map((s: any) => String(s.created_at ?? "")).filter(Boolean).sort();
      const lastVisit = dates.pop() ?? null;
      const firstVisit = dates.length ? dates[0] : lastVisit;
      setProfStats({ visits: done.length, spent, lastVisit, firstVisit });
      const sorted = [...done].sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
      setProfTxns(sorted.slice(0, 20));
      const latest = sorted[0];
      if (latest) {
        const items = ((await db.getAllAsync("SELECT * FROM sale_items WHERE sale_id = ?", [latest.id]).catch(() => [])) as any[]) ?? [];
        await attachLineLabels(db, items).catch(() => {});
        setLastVisitItems(items);
      } else setLastVisitItems([]);
      const notes = ((await db.getAllAsync("SELECT * FROM customer_notes WHERE customer_id = ?", [c.id]).catch(() => [])) as any[]) ?? [];
      setProfNotes(notes.sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))));
    } catch {}
    setProfLoading(false);
  }

  async function openTxn(sale: any) {
    if (!sale) return;
    try {
      const db = await getDb();
      const items = ((await db.getAllAsync("SELECT * FROM sale_items WHERE sale_id = ?", [sale.id]).catch(() => [])) as any[]) ?? [];
      await attachLineLabels(db, items).catch(() => {});
      const credits = ((await db.getAllAsync("SELECT * FROM credits WHERE sale_id = ?", [sale.id]).catch(() => [])) as any[]) ?? [];
      const credit = credits[0] ?? null;
      let payments: any[] = [];
      if (credit) {
        payments = ((await db.getAllAsync("SELECT * FROM credit_payments WHERE credit_id = ? OR debt_id = ? ORDER BY created_at DESC", [credit.id, credit.id]).catch(() => [])) as any[]) ?? [];
      }
      setTxnDetail({ sale, items, payments });
    } catch {
      setTxnDetail({ sale, items: [], payments: [] });
    }
    setView("txn");
  }

  function detachCustomer() {
    setPicked(null);
    setView("form");
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await createOrder({
        storeId,
        mode: hospitality ? "restaurant" : "retail",
        codeKind: "table",
        tableNo,
        customerName: picked?.name ?? null,
        customerPhone: picked?.phone ?? null,
        customerId: picked?.id ?? null,
        actor, deviceId,
      });
      if (!res.ok) {
        if (res.existing) {
          Alert.alert("Gen kòmand deja", res.error, [
            { text: "Fèmen", style: "cancel" },
            { text: "Louvri l", onPress: () => { onClose(); onCreated(res.existing!); } },
          ]);
        } else uploadError("Pa posib", res.error);
        return;
      }
      setTableNo(""); setPicked(null); setCustSearch(""); setView("form");
      onCreated(res.order);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = tableNo.trim().length > 0;
  // "<" walks the view stack back, then closes the modal.
  const goBack = () => {
    if (view === "txn") setView("full");
    else if (view === "full") setView("profile");
    else if (view === "profile" || view === "picker") setView("form");
    else onClose();
  };
  const title =
    view === "picker" || view === "profile" ? "Kliyan"
    : view === "full" ? "Profil"
    : view === "txn" ? "Fakti"
    : "Nouvo Kòmand";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={goBack}>
      <KeyboardSafeView>
      <SafeScreen style={{ flex: 1, backgroundColor: "#000" }}>
        {/* Header: back top-left, title dead-center, Kreye top-right. */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
          <Pressable onPress={goBack} hitSlop={10} style={({ pressed }) => [{ padding: 6, borderRadius: 999 }, pressed && { opacity: 0.6 }]}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, alignItems: "center" }}>
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 17 }}>{title}</Text>
          </View>
          {view === "form" ? (
            <Pressable
              onPress={submit}
              disabled={!canSubmit || busy}
              style={({ pressed }) => [{
                paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
                // Secondary pill: black fill, reads against the modal by border+opacity.
                backgroundColor: "#000",
                borderWidth: 1,
                borderColor: "#3a3a3c",
                opacity: !canSubmit || busy ? 0.45 : pressed ? 0.7 : 1,
              }]}
            >
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 }}>{busy ? "Kreye…" : "Kreye"}</Text>
            </Pressable>
          ) : (
            <View style={{ width: 64 }} />
          )}
        </View>

        {view === "form" ? (
          <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 }}>
            <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_600SemiBold", fontSize: 12, marginBottom: 6 }}>Nimewo Tab *</Text>
            <TextInput
              value={tableNo}
              onChangeText={setTableNo}
              placeholder="Nimewo Tab - 6"
              placeholderTextColor="#5a5a5f"
              autoCapitalize="none"
              style={inputStyle}
            />

            <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_600SemiBold", fontSize: 12, marginTop: 22, marginBottom: 6 }}>Kliyan (si w vle)</Text>
            {/* Identical to checkout's cart customer rows (POSScreen 1749-1761). */}
            <Pressable
              onPress={() => { if (picked) openProfile(picked); else { setView("picker"); setCustSearch(""); } }}
              style={({ pressed }) => [{
                flexDirection: "row", alignItems: "center", gap: 10, height: 60,
                paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23",
                borderWidth: 1, borderColor: "#3a3a3c",
              }, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name={picked ? "person-outline" : "person-add-outline"} size={17} color="#fff" />
              <Text style={{ flex: 1, color: "#fff", fontWeight: "800", fontSize: 13 }} numberOfLines={1}>
                {picked ? picked.name : "Add Customer"}
              </Text>
              <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>
        ) : view === "picker" ? (
          <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}>
            {/* Cartview-style pill search */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1, height: 52, flexDirection: "row", alignItems: "center", backgroundColor: "#000", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16 }}>
                <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
                <TextInput
                  value={custSearch}
                  onChangeText={setCustSearch}
                  placeholder="Chèche"
                  placeholderTextColor="#8e8e93"
                  style={{ flex: 1, fontSize: 16, color: "#fff", paddingVertical: 10 }}
                  returnKeyType="search"
                />
                {custSearch.length > 0 ? (
                  <Pressable onPress={() => setCustSearch("")} hitSlop={8} style={{ padding: 4 }}>
                    <Ionicons name="close-circle" size={18} color="#8e8e93" />
                  </Pressable>
                ) : null}
              </View>
            </View>

            {picked ? (
              <Pressable
                onPress={() => detachCustomer()}
                style={({ pressed }) => [{
                  flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, height: 60,
                  paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2E2A23",
                  borderWidth: 1, borderColor: "#3a3a3c",
                }, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="person-remove-outline" size={17} color="#fff" />
                <Text style={{ flex: 1, color: "#fff", fontWeight: "800", fontSize: 13 }}>Retire kliyan an</Text>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
              </Pressable>
            ) : null}

            <KeyboardSafeScrollView
              style={{ flex: 1, marginTop: 12 }}
              contentContainerStyle={{ paddingBottom: 12 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {matches.length === 0 ? (
                <View style={{ paddingVertical: 32, alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 }}>Pa jwenn kliyan</Text>
                  <Text style={{ color: "#8e8e93", fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 4 }}>Eseye yon lòt rechèch</Text>
                </View>
              ) : matches.map(c => (
                <Pressable
                  key={c.id}
                  // Tapping a row selects it and returns to the form.
                  onPress={() => { setPicked(c); setCustSearch(""); setView("form"); }}
                  style={({ pressed }) => [{
                    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 8,
                    borderRadius: 12,
                  }, pressed && { opacity: 0.8 }]}
                >
                  <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 }}>{(c.name?.[0] ?? "•").toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 }}>{c.name}</Text>
                    {c.phone ? (
                      <Text numberOfLines={1} style={{ color: "#8e8e93", fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 }}>{c.phone}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
                </Pressable>
              ))}
            </KeyboardSafeScrollView>
          </View>
        ) : view === "profile" ? (
          profLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color="#2f80ed" />
            </View>
          ) : (
            <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 }}>
              <KeyboardSafeScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                <CustomerDetailBody
                  customer={profCustomer}
                  stats={profStats}
                  notes={profNotes}
                  onViewProfile={() => setView("full")}
                  onRemove={detachCustomer}
                  hideActions
                  lastVisitItems={lastVisitItems}
                  lastVisitDate={profStats.lastVisit}
                />
              </KeyboardSafeScrollView>
              {/* Same footer as checkout's cart detail (POSScreen 1822-1829). */}
              <View style={{ gap: 10, paddingTop: 10, paddingBottom: 4 }}>
                <Pressable onPress={() => setView("full")} style={{ height: 60, borderRadius: 12, backgroundColor: "#16130c", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "white", fontWeight: "800", fontSize: 14 }}>View Full Profile</Text>
                </Pressable>
                <Pressable onPress={detachCustomer} style={{ height: 60, borderRadius: 12, backgroundColor: palette.dangerBg, borderWidth: 1, borderColor: palette.dangerBd, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: palette.danger, fontWeight: "800", fontSize: 14 }}>Remove From Sale</Text>
                </Pressable>
              </View>
            </View>
          )
        ) : view === "full" ? (
          <KeyboardSafeScrollView style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            <CustomerProfileBody
              customer={profCustomer}
              stats={profStats}
              notes={profNotes}
              transactions={profTxns}
              onOpenTransaction={openTxn}
            />
          </KeyboardSafeScrollView>
        ) : txnDetail ? (
          <KeyboardSafeScrollView style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            <TxnDetailBody
              sale={txnDetail.sale}
              items={txnDetail.items}
              customer={profCustomer}
              payments={txnDetail.payments ?? []}
            />
          </KeyboardSafeScrollView>
        ) : null}
      </SafeScreen>
    
      </KeyboardSafeView>
    </Modal>
  );
}

const inputStyle = {
  backgroundColor: "#17171a",
  borderWidth: 1,
  borderColor: PROD_DARK.hair,
  borderRadius: 12,
  color: "#fff",
  paddingHorizontal: 14,
  paddingVertical: 12,
  fontFamily: "Inter_600SemiBold",
  fontSize: 16,
} as const;

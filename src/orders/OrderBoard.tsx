// Assisted ordering — the line board: every open line, its status, and the
// only actions the lock rules allow for the signed-in actor. Used full-screen
// from the Orders tab and as a sheet inside the POS order strip.
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResponsive, sheetBox } from "../responsive";
import { Ionicons } from "@expo/vector-icons";
import { fmtG, monoStyle } from "../format";
import { getDb } from "../db";
import { PROD_DARK } from "../screens/POSShared";
import {
  LINE_STATUS_COLOR,
  LINE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  type Actor,
  type ChangeRequest,
  type Order,
  type OrderLine,
} from "./types";
import {
  allLinesDelivered,
  canBill,
  canCancelLine,
  canDeliverLine,
  canDecideChange,
  canEditLine,
  canForceCancel,
  canRequestChange,
  canResolveAttention,
  canSettle,
  canStartLine,
  deliveredSubtotal,
  orderCodeLabel,
  pendingCount,
} from "./rules";
export { orderCodeLabel };
import * as store from "./store";
import { OrderPaySheet } from "./OrderPaySheet";
import { uploadError, uploadSuccess } from "../components/UploadTransition";
import type { SettleSuccess } from "./settlement";
import ReceiptModal from "../components/ReceiptModal";
import type { ReceiptData } from "../receipts";
import { buildOrderBill } from "./bill";
import { KeyboardSafeView } from "../components/KeyboardSafe";
import { KeyboardSafeScrollView } from "../components/KeyboardSafe";
import { FALLBACK_STORE_ID } from "../db/ids";

type Sheet =
  | { mode: "edit"; line: OrderLine }
  | { mode: "cancel"; line: OrderLine }
  | { mode: "change"; line: OrderLine }
  | { mode: "override"; line: OrderLine }
  | { mode: "decide"; line: OrderLine; request: ChangeRequest; accept: boolean };

const SHEET_TITLE: Record<Exclude<Sheet, null>["mode"], string> = {
  edit: "Korekte kantite",
  cancel: "Anile liy sa a",
  change: "Mande yon chanjman",
  override: "Fòse anile (manadjè)",
  decide: "Repond demann lan",
};

type MenuIcon = React.ComponentProps<typeof Ionicons>["name"];
type MenuItem = { label: string; icon: MenuIcon; color: string; onPress: () => void };

export function OrderBoard({
  order,
  lines,
  requests = [],
  actor,
  onChanged,
  showHeader = true,
  headerRight,
  storeId = FALLBACK_STORE_ID,
  deviceId = "web",
  storeName = "Pétion-Ville",
  canSell = true,
  onAddItems,
}: {
  order: Order;
  lines: OrderLine[];
  requests?: ChangeRequest[];
  actor: Actor;
  onChanged: () => void;
  showHeader?: boolean;
  headerRight?: React.ReactNode;
  storeId?: string;
  deviceId?: string;
  storeName?: string;
  canSell?: boolean;
  /** Opens the in-Orders "Mete atik" picker (the gold bar button). */
  onAddItems?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, isTablet } = useResponsive();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [menuLine, setMenuLine] = useState<OrderLine | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [receipts, setReceipts] = useState<{ customer: ReceiptData; store: ReceiptData } | null>(null);
  const [qtyText, setQtyText] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);

  const settle = useMemo(() => canSettle(order, lines), [order, lines]);
  const rounds = useMemo(() => {
    const byRound = new Map<number, OrderLine[]>();
    for (const l of lines) {
      const r = Number(l.round_no) || 1;
      if (!byRound.has(r)) byRound.set(r, []);
      byRound.get(r)!.push(l);
    }
    return Array.from(byRound.entries()).sort((a, b) => a[0] - b[0]);
  }, [lines]);

  // Board totals: the order's full value vs how much of it is out.
  const activeLines = useMemo(() => lines.filter(l => l.status !== "cancelled"), [lines]);
  const orderTotal = useMemo(() => activeLines.reduce((s, l) => s + Number(l.line_total ?? 0), 0), [activeLines]);
  const totalQty = useMemo(() => activeLines.reduce((s, l) => s + Number(l.qty ?? 0), 0), [activeLines]);
  const deliveredQty = useMemo(
    () => lines.filter(l => l.status === "delivered").reduce((s, l) => s + Number(l.qty ?? 0), 0),
    [lines],
  );

  const reqFor = (lineId: string) => requests.find(r => r.line_id === lineId && r.status === "pending") ?? null;

  // Synthetic Fakti over the current lines — pure, no DB writes. Reuses the
  // receipt modal (kind "order_bill" switches it to bill presentation).
  const billPair = useMemo(
    () => buildOrderBill({ order, lines, storeName }),
    [order, lines, storeName],
  );
  const openBill = () => {
    setReceipts(billPair);
    setShowReceipt(true);
  };

  // "Kòmanse Prepare" only applies to service products — goods skip prep and
  // go straight to Livre. Resolve product_id → item_type for the lines shown.
  const productKey = useMemo(
    () => Array.from(new Set(lines.map(l => l.product_id).filter(Boolean) as string[])).sort().join(","),
    [lines],
  );
  const [serviceIds, setServiceIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = productKey ? productKey.split(",") : [];
    if (!ids.length) { setServiceIds(new Set()); return; }
    let alive = true;
    getDb()
      .then(db => db.getAllAsync(`SELECT id FROM products WHERE item_type = 'service' AND id IN (${ids.map(() => "?").join(",")})`, ids))
      .then(rows => { if (alive) setServiceIds(new Set(((rows ?? []) as { id: string }[]).map(r => String(r.id)))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [productKey]);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      // Global upload overlay instead of a native Alert (OK button).
      if (!res.ok) uploadError("Pa posib", res.error ?? "Nou pa ka fè sa.");
      else if (okMsg) uploadSuccess(okMsg);
      onChanged();
    } finally {
      setBusy(false);
      setSheet(null);
      setMenuLine(null);
    }
  }

  function openSheet(mode: Sheet["mode"], line: OrderLine, extra?: object) {
    setMenuLine(null);
    setQtyText(String(line.qty));
    setReasonText("");
    setSheet({ mode, line, ...extra } as Sheet);
  }

  function submitSheet() {
    if (!sheet || busy) return;
    const { mode, line } = sheet as any;
    const qty = Number(qtyText.replace(",", "."));
    const reason = reasonText.trim();

    if (mode === "edit") {
      if (!Number.isFinite(qty) || qty <= 0) return uploadError("Kantite pa valab", "Mete yon kantite pi gran pase 0.");
      return run(() => store.editWaitingLine(line.id, { qty }, actor), "Liy lan korekte.");
    }
    if (mode === "cancel") {
      return run(() => store.cancelLine(line.id, actor, reason || undefined), "Liy lan anile.");
    }
    if (mode === "change") {
      if (!Number.isFinite(qty) || qty <= 0) return uploadError("Kantite pa valab", "Mete yon kantite pi gran pase 0.");
      return run(
        () => store.requestChange({ lineId: line.id, kind: "edit", payload: { qty }, reason: reason || null, actor }),
        "Demann lan voye — ap tann repons lòt bò.",
      );
    }
    if (mode === "override") {
      if (!reason) return uploadError("Rezon obligatwa", "Ou dwe ekri poukisa ou fòse anile liy sa a.");
      return run(() => store.forceCancelLine(line.id, actor, reason), "Liy la fòse anile.");
    }
    if (mode === "decide") {
      const req = (sheet as any).request as ChangeRequest;
      const accept = (sheet as any).accept as boolean;
      if (!accept && !reason) return uploadError("Rezon obligatwa", "Explike poukisa ou refize.");
      return run(
        () => store.decideChangeRequest(req.id, accept, actor, reason || undefined),
        accept ? "Chanjman an aksepte." : "Refize — liy lan retounen bay moun ki te kreye l.",
      );
    }
  }

  /** Every secondary action the rules allow for this line ("•••" menu). */
  function menuItemsFor(line: OrderLine): MenuItem[] {
    const items: MenuItem[] = [];
    if (canEditLine(order, line, actor)) {
      items.push({ label: "Korekte kantite", icon: "create-outline", color: "#93c5fd", onPress: () => openSheet("edit", line) });
    }
    if (canCancelLine(order, line, actor)) {
      items.push({ label: "Anile liy sa a", icon: "close-circle-outline", color: "#f87171", onPress: () => openSheet("cancel", line) });
    }
    if (canRequestChange(order, line, actor)) {
      items.push({ label: "Mande chanjman", icon: "swap-horizontal-outline", color: "#93c5fd", onPress: () => openSheet("change", line) });
    }
    if (canResolveAttention(order, line, actor)) {
      items.push({ label: "Relance", icon: "refresh-outline", color: "#FBBF24", onPress: () => run(() => store.resolveAttention(line.id, "resend", actor), "Relance.") });
      items.push({ label: "Anile liy (atansyon)", icon: "trash-outline", color: "#f87171", onPress: () => run(() => store.resolveAttention(line.id, "cancel", actor), "Liy lan anile.") });
    }
    // role/status half of the override gate — the reason is required at
    // submit time, so probing with a placeholder keeps one rule source.
    if (canForceCancel(order, line, actor, "x")) {
      items.push({ label: "Fòse anile (manadjè)", icon: "alert-circle-outline", color: "#f87171", onPress: () => openSheet("override", line) });
    }
    return items;
  }

  /** Deliver every line in the round the actor is allowed to deliver. */
  async function deliverRound(rows: OrderLine[]) {
    if (busy) return;
    const targets = rows.filter(l => canDeliverLine(order, l, actor));
    if (!targets.length) {
      uploadError("Pa posib", "Poko gen liy nan wonn sa a ki ka livre.");
      return;
    }
    setBusy(true);
    try {
      for (const l of targets) {
        const res = await store.deliverLine(l.id, actor);
        if (!res.ok) {
          uploadError("Pa posib", res.error ?? "Nou pa ka livre liy sa a.");
          break;
        }
      }
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  // Single amber status banner (mock: "Shift louvri — …"), split bold lead.
  // Ready orders show NO banner (removed by request — the area stays empty).
  const blocked = !canSell && order.status !== "closed";
  const banner = blocked
    ? order.status === "ready"
      ? null
      : { lead: "Vant bloke", rest: " — louvri shift pou peye kòmand sa a." }
    : order.status === "closed"
      ? { lead: "Kòmand lan", rest: " fèmen." }
      : order.status === "settling"
        ? { lead: "Kòmand lan", rest: " nan eta peye." }
        : settle.ok
          ? null // "Shift louvri — …" success banner removed by request
          : { lead: `${settle.stuck.length} liy`, rest: " pou fini anvan peye." };

  function Row({ line }: { line: OrderLine }) {
    const req = reqFor(line.id);
    const color = LINE_STATUS_COLOR[line.status];
    const canStart = canStartLine(order, line, actor);
    const canDeliver = canDeliverLine(order, line, actor);
    const canDecide = !!req && canDecideChange(order, line, actor);
    const dimmed = line.status === "cancelled";
    const statusLabel = LINE_STATUS_LABELS[line.status];
    const chipLabel = statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1);

    // One primary CTA per line. Prepare exists only for service products;
    // goods (and already-started lines) go straight to Livre.
    const isService = !!line.product_id && serviceIds.has(String(line.product_id));
    const primary: { label: string; icon: MenuIcon; color: string; onPress: () => void } | null =
      isService && canStart
        ? { label: "Kòmanse Prepare", icon: "play", color: "#FBBF24", onPress: () => run(() => store.startLine(line.id, actor), "Kòmanse.") }
        : canDeliver
          ? { label: "Livre", icon: "checkmark", color: "#4ade80", onPress: () => run(() => store.deliverLine(line.id, actor), "Livre.") }
          : null;
    const menuItems = menuItemsFor(line);
    const showActions = !!primary || menuItems.length > 0;

    const pill = (label: string, onPress: () => void, tone: "info" | "good" | "warn" | "bad" = "info") => (
      <Pressable
        key={label}
        onPress={onPress}
        disabled={busy}
        style={({ pressed }) => [{
          minHeight: 46, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999,
          alignItems: "center", justifyContent: "center",
          backgroundColor: tone === "good" ? "rgba(74,222,128,0.14)" : tone === "warn" ? "rgba(245,158,11,0.16)" : tone === "bad" ? "rgba(248,113,113,0.14)" : "rgba(59,130,246,0.16)",
          borderWidth: 1,
          borderColor: tone === "good" ? "rgba(74,222,128,0.4)" : tone === "warn" ? "rgba(245,158,11,0.45)" : tone === "bad" ? "rgba(248,113,113,0.4)" : "rgba(59,130,246,0.4)",
        }, pressed && { opacity: 0.75 }]}
      >
        <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>{label}</Text>
      </Pressable>
    );

    return (
      <View style={{ backgroundColor: PROD_DARK.card, borderRadius: 16, borderWidth: 1, borderColor: PROD_DARK.hair, padding: 14, marginBottom: 12, opacity: dimmed ? 0.62 : 1 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: "#F0B429", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#1a1200", fontFamily: "Inter_700Bold", fontSize: 16 }}>×{line.qty}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 17 }}>{line.name ?? "Atik"}</Text>
            <Text numberOfLines={1} style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 3 }}>
              {line.unit_name ?? "pcs"}{line.variant ? ` • ${line.variant}` : ""} • {fmtG(line.unit_price)}/u
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15, ...monoStyle }}>{fmtG(line.line_total)}</Text>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: color }}>
              <Text style={{ color, fontFamily: "Inter_700Bold", fontSize: 11 }}>{chipLabel}</Text>
            </View>
          </View>
        </View>

        {line.attention ? (
          <View style={{ marginTop: 10, backgroundColor: "rgba(245,158,11,0.12)", borderWidth: 1, borderColor: "rgba(245,158,11,0.4)", borderRadius: 10, padding: 8 }}>
            <Text style={{ color: "#FBBF24", fontFamily: "Inter_700Bold", fontSize: 11 }}>⚠ Bezwen atansyon — {line.attention_reason ?? ""}</Text>
          </View>
        ) : null}
        {line.cancel_reason && line.status === "cancelled" ? (
          <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 6 }}>
            Anile: {line.cancel_reason}{line.override ? " • (fòse pa manadjè)" : ""}
          </Text>
        ) : null}
        {req ? (
          <View style={{ marginTop: 10, backgroundColor: "rgba(59,130,246,0.10)", borderWidth: 1, borderColor: "rgba(59,130,246,0.35)", borderRadius: 10, padding: 8 }}>
            <Text style={{ color: "#93c5fd", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
              Demann: {req.kind === "edit" ? "korekte kantite" : "anile"} — {req.requested_by_name ?? ""} {req.reason ? `• ${req.reason}` : ""}
            </Text>
            {canDecide ? (
              <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                {pill("Aksepte", () => openSheet("decide", line, { request: req, accept: true }), "good")}
                {pill("Refize", () => openSheet("decide", line, { request: req, accept: false }), "bad")}
              </View>
            ) : (
              <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 4 }}>Tann repons nan lòt bò…</Text>
            )}
          </View>
        ) : null}

        {showActions ? (
          <>
            <View style={{ marginTop: 12, borderBottomWidth: 1, borderStyle: "dashed", borderColor: "#3a3a3c" }} />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              {primary ? (
                <Pressable
                  onPress={primary.onPress}
                  disabled={busy}
                  style={({ pressed }) => [{
                    flex: 1, height: 52, borderRadius: 14, backgroundColor: "#1E293B",
                    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                  }, (pressed || busy) && { opacity: 0.75 }]}
                >
                  <Ionicons name={primary.icon} size={16} color={primary.color} />
                  <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>{primary.label}</Text>
                </Pressable>
              ) : null}
              {menuItems.length ? (
                <Pressable
                  onPress={() => setMenuLine(line)}
                  disabled={busy}
                  style={({ pressed }) => [{
                    width: 52, height: 52, borderRadius: 14, backgroundColor: "#1E293B",
                    alignItems: "center", justifyContent: "center",
                  }, (pressed || busy) && { opacity: 0.75 }]}
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    );
  }

  const menuItems = menuLine ? menuItemsFor(menuLine) : [];

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {showHeader ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 20, letterSpacing: -0.4 }}>{orderCodeLabel(order)}</Text>
              <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
                {order.mode === "restaurant" ? "Restoran" : "Magazen"} • {lines.length} liy • {pendingCount(lines)} an atann
              </Text>
            </View>
            <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: PROD_DARK.hair }}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 11 }}>{ORDER_STATUS_LABELS[order.status]}</Text>
            </View>
            {headerRight}
          </View>
        </View>
      ) : null}

      <KeyboardSafeScrollView contentContainerStyle={{ padding: 16, paddingTop: 12, paddingBottom: 24 }}>
        {/* Stats: full order value + how many items are out vs total. */}
        <View style={{ backgroundColor: PROD_DARK.card, borderRadius: 16, borderWidth: 1, borderColor: PROD_DARK.hair, padding: 16, flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1 }}>TOTAL KÒMAND</Text>
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 21, marginTop: 6, ...monoStyle }}>{fmtG(orderTotal)}</Text>
          </View>
          <View style={{ width: 1, alignSelf: "stretch", backgroundColor: PROD_DARK.hair, marginVertical: 4 }} />
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1 }}>LIVRE / TOTAL</Text>
            <Text style={{ color: PROD_DARK.green, fontFamily: "Inter_700Bold", fontSize: 21, marginTop: 6, ...monoStyle }}>
              {deliveredQty} / {totalQty} atik
            </Text>
          </View>
        </View>

        {/* Amber status banner. */}
        {banner ? (
          <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "rgba(245,158,11,0.10)", borderWidth: 1, borderColor: "rgba(245,158,11,0.45)", borderRadius: 12, padding: 14, marginTop: 12 }}>
            <Ionicons name="warning" size={18} color="#FBBF24" style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: "#FBBF24" }}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold" }}>{banner.lead}</Text>
              <Text>{banner.rest}</Text>
            </Text>
          </View>
        ) : null}

        {/* Settlement is money — hard-gated behind an open shift (same rule
            as plain POS). Taking/writing the order itself never is. */}
        <View style={{ gap: 10, marginTop: 12 }}>
          {/* Broadcast handoff: the blocked creator flags a settle-ready order
              so the whole open-shift pool (cashier → owner) can take it. */}
          {!canSell && order.status === "open" && settle.ok ? (
            <Pressable
              onPress={() => run(() => store.markReadyForPayment(order.id, actor, true), "Livre pou peye — moun ki gen shift yo ap wè kòmand sa a.")}
              style={({ pressed }) => [{
                paddingVertical: 15, borderRadius: 16, alignItems: "center",
                backgroundColor: "#FBBF24", flexDirection: "row", justifyContent: "center", gap: 8,
              }, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="paper-plane-outline" size={16} color="#1a1200" />
              <Text style={{ color: "#1a1200", fontFamily: "Inter_700Bold", fontSize: 15 }}>Livre pou peye</Text>
            </Pressable>
          ) : null}
          {!canSell && order.status === "ready" ? (
            <Pressable
              onPress={() => run(() => store.markReadyForPayment(order.id, actor, false))}
              style={({ pressed }) => [{
                paddingVertical: 11, borderRadius: 16, alignItems: "center",
                borderWidth: 1, borderColor: "rgba(251,191,36,0.45)",
              }, pressed && { opacity: 0.7 }]}
            >
              <Text style={{ color: "#FBBF24", fontFamily: "Inter_700Bold", fontSize: 13 }}>Anile siy la</Text>
            </Pressable>
          ) : null}
          {(settle.ok || order.status === "settling") && canSell ? (
            <Pressable
              onPress={() => setShowPay(true)}
              style={({ pressed }) => [{
                paddingVertical: 15, borderRadius: 16, alignItems: "center",
                backgroundColor: "#2f80ed", flexDirection: "row", justifyContent: "center", gap: 8,
              }, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="card-outline" size={17} color="#fff" />
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>
                Peye {fmtG(deliveredSubtotal(lines))}
              </Text>
            </Pressable>
          ) : null}
          {/* Fakti: print/share a bill — only once every item is delivered
              (payment-ready moment) and never for Associate/Server. Same
              rule as the list card's quick print (rules.canBill). */}
          {canBill(order, allLinesDelivered(lines), actor) ? (
            <Pressable
              onPress={openBill}
              style={({ pressed }) => [{
                paddingVertical: 12, borderRadius: 16, alignItems: "center",
                borderWidth: 1, borderColor: "rgba(251,191,36,0.45)",
                flexDirection: "row", justifyContent: "center", gap: 8,
              }, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="receipt-outline" size={16} color="#FBBF24" />
              <Text style={{ color: "#FBBF24", fontFamily: "Inter_700Bold", fontSize: 14 }}>
                Fakti {fmtG(orderTotal)}
              </Text>
            </Pressable>
          ) : null}
          {order.status === "closed" && order.closed_sale_id ? (
            <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 11 }}>
              Anrejistre kòm vant {order.closed_sale_id}
            </Text>
          ) : null}
        </View>

        {/* Rounds */}
        <View style={{ marginTop: 18 }}>
          {rounds.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 48 }}>
              <Ionicons name="reader-outline" size={34} color={PROD_DARK.muted} />
              <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_600SemiBold", fontSize: 14, marginTop: 10 }}>Poko gen anyen nan kòmand sa a</Text>
              <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 4, textAlign: "center" }}>
                Louvri POS a epi mete premye wonn lan.
              </Text>
            </View>
          ) : (
            rounds.map(([roundNo, rows]) => {
              const roundQty = rows.filter(l => l.status !== "cancelled").reduce((s, l) => s + Number(l.qty ?? 0), 0);
              const deliverable = rows.some(l => canDeliverLine(order, l, actor));
              return (
                <View key={roundNo} style={{ marginBottom: 18 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#1E1E22", borderWidth: 1, borderColor: PROD_DARK.hair, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 12 }}>R{roundNo}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 }}>Round {roundNo}</Text>
                      <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 1 }}>
                        {rows.length} liy • {roundQty} atik
                      </Text>
                    </View>
                    {deliverable ? (
                      <Pressable
                        onPress={() => deliverRound(rows)}
                        disabled={busy}
                        style={({ pressed }) => [{
                          flexDirection: "row", alignItems: "center", gap: 6,
                          paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
                          backgroundColor: "rgba(74,222,128,0.12)", borderWidth: 1, borderColor: "rgba(74,222,128,0.5)",
                        }, (pressed || busy) && { opacity: 0.75 }]}
                      >
                        <Ionicons name="checkmark" size={15} color="#4ade80" />
                        <Text style={{ color: "#4ade80", fontFamily: "Inter_700Bold", fontSize: 14 }}>Livre Tout</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {rows.map(l => <Row key={l.id} line={l} />)}
                </View>
              );
            })
          )}
        </View>
      </KeyboardSafeScrollView>

      {/* Bottom bar: running total + open the in-screen Mete atik picker. */}
      {onAddItems && order.status === "open" ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginHorizontal: 16, marginBottom: 8, backgroundColor: "#131316", borderRadius: 20, borderWidth: 1, borderColor: PROD_DARK.hair, padding: 16 }}>
          <View>
            <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 13 }}>Total {orderCodeLabel(order)}</Text>
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 24, marginTop: 2, ...monoStyle }}>{fmtG(orderTotal)}</Text>
          </View>
          <Pressable
            onPress={onAddItems}
            style={({ pressed }) => [{
              flexDirection: "row", alignItems: "center", gap: 10,
              backgroundColor: "#F0B429", borderRadius: 16, paddingHorizontal: 20, paddingVertical: 16,
            }, pressed && { opacity: 0.85 }]}
          >
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "#1a1200", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="add" size={16} color="#F0B429" />
            </View>
            <Text style={{ color: "#1a1200", fontFamily: "Inter_700Bold", fontSize: 16 }}>Mete atik</Text>
          </Pressable>
        </View>
      ) : null}

      <OrderPaySheet
        visible={showPay}
        order={order}
        lines={lines}
        actor={actor}
        storeId={storeId}
        deviceId={deviceId}
        storeName={storeName}
        onClose={() => setShowPay(false)}
        onPaid={(res) => {
          setShowPay(false);
          setReceipts(res.receipts);
          setShowReceipt(true);
          onChanged();
        }}
      />
      <ReceiptModal
        visible={showReceipt}
        receipts={receipts}
        staging={{ storeId, cashierId: actor.id, customerId: order.customer_id }}
        onClose={() => { setShowReceipt(false); setReceipts(null); }}
      />

      {/* "•••" line menu — everything the rules allow beyond the primary CTA. */}
      <Modal visible={!!menuLine} transparent animationType="fade" onRequestClose={() => setMenuLine(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" }} onPress={() => setMenuLine(null)}>
          <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "#111114", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 + insets.bottom, borderTopWidth: 1, borderColor: PROD_DARK.hair }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: "#3a3a3c", alignSelf: "center", marginBottom: 14 }} />
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 17 }} numberOfLines={1}>{menuLine?.name ?? "Atik"}</Text>
            <View style={{ marginTop: 14, gap: 8 }}>
              {menuItems.map(it => (
                <Pressable
                  key={it.label}
                  onPress={it.onPress}
                  disabled={busy}
                  style={({ pressed }) => [{
                    flexDirection: "row", alignItems: "center", gap: 12, height: 56,
                    paddingHorizontal: 14, borderRadius: 14, backgroundColor: "#17171a",
                    borderWidth: 1, borderColor: PROD_DARK.hair,
                  }, (pressed || busy) && { opacity: 0.75 }]}
                >
                  <Ionicons name={it.icon} size={20} color={it.color} />
                  <Text style={{ flex: 1, color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>{it.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={PROD_DARK.muted} />
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => setMenuLine(null)} style={({ pressed }) => [{ marginTop: 14, paddingVertical: 14, borderRadius: 14, backgroundColor: "#1E293B", alignItems: "center" }, pressed && { opacity: 0.8 }]}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 }}>Fèmen</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <ActionSheet
        sheet={sheet}
        qtyText={qtyText}
        setQtyText={setQtyText}
        reasonText={reasonText}
        setReasonText={setReasonText}
        onClose={() => setSheet(null)}
        onSubmit={submitSheet}
        busy={busy}
      />
    </View>
  );
}

function ActionSheet({
  sheet, qtyText, setQtyText, reasonText, setReasonText, onClose, onSubmit, busy,
}: {
  sheet: Sheet | null;
  qtyText: string;
  setQtyText: (v: string) => void;
  reasonText: string;
  setReasonText: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width, isTablet } = useResponsive();
  const mode = sheet?.mode ?? null;
  const showQty = mode === "edit" || mode === "change";
  const reqReason = mode === "override" || (mode === "decide" && !(sheet as any)?.accept);
  const line = sheet?.line ?? null;
  const placeholder = reqReason
    ? mode === "override" ? "Poukisa ou fòse anile liy sa a?" : "Explike poukisa ou refize"
    : "Rezon (si w vle)";

  return (
    <Modal visible={!!sheet} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardSafeView>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" }}>
        <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: "#111114", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 + insets.bottom, borderTopWidth: 1, borderColor: PROD_DARK.hair }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: "#3a3a3c", alignSelf: "center", marginBottom: 14 }} />
          <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 17 }}>{mode ? SHEET_TITLE[mode] : ""}</Text>
          {line ? (
            <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 4 }}>
              {line.name} — {fmtG(line.line_total)}
            </Text>
          ) : null}

          {showQty ? (
            <View style={{ marginTop: 16 }}>
              <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_600SemiBold", fontSize: 12, marginBottom: 6 }}>Kantite</Text>
              <TextInput
                value={qtyText}
                onChangeText={setQtyText}
                keyboardType="numeric"
                autoFocus
                placeholder="0"
                placeholderTextColor="#5a5a5f"
                style={{ backgroundColor: "#17171a", borderWidth: 1, borderColor: PROD_DARK.hair, borderRadius: 12, color: "#fff", paddingHorizontal: 14, paddingVertical: 12, fontFamily: "Inter_600SemiBold", fontSize: 16 }}
              />
            </View>
          ) : null}

          <View style={{ marginTop: 16 }}>
            <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_600SemiBold", fontSize: 12, marginBottom: 6 }}>
              Rezon {reqReason ? <Text style={{ color: "#F87171" }}>(obligatwa)</Text> : null}
            </Text>
            <TextInput
              value={reasonText}
              onChangeText={setReasonText}
              multiline
              placeholder={placeholder}
              placeholderTextColor="#5a5a5f"
              style={{ backgroundColor: "#17171a", borderWidth: 1, borderColor: reqReason && !reasonText.trim() ? "rgba(248,113,113,0.5)" : PROD_DARK.hair, borderRadius: 12, color: "#fff", paddingHorizontal: 14, paddingVertical: 12, fontFamily: "Inter_400Regular", fontSize: 14, minHeight: 74, textAlignVertical: "top" }}
            />
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
            <Pressable onPress={onClose} style={({ pressed }) => [{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: "#1E293B", alignItems: "center" }, pressed && { opacity: 0.8 }]}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 }}>Fèmen</Text>
            </Pressable>
            <Pressable onPress={onSubmit} disabled={busy} style={({ pressed }) => [{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: busy ? "#2f4a66" : "#2f80ed", alignItems: "center" }, (pressed || busy) && { opacity: 0.85 }]}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 }}>Konfime</Text>
            </Pressable>
          </View>
        </View>
      </View>
    
      </KeyboardSafeView>
    </Modal>
  );
}

/** Compact one-line summary used on the POS strip. */
export function OrderStripSummary({ order, lines }: { order: Order; lines: OrderLine[] }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(74,222,128,0.14)", borderWidth: 1, borderColor: "rgba(74,222,128,0.4)" }}>
        <Text style={{ color: "#4ade80", fontFamily: "Inter_700Bold", fontSize: 11 }}>{lines.filter(l => l.status === "delivered").length}/{lines.length} livre</Text>
      </View>
      <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 }}>{fmtG(deliveredSubtotal(lines))}</Text>
      <Text style={{ color: "#FBBF24", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>{pendingCount(lines)} an atann</Text>
    </View>
  );
}

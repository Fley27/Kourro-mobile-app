import React, { useEffect, useRef, useState } from "react";
import { Alert, Animated, BackHandler, Easing, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fmtG } from "../format";
import { ht } from "../i18n";
import { palette, radius, shadow } from "../theme";
import { useResponsive } from "../responsive";
import { PROD_DARK, CartTotalBar, CartPill, CartLinesList, CartEmptyCard, ProductsEmpty, type CartItem, type SaleRow, type SearchMode } from "../screens/POSShared";
import { SearchHeader, PendingCard, VariantCard } from "../picker/phone";
import { TabletSearchCard, TabletPendingHero, TabletProductCard, tabletCatFor } from "../picker/tablet";
import { useSaleRows, usePendingLine, useCartLines, makePricing } from "../picker/hooks";
import { useSaleCatalog } from "../picker/useSaleCatalog";
import { ScanSheet } from "../components/ScanSheet";
import { addRound } from "./store";
import { orderCodeLabel } from "./OrderBoard";
import type { Actor, Order, RoundLineInput } from "./types";
import { uploadSuccess, uploadError } from "../components/UploadTransition";

/**
 * In-Orders item picker — the "Mete atik" flow. Stages a round of lines
 * with the exact same UX as checkout: same search/pending/product cards,
 * the floating pill → cart sheet on phone, the sticky cart panel on tablet,
 * all on the shared CartPill/CartLinesList/CartTotalBar components. The
 * whole round is committed as one addRound. No tender, no suspend, no
 * credit, no shift gate: orders never touch money here.
 *
 * Rendered as an absolute overlay INSIDE the order board's modal window
 * (parent mounts/unmounts it), not as its own native Modal: a sibling
 * top-level Modal mounts under the board's presented window on iOS.
 */
export default function AddItemsModal({
  order, actor, onClose, onAdded,
}: {
  order: Order;
  actor: Actor;
  onClose: () => void;
  onAdded: () => void;
}) {
  const responsive = useResponsive();
  const { isTablet, isLargeTablet, isLandscape, padH } = responsive;
  // Same split as checkout (POSScreen): tablet two-pane only in portrait;
  // landscape tablets get the phone layout (pill + cart sheet).
  const showTablet = isTablet && !isLandscape;
  // Explicit root insets: inside this modal a view-level SafeAreaView comes
  // back with zero padding, so the header lands under the status bar. These
  // values are captured at the app root (SafeAreaProvider) and stay correct.
  const insets = useSafeAreaInsets();

  // Catalog loads lazily — only while this picker is on screen.
  const { products, catNames, pricing, minFactorMap, getBaseCost } = useSaleCatalog(true);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("name");
  const [cat, setCat] = useState("all");
  const [busy, setBusy] = useState(false);

  const rows = useSaleRows({ products, pricing, minFactorMap, catNames, search });
  const visibleRows = showTablet && cat !== "all" ? rows.filter(r => tabletCatFor(r.product) === cat) : rows;

  // The staged round — a plain checkout cart, committed as one addRound.
  const [round, setRound] = useState<CartItem[]>([]);
  const { mergeLine } = makePricing(pricing, minFactorMap);
  const {
    pending, setPending, pendingInput, setPendingInput, pendingLine, pendingMaxQ,
    handleProductPress, adjustPending, setPendingCustom, commitPendingWithInput,
  } = usePendingLine({
    pricing,
    minFactorMap,
    onCommit: (p, q, s) => setRound(prev => mergeLine(prev, p, s, Math.max(1, q))),
    onRowPress: () => setSearch(""),
  });
  const {
    editingQtyId, setEditingQtyId, editingQtyVal, setEditingQtyVal,
    decQty, incQty, removeFromCart, setCustomQty,
  } = useCartLines({ cart: round, setCart: setRound, products, pricing, minFactorMap });

  const subtotal = round.reduce((s, it) => s + (Number(it.lineTotal ?? it.qty * (it.unitPrice ?? 0)) || 0), 0);
  const qtyTotal = round.reduce((s, it) => s + it.qty, 0);

  // Same breathing pulse as checkout's Pay CTA so the Mete button reads as
  // the one primary action.
  const entrance = useRef(new Animated.Value(1)).current;
  const payPulse = useRef(new Animated.Value(0)).current;
  // Overlay slide-in (replaces the old Modal's slide animation).
  const { width: winW, height: winH } = useWindowDimensions();
  const slideIn = useRef(new Animated.Value(winW)).current;
  // Cart sheet slide-up/down (checkout's native sheet, as an overlay).
  const cartY = useRef(new Animated.Value(winH)).current;
  const [showCart, setShowCart] = useState(false);
  const [showScan, setShowScan] = useState(false);
  useEffect(() => {
    Animated.timing(slideIn, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [slideIn]);
  useEffect(() => {
    if (!showCart) return;
    cartY.setValue(winH);
    Animated.timing(cartY, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [showCart, cartY, winH]);
  // Android hardware back: scan sheet → cart sheet → picker.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (showScan) { setShowScan(false); return true; }
      if (showCart) { closeCart(); return true; }
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose, showCart, showScan]);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(payPulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(payPulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [payPulse]);

  function closeCart() {
    Animated.timing(cartY, { toValue: winH, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setShowCart(false);
    });
  }

  function onBarcodeSubmit() {
    if (!search.trim()) return;
    const q = search.trim().toLowerCase();
    const found = products.find(p => (p.barcode ?? "").toLowerCase() === q || (p.sku ?? "").toLowerCase() === q);
    const row = found ? rows.find(r => r.product.id === found.id) ?? null : null;
    if (found && row) handleProductPress(row);
    else uploadError("Pa jwenn", `Pa gen pwodwi ak kòd ${search.trim()}`);
  }

  // Same simulated scan as checkout: pend the top product for this catalog.
  function simulateScan() {
    const top = products[0];
    const row = top ? rows.find(r => r.product.id === top.id) ?? null : null;
    if (top && row) { setSearch(top.barcode ?? top.sku ?? ""); handleProductPress(row); setShowScan(false); }
  }

  // Same copy + behavior as checkout's confirmClearCart.
  function clearRound() {
    if (!round.length) return;
    Alert.alert("Vide panyen?", `${round.length} atik • ${qtyTotal} pcs pral efase.`, [
      { text: "Anile", style: "cancel" },
      { text: "Vide tout", style: "destructive", onPress: () => { setRound([]); setPending(null); setPendingInput(""); if (showCart) closeCart(); } },
    ]);
  }

  async function submit() {
    if (busy) return;
    if (!round.length) {
      uploadError("Panyen vid", "Chwazi atik anvan ou ajoute nan kòmand la");
      return;
    }
    setBusy(true);
    try {
      const input: RoundLineInput[] = round.map(c => ({
        product_id: c.id,
        name: c.name,
        unit_id: c.unitId || null,
        unit_name: c.unitName,
        factor: c.factor,
        variant: c.variant,
        qty: c.qty,
        unit_price: c.unitPrice,
      }));
      const res = await addRound(order.id, input, actor);
      if (!res.ok) {
        uploadError("Pa posib", res.error);
        return;
      }
      const n = round.length;
      const total = subtotal;
      setRound([]);
      setPending(null);
      setPendingInput("");
      onClose();
      onAdded();
      uploadSuccess("Atik ajoute", `${n} liy • ${fmtG(total)} nan kòmand la`);
    } finally {
      setBusy(false);
    }
  }

  const inCartQtyFor = (item: SaleRow) => round.filter(c => c.key === item.key).reduce((s, c) => s + c.qty, 0);
  const pendingActiveFor = (item: SaleRow) => !!pending && pending.product.id === item.product.id && pending.unitId === item.unitId && pending.variant === item.variant;
  const meteLabel = busy ? "Ap mete…" : qtyTotal ? `Mete • ${qtyTotal} atik` : "Mete atik";

  const renderRow = ({ item }: { item: SaleRow }) => showTablet ? (
    <TabletProductCard
      row={item}
      inCartQty={inCartQtyFor(item)}
      pendingActive={pendingActiveFor(item)}
      onPress={() => handleProductPress(item)}
      getBaseCost={getBaseCost}
    />
  ) : (
    <VariantCard
      row={item}
      inCartQty={inCartQtyFor(item)}
      pendingActive={pendingActiveFor(item)}
      flex={isTablet ? 1 : undefined}
      onPress={() => handleProductPress(item)}
    />
  );

  const listHeader = (marginBottom: number) => (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom, marginTop: 4 }}>
      <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }}>Varyant disponib</Text>
      <Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "600" }}>{visibleRows.length} rezilta</Text>
    </View>
  );

  // One shared cart body for the phone sheet + tablet panel.
  const cartLines = (marginTop: number) => (
    <CartLinesList
      cart={round}
      editingQtyId={editingQtyId}
      editingQtyVal={editingQtyVal}
      onDec={decQty}
      onInc={incQty}
      onRemove={removeFromCart}
      onEditStart={(key) => { setEditingQtyId(key); setEditingQtyVal(""); }}
      onEditChange={setCustomQty}
      onEditBlur={() => setEditingQtyId(null)}
      style={{ marginTop }}
    />
  );

  const pendingHero = pending ? (
    showTablet ? (
      <TabletPendingHero
        pending={pending}
        pendingInput={pendingInput}
        pendingLine={pendingLine}
        pendingMaxQ={pendingMaxQ}
        onAdjust={adjustPending}
        onCustom={setPendingCustom}
        onBlurClear={() => setPendingInput("")}
        onCommit={commitPendingWithInput}
        onCancel={() => setPending(null)}
      />
    ) : (
      <PendingCard
        variant="phone"
        pending={pending}
        pendingInput={pendingInput}
        pendingLine={pendingLine}
        pendingMaxQ={pendingMaxQ}
        onAdjust={adjustPending}
        onCustom={setPendingCustom}
        onBlurClear={() => setPendingInput("")}
        onCommit={commitPendingWithInput}
        onCancel={() => setPending(null)}
      />
    )
  ) : null;

  return (
    // Absolute overlay inside the board modal. Root padding comes from the
    // provider insets (status bar / home indicator); the slide transform
    // lives on the inner wrapper so it can't disturb layout.
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, elevation: 60, backgroundColor: "#000", paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }}>
      <Animated.View style={{ flex: 1, backgroundColor: "#000", transform: [{ translateX: slideIn }] }}>
        {/* Header: back • Mete atik + order label • close */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#1c1c1f" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable onPress={onClose} style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#1E1E22", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.7 }]}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 20, letterSpacing: -0.4 }}>Mete atik</Text>
              <Text style={{ color: PROD_DARK.muted, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {orderCodeLabel(order)} • {order.line_count} liy nan kòmand la
              </Text>
            </View>
            <Pressable onPress={onClose} style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#1E1E22", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.7 }]}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>

        {showTablet ? (
          /* Two-pane — mirrors checkout's tablet layout: products left,
             sticky cart card right. */
          <View style={{ flex: 1, flexDirection: "row", gap: 12, paddingHorizontal: padH, paddingBottom: 12, paddingTop: 8 }}>
            <View style={{ flex: 3, minWidth: 0, gap: 12 }}>
              <TabletSearchCard
                entrance={entrance}
                search={search}
                searchMode={searchMode}
                cat={cat}
                onSearchChange={setSearch}
                onSearchModeChange={setSearchMode}
                onBarcodeSubmit={onBarcodeSubmit}
                onOpenScanner={() => setShowScan(true)}
                onCatChange={setCat}
                visibleCount={visibleRows.length}
                totalCount={rows.length}
              />
              {pendingHero}
              <FlatList
                style={{ flex: 1 }}
                data={visibleRows}
                keyExtractor={i => i.key}
                numColumns={isLargeTablet ? 3 : 2}
                columnWrapperStyle={{ gap: 10 }}
                contentContainerStyle={{ gap: 10, paddingTop: 2, paddingBottom: 12 }}
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={listHeader(2)}
                renderItem={renderRow}
                ListEmptyComponent={<ProductsEmpty />}
              />
            </View>

            {/* Right sticky cart card — checkout tablet parity */}
            <View style={{ flex: 2, minWidth: 300, backgroundColor: "#000", borderRadius: radius.lg, borderWidth: 0.5, borderColor: "#262626", ...shadow.card, padding: 14 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <Text style={{ fontWeight: "700", fontSize: 15, color: "#fff", letterSpacing: -0.2, flex: 1 }} numberOfLines={1}>
                  {ht.cart} • {round.length} atik • {qtyTotal} pcs
                </Text>
                {round.length > 0 ? (
                  <Pressable onPress={clearRound} accessibilityLabel="Vide panyen" style={({ pressed }) => [{ backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 }, pressed && { opacity: 0.7 }]}>
                    <Text style={{ color: palette.danger, fontWeight: "700", fontSize: 11 }}>Vide</Text>
                  </Pressable>
                ) : null}
              </View>
              {round.length === 0 ? (
                <CartEmptyCard />
              ) : (
                cartLines(12)
              )}
              <View style={{ marginTop: 12, gap: 10 }}>
                <CartTotalBar
                  payPulse={payPulse}
                  subtotal={subtotal}
                  onPay={submit}
                  label={meteLabel}
                  icon="add-circle-outline"
                />
                <Text style={{ fontSize: 10, color: "#8e8e93", textAlign: "center" }}>
                  Tape Mete pou ajoute nan kòmand la
                </Text>
              </View>
            </View>
          </View>
        ) : (
          /* Phone (and landscape tablet) — checkout phone parity: search +
             pending + product list + floating cart pill → cart sheet. */
          <>
            <SearchHeader
              variant="phone"
              search={search}
              searchMode={searchMode}
              entrance={entrance}
              onSearchChange={setSearch}
              onSearchModeChange={setSearchMode}
              onBarcodeSubmit={onBarcodeSubmit}
              onOpenScanner={() => setShowScan(true)}
            />
            {pendingHero}
            <FlatList
              style={{ flex: 1 }}
              data={visibleRows}
              keyExtractor={i => i.key}
              numColumns={isTablet ? 2 : 1}
              columnWrapperStyle={isTablet ? { gap: 8 } : undefined}
              contentContainerStyle={{ padding: isTablet ? 20 : 12, paddingBottom: 110, gap: 8 }}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={listHeader(8)}
              renderItem={renderRow}
              ListEmptyComponent={<ProductsEmpty />}
            />
            {round.length > 0 ? (
              <View style={{ position: "absolute", bottom: 16, left: 16, right: 16, alignItems: "center", pointerEvents: "box-none" }}>
                <CartPill qty={qtyTotal} subtotal={subtotal} onPress={() => setShowCart(true)} />
              </View>
            ) : null}
          </>
        )}

        {/* Cart sheet — checkout cart sheet markup as an overlay (a nested
            native Modal can mount under the board's window on iOS). */}
        {showCart ? (
          <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 70, elevation: 70, backgroundColor: "#000", transform: [{ translateY: cartY }] }}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
              <View style={{ flex: 1, backgroundColor: "#000", padding: 18 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Pressable onPress={closeCart} accessibilityLabel="Close cart" style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: "#3a3a3c", alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.7 }]}>
                    <Text style={{ fontSize: 17, color: "#fff", fontWeight: "700" }}>✕</Text>
                  </Pressable>
                  <View style={{ flex: 1, alignItems: "center" }}>
                    <Text style={{ fontWeight: "900", fontSize: 20, color: "#fff" }}>{ht.cart}</Text>
                    <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 2, fontWeight: "600" }}>{qtyTotal} pcs • {round.length} atik</Text>
                  </View>
                  <Pressable onPress={clearRound} accessibilityLabel="Vide panyen" style={({ pressed }) => [{ backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 }, pressed && { opacity: 0.7 }]}>
                    <Text style={{ color: palette.danger, fontWeight: "700", fontSize: 11 }}>Vide</Text>
                  </Pressable>
                </View>
                {cartLines(14)}
                <CartTotalBar
                  payPulse={payPulse}
                  subtotal={subtotal}
                  onPay={submit}
                  label={meteLabel}
                  icon="add-circle-outline"
                />
              </View>
            </KeyboardAvoidingView>
          </Animated.View>
        ) : null}

        {/* Shared scan sheet — same simulated scan as checkout (overlay mode). */}
        <ScanSheet
          overlay
          visible={showScan}
          onClose={() => setShowScan(false)}
          onSimulate={simulateScan}
          productLabel={products[0]?.name ?? ""}
        />
      </Animated.View>
    </View>
  );
}

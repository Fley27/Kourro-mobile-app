import React from "react";
import { View, Text, Pressable } from "react-native";
import { fmtG, monoStyle } from "../format";
import { formatCheckoutRow } from "../labels";
import { PROD_DARK, type SaleGroup, type SaleRow } from "../screens/POSShared";

// ---- "Signal module" checkout card — one card per product. Identity lives
// once in the header (monogram, name, meta, gold rule with a live 30-day
// sales readout); every sellable variant hangs off a vertical signal spine
// as its own station. Each station carries a keycap chip with the token that
// actually distinguishes it from its siblings (10 / 25 / 50 / GRO …) so a
// cashier under pressure reads the difference at a glance and verifies with
// the full label beside it. The 30-day best seller gets exactly one quiet
// marker: its rail node in gold. Shared by phone, tablet grid and the
// Orders item picker. ----

const GOLD = "#FBBF24";
const SPINE = "#262626";

/** Narrowest card the header still fits in: 14pt padding each side, the 40pt
 *  monogram, two 10pt gaps, the "N varyant" chip + VANT readout, leaving ~110pt
 *  for the product name. Below this the title's `flex:1 / minWidth:0` collapses
 *  to zero and the article disappears from the card. */
export const GROUP_CARD_MIN_W = 300;
export const GROUP_CARD_GAP = 10;

/** How many cards may sit side by side without any of them dropping below
 *  GROUP_CARD_MIN_W — take the floor, never the ceiling, so the leftover slack
 *  spreads across the cards instead of squeezing the last one. */
export function groupCardColumns(listWidth: number): number {
  return Math.max(1, Math.floor((listWidth + GROUP_CARD_GAP) / (GROUP_CARD_MIN_W + GROUP_CARD_GAP)));
}

// Longest common prefix of sibling titles (case-insensitive). If a sibling
// continues an alphanumeric token right after the match point the prefix
// would split that token ("Sak 1" vs "Sak 10"), so backtrack to the last
// token boundary; a clean boundary ("…KG" vs "…KG Cho") is kept as-is.
function commonPrefixLen(titles: string[]): number {
  if (titles.length < 2) return 0;
  const a = titles[0];
  let i = 0;
  while (i < a.length) {
    const c = a[i].toLowerCase();
    if (!titles.every(t => i < t.length && t[i].toLowerCase() === c)) break;
    i++;
  }
  const continuesToken = titles.some(t => t.length > i && /[A-Za-z0-9]/.test(t[i]));
  if (continuesToken) {
    while (i > 0 && /[A-Za-z0-9]/.test(a[i - 1])) i--;
  }
  return i;
}

// The station's distinguishing token: number (+ unit) when present, else the
// first word of the discriminator uppercased.
function keycapFor(disc: string, title: string): { big: string; small: string; numeric: boolean } {
  const src = disc.trim() || title;
  const m = src.match(/(\d+(?:[.,]\d+)?)\s*([A-Za-z°%]{1,4})?/);
  if (m) return { big: m[1], small: (m[2] ?? "").toUpperCase(), numeric: true };
  const w = src.trim().split(/\s+/)[0] ?? "—";
  return { big: w.slice(0, 4).toUpperCase(), small: "", numeric: false };
}

export function VariantGroupCard(props: {
  group: SaleGroup;
  inCartQtyFor: (row: SaleRow) => number;
  pendingActiveFor: (row: SaleRow) => boolean;
  flex?: number;
  /** Floor for the card's width — the grid passes GROUP_CARD_MIN_W so the
   *  product name can never collapse to nothing. */
  minWidth?: number;
  onRowPress: (row: SaleRow) => void;
  /** In-cart rows get a − button that decrements the staged cart line. */
  onDecQty?: (key: string) => void;
  /** Badge wording for staged qty — checkout says "panyen", the coupon
   *  wizard's requirement picker says "lis rekiz". */
  inCartLabel?: string;
}) {
  const { group, inCartQtyFor, pendingActiveFor, flex, minWidth, onRowPress, onDecQty, inCartLabel = "panyen" } = props;
  const { product, categoryName, rows, variantCount, bestKey } = group;
  const isTop = (product.sales_count ?? 0) >= 90;
  const trend = rows.reduce((s, r) => s + r.salesQty, 0);
  const subtitle = [product.sku ?? "", categoryName].filter(Boolean).join(" · ");
  const titles = rows.map(r => formatCheckoutRow(r.unitName, "", r.variant));
  const prefix = commonPrefixLen(titles);
  const discs = titles.map(t => t.slice(prefix));

  return (
    <View style={{ flex: flex as any, minWidth, backgroundColor: PROD_DARK.card, borderRadius: 18, borderWidth: 1, borderColor: PROD_DARK.hair, overflow: "hidden" }}>
      {/* Header — product identity + trend readout */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(221,138,62,0.14)", borderWidth: 1, borderColor: "rgba(221,138,62,0.3)", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#dd8a3e", fontWeight: "800", fontSize: 17 }}>{(product.name?.[0] ?? "•").toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: "800", fontSize: 16.5, color: PROD_DARK.ink, letterSpacing: -0.3 }} numberOfLines={1}>{product.name}</Text>
          {subtitle ? (
            <Text style={{ color: "#71717a", fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 3 }} numberOfLines={1}>{subtitle}</Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 5 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {isTop && (
              <View style={{ borderWidth: 1, borderColor: PROD_DARK.avatar, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 3 }}>
                <Text style={{ fontSize: 9.5, color: PROD_DARK.avatar, fontWeight: "800", letterSpacing: 0.5 }}>★ TOP</Text>
              </View>
            )}
            <View style={{ backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontSize: 10, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.5 }}>{variantCount} varyant</Text>
            </View>
          </View>
          <Text style={{ fontSize: 10, fontWeight: "700", letterSpacing: 0.6, ...monoStyle, color: trend > 0 ? GOLD : "#52525b" }}>
            VANT 30J · {trend > 0 ? trend : "—"}
          </Text>
        </View>
      </View>
      {/* Gold rule — a circuit trace leaving the header */}
      <View style={{ height: 1, backgroundColor: "#1f1f1f" }}>
        <View style={{ position: "absolute", left: 0, top: 0, width: 76, height: 1.5, backgroundColor: "rgba(251,191,36,0.85)" }} />
      </View>

      {/* Variant stations on the spine */}
      <View style={{ paddingTop: 6, paddingBottom: 6 }}>
        {rows.map((row, idx) => {
          const isSvc = row.product.item_type === "service";
          const svcAvail = !isSvc || (row.product.is_available !== 0 && (row.product.is_available as any) !== false);
          const isOut = !isSvc && row.maxQ <= 0;
          const isAlmost = !isSvc && !isOut && row.maxQ <= 5;
          const dimmed = isSvc ? !svcAvail : isOut;
          const stockColor = isSvc ? (svcAvail ? "#4ade80" : "#FBBF24") : isOut ? "#F87171" : isAlmost ? "#FBBF24" : "#4ade80";
          const stockLabel = isSvc ? (svcAvail ? "Disponib" : "Koupe") : isOut ? "Ruptur" : isAlmost ? "Preske fini" : "Disponib";
          const stockText = isSvc ? stockLabel : `${row.maxQ} ${row.unitName} nan stòk · ${stockLabel}`;
          const inCartQty = inCartQtyFor(row);
          const pendingActive = pendingActiveFor(row);
          const isBest = bestKey === row.key;
          const cap = keycapFor(discs[idx], titles[idx]);
          return (
            <Pressable
              key={row.key}
              onPress={() => onRowPress(row)}
              style={({ pressed }) => [{
                flexDirection: "row",
                alignItems: "center",
                gap: 11,
                paddingVertical: 11,
                paddingRight: 10,
                paddingLeft: 36,
                marginLeft: 6,
                marginRight: 6,
                marginBottom: 2,
                borderRadius: 12,
                borderWidth: pendingActive ? 2 : inCartQty > 0 ? 1.5 : 1,
                borderColor: pendingActive ? PROD_DARK.select : inCartQty > 0 ? "rgba(74,222,128,0.5)" : "transparent",
                opacity: dimmed ? 0.62 : 1,
                backgroundColor: pressed
                  ? (inCartQty > 0 ? "rgba(74,222,128,0.10)" : "rgba(255,255,255,0.05)")
                  : inCartQty > 0 ? "rgba(74,222,128,0.055)" : "transparent",
              }]}
            >
              {idx > 0 && <View style={{ position: "absolute", left: 36, right: 0, top: 0, height: 1, backgroundColor: "#1f1f1f" }} />}
              {/* Spine spans the 2px row margin so the line stays unbroken */}
              <View style={{ position: "absolute", left: 17, top: 0, bottom: -2, width: 2, backgroundColor: SPINE }} />
              {/* Best seller: one quiet marker — a gold node on the rail */}
              <View style={{ position: "absolute", left: 12, top: 0, bottom: 0, width: 12, alignItems: "center", justifyContent: "center" }}>
                <View
                  style={{
                    width: 10, height: 10, borderRadius: 5,
                    backgroundColor: isBest ? GOLD : "#0f0f0f",
                    borderWidth: 2,
                    borderColor: pendingActive ? PROD_DARK.select : isBest ? GOLD : "#3f3f46",
                  }}
                />
              </View>

              {/* Keycap — the sibling-distinguishing token at a glance */}
              <View style={{ width: 46, height: 38, borderRadius: 10, backgroundColor: "#17171a", borderWidth: 1, borderColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: PROD_DARK.ink, fontWeight: "800", fontSize: cap.numeric ? 15 : 11.5, letterSpacing: cap.numeric ? -0.3 : 0.4, ...monoStyle }}>{cap.big}</Text>
                {cap.small ? <Text style={{ color: "#71717a", fontWeight: "700", fontSize: 7.5, letterSpacing: 1, marginTop: 1 }}>{cap.small}</Text> : null}
              </View>

              {/* Full label — verification layer */}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Text style={{ fontWeight: "700", fontSize: 14.5, color: PROD_DARK.ink }} numberOfLines={1}>{titles[idx]}</Text>
                  {/* In-cart: white qty chip + red − to decrement right here */}
                  {inCartQty > 0 && (
                    <View style={{ backgroundColor: "#fff", borderRadius: 24, paddingHorizontal: 8, paddingVertical: 2.5 }}>
                      <Text style={{ fontSize: 10.5, color: "#16130c", fontWeight: "800" }}>×{inCartQty} nan {inCartLabel}</Text>
                    </View>
                  )}
                  {inCartQty > 0 && onDecQty ? (
                    <Pressable
                      onPress={() => onDecQty(row.key)}
                      hitSlop={8}
                      accessibilityLabel="Redwi kantite"
                      style={{ width: 28, height: 28, borderRadius: 9, borderWidth: 1, borderColor: "rgba(248,113,113,0.55)", backgroundColor: "rgba(248,113,113,0.08)", alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ color: "#F87171", fontSize: 17, fontWeight: "700", lineHeight: 18 }}>−</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
                  <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: stockColor }} />
                  <Text style={{ color: PROD_DARK.muted, fontSize: 11, fontWeight: "600" }}>{stockText}</Text>
                  {isAlmost ? (
                    <View style={{ backgroundColor: PROD_DARK.amberBg, borderWidth: 1, borderColor: "rgba(245,158,11,0.5)", borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ fontSize: 9.5, color: PROD_DARK.amber, fontWeight: "800" }}>FÈB</Text>
                    </View>
                  ) : null}
                </View>
              </View>

                <View style={{ alignItems: "flex-end", gap: 5 }}>
                  <Text style={{ fontWeight: "900", color: PROD_DARK.ink, fontSize: 14.5, textAlign: "right", ...monoStyle }}>{fmtG(row.price)}</Text>
                  <View style={{ borderWidth: 1, borderColor: isOut ? "#7f1d1d" : "rgba(251,191,36,0.55)", backgroundColor: isOut ? "transparent" : "rgba(251,191,36,0.07)", borderRadius: 24, paddingHorizontal: 11, paddingVertical: 4 }}>
                    <Text style={{ fontSize: 11.5, color: isOut ? "#F87171" : GOLD, fontWeight: "800" }}>{isOut ? "Epuize" : "+ Tape"}</Text>
                  </View>
                </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

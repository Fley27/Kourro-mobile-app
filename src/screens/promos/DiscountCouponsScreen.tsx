// Rabais & Koupon — the standalone promotions hub: browse/issue coupons and
// manage the bare percentage records.
// ORPHANED: its entry point was removed from MoreScreen (owner/admin/manager
// reach the wizard through a proformat instead). Kept so it can be restored
// by re-adding the import + entry there. The POS redemption surface lives in
// the checkout screen.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput, Alert, Share, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb } from "../../db";
import { useSalesEvents } from "../../salesEvents";
import { uploadError } from "../../components/UploadTransition";
import { useResponsive } from "../../responsive";
import { createDiscount, listCoupons, listDiscounts } from "../../promos/promosModel";
import type { Coupon, Discount, PromoActor } from "../../promos/types";
import CouponWizard from "./CouponWizard";
import { PrimaryButton, PromoCard, PromoHeader, SectionLabel, fmtWhen } from "./promoUi";
import { KeyboardSafeScrollView } from "../../components/KeyboardSafe";

export default function DiscountCouponsScreen({
  role = "manager",
  currentUser,
  storeId,
  deviceId = "device-unknown",
  onBack,
}: {
  role?: string;
  currentUser?: any;
  storeId: string;
  deviceId?: string;
  onBack: () => void;
}) {
  const { padH } = useResponsive();
  const canManage = ["owner", "admin", "manager"].includes(String(currentUser?.role ?? role));
  const actor: PromoActor = { id: currentUser?.id ?? null, name: String(currentUser?.name ?? role), role: String(currentUser?.role ?? role) };
  const [tab, setTab] = useState<"coupons" | "discounts">("coupons");
  const [coupons, setCoupons] = useState<Array<Coupon & { customer_name: string; proformat_receipt: string | null }>>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [newPct, setNewPct] = useState("");
  const [creating, setCreating] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      const [cs, ds] = await Promise.all([listCoupons(db, storeId, ""), listDiscounts(db, storeId)]);
      setCoupons(cs);
      setDiscounts(ds);
    } catch {} finally { setLoading(false); }
  }, [storeId]);
  useEffect(() => { load(); }, [load]);
  // Live: coupons/discounts issued on another register appear after the pull.
  useSalesEvents(() => { load().catch(() => {}); });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return coupons;
    return coupons.filter(c =>
      c.code.toLowerCase().includes(t) ||
      String(c.customer_name ?? "").toLowerCase().includes(t) ||
      String(c.proformat_receipt ?? "").toLowerCase().includes(t)
    );
  }, [coupons, q]);

  async function makeDiscount() {
    const pct = Number(newPct);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) { Alert.alert("Pri valab", "Antre yon pousantrap ant 1 ak 99."); return; }
    setCreating(true);
    try {
      const db = await getDb();
      await createDiscount(db, { storeId, deviceId, actor, percentage: pct });
      setNewPct("");
      await load();
    } catch (e: any) {
      uploadError(e?.title ?? "Erè", e?.message ?? String(e));
    } finally { setCreating(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <KeyboardSafeScrollView contentContainerStyle={{ paddingHorizontal: padH, paddingBottom: 48 }}>
        <PromoHeader title="Rabais & Koupon" subtitle="Pousantrap • koupon yon sèl fwa" onBack={onBack} />

        <View style={{ flexDirection: "row", marginBottom: 6 }}>
          {([["coupons", "Koupon"], ["discounts", "Rabais"]] as const).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setTab(key as any)}
              style={{ flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 8, backgroundColor: tab === key ? "#fff" : "#141414", borderWidth: 1, borderColor: tab === key ? "#fff" : "#3a3a3c" }}
            >
              <Text style={{ color: tab === key ? "#000" : "#fff", fontSize: 15, fontWeight: "800" }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === "coupons" ? (
          <>
            <PrimaryButton label="Nouvo koupon +" onPress={() => setWizardOpen(true)} />
            <View style={{ height: 50, flexDirection: "row", alignItems: "center", backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 25, paddingHorizontal: 16, marginTop: 14, marginBottom: 14 }}>
              <Ionicons name="search" size={18} color="#fff" style={{ marginRight: 8 }} />
              <TextInput value={q} onChangeText={setQ} placeholder="Chèche kòd, kliyan, resi…" placeholderTextColor="#5a5a5e" style={{ flex: 1, color: "#fff", fontSize: 15 }} returnKeyType="search" />
              {q.length > 0 ? <Pressable onPress={() => setQ("")} hitSlop={8}><Text style={{ color: "#8e8e93", fontSize: 13 }}>✕</Text></Pressable> : null}
            </View>
            {loading ? (
              <ActivityIndicator color="#8e8e93" style={{ marginTop: 30 }} />
            ) : filtered.length ? filtered.map(c => {
              const open = openId === String(c.id);
              const tone = c.status === "redeemed" ? "#10240f" : c.status === "expired" ? "#241010" : "#1a1408";
              const border = c.status === "redeemed" ? "#2f80ed33" : c.status === "expired" ? "#ff453a44" : "#5a4a1a";
              const label = c.status === "redeemed" ? "ITILIZE" : c.status === "expired" ? "EKSPIRE" : "KIYÈ";
              const accent = c.status === "redeemed" ? "#7bd88f" : c.status === "expired" ? "#ff453a" : "#ffd60a";
              return (
                <Pressable
                  key={String(c.id)}
                  onPress={() => setOpenId(open ? null : String(c.id))}
                  style={{ backgroundColor: tone, borderWidth: 1, borderColor: border, borderRadius: 14, padding: 14, marginBottom: 10 }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#fff", fontSize: 16, fontWeight: "900", letterSpacing: 0.5 }}>{c.code}</Text>
                      <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 3 }}>
                        {c.customer_name || "—"} · {Number(c.discount_percentage)}%
                        {c.proformat_receipt ? ` · ${c.proformat_receipt}` : ""}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: "#00000066", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ color: accent, fontSize: 11, fontWeight: "800" }}>{label}</Text>
                    </View>
                  </View>
                  <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 6 }}>
                    Rabais kalkile lè peye · ekspire {fmtWhen(c.expires_at)}
                  </Text>
                  {open ? (
                    <View style={{ marginTop: 10 }}>
                      <View style={{ height: 1, backgroundColor: "#ffffff1a", marginBottom: 10 }} />
                      <Text style={{ color: "#fff", fontSize: 14, lineHeight: 21 }}>{String(c.message ?? "")}</Text>
                      <Pressable
                        onPress={async () => { try { await Share.share({ message: String(c.message ?? c.code) }); } catch {} }}
                        style={{ marginTop: 12, alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#ffffff14" }}
                      >
                        <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>Pataje mesaj la</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </Pressable>
              );
            }) : (
              <View style={{ padding: 30, alignItems: "center" }}>
                <Text style={{ color: "#8e8e93", fontSize: 14 }}>{q.trim() ? "Pa gen rezilta." : "Pa gen koupon ankò."}</Text>
              </View>
            )}
          </>
        ) : (
          <>
            <SectionLabel style={{ marginTop: 6 }}>RABAI SOU DOKIMAN</SectionLabel>
            {loading ? (
              <ActivityIndicator color="#8e8e93" style={{ marginTop: 30 }} />
            ) : discounts.length ? discounts.map(d => (
              <View key={String(d.id)} style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#141414", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 14, padding: 14, marginBottom: 10 }}>
                <View style={{ width: 46, height: 46, borderRadius: 10, backgroundColor: "#1c1c1e", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                  <Text style={{ color: "#4da3e0", fontSize: 15, fontWeight: "900" }}>{Number(d.percentage)}%</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>Rabais {Number(d.percentage)}%</Text>
                  <Text style={{ color: "#8e8e93", fontSize: 12, marginTop: 2 }}>
                    {String(d.created_by_name ?? "—")} · {fmtWhen(d.created_at)}
                  </Text>
                </View>
              </View>
            )) : (
              <Text style={{ color: "#8e8e93", fontSize: 14, marginBottom: 8 }}>Pa gen rabais ankò.</Text>
            )}
            {canManage ? (
              <PromoCard style={{ marginTop: 4 }}>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 10 }}>Nouvo rabais</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TextInput
                    value={newPct} onChangeText={t => setNewPct(t.replace(/[^0-9.]/g, "").slice(0, 5))}
                    placeholder="Pousantrap" placeholderTextColor="#5a5a5e" keyboardType="decimal-pad"
                    style={{ flex: 1, minHeight: 50, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 10, paddingHorizontal: 14, color: "#fff", fontSize: 16, backgroundColor: "#0a0a0a" }}
                  />
                  <Pressable
                    onPress={creating ? undefined : makeDiscount}
                    style={{ minWidth: 92, borderRadius: 10, backgroundColor: newPct.trim() ? "#fff" : "#1c1c1e", alignItems: "center", justifyContent: "center" }}
                  >
                    <Text style={{ color: newPct.trim() ? "#000" : "#8e8e93", fontSize: 15, fontWeight: "800" }}>{creating ? "…" : "Kreye"}</Text>
                  </Pressable>
                </View>
              </PromoCard>
            ) : null}
          </>
        )}
      </KeyboardSafeScrollView>

      <CouponWizard
        visible={wizardOpen}
        onClose={() => setWizardOpen(false)}
        storeId={storeId}
        deviceId={deviceId}
        actor={actor}
        mode="direct"
        onIssued={() => { load(); }}
      />
    </View>
  );
}

// SupplierProfile — the full supplier profile UI (dark reference design).
// Mirrors CustomerProfile (design authority): same header, same stat row,
// same profile rows + notes, and the history section — with Batches in
// place of Transactions. Data arrives via props; the caller maps what it
// loads (stats, batches). Edit once here, it changes everywhere.
import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fmtG, fmt, monoStyle } from "../format";
import { ProfileRow, ProfileValue, NoteCard, shortVisitDate, fullVisitDate } from "./CustomerProfile";

const INK = "#fff";
const MUTED = "#8e8e93";
const HAIR = "#262626";
const TILE = "#2b2b2b";

function Hairline() {
  return <View style={{ height: 1, backgroundColor: HAIR }} />;
}

export function batchStatusLabel(status?: string | null): string {
  const s = String(status ?? "pending").toLowerCase();
  if (s === "received") return "Resevwa";
  if (s === "denied") return "Refize";
  return "Tann";
}

function batchChip(status?: string | null) {
  const s = String(status ?? "pending").toLowerCase();
  if (s === "received") return { bg: "#16321F", fg: "#4ADE80" };
  if (s === "denied") return { bg: "#3A1512", fg: "#FF8A80" };
  return { bg: TILE, fg: "#FFD60A" };
}

export type SupplierStats = {
  batches: number;
  lastBatch: string | null;
  firstBatch: string | null;
};

export function SupplierProfileBody({ supplier, stats, batches, onOpenBatch, onViewAll, isOwner }: {
  supplier: any;
  stats: SupplierStats;
  batches: any[];
  onOpenBatch?: (b: any) => void;
  onViewAll?: () => void;
  isOwner?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? (batches ?? []) : (batches ?? []).slice(0, 3);
  const totalPaid = (batches ?? []).reduce((s: number, b: any) => s + Number(b?.total_paid ?? 0), 0);
  return (
    <View style={{ backgroundColor: "#000" }}>

      <Text style={{ fontWeight: "800", fontSize: 28, color: INK, letterSpacing: -0.5 }} numberOfLines={2}>{supplier?.name ?? "Founisè"}</Text>

      <View style={{ flexDirection: "row", marginTop: 20 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, color: MUTED }}>Batches</Text>
          <Text style={{ fontWeight: "800", fontSize: 32, color: INK, marginTop: 4, ...monoStyle }}>{stats.batches}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: HAIR, marginHorizontal: 14 }} />
        <View style={{ flex: 1.4 }}>
          <Text style={{ fontSize: 15, color: MUTED }}>Last batch</Text>
          <Text style={{ fontWeight: "800", fontSize: 32, color: INK, marginTop: 4 }} numberOfLines={1}>{shortVisitDate(stats.lastBatch)}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: HAIR, marginHorizontal: 14 }} />
        <View style={{ flex: 1.4 }}>
          <Text style={{ fontSize: 15, color: MUTED }}>First batch</Text>
          <Text style={{ fontWeight: "800", fontSize: 32, color: INK, marginTop: 4 }} numberOfLines={1}>{shortVisitDate(stats.firstBatch)}</Text>
        </View>
      </View>

      <View style={{ height: 5, backgroundColor: TILE, borderRadius: 3, marginTop: 20 }} />

      <ProfileRow label="Total peye"><ProfileValue>{fmtG(totalPaid)}</ProfileValue></ProfileRow>
      <Hairline />
      {supplier?.phone ? (
        <>
          <ProfileRow label="Telefòn"><ProfileValue>{supplier.phone}</ProfileValue></ProfileRow>
          <Hairline />
        </>
      ) : null}
      {supplier?.address ? (
        <>
          <ProfileRow label="Adrès"><ProfileValue>{supplier.address}</ProfileValue></ProfileRow>
          <Hairline />
        </>
      ) : null}
      {supplier?.payment_terms ? (
        <>
          <ProfileRow label="Kondisyon peman"><ProfileValue>{supplier.payment_terms}</ProfileValue></ProfileRow>
          <Hairline />
        </>
      ) : null}
      {isOwner ? (
        <>
          <ProfileRow label="Enfòmasyon labank (sansib)"><ProfileValue>{supplier?.bank_info || "—"}</ProfileValue></ProfileRow>
          <Hairline />
        </>
      ) : (
        <>
          <ProfileRow label="Enfòmasyon labank (sansib)"><ProfileValue>•••••• — Kache · Owner sèlman 🔒</ProfileValue></ProfileRow>
          <Hairline />
        </>
      )}

      <View style={{ paddingVertical: 14 }}>
        <Text style={{ fontWeight: "800", fontSize: 20, color: INK, letterSpacing: -0.3 }}>Nòt</Text>
        {supplier?.notes ? (
          <NoteCard text={supplier.notes} date={fullVisitDate(supplier.updated_at ?? supplier.created_at ?? null)} dark />
        ) : (
          <Text style={{ fontSize: 15, color: MUTED, marginTop: 8 }}>Pa gen nòt.</Text>
        )}
      </View>
      <Hairline />

      <View style={{ paddingVertical: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "800", fontSize: 20, color: INK, letterSpacing: -0.3 }}>Batches</Text>
          {onViewAll ? (
            <Pressable onPress={onViewAll} hitSlop={8}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: INK, textDecorationLine: "underline" }}>View all</Text>
            </Pressable>
          ) : (batches ?? []).length > 3 ? (
            <Pressable onPress={() => setShowAll(v => !v)} hitSlop={8}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: INK, textDecorationLine: "underline" }}>{showAll ? "Show less" : "View all"}</Text>
            </Pressable>
          ) : null}
        </View>
        {visible.length === 0 ? (
          <Text style={{ fontSize: 15, color: MUTED, marginTop: 8 }}>Pa gen batch.</Text>
        ) : (
          visible.map((b: any, i: number) => <BatchRow key={String(b.id ?? i)} batch={b} onPress={() => onOpenBatch?.(b)} />)
        )}
      </View>
    </View>
  );
}

function BatchRow({ batch, onPress }: { batch: any; onPress: () => void }) {
  const chip = batchChip(batch?.status);
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: HAIR }}>
      <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: TILE, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="cube-outline" size={24} color={INK} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "800", fontSize: 17, color: INK, letterSpacing: -0.2 }} numberOfLines={1}>
          {fmtG(Number(batch?.total_paid ?? 0))} | {batchStatusLabel(batch?.status)}
        </Text>
        <Text style={{ fontSize: 14, color: MUTED, marginTop: 2 }} numberOfLines={1}>
          {shortVisitDate(batch?.date ?? batch?.created_at ?? null)}{batch?.delivery_ref ? ` · ${batch.delivery_ref}` : ""}
        </Text>
      </View>
      <View style={{ backgroundColor: chip.bg, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 }}>
        <Text style={{ fontSize: 11, fontWeight: "800", color: chip.fg }}>{fmt(Number(batch?.quantity ?? 0))}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={MUTED} />
    </Pressable>
  );
}

// Full supplier batch list — opened from "View all": back + centered title
// + rows with icon tile, no chevrons (mirrors CustomerTxnsList).
export function SupplierBatchesList({ batches, onOpenBatch }: {
  batches: any[];
  onOpenBatch?: (b: any) => void;
}) {
  return (
    <View style={{ backgroundColor: "#000" }}>
      {(batches ?? []).length === 0 ? (
        <Text style={{ fontSize: 15, color: MUTED, marginTop: 8 }}>Pa gen batch.</Text>
      ) : (
        (batches ?? []).map((b: any, i: number) => {
          const chip = batchChip(b?.status);
          return (
            <View key={String(b.id ?? i)}>
              <Pressable onPress={() => onOpenBatch?.(b)} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 16 }}>
                <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: TILE, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="cube-outline" size={28} color={INK} />
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={{ fontWeight: "800", fontSize: 19, color: INK, letterSpacing: -0.2 }} numberOfLines={1}>
                    {fmtG(Number(b?.total_paid ?? 0))} | {batchStatusLabel(b?.status)}
                  </Text>
                  <Text style={{ fontSize: 15, color: MUTED, marginTop: 3 }} numberOfLines={1}>
                    {shortVisitDate(b?.date ?? b?.created_at ?? null)} · {fmt(Number(b?.quantity ?? 0))} u
                    {b?.delivery_ref ? ` · ${b.delivery_ref}` : ""}
                  </Text>
                </View>
                <View style={{ backgroundColor: chip.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: chip.fg }}>{batchStatusLabel(b?.status)}</Text>
                </View>
              </Pressable>
              <Hairline />
            </View>
          );
        })
      )}
    </View>
  );
}

// One batch, opened from a row (the supplier analogue of TxnDetailBody).
export function SupplierBatchDetailBody({ batch, itemLabel, productName }: {
  batch: any;
  itemLabel?: string | null;
  productName?: string | null;
}) {
  const qty = Number(batch?.quantity ?? 0);
  const total = Number(batch?.total_paid ?? 0);
  const unit = qty > 0 ? total / qty : 0;
  const status = String(batch?.status ?? "pending");
  const chip = batchChip(status);
  return (
    <View style={{ backgroundColor: "#000" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: TILE, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="cube-outline" size={28} color={INK} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "800", fontSize: 22, color: INK, letterSpacing: -0.3, ...monoStyle }}>{fmtG(total)}</Text>
          <Text style={{ fontSize: 15, color: MUTED, marginTop: 2 }} numberOfLines={1}>{productName || itemLabel || "Atik"}</Text>
        </View>
        <View style={{ backgroundColor: chip.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: "800", color: chip.fg }}>{batchStatusLabel(status)}</Text>
        </View>
      </View>

      <View style={{ height: 5, backgroundColor: TILE, borderRadius: 3, marginTop: 20 }} />

      <ProfileRow label="Kantite"><ProfileValue>{fmt(qty)}</ProfileValue></ProfileRow>
      <Hairline />
      <ProfileRow label="Koste inite"><ProfileValue>{fmtG(unit, 2)}</ProfileValue></ProfileRow>
      <Hairline />
      <ProfileRow label="Total peye"><ProfileValue>{fmtG(total)}</ProfileValue></ProfileRow>
      <Hairline />
      <ProfileRow label="Transport"><ProfileValue>{fmtG(Number(batch?.transport_share ?? 0))}</ProfileValue></ProfileRow>
      <Hairline />
      {batch?.delivery_ref ? (
        <>
          <ProfileRow label="Referans livrezon"><ProfileValue>{batch.delivery_ref}</ProfileValue></ProfileRow>
          <Hairline />
        </>
      ) : null}
      <ProfileRow label="Dat"><ProfileValue>{fullVisitDate(batch?.date ?? batch?.created_at ?? null)}</ProfileValue></ProfileRow>
      <Hairline />
      {status === "received" && batch?.received_at ? (
        <>
          <ProfileRow label="Resevwa"><ProfileValue>{fullVisitDate(batch.received_at)}</ProfileValue></ProfileRow>
          <Hairline />
        </>
      ) : null}
      {status === "denied" ? (
        <>
          {batch?.denied_at ? (
            <>
              <ProfileRow label="Refize"><ProfileValue>{fullVisitDate(batch.denied_at)}</ProfileValue></ProfileRow>
              <Hairline />
            </>
          ) : null}
          {batch?.reason ? (
            <>
              <ProfileRow label="Rezon"><ProfileValue>{batch.reason}</ProfileValue></ProfileRow>
              <Hairline />
            </>
          ) : null}
        </>
      ) : null}
      <ProfileRow label="Sous"><ProfileValue>{String(batch?.source ?? "user") === "auto" ? "Automatik" : "Itizatè"}</ProfileValue></ProfileRow>
      <Hairline />
    </View>
  );
}

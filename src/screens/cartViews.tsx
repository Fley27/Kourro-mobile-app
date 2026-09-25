// Shared in-sheet views for the cart customer/menu flow — rendered INSIDE the
// cart sheet (phone) or cart panel (tablet), never as stacked Modal windows.
// One focused view at a time with back navigation = modal behavior, no
// window-stacking involved. The form body is the single shared CustomerForm.
import React, { useEffect, useRef } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Modal, ActivityIndicator, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette } from "../theme";
import { fmtG, fmt, monoStyle } from "../format";
import CustomerForm, { deptName, countryName, type CustomerFormData } from "../components/CustomerForm";
import { NewCustomerFormBody, EditCustomerFormBody } from "../components/CustomerSheets";
import { CustomerProfileBody, fullVisitDate, NoteCard } from "../components/CustomerProfile";
export { CustomerProfileBody };
import { PAYMENT_LABELS, fmtDateTime } from "../receipts";

export function CartMenuView({ onLouvriFakti, onClearCart, onDismiss }: {
  onLouvriFakti: () => void;
  onClearCart: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={{ gap: 10, paddingVertical: 6 }}>
      <Pressable
        onPress={onLouvriFakti}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#000814", borderRadius: 14, height: 60, paddingHorizontal: 14 }}
      >
        <Ionicons name="reader-outline" size={16} color="#fff" />
          <Text style={{ flex: 1, fontWeight: "800", fontSize: 14, color: "#fff" }}>Ouvèti-Kont</Text>
        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
      </Pressable>
      <Pressable
        onPress={onClearCart}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#16130c", borderRadius: 14, height: 60, paddingHorizontal: 14 }}
      >
        <Ionicons name="trash-bin-outline" size={16} color="#fff" />
        <Text style={{ flex: 1, fontWeight: "800", fontSize: 14, color: "#fff" }}>Vide Panyen</Text>
        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
      </Pressable>
      <Pressable onPress={onDismiss} style={{ paddingVertical: 8, alignItems: "center" }}>
        <Text style={{ color: "#16130c", fontWeight: "700", fontSize: 14, textDecorationLine: "underline" }}>Dismiss</Text>
      </Pressable>
    </View>
  );
}

export function CartCustomersView({ search, onSearch, results, onPick, onOpenNew, dark, showDebtOnly, onToggleDebtOnly }: {
  search: string;
  onSearch: (v: string) => void;
  results: any[];
  onPick: (c: any) => void;
  onOpenNew: () => void;
  dark?: boolean;
  showDebtOnly?: boolean;
  onToggleDebtOnly?: () => void;
}) {
  // Dark reference design (CustomerScreen phone list): pill search + filter,
  // initial tiles, name + contact rows with hairline separators on black.
  if (dark) {
    const sorted = [...results].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <View style={{ flex: 1, height: 52, flexDirection: "row", alignItems: "center", backgroundColor: "#000", borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 26, paddingHorizontal: 16 }}>
            <Ionicons name="search" size={20} color="#fff" style={{ marginRight: 10 }} />
            <TextInput
              value={search}
              onChangeText={onSearch}
              placeholder="Chèche"
              placeholderTextColor="#8e8e93"
              style={{ flex: 1, fontSize: 16, color: "#fff", paddingVertical: 10 }}
              returnKeyType="search"
            />
            {search.length > 0 ? (
              <Pressable onPress={() => onSearch("")} hitSlop={8} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={18} color="#8e8e93" />
              </Pressable>
            ) : null}
          </View>
          {onToggleDebtOnly ? (
            <Pressable
              onPress={onToggleDebtOnly}
              style={{
                width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center",
                backgroundColor: showDebtOnly ? "#fff" : "#000",
                borderWidth: 1, borderColor: showDebtOnly ? "#fff" : "#3a3a3c",
              }}
            >
              <Ionicons name="filter" size={20} color={showDebtOnly ? "#000" : "#fff"} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {sorted.length === 0 ? (
            <View style={{ padding: 32, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>Pa gen kliyan</Text>
              <Text style={{ color: "#8e8e93", fontSize: 13, marginTop: 4 }}>Eseye yon lòt rechèch</Text>
            </View>
          ) : (
            sorted.map(c => (
              <Pressable key={c.id} onPress={() => onPick(c)}>
                <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14 }}>
                  <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#8e8e93", fontSize: 17, fontWeight: "700" }}>{initialsOf(c.name)}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: "#fff", fontSize: 17, fontWeight: "600" }} numberOfLines={1}>{c.name}</Text>
                    <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 2 }} numberOfLines={1}>{c.phone ?? c.id_card_number ?? "—"}</Text>
                  </View>
                </View>
                <View style={{ height: 1, backgroundColor: "#262626", marginLeft: 64 }} />
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 12, height: 44 }}>
        <Ionicons name="search" size={15} color="#94A3B8" style={{ marginRight: 8 }} />
        <TextInput value={search} onChangeText={onSearch} placeholder="Chèche kliyan (non, NIF, telefòn)" placeholderTextColor="#94A3B8" style={{ flex: 1, fontSize: 13, color: "#0F172A" }} />
        {search.length > 0 && <Pressable onPress={() => onSearch("")} hitSlop={8} style={{ padding: 4 }}><Text style={{ color: "#94A3B8", fontSize: 12, fontWeight: "600" }}>✕</Text></Pressable>}
      </View>
      <ScrollView style={{ flex: 1, marginTop: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!search.trim() ? (
          <Text style={{ fontSize: 12, color: "#fff", fontWeight: "800", letterSpacing: 0.6, marginBottom: 8 }}>Apèn Kreye</Text>
        ) : null}
        {results.length === 0 ? (
          <View style={{ padding: 20, alignItems: "center" }}><Text style={{ color: "#94a3b8", fontWeight: "600", fontSize: 13 }}>Pa jwenn kliyan</Text></View>
        ) : (
          results.map(c => (
            <Pressable key={c.id} onPress={() => onPick(c)} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 12, borderWidth: 1, borderColor: "#F1F5F9", backgroundColor: "white", marginBottom: 6 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#F8FAFC", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 14, color: "#475569", fontWeight: "700" }}>{(c.name?.[0] ?? "•").toUpperCase()}</Text>
              </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "700", fontSize: 13, color: "#0F172A" }} numberOfLines={1}>{c.name}</Text>
                        <Text style={{ fontSize: 11, color: "#94A3B8" }} numberOfLines={1}>{c.phone ?? "—"}</Text>
                        <Text style={{ fontSize: 11, color: "#94A3B8", fontWeight: "700" }} numberOfLines={1}>{c.id_card_number ?? "—"}</Text>
                      </View>
              <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

export function NewCustomerView({ formKey, initial, onFormState }: {
  formKey: number;
  initial?: Partial<CustomerFormData>;
  onFormState: (data: any, valid: boolean) => void;
}) {
  return <NewCustomerFormBody formKey={formKey} initial={initial} onFormState={onFormState} />;
}

export function EditCustomerView({ formKey, initial, onFormState, notes, noteInput, onNoteInput, savingNote, onAddNote, notesLimit }: {
  formKey: number;
  initial?: Partial<CustomerFormData>;
  onFormState: (data: any, valid: boolean) => void;
  notes: any[];
  noteInput: string;
  onNoteInput: (v: string) => void;
  savingNote: boolean;
  onAddNote: () => void;
  notesLimit?: number;
}) {
  return (
    <EditCustomerFormBody
      formKey={formKey}
      initial={initial}
      onFormState={onFormState}
      notes={notes}
      noteInput={noteInput}
      onNoteInput={onNoteInput}
      savingNote={savingNote}
      onAddNote={onAddNote}
      notesLimit={notesLimit}
    />
  );
}

export function CustomerDetailBody({ customer, stats, notes, onViewProfile, onRemove, hideActions, lastVisitItems, lastVisitDate, onAddItem, addedProductIds }: {
  customer: any;
  stats: { visits: number; spent: number; lastVisit: string | null; firstVisit: string | null };
  notes: any[];
  onViewProfile: () => void;
  onRemove: () => void;
  hideActions?: boolean;
  lastVisitItems?: any[];
  lastVisitDate?: string | null;
  onAddItem?: (item: any) => void;
  addedProductIds?: string[];
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontWeight: "800", fontSize: 28, color: "#fff", letterSpacing: -0.3 }} numberOfLines={2}>{customer?.name ?? "Kliyan"}</Text>
      {(customer?.email || customer?.phone) ? (
        <View style={{ marginTop: 10, gap: 8 }}>
          {customer?.email ? <Text style={{ fontSize: 17, color: "#8e8e93" }}>{customer.email}</Text> : null}
          {customer?.marketing_consent ? (
            <View style={{ alignSelf: "flex-start", backgroundColor: "rgba(48,209,88,0.15)", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: "#30D158" }}>Email subscribed</Text>
            </View>
          ) : null}
          {customer?.phone ? <Text style={{ fontSize: 17, color: "#8e8e93" }}>{customer.phone}</Text> : null}
        </View>
      ) : null}
      <Text style={{ marginTop: 10, fontSize: 17, fontWeight: "800", color: "#fff" }}>
        {stats.visits} visits <Text style={{ color: "#8e8e93", fontWeight: "600" }}>|</Text>  {fmt(stats.spent)} spent
      </Text>
      <View style={{ height: 10, backgroundColor: "#262626", borderRadius: 5, marginVertical: 20 }} />
      <View style={{ paddingBottom: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "800", fontSize: 22, color: "#fff" }}>Last visit</Text>
          {lastVisitDate ? (
            <Text style={{ fontSize: 16, color: "#8e8e93" }}>{fullVisitDate(lastVisitDate)}</Text>
          ) : null}
        </View>
        {(lastVisitItems ?? []).length > 0 ? (
          (lastVisitItems ?? []).map((it: any, i: number) => {
            const added = (addedProductIds ?? []).includes(String(it.product_id ?? ""));
            return (
            <View key={String(it.id ?? i)} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 }}>
              <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: "#6B7280", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 20 }}>{initialsOf(it.product_name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", fontSize: 17, color: "#fff" }} numberOfLines={1}>{it.product_name ?? "Atik"}</Text>
                <Text style={{ fontSize: 15, color: "#8e8e93", marginTop: 2 }} numberOfLines={1}>{it.variant ?? "Regular"}</Text>
              </View>
              {added ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, height: 44, borderRadius: 22, backgroundColor: palette.successBg, borderWidth: 1, borderColor: palette.successBd }}>
                  <Ionicons name="checkmark" size={18} color={palette.successDot} />
                  <Text style={{ color: palette.successDot, fontWeight: "800", fontSize: 14 }}>Added</Text>
                </View>
              ) : (
                <Pressable onPress={() => onAddItem?.(it)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, height: 44, borderRadius: 22, backgroundColor: "#3a3a3c" }}>
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>Add</Text>
                </Pressable>
              )}
            </View>
            );
          })
        ) : (
          <Text style={{ fontSize: 15, color: "#8e8e93", marginTop: 8 }}>Pokò gen vizit.</Text>
        )}
        </View>
      <View style={{ height: 10, backgroundColor: "#262626", borderRadius: 5, marginVertical: 20 }} />
      <View style={{ paddingBottom: 4 }}>
        <Text style={{ fontWeight: "800", fontSize: 22, color: "#fff" }}>Notes</Text>
        {notes.length === 0 ? (
          <Text style={{ fontSize: 15, color: "#8e8e93", marginTop: 8 }}>Pa gen nòt pou kliyan sa a.</Text>
        ) : (
          notes.slice(0, 2).map(n => (
            <NoteCard key={n.id} text={n.text} date={fullVisitDate(n.created_at)} dark />
          ))
        )}
      </View>
      {!hideActions ? (
        <View style={{ marginTop: 20, gap: 10, paddingBottom: 8 }}>
          <Pressable onPress={onViewProfile} style={{ height: 60, borderRadius: 30, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#000", fontWeight: "800", fontSize: 17 }}>View full profile</Text>
          </Pressable>
          <Pressable onPress={onRemove} style={{ height: 60, borderRadius: 30, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>Remove from sale</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function txnPaymentIcon(method: string): "cash-outline" | "phone-portrait-outline" | "card-outline" {
  const m = String(method ?? "cash").toLowerCase();
  if (m === "moncash" || m === "natcash" || m === "mobile" || m === "mobile_money") return "phone-portrait-outline";
  if (m === "credit") return "card-outline";
  return "cash-outline";
}

function initialsOf(name: string): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const s = parts.map(w => (w[0] ?? "").toUpperCase()).join("");
  return s || "•";
}

export function TenderView({ mode, subtotal, tenderInput, onKey, onTender }: {
  mode: "cash" | "credit";
  subtotal: number;
  tenderInput: string;
  onKey: (k: string) => void;
  onTender: () => void;
}) {
  const entered = tenderInput === "" ? 0 : Number(tenderInput);
  // Empty input = exact amount — always valid, transaction goes through.
  const valid = mode === "cash"
    ? tenderInput === "" || entered >= subtotal
    : entered <= subtotal;
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"];
  return (
    <View style={{ flex: 1 }}>
      <View style={{ borderWidth: 1, borderColor: "#3a3a3c", backgroundColor: "#111", borderRadius: 12, padding: 16, marginTop: 12 }}>
        <Text style={{ fontSize: 20, color: tenderInput === "" ? "#8e8e93" : "#fff", ...monoStyle }}>
          {tenderInput === "" ? `${fmtG(subtotal)}` : `${fmtG(entered)}`}
        </Text>
      </View>
      <Pressable onPress={onTender} disabled={!valid} style={{ marginTop: 12, height: 56, borderRadius: 12, backgroundColor: valid ? "#fff" : "#3a3a3c", alignItems: "center", justifyContent: "center", opacity: valid ? 1 : 0.6 }}>
        <Text style={{ color: valid ? "#16130c" : "#8e8e93", fontWeight: "800", fontSize: 16 }}>Touche</Text>
      </Pressable>
      <View style={{ flex: 1 }} />
      <View style={{ marginHorizontal: -16, marginBottom: -14, borderTopWidth: 0.5, borderTopColor: "#262626" }}>
        {[0, 1, 2, 3].map(r => (
          <View key={r} style={{ flexDirection: "row", borderTopWidth: r === 0 ? 0 : 0.5, borderTopColor: "#262626" }}>
            {[0, 1, 2].map(ci => {
              const k = keys[r * 3 + ci];
              return (
                <Pressable key={ci} onPress={() => onKey(k)} style={{ flex: 1, height: 62, alignItems: "center", justifyContent: "center", backgroundColor: "transparent", borderRightWidth: ci < 2 ? 0.5 : 0, borderRightColor: "#262626" }}>
                  {k === "back" ? (
                    <Ionicons name="backspace-outline" size={24} color="#fff" />
                  ) : (
                    <Text style={{ fontSize: 26, fontWeight: "500", color: "#fff" }}>{k}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

export function TxnDetailBody({ sale, items, customer, onNewReceipt, dueBalance, totalPaid, payments, onPayPress }: {
  sale: any;
  items: any[];
  customer: any | null;
  onNewReceipt?: () => void;
  dueBalance?: number | null;
  totalPaid?: number | null;
  payments?: any[];
  onPayPress?: () => void;
}) {
  const total = Number(sale?.total ?? 0);
  const method = String(sale?.payment_method ?? "cash");
  const methodLabel = (PAYMENT_LABELS as Record<string, string>)[method] ?? method;
  return (
    <View style={{ backgroundColor: "#000", marginTop: 30 }}>
      {onPayPress && (dueBalance ?? 0) > 0 ? (
        <Pressable onPress={onPayPress} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", height: 60, borderRadius: 14, backgroundColor: "#fff", marginBottom: 10 }}>
          <Text style={{ color: "#16130c", fontWeight: "800", fontSize: 16 }}>Touche</Text>
        </Pressable>
      ) : null}
      {onNewReceipt ? (
        <Pressable onPress={onNewReceipt} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", height: 56, borderRadius: 14, backgroundColor: "#48484a", marginBottom: 30 }}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>New receipt</Text>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
        <Text style={{ fontWeight: "700", fontSize: 16, color: "#fff" }}>Transaction Type</Text>
        <Text style={{ fontSize: 14, color: "#8e8e93" }}>{fmtDateTime(sale?.created_at)}</Text>
      </View>
      <View style={{ height: 1, backgroundColor: "#262626", marginTop: 10 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
        <Ionicons name={txnPaymentIcon(method)} size={24} color="#64748B" />
        <Text style={{ flex: 1, fontWeight: "700", fontSize: 16, color: "#fff" }}>{methodLabel}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
        <Ionicons name="receipt-outline" size={24} color="#64748B" />
        <Text style={{ flex: 1, fontWeight: "700", fontSize: 16, color: "#fff" }} numberOfLines={1}>Receipt #{sale?.sale_number ?? sale?.id ?? "—"}</Text>
      </View>
      {customer ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14 }}>
            <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#8e8e93", fontSize: 17, fontWeight: "700" }}>{initialsOf(customer?.name)}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: "#fff", fontSize: 17, fontWeight: "600" }} numberOfLines={1}>{customer?.name ?? "Kliyan"}</Text>
              <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 2 }} numberOfLines={1}>
                {[customer?.phone, customer?.id_card_number].filter(Boolean).join(" | ") || "—"}
              </Text>
            </View>
          </View>
          <View style={{ height: 1, backgroundColor: "#262626" }} />
        </>
      ) : null}
      {payments !== undefined ? (
        <>
          <Text style={{ fontWeight: "800", fontSize: 22, color: "#fff", letterSpacing: -0.3, marginTop: 16 }}>Payments</Text>
          <View style={{ height: 1, backgroundColor: "#262626", marginTop: 10 }} />
          {payments.length === 0 ? (
            <Text style={{ fontSize: 15, color: "#8e8e93", marginTop: 8 }}>Pa gen peman.</Text>
          ) : (
            payments.map((p: any, i: number) => (
              <View key={String(p.id ?? i)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="cash-outline" size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff", ...monoStyle }}>{fmtG(Number(p.amount ?? 0))}</Text>
                  <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>{(PAYMENT_LABELS as Record<string, string>)[String(p.payment_method ?? "cash")] ?? p.payment_method ?? "cash"}{p.receipt_number ? ` • ${p.receipt_number}` : ""}</Text>
                </View>
                <Text style={{ fontSize: 12, color: "#8e8e93" }}>{fmtDateTime(p.created_at)}</Text>
              </View>
            ))
          )}
        </>
      ) : null}
      <Text style={{ fontWeight: "800", fontSize: 22, color: "#fff", letterSpacing: -0.3, marginTop: 16 }}>Items</Text>
      <View style={{ height: 1, backgroundColor: "#262626", marginTop: 10 }} />
      {items.length === 0 ? (
        <Text style={{ fontSize: 15, color: "#94A3B8", marginTop: 8 }}>Pa gen atik.</Text>
      ) : (
        items.map((it: any, i: number) => (
          <View key={String(it.id ?? i)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
            <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: "#6B7280", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>{initialsOf(it.product_name)}</Text>
            </View>
            <Text style={{ flex: 1, fontWeight: "700", fontSize: 16, color: "#fff" }} numberOfLines={1}>
              {it.product_name ?? "Atik"} <Text style={{ fontWeight: "400", color: "#8e8e93" }}>×{Number(it.quantity ?? 0)}</Text>
            </Text>
            <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff", ...monoStyle }}>{fmtG(Number(it.line_total ?? 0))}</Text>
          </View>
        ))
      )}
      <Text style={{ fontWeight: "800", fontSize: 22, color: "#fff", letterSpacing: -0.3, marginTop: 16 }}>Total</Text>
      <View style={{ height: 1, backgroundColor: "#262626", marginTop: 10 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
        <Ionicons name="receipt-outline" size={24} color="#64748B" />
        <Text style={{ flex: 1, fontWeight: "700", fontSize: 16, color: "#fff" }}>Total sale</Text>
        <Text style={{ fontWeight: "800", fontSize: 16, color: "#fff", ...monoStyle }}>{fmtG(total)}</Text>
      </View>
      {totalPaid != null ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
          <Ionicons name="checkmark-circle-outline" size={24} color="#64748B" />
          <Text style={{ flex: 1, fontWeight: "700", fontSize: 16, color: "#fff" }}>Total paid</Text>
          <Text style={{ fontWeight: "800", fontSize: 16, color: "#fff", ...monoStyle }}>{fmtG(Number(totalPaid))}</Text>
        </View>
      ) : null}
      {dueBalance != null ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#262626" }}>
          <Ionicons name="alert-circle-outline" size={24} color="#64748B" />
          <Text style={{ flex: 1, fontWeight: "700", fontSize: 16, color: "#fff" }}>Due balance</Text>
          <Text style={{ fontWeight: "800", fontSize: 16, color: Number(dueBalance) > 0 ? "#fbbf24" : "#fff", ...monoStyle }}>{fmtG(Number(dueBalance))}</Text>
        </View>
      ) : null}
    </View>
  );
}

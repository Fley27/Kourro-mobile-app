// Per-customer credit decision support — a full-height modal over the report:
// what they owe, how they pay (amount vs. time to clear, every payment laid
// out), and what a reasonable limit would be, with the arithmetic next to
// every suggestion. Nothing here blocks a sale; it informs the owner's
// decision — the two buttons write the limit the owner picks.
import React, { useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { Text } from "../../components/InterText";
import { Ionicons } from "@expo/vector-icons";
import { fmtG, monoStyle } from "../../format";
import { getDb, insertOutbox } from "../../db";
import { useResponsive } from "../../responsive";
import { ComboChart, LineChart } from "../../components/charts";
import {
  customerPaymentHistory,
  customerProfile,
  type Behavior,
  type CreditRow,
  type CustomerRow,
  type PaymentRow,
} from "../../creditAnalytics";
import { SafeScreen } from "../../components/SafeScreen";
import { KeyboardSafeScrollView } from "../../components/KeyboardSafe";
import { mintId } from "../../db/ids";

const BG = "rgba(0,0,0,0.96)";
const CARD = "rgba(255,255,255,0.05)";
const CARD_BD = "rgba(255,255,255,0.09)";
const LINE = "rgba(255,255,255,0.09)";
const RADIUS = 24;
const GOLD = "#c8a24a";
const GREEN = "#5ce68a";
const GREEN_TINT = "rgba(92,230,138,0.10)";
const GREEN_BD = "rgba(92,230,138,0.35)";
const AMBER = "#f0a63c";
const RED = "#e06c5b";
const TXT = "#ffffff";
const TXT2 = "#9a9a9e";
const TXT3 = "#6e6e73";
const INK = "#0a0a0a";

const EYEBROW = {
  fontSize: 11,
  fontWeight: "700" as const,
  textTransform: "uppercase" as const,
  letterSpacing: 2,
  color: TXT2,
};

const SQUARE = {
  width: 48,
  height: 48,
  borderRadius: 16,
  backgroundColor: CARD,
  borderWidth: 1,
  borderColor: CARD_BD,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

const BEHAVIOR_BADGE: Record<Behavior, { label: string; color: string; bg: string }> = {
  "full-payer": { label: "Full payer", color: GREEN, bg: GREEN_TINT },
  improving: { label: "Improving", color: GREEN, bg: GREEN_TINT },
  "partial-payer": { label: "Partial payer", color: AMBER, bg: "rgba(240,166,60,0.16)" },
  slipping: { label: "Payments weakening", color: RED, bg: "rgba(224,108,91,0.16)" },
  "no-history": { label: "No history", color: TXT2, bg: "rgba(255,255,255,0.08)" },
};

const fullDate = (t: number) =>
  new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const shortDate = (t: number) =>
  new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

function CardHead({ title, subtitle, icon }: { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <View style={{ flex: 1, paddingTop: 2 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", letterSpacing: -0.4, color: TXT }}>{title}</Text>
        <Text style={{ fontSize: 14, color: TXT2, marginTop: 5, lineHeight: 19 }}>{subtitle}</Text>
      </View>
      <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: CARD, borderWidth: 1, borderColor: CARD_BD, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={19} color={GREEN} />
      </View>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 130 }}>
      <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", color: TXT3 }}>{label}</Text>
      <Text style={{ fontSize: 17, fontWeight: "800", color: tone ?? TXT, marginTop: 5, ...monoStyle }}>{value}</Text>
    </View>
  );
}

export default function CreditCustomerProfile({
  customerId,
  credits,
  payments,
  customers,
  onClose,
  onChanged,
}: {
  customerId: string;
  credits: CreditRow[];
  payments: PaymentRow[];
  customers: CustomerRow[];
  onClose: () => void;
  /** Called after a limit write so the report behind the modal can reload. */
  onChanged?: () => void;
}) {
  const { padH } = useResponsive();
  const p = useMemo(
    () => customerProfile({ customerId, credits, payments, customers }),
    [customerId, credits, payments, customers]
  );
  const hist = useMemo(
    () => customerPaymentHistory({ customerId, credits, payments }),
    [customerId, credits, payments]
  );

  const badge = BEHAVIOR_BADGE[p.behavior];
  const now = Date.now();
  const daysUntilDue = p.dueAt ? Math.ceil((p.dueAt - now) / 86400000) : null;
  const overdueTone = p.balance <= 0 ? GREEN : p.daysOverdue > 0 ? RED : AMBER;
  const overdueText = p.balance <= 0
    ? "Paid in full"
    : p.daysOverdue > 0
      ? `${p.daysOverdue} day${p.daysOverdue === 1 ? "" : "s"} overdue`
      : daysUntilDue !== null && daysUntilDue >= 0
        ? `Due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`
        : "Open";

  // Payment pattern — last five cleared invoices, oldest → newest left to right.
  const chartRows = hist.slice(0, 5).reverse();
  const patternBars = chartRows.map(r => ({ label: shortDate(r.at), value: r.amount }));
  const patternLine = chartRows.map(r => r.daysToClear);

  // Repayment rate (their own cohort series, same rule as the business card).
  const cohortPoints = p.cohorts
    .filter(c => c.rate !== null)
    .map(c => ({ label: c.label, value: c.rate as number }));
  const lastCohort = cohortPoints.length ? cohortPoints[cohortPoints.length - 1] : null;
  const avgRate = cohortPoints.length
    ? Math.round(cohortPoints.reduce((a, c) => a + c.value, 0) / cohortPoints.length)
    : 0;

  // Limit movement for the suggested-limit card.
  const roomPct =
    p.currentLimit && p.currentLimit > 0 && p.suggestedLimit !== null
      ? Math.round(((p.suggestedLimit - p.currentLimit) / p.currentLimit) * 100)
      : null;
  const roomUp = (roomPct ?? 0) > 0;

  const [editing, setEditing] = useState<null | "update" | "reduce">(null);
  const [limitText, setLimitText] = useState("");
  const [saving, setSaving] = useState(false);

  // The limit field is required: the editor opens EMPTY and Save stays off
  // until a positive amount is typed. What is already on file (the saved
  // limit, else the suggestion) rides in the placeholder, so the owner always
  // sees the number they are replacing without it counting as an edit.
  const parsedLimit = Math.round(Number(String(limitText).replace(/[^\d.]/g, "")));
  const limitValid = Number.isFinite(parsedLimit) && parsedLimit > 0;
  const limitPlaceholder =
    p.currentLimit !== null && p.currentLimit > 0
      ? String(Math.round(p.currentLimit))
      : p.suggestedLimit !== null
        ? String(Math.round(p.suggestedLimit))
        : "Required";

  function openEditor(kind: "update" | "reduce") {
    if (kind === "update" && p.suggestedLimit === null) {
      Alert.alert("No suggestion yet", "Issue credit first — the suggested limit is the median of the credit they've already been given.");
      return;
    }
    setLimitText("");
    setEditing(kind);
  }

  async function saveLimit() {
    if (!limitValid) {
      Alert.alert("Limit required", "Enter the new credit limit before saving.");
      return;
    }
    const value = parsedLimit;
    const oldLimit = p.currentLimit;
    if (value === oldLimit) {
      setEditing(null);
      return;
    }
    setSaving(true);
    try {
      const db = await getDb();
      await db.runAsync("UPDATE customers SET credit_limit = ?, credit_limit_source = ? WHERE id = ?", [
        value,
        "manual",
        customerId,
      ]);
      try {
        await db.runAsync(
          "INSERT INTO customer_history (id, customer_id, user_id, action, field_name, old_value, new_value, created_at) VALUES (?,?,?,?,?,?,?,?)",
          [mintId(), customerId, "credit-report", "updated", "credit_limit", oldLimit ?? null, value, new Date().toISOString()]
        );
      } catch {}
      try {
        await insertOutbox("customers", "update", {
          id: customerId,
          credit_limit: value,
          credit_limit_source: "manual",
          updated_at: new Date().toISOString(),
          lamport_clock: Date.now(),
        });
      } catch {}
      setEditing(null);
      onChanged?.();
    } catch (e: any) {
      Alert.alert("Could not save", e?.message ?? "The limit was not updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeScreen style={{ flex: 1, backgroundColor: BG }}>
        {/* Header */}
        <View style={{ paddingHorizontal: padH, paddingTop: 6, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={SQUARE}>
            <Ionicons name="close" size={22} color={TXT} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={EYEBROW}>Customer credit</Text>
            <Text numberOfLines={1} style={{ fontSize: 22, fontWeight: "800", letterSpacing: -0.5, color: TXT, marginTop: 3 }}>
              {p.name}
            </Text>
            {p.phone ? (
              <Text numberOfLines={1} style={{ fontSize: 12.5, color: TXT3, marginTop: 2 }}>{p.phone}</Text>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: badge.bg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
            <Ionicons name="time" size={13} color={badge.color} />
            <Text style={{ fontSize: 12.5, fontWeight: "800", color: badge.color }}>{badge.label}</Text>
          </View>
        </View>

        <KeyboardSafeScrollView
          contentContainerStyle={{ padding: padH, paddingTop: 16, paddingBottom: 44 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Balance */}
          <View style={{ backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 22 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ flex: 1, fontSize: 12.5, fontWeight: "700", letterSpacing: 1.8, color: TXT3 }}>Current balance</Text>
              <View style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ fontSize: 11.5, fontWeight: "800", color: overdueTone }}>{overdueText}</Text>
              </View>
            </View>
            <Text style={{ fontSize: 38, fontWeight: "800", letterSpacing: -1.2, color: TXT, marginTop: 10, ...monoStyle }}>
              {fmtG(p.balance)}
            </Text>
            <View style={{ height: 0.5, backgroundColor: LINE, marginVertical: 16 }} />
            <View style={{ flexDirection: "row", gap: 18 }}>
              <Stat label="Open credits" value={`${p.openCount} / ${p.totalCount}`} />
              <Stat label="Your limit" value={p.currentLimit !== null ? fmtG(p.currentLimit) : "—"} tone={p.currentLimit !== null ? TXT : TXT3} />
            </View>
          </View>

          {/* Payment pattern */}
          <Text style={{ ...EYEBROW, marginTop: 26 }}>Payment history</Text>
          <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={{ flex: 1, fontSize: 26, fontWeight: "800", letterSpacing: -0.6, color: TXT }}>Payment Pattern</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="time" size={16} color={badge.color} />
              <Text style={{ fontSize: 14.5, fontWeight: "700", color: badge.color }}>{badge.label}</Text>
            </View>
          </View>

          <View style={{ marginTop: 14, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 22 }}>
            <CardHead title="Amount vs. time to pay" subtitle="Last 5 cleared invoices" icon="analytics" />
            <View style={{ height: 16 }} />
            {chartRows.length ? (
              <ComboChart bars={patternBars} line={patternLine} barColor={GOLD} lineColor={GREEN} height={200} />
            ) : (
              <View style={{ height: 210, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", gap: 12 }}>
                <Ionicons name="stats-chart" size={26} color="#8a8a8e" />
                <Text style={{ fontSize: 15, color: "#8a8a8e" }}>Payment Pattern Data</Text>
              </View>
            )}
          </View>
          <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 13.5, color: TXT2 }}>Amount paid</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: GREEN }} />
              <Text style={{ fontSize: 13.5, color: TXT2 }}>Days to clear</Text>
            </View>
          </View>

          {/* Repayment rate */}
          <View style={{ marginTop: 16, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 22 }}>
            <CardHead title="Repayment Rate" subtitle="Their credit, and the share of it repaid each month" icon="analytics" />
            <View style={{ height: 16 }} />
            {cohortPoints.length ? (
              <LineChart points={cohortPoints} color={GREEN} height={175} yMin={0} yMax={100} />
            ) : (
              <View style={{ height: 150, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", gap: 12 }}>
                <Ionicons name="stats-chart" size={26} color="#8a8a8e" />
                <Text style={{ fontSize: 15, color: "#8a8a8e" }}>Repayment Rate Data</Text>
              </View>
            )}
            <Text style={{ fontSize: 12.5, color: TXT3, marginTop: 12, lineHeight: 18 }}>
              {lastCohort
                ? `${lastCohort.label}: ${Math.round(lastCohort.value)}% repaid — ${avgRate}% average across ${cohortPoints.length} month${cohortPoints.length === 1 ? "" : "s"}.`
                : "No credit issued to this customer in the last 8 months."}
            </Text>
          </View>

          {/* Guidance */}
          <View style={{ marginTop: 16, flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 20, borderWidth: 0.5, borderColor: GREEN_BD, padding: 18 }}>
            <Ionicons name="sparkles" size={18} color={GREEN} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14.5, lineHeight: 21, color: TXT2 }}>
                <Text style={{ fontWeight: "800", color: TXT }}>{p.guidance.headline}. </Text>
                {p.guidance.body}
              </Text>
              <Text style={{ fontSize: 12, color: TXT3, marginTop: 8, lineHeight: 17 }}>{p.behaviorWhy}</Text>
            </View>
          </View>

          {/* Transparency — every payment, with the arithmetic */}
          <View style={{ marginTop: 16, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, paddingTop: 22 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 22 }}>
              <View style={{ flex: 1 }}>
                <Text style={EYEBROW}>Transparency</Text>
                <Text style={{ fontSize: 20, fontWeight: "800", letterSpacing: -0.4, color: TXT, marginTop: 6 }}>Underlying Numbers</Text>
              </View>
              <View style={{ borderRadius: 999, borderWidth: 1, borderColor: CARD_BD, backgroundColor: "rgba(255,255,255,0.04)", paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ fontSize: 12.5, fontWeight: "700", color: TXT2 }}>
                  {hist.length} payment{hist.length === 1 ? "" : "s"}
                </Text>
              </View>
            </View>

            {hist.length ? (
              <View style={{ marginTop: 16 }}>
                <View style={{ flexDirection: "row", paddingHorizontal: 22, paddingBottom: 10, borderBottomWidth: 0.5, borderBottomColor: LINE }}>
                  <Text style={{ flex: 1.2, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, color: TXT3 }}>DATE</Text>
                  <Text style={{ flex: 1, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, color: TXT3 }}>AMOUNT</Text>
                  <Text style={{ flex: 1, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, color: TXT3, textAlign: "right" }}>DAYS TO CLEAR</Text>
                </View>
                {hist.map((r, i) => (
                  <View
                    key={`${r.at}-${i}`}
                    style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 22, paddingVertical: 15, borderBottomWidth: i === hist.length - 1 ? 0 : 0.5, borderBottomColor: "rgba(255,255,255,0.07)" }}
                  >
                    <Text style={{ flex: 1.2, fontSize: 13.5, color: TXT }}>{fullDate(r.at)}</Text>
                    <Text style={{ flex: 1, fontSize: 13.5, fontWeight: "700", color: TXT, ...monoStyle }}>{fmtG(r.amount)}</Text>
                    <Text style={{ flex: 1, fontSize: 13.5, color: TXT2, textAlign: "right" }}>
                      {r.daysToClear !== null ? `${r.daysToClear} day${r.daysToClear === 1 ? "" : "s"}` : "—"}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={{ paddingHorizontal: 22, paddingBottom: 18, paddingTop: 6 }}>
                <Text style={{ fontSize: 13, color: TXT2, lineHeight: 19 }}>
                  No payments recorded yet — repayments from the register land here.
                </Text>
              </View>
            )}
          </View>

          {/* Decision support */}
          <Text style={{ ...EYEBROW, marginTop: 26 }}>Decision support</Text>
          <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={{ flex: 1, fontSize: 26, fontWeight: "800", letterSpacing: -0.6, color: TXT }}>A confident next limit</Text>
            <Ionicons name="shield-checkmark" size={22} color={GREEN} />
          </View>

          <View style={{ marginTop: 14, backgroundColor: CARD, borderRadius: RADIUS, borderWidth: 0.5, borderColor: CARD_BD, padding: 22 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "700", letterSpacing: 1.8, color: TXT3 }}>Suggested credit limit</Text>
            <Text style={{ fontSize: 38, fontWeight: "800", letterSpacing: -1.2, color: TXT, marginTop: 10, ...monoStyle }}>
              {p.suggestedLimit !== null ? fmtG(p.suggestedLimit) : "—"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }}>
              {p.suggestedLimit === null ? (
                <Text style={{ fontSize: 14.5, fontWeight: "700", color: TXT2 }}>No credit issued yet — nothing to base a limit on.</Text>
              ) : roomPct === null ? (
                <>
                  <Ionicons name="trending-up" size={16} color={GREEN} />
                  <Text style={{ fontSize: 14.5, fontWeight: "700", color: GREEN }}>Suggested starting point</Text>
                </>
              ) : roomPct === 0 ? (
                <Text style={{ fontSize: 14.5, fontWeight: "700", color: TXT2 }}>Matches your current limit</Text>
              ) : (
                <>
                  <Ionicons name={roomUp ? "trending-up" : "trending-down"} size={16} color={roomUp ? GREEN : AMBER} />
                  <Text style={{ fontSize: 14.5, fontWeight: "700", color: roomUp ? GREEN : AMBER }}>
                    {roomUp ? "+" : ""}{roomPct}% {roomUp ? "room to grow" : "below your current limit"}
                  </Text>
                </>
              )}
            </View>
            <Text style={{ fontSize: 12.5, color: TXT3, marginTop: 12, lineHeight: 18 }}>
              {p.limitWindow === "12m"
                ? `Median of ${p.limitSamples.length} credit${p.limitSamples.length === 1 ? "" : "s"} issued in the last 12 months`
                : p.limitWindow === "all"
                  ? `Median of ${p.limitSamples.length} credit${p.limitSamples.length === 1 ? "" : "s"} across all history`
                  : "Guidance only — never an automatic block."}
            </Text>
            <View style={{ height: 0.5, backgroundColor: LINE, marginVertical: 16 }} />
            <View style={{ flexDirection: "row", gap: 18 }}>
              <Stat label="Your limit" value={p.currentLimit !== null ? fmtG(p.currentLimit) : "—"} tone={p.currentLimit !== null ? TXT : TXT3} />
              <Stat label="Suggested" value={p.suggestedLimit !== null ? fmtG(p.suggestedLimit) : "—"} tone={GOLD} />
            </View>
          </View>

          {/* Actions */}
          <View style={{ marginTop: 16, gap: 12 }}>
            <Pressable
              onPress={() => openEditor("update")}
              style={{ height: 56, borderRadius: 16, backgroundColor: GREEN, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
            >
              <Ionicons name="checkmark" size={19} color={INK} />
              <Text style={{ fontSize: 16.5, fontWeight: "800", color: INK }}>Update Limit</Text>
              <Ionicons name="chevron-forward" size={17} color={INK} />
            </Pressable>
            <Pressable
              onPress={() => openEditor("reduce")}
              style={{ height: 56, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.28)", alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontSize: 16.5, fontWeight: "800", color: TXT }}>Reduce Limit</Text>
            </Pressable>
          </View>

          <Text style={{ fontSize: 11.5, color: TXT3, marginTop: 16, lineHeight: 16 }}>
            Aging runs from each credit's due date, or its sale date when no due date was set. Days to clear count from the day the credit was
            issued to the day the payment landed. Suggestions are guidance — the decision stays with you.
          </Text>
        </KeyboardSafeScrollView>

        {/* Limit editor */}
        {editing ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", padding: 24 }}
          >
            <View style={{ width: "100%", maxWidth: 380, backgroundColor: "#0e0e0e", borderRadius: 24, borderWidth: 1, borderColor: CARD_BD, padding: 22 }}>
              <Text style={EYEBROW}>{editing === "update" ? "Update limit" : "Reduce limit"}</Text>
              <Text style={{ fontSize: 22, fontWeight: "800", letterSpacing: -0.5, color: TXT, marginTop: 6 }}>
                {p.name}
              </Text>
              <TextInput
                value={limitText}
                onChangeText={setLimitText}
                keyboardType="numeric"
                placeholder={limitPlaceholder}
                placeholderTextColor={TXT3}
                autoFocus
                style={{ marginTop: 16, borderWidth: 1, borderColor: limitText.length > 0 && !limitValid ? RED : CARD_BD, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, minHeight: 52, color: TXT, fontSize: 20, fontWeight: "700", backgroundColor: CARD, ...monoStyle }}
              />
              {!limitValid ? (
                <Text style={{ fontSize: 12.5, color: AMBER, marginTop: 10, lineHeight: 18, fontWeight: "700" }}>
                  A credit limit is required — enter an amount above 0 to save.
                </Text>
              ) : (
                <Text style={{ fontSize: 12.5, color: TXT3, marginTop: 10, lineHeight: 18 }}>
                  {p.suggestedLimit !== null
                    ? `Suggested ${fmtG(p.suggestedLimit)} · current ${p.currentLimit !== null ? fmtG(p.currentLimit) : "—"}`
                    : `Current ${p.currentLimit !== null ? fmtG(p.currentLimit) : "—"}`}
                </Text>
              )}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
                <Pressable
                  onPress={() => setEditing(null)}
                  disabled={saving}
                  style={{ flex: 1, height: 50, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.28)", alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontSize: 15, fontWeight: "700", color: TXT2 }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={saveLimit}
                  disabled={saving || !limitValid}
                  style={{ flex: 1, height: 50, borderRadius: 14, backgroundColor: GREEN, alignItems: "center", justifyContent: "center", opacity: saving || !limitValid ? 0.45 : 1 }}
                >
                  <Text style={{ fontSize: 15, fontWeight: "800", color: INK }}>{saving ? "Saving…" : "Save"}</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        ) : null}
      </SafeScreen>
    </Modal>
  );
}

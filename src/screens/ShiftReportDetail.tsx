// Daily-report viewer — full-screen dark design.
// Header identity (avatar + name + current balance), shift status, running
// total, cash-out / collected tiles, breakdown and recent activity. Read-only:
// every line is preserved so any discrepancy traces to its exact source.
import React from "react";
import { View, Text, Pressable, ScrollView, Modal, SafeAreaView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { reconcileShift, localDayKey, localDayRange } from "../businessGuard";
import { getUserById } from "../users";
import { fmtG, monoStyle } from "../format";

export type ReportDetailData = {
  report: any;
  shift: any | null;
  movements: any[];
  hands: any[];
  debts: any[];
  reviews: any[];
};

// Per-shift attribution for a report's lines. A line belongs ONLY to the shift
// it was done in — never another shift of the same day (multi-shift days) and
// never another day (overnight shifts). Resolution order:
//  1. the report's own shift_id (pinned at creation);
//  2. legacy rows: the shift whose window contains the report's own timestamp;
//  3. no shift at all → the report's calendar day (never unbounded history).
export async function resolveReportShift(
  db: any,
  rep: any
): Promise<{ shift: any | null; shifts: any[]; inWin: (ts: any) => boolean }> {
  const day = String(rep?.report_date ?? "");
  const shifts: any[] = [];
  let linked: any | null = null;
  if (day && db) {
    try {
      const [dayLo, dayHi] = localDayRange(day);
      // Overnight-proof: a shift started yesterday may close into today's report.
      const prevKey = localDayKey(new Date(`${day}T12:00:00`).getTime() - 86400000);
      const wideLo = localDayRange(prevKey)[0];
      const rows = (await db.getAllAsync(
        "SELECT * FROM shifts WHERE cashier_id = ? AND start_time >= ? AND start_time < ?",
        [rep.user_id, wideLo, dayHi]
      ).catch(() => [])) ?? [];
      shifts.push(...(rows as any[]));
      if (rep.shift_id) {
        linked = ((await db.getAllAsync("SELECT * FROM shifts WHERE id = ?", [rep.shift_id]).catch(() => [])) ?? [])[0] ?? null;
      }
      if (!linked) {
        const repTs = String(rep.submitted_at ?? rep.created_at ?? "");
        linked = shifts
          .filter((s: any) => repTs && String(s.start_time ?? "") <= repTs)
          .sort((a: any, b: any) => String(b.start_time ?? "").localeCompare(String(a.start_time ?? "")))[0] ?? null;
      }
      let winStart = String(linked?.start_time ?? "");
      let winEnd = linked ? String(linked.end_time ?? "") : "";
      if (linked && !winEnd) winEnd = new Date().toISOString(); // still open → now
      if (!winStart) { winStart = dayLo; winEnd = dayHi; } // legacy, unlinked → that day only
      const inWin = (ts: any) => { const s = String(ts ?? ""); return s !== "" && s >= winStart && s <= winEnd; };
      return { shift: linked, shifts, inWin };
    } catch { /* fall through to an empty window — never history-wide */ }
  }
  return { shift: null, shifts, inWin: () => false };
}

// A cash credit payment belongs to its stamped shift; unstamped (legacy)
// rows fall back to the report's shift window. collected_by stays at the call site.
export function paymentInReportShift(p: any, shift: any, inWin: (ts: any) => boolean): boolean {
  if ((p.payment_method ?? "cash") !== "cash") return false;
  const sid = p.shift_id != null && String(p.shift_id) !== "" ? String(p.shift_id) : null;
  if (sid) return !!shift && sid === String(shift.id);
  return inWin(p.created_at);
}

const DECISION_LABEL: Record<string, string> = {
  debt: "Dèt ouvè",
  waived_negligible: "Pèt neglij",
  approved: "Apwouve",
  revoke_to_debt: "Revoke → Dèt",
  approve_waive: "Pèt konfime",
};

const D = {
  bg: "#000",
  card: "#151518",
  card2: "#1E1E22",
  hairline: "rgba(255,255,255,0.08)",
  txt: "#fff",
  dim: "#9a9a9e",
  faint: "#6e6e73",
  green: "#4ade80",
  greenSoft: "rgba(74,222,128,0.10)",
  greenBd: "rgba(74,222,128,0.30)",
  red: "#e06c5b",
  redSoft: "rgba(224,108,91,0.10)",
  redBd: "rgba(224,108,91,0.35)",
  cyan: "#22d3ee",
  cyanSoft: "rgba(34,211,238,0.10)",
  cyanBd: "rgba(34,211,238,0.30)",
  amber: "#fbbf24",
  amberSoft: "rgba(251,191,36,0.10)",
  amberBd: "rgba(251,191,36,0.30)",
};

function hhmm(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function initials(name: string): string {
  return name.split(" ").filter(Boolean).map(w => w[0]?.toUpperCase()).slice(0, 2).join("") || "?";
}

export default function ShiftReportDetail({ data, onClose }: { data: ReportDetailData; onClose: () => void }) {
  const { report, shift, movements, hands, debts, reviews } = data;
  const opening = Number(report?.opening_balance ?? shift?.opening_balance ?? 0);
  const cashSales = Number(report?.cash_sales ?? 0);
  const debt = Number(report?.credit_collected_cash ?? 0);
  const cashOut = Number(report?.withdrawals_total ?? 0) + Number(report?.inventory_total ?? 0);
  const carry = Number(report?.standby_carry ?? 0);
  const expected = reconcileShift({ opening, cashSales, debtCollected: debt, cashOut, standbyCarry: carry });
  const actual = report?.actual_cash != null ? Number(report.actual_cash) : null;
  const deficit = actual !== null ? expected - actual : null;
  const withdrawals = (movements ?? []).filter((m: any) => m.type === "withdrawal");
  const supplies = (movements ?? []).filter((m: any) => m.type === "inventory");
  const latestReview = reviews?.length ? [...reviews].sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0] : null;
  const cashierName = getUserById(report?.user_id)?.name ?? report?.user_id ?? "—";
  const cashierRole = String(report?.role ?? getUserById(report?.user_id)?.role ?? "cashier").toUpperCase();
  const storeName = getUserById(report?.user_id)?.store ?? "Front till";
  const balance = actual ?? expected;

  const status = String(report?.status ?? "");
  const isClosed = status === "closed";
  const isSubmitted = status === "submitted";
  const shiftOpen = !isClosed && !isSubmitted && (shift?.status === "open" || status === "pending");
  const startedAt = shift?.start_time ? hhmm(shift.start_time) : null;

  const dateTitle = (() => {
    try {
      const d = new Date(`${report?.report_date}T12:00:00`);
      if (isNaN(d.getTime())) return String(report?.report_date ?? "");
      return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    } catch { return String(report?.report_date ?? ""); }
  })();

  type Act = { id: string; inward: boolean; title: string; sub: string; time: string; ts: string; amount: number };
  const activity: Act[] = [
    ...(debts ?? []).map((p: any, i: number) => ({
      id: String(p.id ?? `debt-${i}`),
      inward: true,
      title: "Debt Collection",
      sub: p.receipt_number ? `#${p.receipt_number}` : (getUserById(p.collected_by)?.name ?? "Cash"),
      time: hhmm(p.created_at),
      ts: String(p.created_at ?? ""),
      amount: Number(p.amount ?? 0),
    })),
    ...withdrawals.map((m: any) => ({
      id: String(m.id),
      inward: false,
      title: "Cash Removal",
      sub: String(m.reason ?? "Retrè"),
      time: hhmm(m.created_at),
      ts: String(m.created_at ?? ""),
      amount: Number(m.amount ?? 0),
    })),
    ...supplies.map((m: any) => ({
      id: String(m.id),
      inward: false,
      title: "Cash Removal",
      sub: String(m.reason ?? "Depans"),
      time: hhmm(m.created_at),
      ts: String(m.created_at ?? ""),
      amount: Number(m.amount ?? 0),
    })),
  ].sort((a, b) => b.ts.localeCompare(a.ts));

  const outTotal = cashOut;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: D.bg }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* Top bar */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Pressable onPress={onClose} hitSlop={10} style={{ width: 45, height: 45, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={36} color="#fff" />
            </Pressable>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: D.greenSoft, borderWidth: 0.5, borderColor: D.greenBd }}>
              <Ionicons name="wallet-outline" size={16} color={D.green} />
              <Text style={{ fontWeight: "800", fontSize: 15, color: D.green, ...monoStyle }}>{fmtG(balance)}</Text>
              <Text style={{ fontSize: 8.5, color: D.dim, fontWeight: "700", letterSpacing: 1 }}>CURRENT BALANCE</Text>
            </View>
          </View>

          {/* Identity */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#2b2b2e", alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: D.hairline }}>
              <Text style={{ fontWeight: "800", fontSize: 16, color: D.txt }}>{initials(cashierName)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "800", color: D.txt }}>{cashierName}</Text>
              <Text style={{ fontSize: 10, color: D.dim, fontWeight: "700", letterSpacing: 1.2, marginTop: 2 }}>{cashierRole}</Text>
            </View>
          </View>

          {/* Title */}
          <Text style={{ fontSize: 11, color: D.dim, fontWeight: "700", letterSpacing: 2, marginTop: 18 }}>CURRENT SHIFT</Text>
          <Text style={{ fontSize: 28, fontWeight: "800", color: D.txt, letterSpacing: -0.5, marginTop: 4 }}>Daily report</Text>
          <Text style={{ fontSize: 12.5, color: D.dim, marginTop: 4 }}>{dateTitle} · {storeName}</Text>

          {/* Status */}
          <View style={{
            marginTop: 14, flexDirection: "row", alignItems: "center", gap: 10,
            backgroundColor: isClosed ? D.card : isSubmitted ? D.amberSoft : D.greenSoft,
            borderRadius: 16, padding: 14, borderWidth: 0.5,
            borderColor: isClosed ? D.hairline : isSubmitted ? D.amberBd : D.greenBd,
          }}>
            <Ionicons
              name={isClosed ? "checkmark-circle-outline" : isSubmitted ? "time-outline" : "shield-checkmark-outline"}
              size={18}
              color={isClosed ? D.dim : isSubmitted ? D.amber : D.green}
            />
            <Text style={{ flex: 1, fontSize: 13.5, fontWeight: "700", color: isClosed ? D.dim : isSubmitted ? D.amber : D.green }}>
              {isClosed ? "Shift closed" : isSubmitted ? "Submitted · awaiting review" : shiftOpen ? `Shift active${startedAt ? ` · Started at ${startedAt}` : ""}` : "Shift pending"}
            </Text>
            {shiftOpen ? (
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: D.greenSoft, borderWidth: 0.5, borderColor: D.greenBd }}>
                <Text style={{ fontSize: 10, fontWeight: "800", color: D.green, letterSpacing: 0.8 }}>LIVE</Text>
              </View>
            ) : isSubmitted ? (
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: D.amberSoft, borderWidth: 0.5, borderColor: D.amberBd }}>
                <Text style={{ fontSize: 10, fontWeight: "800", color: D.amber, letterSpacing: 0.8 }}>REVIEW</Text>
              </View>
            ) : null}
          </View>

          {/* Running total */}
          <View style={{ marginTop: 12, backgroundColor: D.card, borderRadius: 20, padding: 18, borderWidth: 0.5, borderColor: D.hairline }}>
            <Text style={{ fontSize: 10, color: D.dim, fontWeight: "700", letterSpacing: 1.6 }}>RUNNING TOTAL</Text>
            <Text style={{ fontWeight: "800", fontSize: 34, color: D.txt, marginTop: 6, letterSpacing: -0.5, ...monoStyle }}>{fmtG(expected)}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
              <Ionicons name="time-outline" size={13} color={D.faint} />
              <Text style={{ fontSize: 12, color: D.dim }}>{startedAt ? `Started today at ${startedAt}` : dateTitle}</Text>
            </View>
            {actual !== null ? (
              <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: D.hairline }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 12, color: D.dim }}>Counted</Text>
                  <Text style={{ fontSize: 14, fontWeight: "800", color: D.txt, ...monoStyle }}>{fmtG(actual)}</Text>
                </View>
                <View style={{
                  marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  backgroundColor: deficit === 0 ? D.greenSoft : D.redSoft,
                  borderRadius: 12, padding: 12, borderWidth: 0.5,
                  borderColor: deficit === 0 ? D.greenBd : D.redBd,
                }}>
                  <Text style={{ fontWeight: "800", fontSize: 13, color: deficit === 0 ? D.green : D.red }}>
                    {deficit === 0 ? "✓ Balanced" : deficit! > 0 ? `Deficit ${fmtG(deficit!)}` : `Over ${fmtG(Math.abs(deficit!))}`}
                  </Text>
                  <Ionicons name={deficit === 0 ? "checkmark-circle" : "warning"} size={18} color={deficit === 0 ? D.green : D.red} />
                </View>
              </View>
            ) : null}
          </View>

          {/* Breakdown */}
          <View style={{ marginTop: 12, backgroundColor: D.card, borderRadius: 20, padding: 18, borderWidth: 0.5, borderColor: D.hairline }}>
            {[
              { label: "Opening float", value: `+${fmtG(opening)}`, color: D.txt },
              { label: "Cash Sale", value: `+${fmtG(cashSales)}`, color: D.green },
              { label: "Debt collected", value: `+${fmtG(debt)}`, color: D.green },
              ...(carry > 0 ? [{ label: "Standby carried", value: `+${fmtG(carry)}`, color: D.txt }] : []),
            ].map(row => (
              <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 }}>
                <Text style={{ fontSize: 12.5, color: D.dim }}>{row.label}</Text>
                <Text style={{ fontSize: 13.5, fontWeight: "800", color: row.color, ...monoStyle }}>{row.value}</Text>
              </View>
            ))}
          </View>

          {/* Tiles */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <View style={{ flex: 1, backgroundColor: D.card, borderRadius: 18, padding: 16, borderWidth: 0.5, borderColor: D.hairline }}>
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(96,165,250,0.15)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="remove" size={18} color="#60a5fa" />
              </View>
              <Text style={{ fontSize: 14, fontWeight: "800", color: D.txt, marginTop: 12 }}>Log Cash Out</Text>
              <Text style={{ fontSize: 11.5, color: D.dim, marginTop: 2 }}>Remove from till</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: D.card, borderRadius: 18, padding: 16, borderWidth: 0.5, borderColor: D.hairline }}>
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: D.greenSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="add" size={18} color={D.green} />
              </View>
              <Text style={{ fontSize: 14, fontWeight: "800", color: D.txt, marginTop: 12 }}>Debt Collected</Text>
              <Text style={{ fontSize: 11.5, color: D.dim, marginTop: 2 }}>Add to till</Text>
            </View>
          </View>

          {/* Totals */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1, backgroundColor: D.redSoft, borderRadius: 18, padding: 16, borderWidth: 0.5, borderColor: D.redBd }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 10, color: D.dim, fontWeight: "700", letterSpacing: 1.2 }}>CASH OUT</Text>
                <Ionicons name="trending-down-outline" size={15} color={D.red} />
              </View>
              <Text style={{ fontWeight: "800", fontSize: 20, color: D.red, marginTop: 8, ...monoStyle }}>{fmtG(outTotal)}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: D.greenSoft, borderRadius: 18, padding: 16, borderWidth: 0.5, borderColor: D.greenBd }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 10, color: D.dim, fontWeight: "700", letterSpacing: 1.2 }}>COLLECTED</Text>
                <Ionicons name="cash-outline" size={15} color={D.green} />
              </View>
              <Text style={{ fontWeight: "800", fontSize: 20, color: D.green, marginTop: 8, ...monoStyle }}>{fmtG(debt)}</Text>
            </View>
          </View>

          {/* Recent activity */}
          <View style={{ flexDirection: "row", alignItems: "baseline", marginTop: 20, marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, color: D.dim, fontWeight: "700", letterSpacing: 2 }}>TODAY</Text>
              <Text style={{ fontSize: 22, fontWeight: "800", color: D.txt, letterSpacing: -0.4, marginTop: 2 }}>Recent activity</Text>
            </View>
            <Text style={{ fontSize: 12, color: D.faint }}>{activity.length} {activity.length === 1 ? "entry" : "entries"}</Text>
          </View>
          {activity.length === 0 ? (
            <View style={{ backgroundColor: D.card, borderRadius: 18, padding: 18, borderWidth: 0.5, borderColor: D.hairline }}>
              <Text style={{ fontSize: 13, color: D.dim, textAlign: "center" }}>No cash movements yet.</Text>
            </View>
          ) : activity.map(a => (
            <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: D.card, borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 0.5, borderColor: D.hairline }}>
              <View style={{
                width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center",
                backgroundColor: a.inward ? D.greenSoft : D.redSoft,
                borderWidth: 0.5, borderColor: a.inward ? D.greenBd : D.redBd,
              }}>
                <Ionicons name={a.inward ? "arrow-up" : "arrow-down"} size={15} color={a.inward ? D.green : D.red} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "800", color: D.txt }}>{a.title}</Text>
                <Text style={{ fontSize: 11.5, color: D.dim, marginTop: 2 }} numberOfLines={1}>{a.sub}</Text>
                <Text style={{ fontSize: 11, color: D.faint, marginTop: 1 }}>{a.time}</Text>
              </View>
              <Text style={{ fontSize: 14, fontWeight: "800", color: a.inward ? D.green : D.red, ...monoStyle }}>
                {a.inward ? `+${fmtG(a.amount)}` : `−${fmtG(a.amount)}`}
              </Text>
            </View>
          ))}

          {latestReview ? (
            <View style={{ marginTop: 12, backgroundColor: D.card2, borderRadius: 16, padding: 14, borderWidth: 0.5, borderColor: D.hairline }}>
              <Text style={{ fontSize: 12.5, fontWeight: "800", color: D.txt }}>
                Decision: {DECISION_LABEL[latestReview.decision] ?? latestReview.decision}
              </Text>
              <Text style={{ fontSize: 11, color: D.dim, marginTop: 4 }}>
                By {getUserById(latestReview.decided_by)?.name ?? latestReview.decided_by ?? "?"}
                {latestReview.reason ? ` · "${latestReview.reason}"` : ""}
              </Text>
            </View>
          ) : null}
          <View style={{ height: 20 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

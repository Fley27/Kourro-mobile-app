// CreditPayFlow — full-screen Touche flow for credit dues, used from every
// transaction detail: choice (Akite / Peye Moso) → amount pad → upload
// transition (≥2s) → status (3–5s) → locked receipt via onSuccess.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fmtG, fmt } from "../format";
import { UploadTransition, minDelay, type UploadPhase } from "./UploadTransition";
import { CustomerProfileHeader, ModalScreen } from "./CustomerProfile";

export type PaySuccessInfo = { amount: number; receipt: string; finalBalance: number };

type Step = "choice" | "amount";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"];

export function CreditPayFlow({ visible, due, onClose, onPay, onSuccess, inline }: {
  visible: boolean;
  due: number;
  onClose: () => void;
  onPay: (amount: number) => Promise<{ receipt: string; finalBalance: number }>;
  onSuccess: (info: PaySuccessInfo) => void;
  inline?: boolean;
}) {
  const [step, setStep] = useState<Step>("choice");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>("loading");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    if (visible) { setStep("choice"); setInput(""); setBusy(false); setPhase("loading"); setStatusMsg(""); }
  }, [visible]);

  async function runPay(amount: number) {
    setBusy(true);
    setPhase("loading");
    setStatusMsg(`${fmtG(Math.round(amount))} • ap konfime…`);
    try {
      const res = await minDelay(onPay(amount), 2000);
      setPhase("success");
      setStatusMsg(`${fmtG(Math.round(amount))} • Resi ${res.receipt}`);
      await new Promise(r => setTimeout(r, 3500));
      setBusy(false);
      onSuccess({ amount, receipt: res.receipt, finalBalance: res.finalBalance });
    } catch (e: any) {
      setPhase("error");
      setStatusMsg(e?.message ?? "Peman echwe");
      await new Promise(r => setTimeout(r, 3500));
      setBusy(false);
    }
  }

  function onKey(k: string) {
    if (k === "back") { setInput(v => v.slice(0, -1)); return; }
    setInput(v => (v + k).replace(/[^0-9.]/g, "").slice(0, 12));
  }

  const entered = Number(input) || 0;
  const amountOk = entered > 0 && entered <= due;

  const body = (
    <>
      <CustomerProfileHeader
        onBack={step === "amount" && !busy ? () => setStep("choice") : !busy ? onClose : undefined}
        backIcon="chevron"
        title={step === "choice" ? "Touche" : "Peye Moso"}
      />
      <View style={{ height: 1, backgroundColor: "#262626", marginTop: 14 }} />

      {step === "choice" ? (
        <>
          <View style={{ height: "auto", flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
            <Text style={{ fontWeight: "800", fontSize: 22, color: "#fff", textAlign: "center", letterSpacing: -0.3 }}>
              Ou ap peye tout oubyen yon pati?
            </Text>
            <Text style={{ fontSize: 14, color: "#8e8e93", marginTop: 8, textAlign: "center" }}>
              Due balance: {fmtG(Math.round(due))}
            </Text>
          </View>
            <View style={{ paddingBottom: 8 }}>
              <Pressable
                onPress={() => runPay(due)}
                disabled={busy || due <= 0}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: "#262626", opacity: busy || due <= 0 ? 0.5 : 1 }}
              >
                <Text style={{ flex: 1, fontWeight: "700", fontSize: 17, color: "#fff" }}>
                  Akite • {fmtG(Math.round(due))}
                </Text>
                <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
              </Pressable>
              <Pressable
                onPress={() => setStep("amount")}
                disabled={busy}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: "#262626", opacity: busy ? 0.5 : 1 }}
              >
                <Text style={{ flex: 1, fontWeight: "700", fontSize: 17, color: "#fff" }}>Peye Moso</Text>
                <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
              </Pressable>
            </View>
        </>
      ) : (
        <>
          <View style={{ borderWidth: 1, borderColor: "#3a3a3c", backgroundColor: "#111", borderRadius: 12, padding: 18, alignItems: "center", marginTop: 8 }}>
            <Text style={{ fontSize: 28, fontWeight: "800", color: input === "" ? "#8e8e93" : "#fff" }}>
              {input === "" ? `${fmtG(Math.round(due))}` : `${fmtG(entered)}`}
            </Text>
            <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 4 }}>Due: {fmtG(Math.round(due))}</Text>
          </View>
          <Pressable
            onPress={() => amountOk && runPay(entered)}
            disabled={!amountOk}
            style={{ marginTop: 12, height: 60, borderRadius: 14, backgroundColor: amountOk ? "#fff" : "#2b2b2b", alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ fontWeight: "800", fontSize: 16, color: amountOk ? "#000" : "#6e6e73" }}>Touche</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ borderTopWidth: 0.5, borderTopColor: "#262626" }}>
            {[0, 1, 2, 3].map(r => (
              <View key={r} style={{ flexDirection: "row", borderTopWidth: r === 0 ? 0 : 0.5, borderTopColor: "#262626" }}>
                {[0, 1, 2].map(ci => {
                  const k = KEYS[r * 3 + ci];
                  return (
                    <Pressable key={ci} onPress={() => onKey(k)} style={{ flex: 1, height: 62, alignItems: "center", justifyContent: "center", backgroundColor: "#000", borderRightWidth: ci < 2 ? 0.5 : 0, borderRightColor: "#262626" }}>
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
        </>
      )}
    </>
  );

  if (inline) {
    if (!visible) return null;
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {body}
        <UploadTransition visible={busy} phase={phase} title="Peman an kou" detail={statusMsg} />
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <ModalScreen>
        {body}
      </ModalScreen>
      <UploadTransition visible={busy} phase={phase} title="Peman an kou" detail={statusMsg} />
    </Modal>
  );
}

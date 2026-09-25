// CatalogFlowModal — reusable full-screen black modal hosting the catalog
// five-step guided flow (product → items → batch → variants → prices) and
// the manage screens (same steps, existing entities, section menu).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, Modal, SafeAreaView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getDb } from "../../db";
import { UploadTransition, minDelay, type UploadPhase } from "../../components/UploadTransition";
import type { Category } from "../CatalogShared";
import type { FlowCtx } from "./types";
import ProductStep from "./ProductStep";
import ItemsStep from "./ItemsStep";
import BatchStep from "./BatchStep";
import VariantsStep from "./VariantsStep";
import PricesStep from "./PricesStep";

export type StepKey = "product" | "items" | "batch" | "variants" | "prices";

const CREATE_STEPS: { key: StepKey; label: string }[] = [
  { key: "product", label: "Pwodwi" },
  { key: "items", label: "Inite" },
  { key: "variants", label: "Variant" },
  { key: "batch", label: "Batch" },
  { key: "prices", label: "Pri" },
];

const MANAGE_SECTIONS: { key: StepKey; label: string; sub: string; icon: string }[] = [
  { key: "product", label: "Pwodwi", sub: "Non, kategori, founisè", icon: "pricetag-outline" },
  { key: "items", label: "Inite", sub: "Kontenè + rapò kraze", icon: "cube-outline" },
  { key: "variants", label: "Variant", sub: "Fason yo vann", icon: "layers-outline" },
  { key: "batch", label: "Batch", sub: "Pri acha, resevwa, refize", icon: "archive-outline" },
  { key: "prices", label: "Pri", sub: "Pri pa dat efektif", icon: "cash-outline" },
];

export default function CatalogFlowModal({
  visible, onClose, onDone, categories, role = "cashier", currentUser,
  initialProductId, initialSection,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: () => void;
  categories: Category[];
  role?: string;
  currentUser?: any;
  /** Manage mode: jump straight into an existing product's sections. */
  initialProductId?: string | null;
  initialSection?: StepKey | null;
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [productId, setProductId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [flowType, setFlowType] = useState<"goods" | "service">("goods");
  const [manageSection, setManageSection] = useState<StepKey | null>(null);
  const manage = !!initialProductId;

  const ctx: FlowCtx = useMemo(() => ({
    role, currentUser, categories,
    reload: () => {},
  }), [role, currentUser, categories]);

  useEffect(() => {
    if (visible) {
      finishedRef.current = false;
      setStepDirty(false);
      setStepIdx(0);
      setManageSection(initialSection ?? null);
      if (initialProductId) {
        setProductId(initialProductId);
        (async () => {
          try {
            const db = await getDb();
            const rows = (((await db.getAllAsync("SELECT name, item_type FROM products WHERE id = ?", [initialProductId]).catch(() => [])) ?? []) as any[]);
            setProductName(String(rows[0]?.name ?? ""));
            setFlowType(rows[0]?.item_type === "service" ? "service" : "goods");
          } catch {}
        })();
      } else {
        setProductId(null);
        setProductName("");
        setFlowType("goods");
      }
    }
  }, [visible, initialProductId, initialSection]);

  // Services carry no stock: items + batch steps (and sections) disappear.
  // Variants anchor to one auto-created base item behind the scenes.
  const steps = useMemo(
    () => (flowType === "service" ? CREATE_STEPS.filter(s => s.key !== "batch" && s.key !== "items") : CREATE_STEPS),
    [flowType]
  );
  const sections = useMemo(
    () => (flowType === "service" ? MANAGE_SECTIONS.filter(s => s.key !== "batch" && s.key !== "items") : MANAGE_SECTIONS),
    [flowType]
  );

  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const goNext = () => setStepIdx(i => Math.min(i + 1, steps.length - 1));
  const nextRef = useRef<(() => void) | null>(null);
  const registerNext = (fn: (() => void) | null) => { nextRef.current = fn; };
  const isLastStep = Math.min(stepIdx, steps.length - 1) >= steps.length - 1;
  const finishedRef = useRef(false);
  const [stepDirty, setStepDirty] = useState(false);
  const [upBusy, setUpBusy] = useState(false);
  const [upPhase, setUpPhase] = useState<UploadPhase>("loading");
  const [upMsg, setUpMsg] = useState("");
  const done = async () => {
    // Finishing the chain registers the product (draft → active),
    // wrapped in the reusable upload transition.
    if (upBusy) return;
    setUpBusy(true);
    setUpPhase("loading");
    setUpMsg(productName ? `${productName} • ap anrejistre…` : "Ap anrejistre…");
    try {
      await minDelay((async () => {
        if (!manage && productId) {
          const db = await getDb();
          const now = new Date().toISOString();
          await db.runAsync("UPDATE products SET status = ?, updated_at = ?, dirty = 1 WHERE id = ?", ["active", now, productId]);
          try {
            const { insertOutbox } = await import("../../db");
            await insertOutbox("products", "update", { id: productId, status: "active", updated_at: now, is_deleted: 0 });
          } catch {}
        }
      })(), 1500);
      setUpPhase("success");
      setUpMsg(productName ? `${productName} • anrejistre` : "Pwodwi anrejistre");
      await new Promise(r => setTimeout(r, 2000));
      setUpBusy(false);
      finishedRef.current = true;
      onDone();
      onClose();
    } catch (e: any) {
      setUpPhase("error");
      setUpMsg(e?.message ?? "Anrejistre echwe");
      await new Promise(r => setTimeout(r, 3000));
      setUpBusy(false);
    }
  };
  // Abandoning a create chain must never register the product: discard the
  // unfinished draft (manage mode never discards — it edits live rows).
  const discardAndClose = async () => {
    if (!manage && productId && !finishedRef.current) {
      try {
        const db = await getDb();
        const { softDeleteProduct } = await import("../../catalogModel");
        await softDeleteProduct(db, productId);
      } catch {}
    }
    onClose();
  };
  // Warn before losing typed progress or a half-built chain. Pristine form
  // and finished chains close silently.
  const close = () => {
    if (manage || finishedRef.current || (!productId && !stepDirty)) {
      onClose();
      return;
    }
    Alert.alert(
      "Kite paj la?",
      "Si ou kite kounye a, tout sa ou antre ap pèdi.",
      [
        { text: "Rete", style: "cancel" },
        { text: "Kite paj la", style: "destructive", onPress: () => { discardAndClose(); } },
      ]
    );
  };

  const stepProps = {
    ctx,
    productId: productId ?? "",
    productName,
    onBack: manage
      ? () => setManageSection(null)
      : stepIdx > 0
        ? () => setStepIdx(i => i - 1)
        : undefined,
  };

  // Create steps stay mounted (display:none when inactive) so back-navigation
  // keeps typed state. Reset each render: only the active step re-registers.
  nextRef.current = null;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
          <Pressable
            onPress={() => {
              if (manage && manageSection) setManageSection(null);
              else if (!manage && stepIdx > 0) setStepIdx(i => i - 1);
              else close();
            }}
            accessibilityLabel="Back"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#F2F2F7", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name={manage && manageSection ? "chevron-back" : !manage && stepIdx > 0 ? "chevron-back" : "close"} size={22} color="#000" />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 20, color: "#fff" }} numberOfLines={1}>
              {manage ? (manageSection ? sections.find(s => s.key === manageSection)?.label ?? "" : productName || "Jere") : step.label}
            </Text>
            {!manage && (
              <Text style={{ fontSize: 11, color: "#8e8e93", marginTop: 2 }}>Etap {Math.min(stepIdx, steps.length - 1) + 1} / {steps.length}</Text>
            )}
          </View>
          {!manage ? (
            <Pressable onPress={() => nextRef.current?.()} style={{ paddingHorizontal: 18, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontWeight: "800", fontSize: 14, color: "#000" }}>{isLastStep ? "Anrejistre" : "Kontinye"}</Text>
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>
        <View style={{ height: 1, backgroundColor: "#262626" }} />
        {!manage && (
          <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingTop: 12 }}>
            {steps.map((s, i) => (
              <View key={s.key} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= Math.min(stepIdx, steps.length - 1) ? "#fff" : "#2b2b2b" }} />
            ))}
          </View>
        )}

        {manage ? (
          manageSection === null ? (
            <View style={{ flex: 1, padding: 16, gap: 10 }}>
              <Text style={{ fontSize: 12, color: "#8e8e93" }} numberOfLines={1}>{productName}</Text>
              {sections.map(s => (
                <Pressable key={s.key} onPress={() => setManageSection(s.key)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 16, padding: 14 }}>
                  <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#2b2b2b", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={s.icon as any} size={20} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "800", fontSize: 15, color: "#fff" }}>{s.label}</Text>
                    <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>{s.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#8e8e93" />
                </Pressable>
              ))}
            </View>
          ) : manageSection === "product" ? (
            <ProductStep {...stepProps} onNext={() => setManageSection(null)} />
          ) : manageSection === "items" ? (
            <ItemsStep {...stepProps} />
          ) : manageSection === "batch" ? (
            <BatchStep {...stepProps} />
          ) : manageSection === "variants" ? (
            <VariantsStep {...stepProps} serviceMode={flowType === "service"} />
          ) : (
            <PricesStep {...stepProps} />
          )
        ) : (
          <>
            <View style={{ flex: 1, display: step.key === "product" ? "flex" : "none" }}>
              <ProductStep
                ctx={ctx}
                onDirtyChange={setStepDirty}
                registerNext={registerNext}
                active={step.key === "product"}
                onNext={(id: string, type: "goods" | "service") => {
                  setProductId(id);
                  setStepDirty(false);
                  setFlowType(type);
                  (async () => {
                    try {
                      const db = await getDb();
                      const rows = (((await db.getAllAsync("SELECT name FROM products WHERE id = ?", [id]).catch(() => [])) ?? []) as any[]);
                      setProductName(String(rows[0]?.name ?? ""));
                    } catch {}
                  })();
                  setStepIdx(1);
                }}
              />
            </View>
            {!productId && step.key !== "product" ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
                <Text style={{ color: "#8e8e93", fontSize: 13 }}>Kreye pwodwi a anvan (etap 1).</Text>
              </View>
            ) : (
              <>
                <View style={{ flex: 1, display: step.key === "items" ? "flex" : "none" }}>
                  <ItemsStep {...stepProps} stageMode registerNext={registerNext} active={step.key === "items"} onNext={goNext} />
                </View>
                <View style={{ flex: 1, display: step.key === "variants" ? "flex" : "none" }}>
                  <VariantsStep {...stepProps} serviceMode={flowType === "service"} stageMode registerNext={registerNext} active={step.key === "variants"} onNext={goNext} />
                </View>
                <View style={{ flex: 1, display: step.key === "batch" ? "flex" : "none" }}>
                  <BatchStep {...stepProps} restrictSuppliers stageMode registerNext={registerNext} active={step.key === "batch"} onNext={goNext} />
                </View>
                <View style={{ flex: 1, display: step.key === "prices" ? "flex" : "none" }}>
                  <PricesStep {...stepProps} registerNext={registerNext} active={step.key === "prices"} onDone={done} />
                </View>
              </>
            )}
          </>
        )}
      </SafeAreaView>
      <UploadTransition visible={upBusy} phase={upPhase} title="Anrejistre pwodwi" detail={upMsg} />
    </Modal>
  );
}

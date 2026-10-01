// StepForms — shared unit/variant form fields for the single-product chain
// (ItemsStep/VariantsStep) and the bulk flow. Same pickers, same language;
// each caller owns its state, validation, and saving.
import React from "react";
import { View, Text, Pressable, TextInput } from "react-native";

export type UnitRelation = "bigger" | "smaller";

export const UNIT_RELATIONS: { key: UnitRelation; label: string }[] = [
  { key: "bigger", label: "Pi gwo" },
  { key: "smaller", label: "Pi piti" },
];

export function ratioForUnit(rel: UnitRelation, q: number): number {
  if (rel === "bigger") return q;
  return 1 / q;
}

/** Staged rows below a key (cycle guard for reference pickers). */
export function stagedDescendantsOfPool(staged: { key: string; refKey: string | null }[], key: string): Set<string> {
  const out = new Set<string>();
  const walk = (k: string) => {
    for (const s of staged) {
      if (s.refKey === k && !out.has(s.key)) {
        out.add(s.key);
        walk(s.key);
      }
    }
  };
  walk(key);
  return out;
}

export function UnitRefPicker({ saved, staged, valueId, valueKey, onPickId, onPickKey, excludeStagedKey, enabled, markTouched }: {
  saved: { id: string; name: string }[];
  staged: { key: string; name: string; refKey: string | null }[];
  valueId: string | null;
  valueKey: string | null;
  onPickId: (id: string | null) => void;
  onPickKey: (key: string | null) => void;
  excludeStagedKey: string | null;
  enabled: boolean;
  markTouched: () => void;
}) {
  const downs = excludeStagedKey ? stagedDescendantsOfPool(staged, excludeStagedKey) : new Set<string>();
  return (
    <View style={{ gap: 8, opacity: enabled ? 1 : 0.5 }}>
      <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>REFERANS</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {saved.map(it => {
          const active = valueId === it.id && !valueKey;
          return (
            <Pressable key={it.id} disabled={!enabled} onPress={() => { markTouched(); onPickId(active ? null : it.id); onPickKey(null); }}
              style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b" }}>
              <Text style={{ fontWeight: "600", fontSize: 12, color: active ? "#000" : "#fff" }}>{it.name}</Text>
            </Pressable>
          );
        })}
        {staged.filter(s => s.key !== excludeStagedKey && !downs.has(s.key)).map(s => {
          const active = valueKey === s.key;
          return (
            <Pressable key={s.key} disabled={!enabled} onPress={() => { markTouched(); onPickKey(active ? null : s.key); onPickId(null); }}
              style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b", borderStyle: "dashed" }}>
              <Text style={{ fontWeight: "600", fontSize: 12, color: active ? "#000" : "#fff" }}>{s.name} (nouvo)</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function UnitRelationRow({ relation, setRelation, qty, setQty, enabled, markTouched }: {
  relation: UnitRelation;
  setRelation: (r: UnitRelation) => void;
  qty: string;
  setQty: (v: string) => void;
  enabled: boolean;
  markTouched: () => void;
}) {
  return (
    <View style={{ gap: 8, opacity: enabled ? 1 : 0.5 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {UNIT_RELATIONS.map(r => {
          const active = relation === r.key;
          return (
            <Pressable key={r.key} disabled={!enabled} onPress={() => { markTouched(); setRelation(r.key); }}
              style={{ flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b", backgroundColor: active ? "#fff" : "transparent", alignItems: "center" }}>
              <Text style={{ fontWeight: "700", fontSize: 12, color: active ? "#000" : "#fff" }}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput value={qty} onChangeText={v => { markTouched(); setQty(v.replace(/[^0-9.]/g, "")); }} placeholder="Konbyen (ex. 9)" placeholderTextColor="#636366" keyboardType="numeric" editable={enabled}
        style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "transparent", textAlign: "center" }} />
    </View>
  );
}

export function VariantFormFields({ items, valueId, onPick, name, onName, namePlaceholder, markTouched }: {
  items: { id: string; name: string }[];
  valueId: string;
  onPick: (id: string) => void;
  name: string;
  onName: (v: string) => void;
  namePlaceholder?: string;
  markTouched: () => void;
}) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>INITE</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {items.map(it => {
          const active = valueId === it.id;
          return (
            <Pressable key={it.id} onPress={() => { markTouched(); onPick(it.id); }}
              style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? "#fff" : "transparent", borderWidth: 1, borderColor: active ? "#fff" : "#2b2b2b" }}>
              <Text style={{ fontWeight: "600", fontSize: 12, color: active ? "#000" : "#fff" }}>{it.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput value={name} onChangeText={v => { markTouched(); onName(v); }} placeholder={namePlaceholder ?? "Cold, Regular, Boxed"} placeholderTextColor="#636366"
        style={{ height: 60, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: "#fff", backgroundColor: "transparent" }} />
    </View>
  );
}

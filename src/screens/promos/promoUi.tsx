// Shared dark-theme bits for the promo screens (Proformat / Rabais & Koupon).
// Matches the Pickups-style header + card language used across MoreScreen bodies.
import React from "react";
import { View, Text, Pressable, TextInput, type TextInputProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export function PromoHeader({ title, subtitle, onBack, right }: {
  title: string;
  subtitle?: string | null;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, paddingBottom: 4 }}>
      <Pressable onPress={onBack} hitSlop={10} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="chevron-back" size={24} color="#fff" />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800" }}>{title}</Text>
        {subtitle ? <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <Text style={{ color: "#8e8e93", fontSize: 13, fontWeight: "800", letterSpacing: 0.6, marginTop: 20, marginBottom: 10, ...(style ?? {}) }}>
      {children}
    </Text>
  );
}

export function PromoCard({ children, tone = "base", style }: { children: React.ReactNode; tone?: "base" | "good" | "warn"; style?: any }) {
  const border = tone === "good" ? "#2f80ed55" : tone === "warn" ? "#5a4a1a" : "#2b2b2b";
  const bg = tone === "good" ? "#0d1624" : tone === "warn" ? "#1a1408" : "#141414";
  return (
    <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: 16, padding: 16, marginBottom: 12, ...(style ?? {}) }}>
      {children}
    </View>
  );
}

export function Chip({ label, active, onPress, disabled }: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={{
        paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
        borderWidth: 1, marginRight: 8, marginBottom: 8,
        backgroundColor: active ? "#fff" : "#141414",
        borderColor: active ? "#fff" : "#3a3a3c",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: active ? "#000" : "#fff", fontSize: 14, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

export function LabeledInput({ label, hint, style, ...rest }: { label: string; hint?: string; style?: any } & Omit<TextInputProps, "style">) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: "#8e8e93", fontSize: 13, fontWeight: "700", marginBottom: 6 }}>{label}</Text>
      <TextInput
        placeholderTextColor="#5a5a5e"
        {...rest}
        style={{
          minHeight: 52, borderWidth: 1, borderColor: "#3a3a3c", borderRadius: 12,
          paddingHorizontal: 14, paddingVertical: 12, color: "#fff", fontSize: 16, backgroundColor: "#0a0a0a",
          ...(style ?? {}),
        }}
      />
      {hint ? <Text style={{ color: "#5a5a5e", fontSize: 11, marginTop: 4 }}>{hint}</Text> : null}
    </View>
  );
}

export function PrimaryButton({ label, onPress, disabled, busy, tone = "white" }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "white" | "ghost";
}) {
  const off = disabled || busy;
  const white = tone === "white";
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      style={{
        height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 6,
        backgroundColor: off ? "#1c1c1e" : white ? "#fff" : "#1c1c1e",
        borderWidth: white ? 0 : 1, borderColor: "#3a3a3c",
      }}
    >
      <Text style={{ color: off ? "#8e8e93" : white ? "#000" : "#fff", fontSize: 17, fontWeight: "800" }}>
        {busy ? "…" : label}
      </Text>
    </Pressable>
  );
}

const HT_MONTHS = ["janvye", "fevriye", "mas", "avril", "me", "juin", "jiyè", "out", "septanm", "oktòb", "novanm", "desanm"];

/** "2025-07-14T18:03:11.000Z" → "14 juil 2025 · 18:03" (kreyòl month). */
export function fmtWhen(iso?: string | null): string {
  const d = new Date(String(iso ?? ""));
  if (!isFinite(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${HT_MONTHS[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`;
}

// PickerGrid — reusable tile-grid picker in the icon-picker language:
// boxed section, eyebrow header, tiles that invert on select.
// Used for categories, suppliers (anything pickable with a label).
import React, { useState } from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type PickerTile = {
  id: string;
  label: string;
  glyph?: keyof typeof Ionicons.glyphMap | null;
  char?: string | null;
};

export default function PickerGrid({
  title,
  tiles,
  selectedIds,
  onToggle,
  numCols = 3,
  searchPlaceholder,
}: {
  title: string;
  tiles: PickerTile[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  numCols?: number;
  searchPlaceholder?: string;
}) {
  const sel = new Set(selectedIds);
  const [q, setQ] = useState("");
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const shown = searchPlaceholder && q.trim()
    ? tiles.filter(t => norm(t.label).includes(norm(q.trim())))
    : tiles;
  return (
    <View style={{ borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 12, padding: 12 }}>
      <Text style={{ fontSize: 11, color: "#8e8e93", fontWeight: "700", letterSpacing: 0.6 }}>{title}</Text>
      {searchPlaceholder ? (
        <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#2b2b2b", borderRadius: 12, paddingHorizontal: 12, height: 48, marginTop: 10 }}>
          <Ionicons name="search" size={16} color="#8e8e93" style={{ marginRight: 8 }} />
          <TextInput value={q} onChangeText={setQ} placeholder={searchPlaceholder} placeholderTextColor="#636366"
            style={{ flex: 1, fontSize: 14, color: "#fff" }} returnKeyType="search" />
          {q.length > 0 && (
            <Pressable onPress={() => setQ("")} hitSlop={8} style={{ padding: 4 }}>
              <Text style={{ color: "#8e8e93", fontSize: 12, fontWeight: "600" }}>✕</Text>
            </Pressable>
          )}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {shown.map(t => {
          const active = sel.has(t.id);
          const fg = active ? "#000" : "#fff";
          return (
            <Pressable
              key={t.id}
              onPress={() => onToggle(t.id)}
              style={{
                width: `${100 / numCols - 3}%`,
                alignItems: "center",
                gap: 6,
                paddingVertical: 12,
                paddingHorizontal: 4,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: active ? "#fff" : "#2b2b2b",
                backgroundColor: active ? "#fff" : "#1C1C1E",
              }}
            >
              {t.glyph ? (
                <Ionicons name={t.glyph} size={22} color={fg} />
              ) : t.char ? (
                <Text style={{ fontSize: 20 }}>{t.char}</Text>
              ) : (
                <Text style={{ fontSize: 20, fontWeight: "800", color: fg }}>{t.label?.[0]?.toUpperCase() ?? "•"}</Text>
              )}
              <Text style={{ fontSize: 11, fontWeight: "600", color: fg, textAlign: "center" }} numberOfLines={1}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {shown.length === 0 && (
        <Text style={{ fontSize: 12, color: "#8e8e93", marginTop: 8 }}>
          {tiles.length === 0 ? "Anyen isit la pou kounye a." : "Pa gen rezilta."}
        </Text>
      )}
    </View>
  );
}

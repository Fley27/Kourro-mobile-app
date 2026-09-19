import React, { useState } from "react";
import { View, Text, Pressable, TextInput, Modal, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow } from "../../theme";
import { useResponsive, centerBox, dialogBox } from "../../responsive";
import { generateUniqueCode, isSoftwareOwner, type StoreItem } from "./storeCodes";

type Props = {
  stores: StoreItem[];
  setStores: (v: StoreItem[] | ((prev: StoreItem[]) => StoreItem[])) => void;
  activeStoreId: string;
  setActiveStoreId: (id: string) => void;
  onClose: () => void;
};

export default function SecurityCenter({ stores, setStores, activeStoreId, setActiveStoreId, onClose }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [authKey, setAuthKey] = useState("");
  const [authError, setAuthError] = useState("");
  const [targetStore, setTargetStore] = useState<StoreItem | null>(null);
  const [action, setAction] = useState<"rotate" | "toggle" | null>(null);
  const [confirmKey, setConfirmKey] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [result, setResult] = useState<{ storeId: string; newCode?: string; disabled?: boolean } | null>(null);
  const { width, isTablet, padH } = useResponsive();

  const authenticate = () => {
    if (isSoftwareOwner(authKey)) { setUnlocked(true); setAuthError(""); }
    else setAuthError("Kle Sistèm pa bon — AKSÈ REFIZE.");
  };

  const confirmed = () => {
    if (!targetStore) return;
    if (!isSoftwareOwner(confirmKey)) { setConfirmError("Kle Sistèm pa bon — aksyon an anile."); return; }
    // Only the software owner may change a store code or block a store.
    if (action === "rotate") {
      const newCode = generateUniqueCode(stores.map(s => s.id === targetStore.id ? { ...s, code: "" } : s));
      setStores(prev => prev.map(s => s.id === targetStore.id ? { ...s, code: newCode, breachFlagged: true, breachedAt: new Date().toISOString(), revokedBy: "SYS-OWNER" } : s));
      setResult({ storeId: targetStore.id, newCode });
    } else if (action === "toggle") {
      const disabled = !targetStore.disabled;
      setStores(prev => prev.map(s => s.id === targetStore.id ? { ...s, disabled, breachFlagged: disabled ? true : s.breachFlagged, breachedAt: disabled ? new Date().toISOString() : s.breachedAt, revokedBy: disabled ? "SYS-OWNER" : undefined } : s));
      if (disabled && activeStoreId === targetStore.id) {
        const safe = stores.find(s => s.id !== targetStore.id && !s.disabled);
        if (safe) setActiveStoreId(safe.id);
      }
      setResult({ storeId: targetStore.id, disabled });
    }
    setTargetStore(null); setAction(null); setConfirmKey(""); setConfirmError("");
  };

  if (result) {
    const s = stores.find(x => x.id === result.storeId);
    return (
      <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ padding: padH, gap: 12, alignItems: isTablet ? "center" : undefined }}>
        <View style={{ width: "100%", backgroundColor: palette.surface, borderRadius: radius.lg, padding: 20, alignItems: "center", borderWidth: 0.5, borderColor: palette.hairline, ...shadow.card }}>
          <View style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: palette.successBg, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="shield-checkmark" size={28} color={palette.success} />
          </View>
          <Text style={{ fontWeight: "900", fontSize: 17, color: palette.ink, marginTop: 12, letterSpacing: -0.3 }}>
            {result.newCode ? "Kòd chanje avèk siksè" : result.disabled ? "Magazen bloke" : "Magazen reaktive"}
          </Text>
          <Text style={{ fontSize: 12, color: palette.muted2, textAlign: "center", marginTop: 6, lineHeight: 17 }}>
            {result.newCode
              ? `Kòd sekrè pou ${s?.name} te chanje. Ansyen kòd la pa valab ankò.`
              : result.disabled
                ? `Tout aktivite sou ${s?.name} te sispann.`
                : `${s?.name} ka fonksyone ankò.`}
          </Text>
          {result.newCode && (
            <View style={{ marginTop: 14, backgroundColor: palette.ink2, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 24, alignItems: "center", alignSelf: "stretch" }}>
              <Text style={{ color: palette.muted3, fontSize: 10, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" }}>Nouvo kòd (yon sèl fwa)</Text>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 24, letterSpacing: 4, marginTop: 4 }}>{result.newCode}</Text>
            </View>
          )}
          <Pressable onPress={() => { setResult(null); }} style={{ marginTop: 16, backgroundColor: palette.ink2, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 24, minHeight: 48, alignItems: "center", justifyContent: "center", alignSelf: "stretch", ...shadow.soft }}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>Fèmen</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // ---- Locked: require software-owner key ----
  if (!unlocked) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ padding: padH, gap: 12, paddingBottom: 48, alignItems: isTablet ? "center" : undefined }}>
        <View style={{ width: "100%", gap: 12 }}>
        <View style={{ backgroundColor: palette.ink2, borderRadius: radius.lg, padding: 16, ...shadow.elevated }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="shield-checkmark-outline" size={18} color={palette.warningDot} />
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16, letterSpacing: -0.3 }}>Konsole Sipò (Software Owner)</Text>
          </View>
          <Text style={{ color: palette.muted3, marginTop: 4, fontSize: 12, lineHeight: 17 }}>
            Zòn sekirite sistèm. Sèlman Software Owner ka chanje operasyon sou kòd sekrè magazen. Store Owner pa gen pouvwa sa a.
          </Text>
        </View>

        <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.separator, padding: 16, ...shadow.soft }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="key-outline" size={15} color={palette.ink} />
            <Text style={{ fontWeight: "800", fontSize: 13, color: palette.ink }}>Antre Kle Sistèm</Text>
          </View>
          <TextInput
            value={authKey}
            onChangeText={v => { setAuthKey(v); if (authError) setAuthError(""); }}
            placeholder="Kle Sistèm Software Owner"
            placeholderTextColor={palette.muted3}
            autoCapitalize="characters"
            secureTextEntry
            style={{ borderWidth: 1, borderColor: authError ? palette.dangerBd : palette.separator, borderRadius: radius.sm, paddingVertical: 13, paddingHorizontal: 12, minHeight: 48, marginTop: 12, fontWeight: "700", letterSpacing: 1, color: palette.ink, backgroundColor: palette.surface }}
          />
          {authError ? <Text style={{ fontSize: 12, color: palette.danger, fontWeight: "700", marginTop: 8 }}>{authError}</Text> : null}
          <Pressable onPress={authenticate} style={{ marginTop: 12, backgroundColor: palette.ink2, borderRadius: radius.sm, paddingVertical: 13, alignItems: "center", ...shadow.soft }}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>Verifye aksè</Text>
          </Pressable>
        </View>
        </View>
      </ScrollView>
    );
  }

  // ---- Unlocked: manage stores ----
  return (
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ padding: padH, gap: 12, paddingBottom: 48, alignItems: isTablet ? "center" : undefined }}>
      <View style={{ width: "100%", gap: 12 }}>
      {/* Status banner */}
      <View style={{ backgroundColor: palette.warningBg, borderWidth: 1, borderColor: palette.warningBd, borderRadius: radius.md, padding: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="warning-outline" size={15} color={palette.warning} />
          <Text style={{ fontWeight: "800", fontSize: 12, color: palette.warning }}>Konsèy sekirite</Text>
        </View>
        <Text style={{ fontSize: 11, color: palette.warning, marginTop: 4, lineHeight: 16 }}>
          Chak kòd sekrè inik pou tout magazen yo. Si gen bès sekirite, chanje kòd la (ansyen an vini pa valab) oswa bloke magazen an nèt.
        </Text>
      </View>

      {/* Store list */}
      <View style={{ backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.separator, overflow: "hidden", ...shadow.soft }}>
        <View style={{ padding: 12, borderBottomWidth: 1, borderColor: palette.separator, backgroundColor: palette.surface2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="storefront-outline" size={15} color={palette.ink} />
            <Text style={{ fontWeight: "900", fontSize: 13, color: palette.ink }}>Magazen yo ({stores.length})</Text>
          </View>
        </View>
        {stores.map(s => {
          const isActive = s.id === activeStoreId;
          return (
            <View key={s.id} style={{ padding: 12, borderBottomWidth: 1, borderColor: palette.separatorSoft, backgroundColor: s.disabled ? palette.dangerBg : palette.surface }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: s.disabled ? palette.dangerBg : palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="storefront-outline" size={18} color={s.disabled ? palette.danger : palette.muted2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontWeight: "800", fontSize: 14, color: palette.ink }} numberOfLines={1}>{s.name}</Text>
                      {isActive && <View style={{ backgroundColor: palette.successBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontWeight: "800", color: palette.success }}>AKTIF</Text></View>}
                      {s.disabled && <View style={{ backgroundColor: palette.dangerBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontWeight: "800", color: palette.danger }}>BLOKE</Text></View>}
                      {s.breachFlagged && !s.disabled && <View style={{ backgroundColor: palette.warningBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontWeight: "800", color: palette.warning }}>BÈS</Text></View>}
                    </View>
                    <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 1 }} numberOfLines={1}>{s.location} • Depi {new Date(s.createdAt).toLocaleDateString()}</Text>
                  </View>
                </View>
                <Ionicons name={s.disabled ? "lock-closed" : "shield-checkmark-outline"} size={18} color={s.disabled ? palette.danger : palette.success} />
              </View>
              <View style={{ marginTop: 8, backgroundColor: palette.surface2, borderWidth: 1, borderColor: palette.separator, borderRadius: radius.sm, padding: 8, flexDirection: "row", alignItems: "center" }}>
                <Ionicons name="lock-closed-outline" size={13} color={palette.muted2} style={{ marginRight: 6 }} />
                <Text style={{ fontSize: 11, color: palette.muted2, fontWeight: "700" }}>Kòd sekrè</Text>
                <View style={{ marginLeft: "auto", backgroundColor: palette.surfaceGrouped, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                  <Text style={{ fontSize: 11, color: palette.muted2, fontWeight: "700", letterSpacing: 2 }}>••••</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <Pressable onPress={() => { setTargetStore(s); setAction("rotate"); setConfirmKey(""); setConfirmError(""); }} style={{ flex: 1, backgroundColor: palette.ink2, borderRadius: radius.sm, paddingVertical: 10, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6, ...shadow.soft }}>
                  <Ionicons name="refresh" size={14} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>Chanje kòd</Text>
                </Pressable>
                <Pressable onPress={() => { setTargetStore(s); setAction("toggle"); setConfirmKey(""); setConfirmError(""); }} style={{ flex: 1, backgroundColor: s.disabled ? palette.success : palette.danger, borderRadius: radius.sm, paddingVertical: 10, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6, ...shadow.soft }}>
                  <Ionicons name={s.disabled ? "play" : "stop-circle"} size={14} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>{s.disabled ? "Reaktive" : "Bloke magazen"}</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>

      {/* Confirm modal — re-confirm software key for sensitive action */}
      <Modal visible={!!targetStore} transparent animationType="fade" onRequestClose={() => { setTargetStore(null); setConfirmError(""); }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24, alignItems: "center" }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", ...(isTablet && { alignItems: "center", width }) }}>
              <View style={{ ...dialogBox(isTablet, width, 480), width: "100%", backgroundColor: palette.surface, borderRadius: radius.lg, padding: 16, ...shadow.elevated }}>
            <View style={{ alignItems: "center" }}>
              <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: action === "rotate" ? palette.warningBg : palette.dangerBg, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={action === "rotate" ? "refresh" : "stop-circle"} size={24} color={action === "rotate" ? palette.warningDot : palette.danger} />
              </View>
              <Text style={{ fontWeight: "900", fontSize: 16, marginTop: 12, textAlign: "center", color: palette.ink, letterSpacing: -0.3 }}>
                {action === "rotate" ? "Chanje kòd sekrè" : targetStore?.disabled ? "Reaktive magazen" : "Bloke magazen"}
              </Text>
              <Text style={{ textAlign: "center", color: palette.muted2, fontSize: 12, marginTop: 6, lineHeight: 17 }}>
                {action === "rotate"
                  ? `${targetStore?.name}: yon nouvo kòd inik ap généré epi ansyen an p ap valab ankò.`
                  : `${targetStore?.name} ap ${targetStore?.disabled ? "reaktive" : "bloke"}. Aksyon sa a mande Kle Sistèm.`}
              </Text>
            </View>
            <TextInput
              value={confirmKey}
              onChangeText={v => { setConfirmKey(v); if (confirmError) setConfirmError(""); }}
              placeholder="Rekonfime Kle Sistèm"
              placeholderTextColor={palette.muted3}
              autoCapitalize="characters"
              secureTextEntry
              style={{ borderWidth: 1, borderColor: confirmError ? palette.dangerBd : palette.separator, borderRadius: radius.sm, paddingVertical: 13, paddingHorizontal: 12, minHeight: 48, marginTop: 12, fontWeight: "700", letterSpacing: 1, color: palette.ink, backgroundColor: palette.surface }}
            />
            {confirmError ? <Text style={{ fontSize: 12, color: palette.danger, fontWeight: "700", marginTop: 8, textAlign: "center" }}>{confirmError}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable onPress={() => { setTargetStore(null); setConfirmKey(""); setConfirmError(""); }} style={{ flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: palette.hairline }}><Text style={{ fontWeight: "700", color: palette.ink }}>Anile</Text></Pressable>
              <Pressable onPress={confirmed} style={{ flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", ...shadow.soft }}><Text style={{ color: "#fff", fontWeight: "800" }}>Konfime</Text></Pressable>
            </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      </View>
    </ScrollView>
  );
}

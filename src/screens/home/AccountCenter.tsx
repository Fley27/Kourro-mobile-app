import React, { useState } from "react";
import { View, Text, Pressable, TextInput, Alert, Modal, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, radius, shadow } from "../../theme";
import { useResponsive, centerBox, sheetBox, dialogBox } from "../../responsive";
import { generateUniqueCode } from "./storeCodes";

type StoreItem = { id: string; name: string; location: string; code: string; createdAt: string; disabled?: boolean; breachFlagged?: boolean; breachedAt?: string; revokedBy?: string };

type Props = {
  role: string;
  stores: StoreItem[];
  setStores: (v: StoreItem[] | ((prev: StoreItem[]) => StoreItem[])) => void;
  activeStoreId: string;
  setActiveStoreId: (id: string) => void;
  appDisabled: boolean;
  setAppDisabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  onClose: () => void;
};

const MAX_STORES = 3;

export default function AccountCenter({
  role, stores, setStores, activeStoreId, setActiveStoreId,
  appDisabled, setAppDisabled, onClose,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [verifyStore, setVerifyStore] = useState<StoreItem | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [justSwitched, setJustSwitched] = useState<string | null>(null);
  const { width, isTablet, padH } = useResponsive();

  const active = stores.find(s => s.id === activeStoreId) ?? stores[0];

  const createStore = () => {
    if (!newName.trim() || !newLocation.trim()) { setError("Non ak lokal obligatwa."); return; }
    if (stores.length >= MAX_STORES) { setError("Ou rive nan limit maksimòm (3 magazen). Pou plis, ou bezwen aksè espesyal."); return; }
    const code = generateUniqueCode(stores);
    const store: StoreItem = { id: `st-${Date.now()}`, name: newName.trim(), location: newLocation.trim(), code, createdAt: new Date().toISOString() };
    setStores(prev => [...prev, store]);
    setActiveStoreId(store.id);
    setJustSwitched(store.id);
    setTimeout(() => setJustSwitched(null), 2500);
    setShowCreate(false); setNewName(""); setNewLocation(""); setError("");
    setCreatedCode(code);
  };

  const confirmSwitch = () => {
    if (!verifyStore) return;
    if (verifyStore.disabled) { setVerifyStore(null); Alert.alert("Magazen bloke", "Magazen sa a sispann apre yon bès sekirite. Kontakte Konsole Sipò pou rektifye."); return; }
    const input = verifyCode.trim().toUpperCase();
    if (input !== verifyStore.code.toUpperCase()) { setCodeError("Kòd sekrè pa kòrèk. Eseye ankò."); return; }
    setActiveStoreId(verifyStore.id);
    setJustSwitched(verifyStore.id);
    setTimeout(() => setJustSwitched(null), 2500);
    setVerifyStore(null); setVerifyCode(""); setCodeError("");
    setTimeout(onClose, 350);
  };

  const todayStr = new Date().toLocaleDateString("fr-HT", { year: "numeric", month: "long", day: "numeric" });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ padding: padH, paddingBottom: 24, alignItems: isTablet ? "center" : undefined }}>
      <View style={{ width: "100%", gap: 0 }}>
      {/* Hero card — charcoal luxury */}
      <View style={{ backgroundColor: palette.ink2, borderRadius: radius.lg, padding: 16, ...shadow.elevated }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="business-outline" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16, letterSpacing: -0.3 }}>Kourro</Text>
            </View>
            <Text style={{ color: palette.muted3, marginTop: 2, fontSize: 11 }}>{todayStr} • {stores.length}/{MAX_STORES} magazen • Aktif: {active?.name ?? "—"}</Text>
          </View>
          <View style={{ backgroundColor: "rgba(255,255,255,0.12)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill }}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 10, letterSpacing: 0.4 }}>{stores.length}/{MAX_STORES}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 12 }}>
          <View style={{ flex: 1, backgroundColor: palette.successDot, borderRadius: radius.sm, padding: 6, alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Ionicons name="checkmark" size={12} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>Aktif: {active?.name ?? "—"}</Text>
            </View>
          </View>
          <View style={{ flex: 1, backgroundColor: palette.inkSoft, borderRadius: radius.sm, padding: 6, alignItems: "center" }}>
            <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{active?.location ?? ""}</Text>
          </View>
        </View>
        {justSwitched && (
          <View style={{ marginTop: 8, backgroundColor: palette.successBg, borderRadius: radius.sm, padding: 8 }}>
            <Text style={{ fontWeight: "800", fontSize: 12, color: palette.success, textAlign: "center" }}>✓ Ou ap itilize kounye a: {stores.find(s => s.id === justSwitched)?.name}</Text>
          </View>
        )}
      </View>

      {/* Stat cards */}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <View style={{ flex: 1, backgroundColor: palette.surface, borderRadius: radius.sm, padding: 12, borderWidth: 1, borderColor: palette.separator, ...shadow.soft }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="storefront-outline" size={13} color={palette.muted2} />
            <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700" }}>MAGAZEN</Text>
          </View>
          <Text style={{ fontWeight: "900", fontSize: 18, color: palette.ink, marginTop: 4, letterSpacing: -0.4 }}>{stores.length}<Text style={{ fontSize: 13, color: palette.muted3 }}>/{MAX_STORES}</Text></Text>
          <Text style={{ fontSize: 10, color: palette.muted2, marginTop: 2 }}>total kreye</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: palette.surface, borderRadius: radius.sm, padding: 12, borderWidth: 1, borderColor: palette.separator, ...shadow.soft }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="checkmark-circle-outline" size={13} color={palette.success} />
            <Text style={{ fontSize: 10, color: palette.muted2, fontWeight: "700" }}>AKTIF</Text>
          </View>
          <Text numberOfLines={1} style={{ fontWeight: "900", fontSize: 16, color: palette.success, marginTop: 4, letterSpacing: -0.3 }}>{active?.name ?? "—"}</Text>
          <Text numberOfLines={1} style={{ fontSize: 10, color: palette.muted2, marginTop: 2 }}>{active?.location ?? ""}</Text>
        </View>
      </View>

      {/* Store list section */}
      <View style={{ marginTop: 12, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.separator, overflow: "hidden", ...shadow.soft }}>
        <View style={{ padding: 12, borderBottomWidth: 1, borderColor: palette.separator, flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: palette.surface2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="layers-outline" size={15} color={palette.ink} />
            <Text style={{ fontWeight: "900", fontSize: 13, color: palette.ink }}>Magazen yo ({stores.length})</Text>
          </View>
          <Pressable
            onPress={() => { if (stores.length >= MAX_STORES) { Alert.alert("Limit rive", "Ou gen maksimòm 3 magazen. Pou kreye plis, ou bezwen aksè espesyal."); return; } setShowCreate(true); }}
            style={{ backgroundColor: palette.ink2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, flexDirection: "row", alignItems: "center", gap: 5, ...shadow.soft }}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>Nouvo</Text>
          </Pressable>
        </View>
        {stores.map(s => {
          const isActive = s.id === activeStoreId;
          const blocked = !!s.disabled;
          return (
            <Pressable
              key={s.id}
              onPress={() => { if (!isActive && !blocked) { setVerifyStore(s); setVerifyCode(""); setCodeError(""); } else if (blocked) { Alert.alert("Magazen bloke", "Magazen sa a sispann apre yon bès sekirite. Kontakte Konsole Sipò pou rektifye."); } }}
              style={{ padding: 12, borderBottomWidth: 1, borderColor: palette.separatorSoft, backgroundColor: isActive ? palette.surface2 : blocked ? palette.dangerBg : palette.surface, opacity: blocked && !isActive ? 0.85 : 1 }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: isActive ? palette.successBg : blocked ? palette.dangerBg : palette.surfaceGrouped, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="storefront-outline" size={18} color={isActive ? palette.success : blocked ? palette.danger : palette.muted2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontWeight: "800", fontSize: 14, color: palette.ink }} numberOfLines={1}>{s.name}</Text>
                      {isActive && <View style={{ backgroundColor: palette.successBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontWeight: "800", color: palette.success }}>AKTIF</Text></View>}
                      {blocked && <View style={{ backgroundColor: palette.dangerBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontWeight: "800", color: palette.danger }}>BLOKE</Text></View>}
                      {s.breachFlagged && !blocked && <View style={{ backgroundColor: palette.warningBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontWeight: "800", color: palette.warning }}>BÈS</Text></View>}
                    </View>
                    <Text style={{ fontSize: 11, color: palette.muted2, marginTop: 1 }} numberOfLines={1}>{s.location} • Depi {new Date(s.createdAt).toLocaleDateString()}</Text>
                  </View>
                </View>
                {isActive ? <Ionicons name="checkmark-circle" size={20} color={palette.success} /> : blocked ? <Ionicons name="lock-closed" size={16} color={palette.danger} /> : <Ionicons name="chevron-forward" size={16} color={palette.muted3} />}
              </View>
              <View style={{ marginTop: 8, backgroundColor: palette.surface2, borderWidth: 1, borderColor: palette.separator, borderRadius: radius.sm, padding: 8, flexDirection: "row", alignItems: "center" }}>
                <Ionicons name="lock-closed-outline" size={13} color={palette.muted2} style={{ marginRight: 6 }} />
                <Text style={{ fontSize: 11, color: palette.muted2, fontWeight: "700" }}>Kòd sekrè</Text>
                <Text style={{ fontSize: 11, color: palette.muted3, marginLeft: 6, fontStyle: "italic" }}>Sere deyò app la • pa vizib</Text>
                <View style={{ marginLeft: "auto", backgroundColor: palette.surfaceGrouped, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                  <Text style={{ fontSize: 11, color: palette.muted2, fontWeight: "700", letterSpacing: 2 }}>••••</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* App access section */}
      <View style={{ marginTop: 12, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.separator, padding: 12, ...shadow.soft }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="lock-closed-outline" size={14} color={palette.ink} />
              <Text style={{ fontWeight: "800", fontSize: 13, color: palette.ink }}>Aksè app (Pwopriyetè)</Text>
            </View>
            <Text style={{ fontSize: 11, color: appDisabled ? palette.danger : palette.muted2, marginTop: 2 }}>{appDisabled ? "Li sèlman pwopriyetè a" : "Tout manm ka ekri"}</Text>
          </View>
          <Pressable onPress={() => setAppDisabled(v => !v)} style={{ backgroundColor: appDisabled ? palette.danger : palette.success, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm, ...shadow.soft }}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>{appDisabled ? "Aktive" : "Dezaktive"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ marginTop: 12, backgroundColor: palette.surface2, borderWidth: 1, borderColor: palette.separator, borderRadius: radius.md, padding: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="information-circle-outline" size={15} color={palette.muted2} />
          <Text style={{ fontWeight: "800", fontSize: 12, color: palette.muted2 }}>Eskalad magazen</Text>
        </View>
        <Text style={{ fontSize: 11, color: palette.muted3, marginTop: 4, lineHeight: 16 }}>Tap yon lòt magazen epi antre kòd sekrè li pou chanje magazen aktif. Limit 3 san aksè espesyal.</Text>
      </View>

      {/* Create store modal */}
      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", alignItems: isTablet ? "center" : undefined }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", ...(isTablet && { alignItems: "center", width }) }}>
              <View style={{ ...sheetBox(isTablet, width, 640), backgroundColor: palette.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 16, ...shadow.elevated }}>
            <View style={{ width: 36, height: 4, backgroundColor: palette.separator, borderRadius: 2, alignSelf: "center", marginBottom: 14 }} />
            <Text style={{ fontWeight: "900", textAlign: "center", color: palette.ink, fontSize: 17, letterSpacing: -0.3 }}>Nouvo Magazen</Text>
            <Text style={{ textAlign: "center", color: palette.muted2, fontSize: 12, marginTop: 4 }}>{stores.length}/{MAX_STORES} kreye • Kòd sekrè 4 karaktè ap généré otomatikman</Text>
            <TextInput placeholder="Non magazen" placeholderTextColor={palette.muted3} value={newName} onChangeText={v => { setNewName(v); if (error) setError(""); }} style={{ borderWidth: 1, borderColor: palette.separator, borderRadius: radius.sm, paddingVertical: 14, paddingHorizontal: 12, minHeight: 48, marginTop: 12, fontWeight: "700", color: palette.ink, backgroundColor: palette.surface }} />
            <TextInput placeholder="Lokal / site" placeholderTextColor={palette.muted3} value={newLocation} onChangeText={v => { setNewLocation(v); if (error) setError(""); }} style={{ borderWidth: 1, borderColor: palette.separator, borderRadius: radius.sm, paddingVertical: 14, paddingHorizontal: 12, minHeight: 48, marginTop: 8, fontWeight: "700", color: palette.ink, backgroundColor: palette.surface }} />
            {stores.length >= MAX_STORES && (
              <View style={{ marginTop: 8, backgroundColor: palette.warningBg, borderWidth: 1, borderColor: palette.warningBd, borderRadius: radius.sm, padding: 8 }}>
                <Text style={{ fontSize: 11, color: palette.warning, fontWeight: "700" }}>Limit 3 magazen rive jwenn — ou bezwen aksè espesyal.</Text>
              </View>
            )}
            {error ? <Text style={{ fontSize: 12, color: palette.danger, fontWeight: "700", marginTop: 8, textAlign: "center" }}>{error}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable onPress={() => { setShowCreate(false); setError(""); }} style={{ flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: palette.hairline }}><Text style={{ fontWeight: "700", color: palette.ink }}>Anile</Text></Pressable>
              <Pressable onPress={createStore} style={{ flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", ...shadow.soft }}><Text style={{ color: "#fff", fontWeight: "800" }}>Kreye magazen</Text></Pressable>
            </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* One-time secret code — shown once only, must be saved outside app */}
      <Modal visible={!!createdCode} transparent animationType="fade" onRequestClose={() => { setCreatedCode(null); setTimeout(onClose, 350); }}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24, alignItems: "center" }}>
          <View style={{ ...dialogBox(isTablet, width, 480), width: "100%", backgroundColor: palette.surface, borderRadius: radius.lg, padding: 16, alignItems: "center", ...shadow.elevated }}>
            <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: palette.warningBg, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="warning-outline" size={24} color={palette.warningDot} />
            </View>
            <Text style={{ fontWeight: "900", fontSize: 16, marginTop: 12, textAlign: "center", color: palette.ink, letterSpacing: -0.3 }}>Kòd sekrè — Sere li kounye a</Text>
            <Text style={{ textAlign: "center", color: palette.muted2, fontSize: 12, marginTop: 6 }}>Sa se sèl fwa ou pral wè kòd sa a nan app la. Ekri li epi sere li deyò app la (kaye, nòt an sekirite).</Text>
            <View style={{ marginTop: 14, backgroundColor: palette.ink2, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 24, alignItems: "center", alignSelf: "stretch" }}>
              <Text style={{ color: palette.muted3, fontSize: 10, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" }}>Kòd magazen</Text>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 24, letterSpacing: 4, marginTop: 4 }}>{createdCode}</Text>
            </View>
            <Text style={{ textAlign: "center", color: palette.danger, fontSize: 11, fontWeight: "700", marginTop: 12 }}>Apre ou fèmen, kòd la p ap janm parèt ankò — menm pwopriyetè pa ka wè li.</Text>
            <Pressable onPress={() => { setCreatedCode(null); setTimeout(onClose, 350); }} style={{ marginTop: 14, backgroundColor: palette.ink2, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 24, minHeight: 48, alignItems: "center", justifyContent: "center", alignSelf: "stretch", ...shadow.soft }}>
              <Text style={{ color: "#fff", fontWeight: "800" }}>Mwen sere li deyò app la ✓</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Verify store switch modal */}
      <Modal visible={!!verifyStore} transparent animationType="fade" onRequestClose={() => setVerifyStore(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24, alignItems: "center" }}>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", ...(isTablet && { alignItems: "center", width }) }}>
              <View style={{ ...dialogBox(isTablet, width, 480), width: "100%", backgroundColor: palette.surface, borderRadius: radius.lg, padding: 16, ...shadow.elevated }}>
            <Text style={{ fontWeight: "900", textAlign: "center", color: palette.ink, fontSize: 17, letterSpacing: -0.3 }}>Chanje magazen</Text>
            <Text style={{ textAlign: "center", color: palette.muted2, fontSize: 12, marginTop: 4 }}>Ou pral chanje nan <Text style={{ fontWeight: "800", color: palette.ink }}>{verifyStore?.name}</Text>. Antre kòd sekrè magazen sa a.</Text>
            <TextInput
              value={verifyCode}
              onChangeText={v => { setVerifyCode(v); if (codeError) setCodeError(""); }}
              placeholder="Kòd sekrè"
              placeholderTextColor={palette.muted3}
              autoCapitalize="characters"
              autoFocus
              secureTextEntry
              style={{ borderWidth: 1, borderColor: codeError ? palette.dangerBd : palette.separator, borderRadius: radius.sm, paddingVertical: 14, paddingHorizontal: 12, minHeight: 48, marginTop: 12, fontWeight: "800", letterSpacing: 3, textAlign: "center", color: palette.ink, backgroundColor: palette.surface }}
            />
            {codeError ? <Text style={{ fontSize: 12, color: palette.danger, fontWeight: "700", marginTop: 8, textAlign: "center" }}>{codeError}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable onPress={() => { setVerifyStore(null); setVerifyCode(""); setCodeError(""); }} style={{ flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: palette.surfaceGrouped, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: palette.hairline }}><Text style={{ fontWeight: "700", color: palette.ink }}>Anile</Text></Pressable>
              <Pressable onPress={confirmSwitch} style={{ flex: 1, minHeight: 48, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: palette.ink2, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", ...shadow.soft }}><Text style={{ color: "#fff", fontWeight: "800" }}>Chanje</Text></Pressable>
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

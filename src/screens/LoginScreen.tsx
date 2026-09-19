// Jesyon Magazen — enter the app.
// Luxurious dark-hero sign-in/sign-up. In local-dev (mock) mode you can enter
// through demo credentials for every role, each carrying its own secret code.
import { useState } from "react";
import { SafeAreaView, Text, View, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthState, DEMO_CREDENTIALS } from "../auth/authStore";
import { isLiveSupabase } from "../auth/supabase";
import { palette, radius, shadow } from "../theme";
import type { Role } from "../users";
import { useResponsive, centerBox } from "../responsive";

const ROLE_META: Record<Role, { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  owner: { label: "Pwopriyetè", color: palette.accentGold, bg: palette.accentGoldSoft, icon: "diamond-outline" },
  admin: { label: "Admin", color: palette.violet, bg: palette.violetBg, icon: "shield-checkmark-outline" },
  manager: { label: "Jestyonè", color: palette.blue, bg: palette.blueBg, icon: "briefcase-outline" },
  cashier: { label: "Kasye", color: palette.emerald, bg: palette.emeraldSoft, icon: "cart-outline" },
};

type Mode = "signin" | "signup";

function BrandHero({ compact }: { compact?: boolean }) {
  return (
    <View style={{ alignItems: "center", paddingTop: compact ? 34 : 64, paddingBottom: compact ? 28 : 44, paddingHorizontal: 28 }}>
      <View pointerEvents="none" style={{ position: "absolute", top: compact ? 0 : -30 }}>
        <View style={{ width: 240, height: 240, borderRadius: 120, backgroundColor: "rgba(200,162,74,0.08)", position: "absolute", top: -40, left: -124 }} />
        <View style={{ width: 140, height: 140, borderRadius: 70, backgroundColor: "rgba(200,162,74,0.14)", position: "absolute", top: -10, left: -70 }} />
      </View>
      <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: palette.ink2, borderWidth: 1, borderColor: "rgba(200,162,74,0.55)", alignItems: "center", justifyContent: "center", shadowColor: palette.accentGold, shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}>
        <Image source={require("../../assets/kourro-logo.png")} style={{ width: 52, height: 52, resizeMode: "contain" }} />
      </View>
      <Text allowFontScaling={false} style={{ fontFamily: "Quicksand_700Bold", color: "#fff", fontWeight: "700", fontSize: 22, letterSpacing: -0.6, marginTop: 18, textAlign: "center" }}>
        Kourro
      </Text>
      <Text allowFontScaling={false} style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 8, textAlign: "center", lineHeight: 17 }}>
        Bati yon biznis ki ap siviv ou.{'\n'}Konplè, offline-first, + machandiz kreyòl.
      </Text>
    </View>
  );
}

export default function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const { width, isTablet } = useResponsive();
  const { user, cached, error, signIn, signUp, unlockWithPin, demoSignIn, signOut } = useAuthState();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [focused, setFocused] = useState<"email" | "password" | "name" | "store" | null>(null);

  const inputStyle = (k: "email" | "password" | "name" | "store") => ({
    borderWidth: 0.5,
    borderColor: focused === k ? "rgba(255,77,0,0.8)" : palette.separator,
    borderRadius: radius.sm,
    backgroundColor: palette.surface2,
    paddingHorizontal: 14,
    height: 46,
    marginTop: 8,
    fontSize: 14,
    color: palette.ink,
    fontFamily: "Roboto_400Regular",
  });

  const fieldFocus = (k: "email" | "password" | "name" | "store") => ({
    onFocus: () => setFocused(k),
    onBlur: () => setFocused(null),
  });

  // Offline PIN quick entry (cached profile, no live session).
  if (!user && cached) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.ink2 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: isTablet ? 32 : 24, alignItems: isTablet ? "center" : undefined }}>
          <View style={{ ...centerBox(isTablet, width, 480), width: "100%" }}>
          <BrandHero compact />
          <View style={{ backgroundColor: palette.surface, borderRadius: radius.xl, padding: 22, borderWidth: 0.5, borderColor: "rgba(200,162,74,0.35)", ...shadow.elevated }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 14, borderBottomWidth: 0.5, borderColor: palette.separator }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: ROLE_META[cached.role].color }}>
                <Text allowFontScaling={false} style={{ fontFamily: "Quicksand_700Bold", color: "#fff", fontWeight: "700", fontSize: 17 }}>{cached.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text allowFontScaling={false} style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 16, color: palette.ink }} numberOfLines={1}>{cached.name}</Text>
                <Text allowFontScaling={false} style={{ fontSize: 11, color: palette.muted2, marginTop: 2 }}>{ROLE_META[cached.role].label} • {cached.store}</Text>
              </View>
            </View>
            <Text allowFontScaling={false} style={{ fontSize: 11, color: palette.muted, marginTop: 14 }}>Antre PIN ou pou ouvri san koneksyon.</Text>
            <TextInput value={pin} onChangeText={setPin} keyboardType="number-pad" maxLength={4} secureTextEntry placeholder="••••" placeholderTextColor={palette.muted3} style={inputStyle("password")} autoFocus />
            {(localError ?? error) && <Text allowFontScaling={false} style={{ color: palette.danger, fontSize: 12, marginTop: 8, fontWeight: "600" }}>{localError ?? error}</Text>}
            <Pressable onPress={() => { const r = unlockWithPin(pin); if (r.ok) onAuthed(); else setLocalError(r.error ?? "PIN pa kòrèk."); }} style={{ marginTop: 16, backgroundColor: palette.ink2, borderRadius: radius.sm, paddingVertical: 14, alignItems: "center", borderWidth: 0.5, borderColor: "rgba(200,162,74,0.45)", ...shadow.card }}>
              <Text allowFontScaling={false} style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>🔓 Ouvri</Text>
            </Pressable>
            <Pressable onPress={() => signOut()} style={{ marginTop: 12, alignItems: "center" }}>
              <Text allowFontScaling={false} style={{ fontSize: 12, color: palette.muted2, fontWeight: "600" }}>Pase nan koneksyon imel →</Text>
            </Pressable>
          </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const submit = () => {
    setBusy(true); setLocalError(null);
    if (!email.trim() || password.length < 6) {
      setLocalError("Imel valab ak modpas 6 karaktè omwen."); setBusy(false); return;
    }
    const run = async () => {
      let r;
      if (mode === "signin") r = await signIn(email.trim(), password);
      else {
        if (!fullName.trim() || !storeName.trim()) { setLocalError("Non konplè ak non magazen yo obligatwa."); setBusy(false); return; }
        r = await signUp(email.trim(), password, fullName.trim(), storeName.trim());
      }
      if (r.ok) onAuthed(); else setLocalError(r.error ?? "Imposib. Eseye ankò.");
      setBusy(false);
    };
    run();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.ink2 }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, alignItems: isTablet ? "center" : undefined }}>
          <View style={{ ...centerBox(isTablet, width, 560), width: "100%" }}>
          <BrandHero compact />
          <View style={{ flex: 1, backgroundColor: palette.bgWarm, borderTopLeftRadius: 32, borderTopRightRadius: 32, marginTop: -20, paddingHorizontal: isTablet ? 28 : 22, paddingTop: 26, paddingBottom: 40, ...(isTablet && { borderRadius: 32, marginTop: 0, marginBottom: 32 }) }}>
            <View style={{ flexDirection: "row", gap: 6, backgroundColor: palette.surfaceGrouped, borderRadius: 14, padding: 4, marginBottom: 22, borderWidth: 0.5, borderColor: palette.hairline }}>
              {(["signin", "signup"] as const).map(m => (
                <Pressable key={m} onPress={() => setMode(m)} style={{ flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: "center", backgroundColor: mode === m ? palette.surface : "transparent", ...(mode === m ? { ...shadow.soft, borderWidth: 0.5, borderColor: "rgba(200,162,74,0.4)" } : {}) }}>
                  <Text allowFontScaling={false} style={{ fontWeight: "700", fontSize: 13, color: mode === m ? palette.ink : palette.muted2 }}>{m === "signin" ? "Konekte" : "Kreye Kont"}</Text>
                </Pressable>
              ))}
            </View>

            {!isLiveSupabase && (
              <>
                <Text allowFontScaling={false} style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: palette.muted2 }}>Antre Demo — chwazi wòl ou</Text>
                <Text allowFontScaling={false} style={{ fontSize: 11, color: palette.muted2, marginTop: 4, marginBottom: 14 }}>Pa gen backend konekte (localhost). Chak wòl gen kòd sekrè li — pre 1, li ap sèvi tou kòm PIN. One tap pou antre.</Text>
                <View style={{ backgroundColor: palette.surface, borderRadius: radius.xl, borderWidth: 0.5, borderColor: palette.hairline, overflow: "hidden", ...shadow.card }}>
                  {DEMO_CREDENTIALS.map((c, i) => {
                    const meta = ROLE_META[c.role];
                    return (
                      <Pressable key={c.userId} onPress={async () => { await demoSignIn(c.userId); onAuthed(); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: palette.separator, borderBottomWidth: i === DEMO_CREDENTIALS.length - 1 ? 0 : 0.5, borderBottomColor: palette.separator }}>
                        <View style={{ position: "relative" }}>
                          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: palette.ink2, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: meta.color }}>
                            <Text allowFontScaling={false} style={{ fontFamily: "Quicksand_700Bold", color: "#fff", fontWeight: "700", fontSize: 14 }}>{c.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
                          </View>
                          <View style={{ position: "absolute", right: -2, bottom: -2, width: 15, height: 15, borderRadius: 8, backgroundColor: palette.successDot, borderWidth: 2, borderColor: palette.surface }} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text allowFontScaling={false} style={{ fontFamily: "Quicksand_700Bold", fontWeight: "700", fontSize: 14, color: palette.ink, letterSpacing: -0.2 }} numberOfLines={1}>{c.name}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
                            <View style={{ height: 18, borderRadius: 9, paddingHorizontal: 7, backgroundColor: meta.bg, borderWidth: 0.5, borderColor: meta.color }}>
                              <Text allowFontScaling={false} style={{ fontWeight: "700", fontSize: 8, color: meta.color, letterSpacing: 0.6, textTransform: "uppercase" }}>{meta.label}</Text>
                            </View>
                            <Text allowFontScaling={false} style={{ fontSize: 11, color: palette.muted2 }} numberOfLines={1}>{c.store}</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <View style={{ paddingHorizontal: 9, height: 26, borderRadius: 9, backgroundColor: palette.accentGoldSoft, borderWidth: 0.5, borderColor: "rgba(200,162,74,0.45)", alignItems: "center", justifyContent: "center" }}>
                            <Text allowFontScaling={false} style={{ fontFamily: "Quicksand_700Bold", fontWeight: "800", fontSize: 12, color: palette.accentGold, letterSpacing: 1 }}>KÒD {c.pin}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={palette.muted3} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 22 }}>
                  <View style={{ flex: 1, height: 0.5, backgroundColor: palette.separator }} />
                  <Text allowFontScaling={false} style={{ fontSize: 10, color: palette.muted3, textTransform: "uppercase", letterSpacing: 1 }}>oswa — tape imel</Text>
                  <View style={{ flex: 1, height: 0.5, backgroundColor: palette.separator }} />
                </View>
                <Text allowFontScaling={false} style={{ fontSize: 10, color: palette.muted3, textAlign: "center", marginTop: 14, lineHeight: 15 }}>
                  Demo: owner@demo.magazen.ht · admin@ · manager@ · cashier@{'\n'}nenpòt modpas (6 karaktè omwen) — kont lokal
                </Text>
              </>
            )}

            <Text allowFontScaling={false} style={{ fontSize: 12, fontWeight: "600", color: palette.muted }}>Imel</Text>
              <TextInput value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="ou@magazen.ht" placeholderTextColor={palette.muted3} style={inputStyle("email")} {...fieldFocus("email")} />

              <Text allowFontScaling={false} style={{ fontSize: 12, fontWeight: "600", color: palette.muted, marginTop: 14 }}>Modpas</Text>
              <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" placeholderTextColor={palette.muted3} style={inputStyle("password")} {...fieldFocus("password")} />

              {mode === "signup" && (
                <>
                  <Text allowFontScaling={false} style={{ fontSize: 12, fontWeight: "600", color: palette.muted, marginTop: 14 }}>Non konplè</Text>
                  <TextInput value={fullName} onChangeText={setFullName} placeholder="Eg. Jacques Etienne" placeholderTextColor={palette.muted3} style={inputStyle("name")} {...fieldFocus("name")} />
                  <Text allowFontScaling={false} style={{ fontSize: 12, fontWeight: "600", color: palette.muted, marginTop: 14 }}>Non biznis / magazen *</Text>
                  <TextInput value={storeName} onChangeText={setStoreName} placeholder="Eg. Jakline Supply" placeholderTextColor={palette.muted3} style={inputStyle("store")} {...fieldFocus("store")} />
                  <Text allowFontScaling={false} style={{ fontSize: 10, color: palette.muted3, marginTop: 8 }}>Jiska 3 kote pou chak magazen — depann de plan an. Ou ka ajoute apre.</Text>
                </>
              )}

              {(localError ?? error) && (
                <View style={{ marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd }}>
                  <Text allowFontScaling={false} style={{ color: palette.danger, fontSize: 12, fontWeight: "600" }}>{localError ?? error}</Text>
                </View>
              )}

              <Pressable onPress={submit} disabled={busy} style={{ marginTop: 20, backgroundColor: palette.accent, borderRadius: radius.md, height: 54, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, borderWidth: 0, ...shadow.elevated, opacity: busy ? 0.65 : 1 }}>
                {busy ? <ActivityIndicator color="#fff6ee" /> : (
                  <>
                    <Text allowFontScaling={false} style={{ color: "#fff6ee", fontWeight: "800", fontSize: 15, letterSpacing: 0.2 }}>{mode === "signin" ? "Konekte" : "Kreye kont + magazen"}</Text>
                    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#fff6ee", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="arrow-forward" size={13} color="#ff4d00" />
                    </View>
                  </>
                )}
              </Pressable>

            <Text allowFontScaling={false} style={{ fontSize: 10, color: palette.muted3, textAlign: "center", marginTop: 24, letterSpacing: 0.4 }}>HTG • Offline-first • Byen pwotèje</Text>
          </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
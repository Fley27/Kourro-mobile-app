// Jesyon Magazen — enter the app.
// Sign-in only: accounts are provisioned server-side (admin portal), so the
// app never creates them. In local-dev (mock) mode you can enter through demo
// credentials for every role, each carrying its own secret code.
import { useState } from "react";
import { Text, View, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useAuthState, DEMO_CREDENTIALS } from "../auth/authStore";
import { isLiveSupabase } from "../auth/supabase";
import { blackPalette as palette, radius, shadow } from "../theme";
import type { Role } from "../users";
import { useResponsive, centerBox } from "../responsive";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardSafeScrollView } from "../components/KeyboardSafe";

const ROLE_META: Record<Role, { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  owner: { label: "Pwopriyetè", color: palette.accentGold, bg: palette.accentGoldSoft, icon: "diamond-outline" },
  admin: { label: "Admin", color: palette.violet, bg: palette.violetBg, icon: "shield-checkmark-outline" },
  manager: { label: "Jestyonè", color: palette.blue, bg: palette.blueBg, icon: "briefcase-outline" },
  cashier: { label: "Kasye", color: palette.emerald, bg: palette.emeraldSoft, icon: "cart-outline" },
  associate: { label: "Asosye", color: palette.emerald, bg: palette.emeraldSoft, icon: "person-outline" },
  cook: { label: "Kwizinye", color: palette.warning, bg: palette.warningBg, icon: "restaurant-outline" },
};

function BrandHero({ compact }: { compact?: boolean }) {
  return (
    <View style={{ alignItems: "center", paddingTop: compact ? 8 : 16, paddingBottom: compact ? 22 : 28, paddingHorizontal: 28 }}>
      <Image source={require("../../assets/kourro-wordmark.png")} style={{ width: compact ? 208 : 232, height: compact ? 55 : 61, resizeMode: "contain" }} />
      <Text allowFontScaling={false} style={{ fontFamily: "Inter_700Bold", color: palette.ink, fontWeight: "700", fontSize: 22, letterSpacing: -0.6, marginTop: 18, textAlign: "center" }}>
        Byenveni ankò
      </Text>
      <Text allowFontScaling={false} style={{ color: "#a1a1a6", fontSize: 13, marginTop: 6, textAlign: "center", lineHeight: 19 }}>
        Konekte pou kontinye jere biznis ou.
      </Text>
    </View>
  );
}

export default function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const { width, isTablet } = useResponsive();
  const { user, cached, error, signIn, unlockWithPin, demoSignIn, signOut } = useAuthState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [focused, setFocused] = useState<"email" | "password" | null>(null);

  const inputStyle = (k: "email" | "password") => ({
    borderWidth: 1,
    borderColor: focused === k ? "rgba(255,77,0,0.85)" : "rgba(255,255,255,0.11)",
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.055)",
    paddingHorizontal: 16,
    height: 54,
    marginTop: 8,
    fontSize: 14,
    color: palette.ink,
    fontFamily: "Inter_400Regular",
  });

  const fieldFocus = (k: "email" | "password") => ({
    onFocus: () => setFocused(k),
    onBlur: () => setFocused(null),
  });

  // Offline PIN quick entry (cached profile, no live session).
  if (!user && cached) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        <KeyboardSafeScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: isTablet ? 32 : 24, paddingVertical: 24 }}>
          <View style={{ ...centerBox(isTablet, width, 480), width: "100%" }}>
          <BrandHero compact />
          <View style={{ position: "relative", overflow: "hidden", backgroundColor: "rgba(28,28,30,0.78)", borderRadius: 28, padding: 22, borderWidth: 1, borderColor: "rgba(255,255,255,0.13)", ...shadow.card }}>
            <BlurView tint="dark" intensity={18} style={StyleSheet.absoluteFillObject} />
            <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 24, right: 24, height: 1, backgroundColor: "rgba(255,255,255,0.18)" }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 14, borderBottomWidth: 0.5, borderColor: palette.separator }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: ROLE_META[cached.role].color }}>
                <Text allowFontScaling={false} style={{ fontFamily: "Inter_700Bold", color: palette.ink, fontWeight: "700", fontSize: 17 }}>{cached.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text allowFontScaling={false} style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 16, color: palette.ink }} numberOfLines={1}>{cached.name}</Text>
                <Text allowFontScaling={false} style={{ fontSize: 11, color: palette.muted2, marginTop: 2 }}>{ROLE_META[cached.role].label} • {cached.store}</Text>
              </View>
            </View>
            <Text allowFontScaling={false} style={{ fontSize: 11, color: palette.muted, marginTop: 14 }}>Antre PIN ou pou ouvri san koneksyon.</Text>
            <TextInput value={pin} onChangeText={setPin} keyboardType="number-pad" maxLength={4} secureTextEntry placeholder="••••" placeholderTextColor={palette.muted3} style={inputStyle("password")} autoFocus />
            {(localError ?? error) && <Text allowFontScaling={false} style={{ color: palette.danger, fontSize: 12, marginTop: 8, fontWeight: "600" }}>{localError ?? error}</Text>}
            <Pressable onPress={() => { const r = unlockWithPin(pin); if (r.ok) onAuthed(); else setLocalError(r.error ?? "PIN pa kòrèk."); }} style={{ marginTop: 16, backgroundColor: palette.accent, borderRadius: radius.sm, paddingVertical: 14, alignItems: "center", ...shadow.card }}>
              <Text allowFontScaling={false} style={{ color: palette.emberInk, fontWeight: "800", fontSize: 14 }}>Ouvri</Text>
            </Pressable>
            <Pressable onPress={() => signOut()} style={{ marginTop: 12, alignItems: "center" }}>
              <Text allowFontScaling={false} style={{ fontSize: 12, color: palette.muted2, fontWeight: "600" }}>Pase nan koneksyon imel →</Text>
            </Pressable>
          </View>
          </View>
        </KeyboardSafeScrollView>
      </SafeAreaView>
    );
  }

  const submit = () => {
    setBusy(true); setLocalError(null);
    if (!email.trim() || password.length < 6) {
      setLocalError("Imel valab ak modpas 6 karaktè omwen."); setBusy(false); return;
    }
    const run = async () => {
      const r = await signIn(email.trim(), password);
      if (r.ok) onAuthed(); else setLocalError(r.error ?? "Imposib. Eseye ankò.");
      setBusy(false);
    };
    run();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <KeyboardSafeScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: isTablet ? 32 : 24, paddingVertical: 24 }}>
        <View style={{ ...centerBox(isTablet, width, 500), width: "100%" }}>
          <BrandHero compact={!isTablet} />
        <View style={{ position: "relative", overflow: "hidden", backgroundColor: "rgba(28,28,30,0.78)", borderRadius: 28, marginBottom: 24, paddingHorizontal: isTablet ? 28 : 22, paddingTop: 24, paddingBottom: 28, borderWidth: 1, borderColor: "rgba(255,255,255,0.13)", ...shadow.card }}>
          <BlurView tint="dark" intensity={18} style={StyleSheet.absoluteFillObject} />
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 24, right: 24, height: 1, backgroundColor: "rgba(255,255,255,0.18)" }} />
          {!isLiveSupabase && (
            <>
              <Text allowFontScaling={false} style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: palette.muted2, textAlign: "center" }}>Antre Demo — chwazi wòl ou</Text>
              <Text allowFontScaling={false} style={{ fontSize: 11, color: palette.muted2, marginTop: 5, marginBottom: 14, textAlign: "center", lineHeight: 16 }}>Pa gen backend konekte (localhost). Chak wòl gen kòd sekrè li — pre 1, li ap sèvi tou kòm PIN. One tap pou antre.</Text>
              <View style={{ backgroundColor: "rgba(255,255,255,0.045)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  {DEMO_CREDENTIALS.map((c, i) => {
                    const meta = ROLE_META[c.role];
                    return (
                      <Pressable key={c.userId} onPress={async () => { await demoSignIn(c.userId); onAuthed(); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: palette.separator, borderBottomWidth: i === DEMO_CREDENTIALS.length - 1 ? 0 : 0.5, borderBottomColor: palette.separator }}>
                        <View style={{ position: "relative" }}>
                          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: meta.color }}>
                            <Text allowFontScaling={false} style={{ fontFamily: "Inter_700Bold", color: palette.ink, fontWeight: "700", fontSize: 14 }}>{c.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}</Text>
                          </View>
                          <View style={{ position: "absolute", right: -2, bottom: -2, width: 15, height: 15, borderRadius: 8, backgroundColor: palette.successDot, borderWidth: 2, borderColor: "#1c1c1e" }} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text allowFontScaling={false} style={{ fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 14, color: palette.ink, letterSpacing: -0.2 }} numberOfLines={1}>{c.name}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
                            <View style={{ minHeight: 18, borderRadius: 9, paddingHorizontal: 7, backgroundColor: meta.bg, borderWidth: 0.5, borderColor: meta.color, justifyContent: "center" }}>
                              <Text allowFontScaling={false} style={{ fontWeight: "700", fontSize: 8, color: meta.color, letterSpacing: 0.6, textTransform: "uppercase" }}>{meta.label}</Text>
                            </View>
                            <Text allowFontScaling={false} style={{ fontSize: 11, color: palette.muted2 }} numberOfLines={1}>{c.store}</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <View style={{ paddingHorizontal: 9, height: 26, borderRadius: 9, backgroundColor: "rgba(200,162,74,0.14)", borderWidth: 0.5, borderColor: "rgba(200,162,74,0.35)", alignItems: "center", justifyContent: "center" }}>
                            <Text allowFontScaling={false} style={{ fontFamily: "Inter_700Bold", fontWeight: "800", fontSize: 12, color: palette.accentGold, letterSpacing: 1 }}>KÒD {c.pin}</Text>
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

              {(localError ?? error) && (
                <View style={{ marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: palette.dangerBg, borderWidth: 0.5, borderColor: palette.dangerBd }}>
                  <Text allowFontScaling={false} style={{ color: palette.danger, fontSize: 12, fontWeight: "600" }}>{localError ?? error}</Text>
                </View>
              )}

              <Pressable onPress={submit} disabled={busy} style={{ marginTop: 20, backgroundColor: palette.accent, borderRadius: radius.md, height: 54, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, borderWidth: 0, ...shadow.elevated, opacity: busy ? 0.65 : 1 }}>
                {busy ? <ActivityIndicator color="#fff6ee" /> : (
                  <>
                    <Text allowFontScaling={false} style={{ color: "#fff6ee", fontWeight: "800", fontSize: 15, letterSpacing: 0.2 }}>Konekte</Text>
                    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#fff6ee", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="arrow-forward" size={13} color="#ff4d00" />
                    </View>
                  </>
                )}
              </Pressable>
          </View>
          </View>
        </KeyboardSafeScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
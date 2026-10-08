// UploadTransition — reusable DB-upload monitor. Wraps any async write with an
// Apple-smooth overlay: eased loading (minimum duration so it never flashes),
// then a success/error status held long enough to read. Anytime we upload
// data, run it through here so the user always sees what's happening.
//
// Global driver (uploadSuccess / uploadError): the app root mounts
// <GlobalUploadTransition /> once, so any screen can show the shared overlay
// after a save/edit instead of firing an Alert — no per-screen busy state.
import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { View, Text, Modal, Animated, Easing, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type UploadPhase = "loading" | "success" | "error";

// ── Global overlay store ──

export type UploadNotifyState = {
  visible: boolean;
  phase: UploadPhase;
  title: string;
  detail?: string;
};

const IDLE: UploadNotifyState = { visible: false, phase: "loading", title: "" };

let notifyState: UploadNotifyState = IDLE;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let notifyDone: (() => void) | null = null;
const notifyListeners = new Set<() => void>();

function emitNotify() {
  notifyListeners.forEach(l => l());
}

function subscribeNotify(l: () => void) {
  notifyListeners.add(l);
  return () => { notifyListeners.delete(l); };
}

function getNotifyState(): UploadNotifyState {
  return notifyState;
}

type NotifyOpts = {
  title: string;
  detail?: string;
  // Runs after the hold completes (e.g. close the sheet the alert used to close).
  onDone?: () => void;
  // Custom hold before auto-hide (per-flow override; success default is 1500ms).
  holdMs?: number;
};

function runDone() {
  const fn = notifyDone;
  notifyDone = null;
  if (!fn) return;
  try { fn(); } catch {}
}

function notify(phase: UploadPhase, opts: NotifyOpts) {
  // A newer result supersedes the one on screen — finish its onDone first so a
  // pending sheet-close callback can never be dropped.
  if (notifyTimer) { clearTimeout(notifyTimer); notifyTimer = null; runDone(); }
  notifyState = { visible: true, phase, title: opts.title, detail: opts.detail };
  notifyDone = opts.onDone ?? null;
  emitNotify();
  // Loading never auto-hides — it stays up until the result (success/error)
  // supersedes it, however long the write takes.
  if (phase === "loading") return;
  // Same cadence as the screen-local overlays: success readable (1.5s),
  // errors longer.
  const hold = opts.holdMs ?? (phase === "error" ? 3000 : 1500);
  notifyTimer = setTimeout(() => {
    notifyState = IDLE;
    notifyTimer = null;
    emitNotify();
    runDone();
  }, hold);
}

/** In-flight write — stays until uploadSuccess/uploadError supersedes it. */
export function uploadLoading(title: string, detail?: string, onDone?: () => void) {
  notify("loading", { title, detail, onDone });
}

/** Post-save/edit SUCCESS result — replaces Alert.alert("... ✓", msg). */
export function uploadSuccess(title: string, detail?: string, onDone?: () => void, holdMs?: number) {
  notify("success", { title, detail, onDone, holdMs });
}

/** Post-save/edit FAILURE result — replaces Alert.alert("Erè", msg). */
export function uploadError(title: string, detail?: string, onDone?: () => void, holdMs?: number) {
  notify("error", { title, detail, onDone, holdMs });
}

/** Mounted once at the app root. */
export function GlobalUploadTransition({ overlay }: { overlay?: boolean } = {}) {
  const s = useSyncExternalStore(subscribeNotify, getNotifyState, getNotifyState);
  return <UploadTransition overlay={overlay} visible={s.visible} phase={s.phase} title={s.title} detail={s.detail} />;
}

/**
 * True while a global uploadSuccess/uploadError toast is on screen. A toast is
 * its own RN <Modal>, so anything else that has to present a Modal (the POS
 * receipt) must wait for it — iOS silently drops the second presentation.
 */
export function useUploadNotifyVisible(): boolean {
  return useSyncExternalStore(subscribeNotify, getNotifyState, getNotifyState).visible;
}

export function UploadTransition({ visible, phase, title, detail, overlay }: {
  visible: boolean;
  phase: UploadPhase;
  title: string;
  detail?: string;
  // In-window mode: a sibling top-level Modal mounts UNDER the board Modal on
  // iOS, so callers inside a Modal window pass overlay and get the same markup
  // as an absolute layer in their own window instead.
  overlay?: boolean;
}) {
  const pop = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => { console.log("[upload] render", { visible, phase, title, detail }); }, [visible, phase, title, detail]);
  useEffect(() => {
    if (!visible) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(({ finished }) => console.log("[upload] fade finished", finished));
  }, [visible, fade]);
  useEffect(() => {
    if (!visible) return;
    if (phase === "loading") {
      pop.setValue(0);
      return;
    }
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 7, tension: 110, useNativeDriver: true }).start();
  }, [visible, phase, pop]);
  // Not visible → out of the tree entirely: a mounted-but-hidden Modal still
  // registers on Android and can swallow the hardware back button.
  if (!visible) return null;
  // Background sits OUTSIDE the animated opacity: as soon as the layer is up
  // the screen is opaque, so an invisible-but-touch-blocking overlay can never
  // look like a frozen UI.
  const body = (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Animated.View style={{ flex: 1, alignItems: "center", opacity: fade }}>
        <View style={{ marginTop: 110, alignItems: "center", paddingHorizontal: 24 }}>
          <Text style={{ fontWeight: "800", fontSize: 24, color: "#fff", textAlign: "center", letterSpacing: -0.3 }} numberOfLines={2}>{title}</Text>
          {!!detail ? <Text style={{ fontSize: 14, color: "#8E8E93", marginTop: 6, textAlign: "center" }}>{detail}</Text> : null}
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          {phase === "loading" ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : (
            <Animated.View
              style={{
                transform: [{ scale: pop }],
                width: 84, height: 84, borderRadius: 42, borderWidth: 4,
                borderColor: phase === "success" ? "#30D158" : "#FF453A",
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Ionicons name={phase === "success" ? "checkmark" : "close"} size={42} color={phase === "success" ? "#30D158" : "#FF453A"} />
            </Animated.View>
          )}
          <Animated.Text style={{ fontWeight: "800", fontSize: 20, color: "#fff", marginTop: 18, opacity: phase === "loading" ? 1 : pop }}>
            {phase === "loading" ? "Ap voye…" : phase === "success" ? "Siksè" : "Echwe"}
          </Animated.Text>
        </View>
      </Animated.View>
    </View>
  );
  if (overlay) {
    return <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 120, elevation: 120 }}>{body}</View>;
  }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      {body}
    </Modal>
  );
}

// Guarantees a minimum duration so the transition never flashes by.
export function minDelay<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.all([work, new Promise<void>(r => setTimeout(r, ms))]).then(([out]) => out);
}

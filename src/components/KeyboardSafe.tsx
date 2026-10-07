import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  type ScrollViewProps,
  type ViewStyle,
} from "react-native";

/**
 * Universal keyboard contract — applies identically to phone and tablet:
 *
 * - KeyboardSafeView: the one KeyboardAvoidingView recipe for every screen,
 *   modal and sheet that hosts inputs (iOS behavior="padding" pushes the
 *   layout above the keyboard; Android behavior="height" pairs with
 *   softwareKeyboardLayoutMode="pan" — see app.json).
 * - KeyboardSafeScrollView: ScrollView that keeps the focused field visible
 *   above the keyboard (measures the input once the keyboard has settled and
 *   scrolls just enough) and lets taps through while the keyboard is open.
 * - useKeyboardHeight: for footers/CTAs that live outside a KAV.
 *
 * Never mix an extra `paddingBottom = keyboardHeight` with an ancestor
 * KeyboardSafeView — the KAV already lifts the layout; doubling over-scrolls.
 */

const SHOW_EVENT = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const HIDE_EVENT = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

type KeyboardBox = { top: number; height: number };

function keyboardBoxFrom(e: any): KeyboardBox {
  const c = e?.endCoordinates ?? {};
  const height = typeof c.height === "number" ? c.height : 0;
  const windowH = Dimensions.get("window").height;
  // iOS reports screenY = keyboard top; Android often omits it.
  const top = typeof c.screenY === "number" && c.screenY > 0 ? c.screenY : windowH - height;
  return { top, height };
}

/** Current keyboard height (0 while hidden). */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(SHOW_EVENT, (e: any) => setHeight(e?.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(HIDE_EVENT, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export type KeyboardSafeViewProps = {
  children?: React.ReactNode;
  style?: any;
  /** Matches the legacy keyboardVerticalOffset sites (default 0). */
  offset?: number;
  enabled?: boolean;
};

export function KeyboardSafeView({ children, style, offset = 0, enabled = true }: KeyboardSafeViewProps) {
  return (
    <KeyboardAvoidingView
      enabled={enabled}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={offset}
      style={[{ flex: 1 } as ViewStyle, style]}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

/** Scroll the focused input above the keyboard — iOS safety net (Android relies on adjustPan + the KAV). */
function useFocusedInputScroll(run: boolean) {
  const boxRef = useRef<KeyboardBox>({ top: 0, height: 0 });
  const scrollRef = useRef<ScrollView | null>(null);
  const offsetRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!run || Platform.OS !== "ios") return;
    const attempt = () => {
      const scroll = scrollRef.current;
      const box = boxRef.current;
      if (!scroll || !box.height) return;
      const State: any = (TextInput as any).State;
      const input: any = State?.currentlyFocusedInput?.() ?? null;
      if (!input || typeof input.measureInWindow !== "function") return;
      input.measureInWindow((ix: number, iy: number, iw: number, ih: number) => {
        if (!scroll || typeof (scroll as any).measureInWindow !== "function") return;
        (scroll as any).measureInWindow((_sx: number, sy: number, _sw: number, sh: number) => {
          const visibleBottom = Math.min(sy + sh, box.top) - 16;
          const inputBottom = iy + ih;
          if (inputBottom <= visibleBottom) return; // already clear of the keyboard
          const next = Math.max(0, offsetRef.current + (inputBottom - visibleBottom));
          if (Math.abs(next - offsetRef.current) < 2) return;
          scroll.scrollTo({ y: next, animated: true });
          offsetRef.current = next;
        });
      });
    };
    const schedule = () => {
      timersRef.current.forEach(clearTimeout);
      // Measure after the keyboard/KAV animation has settled (twice — focus
      // can move to a later field while the keyboard is still animating).
      timersRef.current = [setTimeout(attempt, 260), setTimeout(attempt, 560)];
    };
    const show = Keyboard.addListener(SHOW_EVENT, (e: any) => {
      boxRef.current = keyboardBoxFrom(e);
      schedule();
    });
    const hide = Keyboard.addListener(HIDE_EVENT, () => {
      boxRef.current = { top: 0, height: 0 };
      timersRef.current.forEach(clearTimeout);
    });
    return () => {
      show.remove();
      hide.remove();
      timersRef.current.forEach(clearTimeout);
    };
  }, [run]);

  return {
    scrollRef,
    onScroll: (e: any) => {
      offsetRef.current = e?.nativeEvent?.contentOffset?.y ?? offsetRef.current;
    },
  };
}

export type KeyboardSafeScrollViewProps = ScrollViewProps & {
  /** Default true — taps on buttons work while the keyboard is open. */
  persistTaps?: boolean;
};

export const KeyboardSafeScrollView = forwardRef<ScrollView, KeyboardSafeScrollViewProps>(function KeyboardSafeScrollView(
  { children, persistTaps = true, onScroll, ...rest },
  ref,
) {
  const innerRef = useRef<ScrollView | null>(null);
  const { scrollRef, onScroll: track } = useFocusedInputScroll(true);
  useImperativeHandle(ref, () => innerRef.current as ScrollView);
  useImperativeHandle(scrollRef, () => innerRef.current as ScrollView, []);

  return (
    <ScrollView
      ref={innerRef}
      keyboardShouldPersistTaps={persistTaps ? "handled" : rest.keyboardShouldPersistTaps ?? "handled"}
      keyboardDismissMode={rest.keyboardDismissMode ?? "interactive"}
      onScroll={(e) => {
        track(e);
        onScroll?.(e);
      }}
      scrollEventThrottle={rest.scrollEventThrottle ?? 16}
      {...rest}
    >
      {children}
    </ScrollView>
  );
});

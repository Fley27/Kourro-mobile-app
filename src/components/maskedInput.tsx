// maskedInput — TextInputs that format AS you type and keep the caret where
// the user is working.
//
// The parent owns the RAW value (digits for phones, digits + one decimal for
// money). The input renders `format(raw)` and, on every keystroke, figures out
// where the edit happened by diffing the previous display against the new
// text, counting only "logical" characters (digits — plus the decimal
// separator for money). Formatter-inserted separators therefore never move
// the caret: you get the display format of format.ts while typing, and the
// raw value still parses with Number()/parseFloat().
import React, { useEffect, useRef } from "react";
import { TextInput, type TextInputProps } from "react-native";

// Pure helpers live in ../textFormat (no RN import → unit-testable); re-exported
// here so existing imports keep working.
export {
  GROUP_SEP,
  normalizeMoneyInput,
  formatMoneyInput,
  countMoneySig,
  indexAfterMoneySig,
  countDigits,
  indexAfterDigits,
} from "../textFormat";
import {
  normalizeMoneyInput,
  formatMoneyInput,
  countMoneySig,
  indexAfterMoneySig,
  caretSigAfterEdit,
} from "../textFormat";

// ── The input ──

export type MaskedTextInputProps = Omit<TextInputProps, "value" | "onChangeText"> & {
  /** Raw value (what the parent stores). */
  value: string;
  /** Called with the normalized raw value on every keystroke. */
  onChangeText: (raw: string) => void;
  /** typed text → raw (strip grouping, fix decimal). */
  normalize: (text: string) => string;
  /** raw → display text. */
  format: (raw: string) => string;
  /** how many logical chars a string holds (for caret math). */
  countSig: (s: string) => number;
  /** index in `s` right after its nth logical char. */
  indexAfterSig: (s: string, count: number) => number;
};

export function MaskedTextInput(props: MaskedTextInputProps) {
  const { value, onChangeText, normalize, format, countSig, indexAfterSig, ...rest } = props;
  const ref = useRef<TextInput>(null);
  const display = format(value);
  const prevRef = useRef(display);
  const pendingSig = useRef<number | null>(null);

  useEffect(() => {
    const target = pendingSig.current;
    pendingSig.current = null;
    prevRef.current = display;
    if (target == null) return;
    const idx = indexAfterSig(display, target);
    // setNativeProps after commit: cheaper and safer than a state round-trip.
    requestAnimationFrame(() => {
      try { ref.current?.setNativeProps({ selection: { start: idx, end: idx } }); } catch {}
    });
  }, [display, indexAfterSig]);

  function handleChange(next: string) {
    // Where did the edit land? Diff prev vs next display (textFormat).
    const sig = caretSigAfterEdit(prevRef.current, next, countSig);
    const raw = normalize(next);
    if (raw === value) {
      // Nothing the parent stores changed (e.g. a letter was typed): snap the
      // native text straight back so a stray char never lingers on screen.
      pendingSig.current = null;
      requestAnimationFrame(() => {
        try { ref.current?.setNativeProps({ text: display, selection: { start: indexAfterSig(display, sig), end: indexAfterSig(display, sig) } }); } catch {}
      });
      return;
    }
    pendingSig.current = sig;
    onChangeText(raw);
  }

  return <TextInput ref={ref} value={display} onChangeText={handleChange} {...rest} />;
}

/** TextInput lookalike that formats money live (raw in, "1 234,50" on screen). */
export function MoneyInput({ value, onChangeText, ...rest }: Omit<TextInputProps, "value" | "onChangeText"> & {
  value: string;
  onChangeText: (raw: string) => void;
}) {
  return (
    <MaskedTextInput
      value={value}
      onChangeText={onChangeText}
      normalize={normalizeMoneyInput}
      format={formatMoneyInput}
      countSig={countMoneySig}
      indexAfterSig={indexAfterMoneySig}
      {...rest}
    />
  );
}

// textFormat — pure live-formatting helpers shared by maskedInput (money) and
// PhoneField (phone). No react-native import: unit-testable as-is.

/** Narrow no-break space — the grouping char format.ts renders with. */
export const GROUP_SEP = "\u202f";

// ── Money (French/Haitian style: "1 234 567,50") ──

/** Accepts "," or "." as decimal; strips everything else (incl. grouping). */
export function normalizeMoneyInput(text: string): string {
  let out = "";
  let seenDot = false;
  for (const ch of String(text ?? "")) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if ((ch === "." || ch === ",") && !seenDot) { out += "."; seenDot = true; }
  }
  return out;
}

/** Same grouping/decimal style as fmt() — but on the raw string, so "12." stays "12,". */
export function formatMoneyInput(raw: string): string {
  if (!raw) return "";
  const dot = raw.indexOf(".");
  const int = dot >= 0 ? raw.slice(0, dot) : raw;
  const dec = dot >= 0 ? raw.slice(dot + 1) : "";
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEP);
  return dot >= 0 ? `${grouped},${dec}` : grouped;
}

/** Logical characters for money: every digit + the first decimal separator. */
export function countMoneySig(s: string): number {
  let n = 0;
  let seenDot = false;
  for (const ch of String(s ?? "")) {
    if (ch >= "0" && ch <= "9") n++;
    else if ((ch === "," || ch === ".") && !seenDot) { n++; seenDot = true; }
  }
  return n;
}

/** Index right after the `count`-th logical character (end when exhausted). */
export function indexAfterMoneySig(s: string, count: number): number {
  let n = 0;
  let seenDot = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch >= "0" && ch <= "9") n++;
    else if ((ch === "," || ch === ".") && !seenDot) { n++; seenDot = true; }
    if (n >= count) return i + 1;
  }
  return s.length;
}

// ── Digits (phone masks) ──

export function countDigits(s: string): number {
  let n = 0;
  for (const ch of String(s ?? "")) if (ch >= "0" && ch <= "9") n++;
  return n;
}

export function indexAfterDigits(s: string, count: number): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] >= "0" && s[i] <= "9") n++;
    if (n >= count) return i + 1;
  }
  return s.length;
}

/**
 * Where the caret lands after an edit, computed by diffing the previous
 * display against the new text (no reliance on platform selection events).
 * Returns the number of logical chars that should sit before the caret.
 */
export function caretSigAfterEdit(prev: string, next: string, countSig: (s: string) => number): number {
  let p = 0;
  while (p < prev.length && p < next.length && prev[p] === next[p]) p++;
  let suf = 0;
  while (suf < prev.length - p && suf < next.length - p && prev[prev.length - 1 - suf] === next[next.length - 1 - suf]) suf++;
  if (next.length >= prev.length) {
    // Insertion (typing, paste): prefix + whatever landed.
    return countSig(prev.slice(0, p)) + countSig(next.slice(p, next.length - suf));
  }
  // Deletion: caret sits where the gap now is.
  return countSig(next.slice(0, p));
}

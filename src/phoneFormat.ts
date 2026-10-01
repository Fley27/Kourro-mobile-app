// Country phone masks — the input formats as you type, per the numbering plan
// of the country picked on the flag. Curated set only (Haiti + the countries
// people actually call); everything else keeps the raw digits.
//
// Storage stays digits-only: formatting is presentation, so a number saved by
// an older build ("+509 3712 3456") renders through the same mask when edited.
type Pattern = { iso: string; dial: string; len: number; mask: string };

const P = (iso: string, dial: string, len: number, mask: string): Pattern => ({ iso, dial, len, mask });

const PATTERNS: Pattern[] = [
  P("HT", "509", 8, "####-####"),
  // NANP — same shape everywhere (+1, 10 national digits).
  P("US", "1", 10, "(###) ###-####"),
  P("CA", "1", 10, "(###) ###-####"),
  P("DO", "1", 10, "(###) ###-####"),
  P("BS", "1", 10, "(###) ###-####"),
  P("JM", "1", 10, "(###) ###-####"),
  P("CU", "1", 10, "(###) ###-####"),
  P("FR", "33", 10, "## ## ## ## ##"),
  P("MX", "52", 10, "## #### ####"),
  P("CL", "56", 9, "# #### ####"),
];

export function phonePatternFor(iso: string): Pattern | undefined {
  const code = String(iso ?? "").toUpperCase();
  return PATTERNS.find(p => p.iso === code);
}

/** Digits only — what the input keeps in state. */
export function normalizePhoneInput(text: string): string {
  return String(text ?? "").replace(/\D/g, "");
}

function applyMask(digits: string, mask: string): string {
  let out = "";
  let di = 0;
  for (const m of mask) {
    if (di >= digits.length) break;
    out += m === "#" ? digits[di++] : m;
  }
  // Longer than the plan (mistyped / international prefix kept): keep the rest.
  return out + digits.slice(di);
}

/**
 * Format a phone value against `iso`: strips non-digits, drops a stored
 * international prefix when the digits name a country we know ("509…" while
 * the flag says HT), then masks the national part progressively while typing.
 */
export function formatPhoneDigits(value: string, iso: string): string {
  const digits = normalizePhoneInput(value);
  if (!digits) return "";
  let p = phonePatternFor(iso);
  if (!p) return digits;
  // Digits that carry another country's code (longer than this country's plan)
  // → mask as that country instead of chopping at the wrong boundaries.
  const byDial = PATTERNS
    .filter(x => digits.startsWith(x.dial) && digits.length > x.len)
    .sort((a, b) => b.dial.length - a.dial.length)[0];
  if (byDial) p = byDial;
  // Stored with an international prefix (legacy "+509 …") or a cross-country
  // dial code: the leading dial code can't be national digits for the plan we
  // settled on, so drop it. Short dials ("1", "33") only strip on a full-length
  // remainder; longer dials ("509") also strip partial legacy values.
  let national = digits;
  const rest = digits.length - p.dial.length;
  if (digits.startsWith(p.dial) && rest > 0 && (rest >= p.len || (p.dial.length >= 2 && rest >= 4))) {
    national = digits.slice(p.dial.length);
  }
  return applyMask(national, p.mask);
}

/** Country a full international number points at — or "" when it doesn't. */
export function inferPhoneIso(value: string): string {
  const digits = normalizePhoneInput(value);
  const hit = PATTERNS
    .filter(x => digits.startsWith(x.dial) && digits.length >= x.dial.length + x.len)
    .sort((a, b) => b.dial.length - a.dial.length)[0];
  return hit ? hit.iso : "";
}

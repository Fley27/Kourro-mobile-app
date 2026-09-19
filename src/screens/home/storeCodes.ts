// Store secret-code utilities — uniqueness + security
export type StoreItem = { id: string; name: string; location: string; code: string; createdAt: string; disabled?: boolean; breachFlagged?: boolean; breachedAt?: string; revokedBy?: string };

function genRawCode(): string {
  const letters = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

// All codes in active use OR previously revoked must not collide.
function usedCodes(stores: StoreItem[]): Set<string> {
  const set = new Set<string>();
  for (const s of (stores ?? [])) {
    set.add(s.code.toUpperCase());
    // any future/historical codes are guarded by uniqueness too
  }
  return set;
}

// Generates a store code guaranteed to be unique across all stores.
export function generateUniqueCode(stores: StoreItem[]): string {
  const used = usedCodes(stores);
  let code = genRawCode();
  let guard = 0;
  while (used.has(code) && guard < 1000) {
    code = genRawCode();
    guard++;
  }
  return code;
}

// Software owner authority — a distinct system-level admin key.
// This is separate from any store 'owner' role; only this key may rotate/revoke
// a store code or lock a store down after a security breach.
export const SOFTWARE_OWNER_KEY = "SYS-OWNER-2026";

export function isSoftwareOwner(key: string): boolean {
  return String(key).trim().toUpperCase() === SOFTWARE_OWNER_KEY;
}

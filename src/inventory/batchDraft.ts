/**
 * Batch-creation drafts — device-local only.
 *
 * Unfinished wizard runs (including any batch with an unresolved Split/Keep
 * recommendation) are parked here so they can be resumed. They live in the
 * `_meta` key-value table, which is deliberately NOT part of the sync set:
 * a draft never reaches the shared database, so a half-built delivery can
 * never be mistaken for a real one on another device.
 *
 * Storage pattern mirrors sales/cartDraft.ts (works on SQLite and the
 * in-memory fallback, no schema migration needed).
 *
 * Expired after DRAFT_TTL_DAYS, purged on app open / Inventory mount.
 */
import { notifyDraftReminder } from "../notifications";

export const DRAFT_TTL_DAYS = 14;

const KEY_PREFIX = "batch_draft:";
const SESSION_KEY = "batch_session";

export type BatchDraftStep = 1 | 2 | 3 | 4;

/** One item staged in the wizard: what to buy, at what cost. */
export type DraftBubble = {
  unitId: string;      // item id (post-v2: bubbles are keyed by item)
  productId: string;
  name: string;
  qty: number;
  costPrice: number;
};

/** Per-line resolution of a Split/Keep recommendation. */
export type DraftDecision = "split" | "keep";

export type BatchDraft = {
  id: string;
  step: BatchDraftStep;
  supplierId: string;
  bubbles: DraftBubble[];
  /** variantId → entered price (empty string = untouched/blank). */
  prices: Record<string, string>;
  /** Step-4 bundle selections. */
  bundles: { variantId: string; minQuantity: string; price: string; active: boolean }[];
  /** itemId → decision for the current comparison pass. */
  decisions: Record<string, DraftDecision>;
  sessionRef: string | null;
  /** Batches already written while resolving Split in this run. */
  finalizedBatchIds: string[];
  /** Item held back by Split, waiting for Add Another with the cheaper supplier. */
  splitTarget: { itemId: string; productId: string; supplierId: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type BatchDraftSummary = {
  id: string;
  step: BatchDraftStep;
  supplierId: string;
  updatedAt: string;
  itemCount: number;
};

/** One wizard run across several batches — used to patch transport at the end. */
export type ActiveSession = {
  ref: string;
  batchIds: string[];
  createdAt: string;
};

function isExpired(updatedAt: string, nowMs: number): boolean {
  const t = Date.parse(updatedAt);
  if (!isFinite(t)) return true;
  return nowMs - t > DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000;
}

async function readMeta(db: any, key: string): Promise<any | null> {
  try {
    const rows = (await db.getAllAsync("SELECT * FROM _meta WHERE key = ?", [key])) as any[];
    if (!rows?.length) return null;
    return JSON.parse(rows[0].value ?? "null");
  } catch {
    return null;
  }
}

async function writeMeta(db: any, key: string, value: any): Promise<void> {
  try {
    await db.runAsync("INSERT OR REPLACE INTO _meta (key, value) VALUES (?,?)", [
      key,
      JSON.stringify(value),
    ]);
  } catch {}
}

/**
 * Drop drafts nobody has touched in DRAFT_TTL_DAYS. Returns how many are
 * left, so callers can drive the reminder notification off the real count.
 */
export async function purgeExpiredBatchDrafts(db: any): Promise<number> {
  let rows: any[] = [];
  try { rows = (await db.getAllAsync("SELECT * FROM _meta")) as any[]; } catch { rows = []; }
  const now = Date.now();
  let kept = 0;
  for (const row of rows ?? []) {
    const key = String(row?.key ?? "");
    if (!key.startsWith(KEY_PREFIX)) continue;
    let parsed: any = null;
    try { parsed = JSON.parse(row.value ?? "null"); } catch { parsed = null; }
    if (!parsed || isExpired(parsed.updatedAt ?? parsed.createdAt ?? "", now)) {
      try { await db.runAsync("DELETE FROM _meta WHERE key = ?", [key]); } catch {}
      continue;
    }
    kept++;
  }
  return kept;
}

export async function listBatchDrafts(db: any): Promise<BatchDraftSummary[]> {
  let rows: any[] = [];
  try { rows = (await db.getAllAsync("SELECT * FROM _meta")) as any[]; } catch { rows = []; }
  const now = Date.now();
  const out: BatchDraftSummary[] = [];
  for (const row of rows ?? []) {
    const key = String(row?.key ?? "");
    if (!key.startsWith(KEY_PREFIX)) continue;
    let d: any = null;
    try { d = JSON.parse(row.value ?? "null"); } catch { d = null; }
    if (!d?.id || isExpired(d.updatedAt ?? d.createdAt ?? "", now)) continue;
    out.push({
      id: String(d.id),
      step: (Number(d.step) || 1) as BatchDraftStep,
      supplierId: String(d.supplierId ?? ""),
      updatedAt: String(d.updatedAt ?? ""),
      itemCount: Array.isArray(d.bubbles) ? d.bubbles.length : 0,
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadBatchDraft(db: any, id: string): Promise<BatchDraft | null> {
  const d = await readMeta(db, `${KEY_PREFIX}${id}`);
  if (!d?.id || isExpired(d.updatedAt ?? d.createdAt ?? "", Date.now())) return null;
  return {
    ...d,
    bubbles: Array.isArray(d.bubbles) ? d.bubbles : [],
    prices: d.prices && typeof d.prices === "object" ? d.prices : {},
    bundles: Array.isArray(d.bundles) ? d.bundles : [],
    decisions: d.decisions && typeof d.decisions === "object" ? d.decisions : {},
    finalizedBatchIds: Array.isArray(d.finalizedBatchIds) ? d.finalizedBatchIds : [],
  };
}

export async function saveBatchDraft(db: any, draft: BatchDraft): Promise<void> {
  await writeMeta(db, `${KEY_PREFIX}${draft.id}`, {
    ...draft,
    updatedAt: new Date().toISOString(),
    // Created-once so a resumed draft keeps its original age.
    createdAt: draft.createdAt || new Date().toISOString(),
  });
  // Any live draft means the reminder should keep firing.
  try { await notifyDraftReminder(true); } catch {}
}

export async function deleteBatchDraft(db: any, id: string): Promise<void> {
  try { await db.runAsync("DELETE FROM _meta WHERE key = ?", [`${KEY_PREFIX}${id}`]); } catch {}
  const left = await listBatchDrafts(db);
  if (!left.length) {
    try { await notifyDraftReminder(false); } catch {}
  }
}

export async function countBatchDrafts(db: any): Promise<number> {
  return (await listBatchDrafts(db)).length;
}

// --- active session (finalized batches of one wizard run) ----------------

export async function loadActiveSession(db: any): Promise<ActiveSession | null> {
  const s = await readMeta(db, SESSION_KEY);
  if (!s?.ref) return null;
  if (isExpired(s.createdAt ?? "", Date.now())) return null;
  return {
    ref: String(s.ref),
    batchIds: Array.isArray(s.batchIds) ? s.batchIds.map(String) : [],
    createdAt: String(s.createdAt ?? ""),
  };
}

export async function saveActiveSession(db: any, session: ActiveSession): Promise<void> {
  await writeMeta(db, SESSION_KEY, session);
}

export async function clearActiveSession(db: any): Promise<void> {
  try { await db.runAsync("DELETE FROM _meta WHERE key = ?", [SESSION_KEY]); } catch {}
}

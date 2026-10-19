// Human-language sync issue text (Kreyòl-first).
//
// The middleware reports push rejections as raw Postgres/auth codes
// ("store_members: error:forbidden_roster",
// "insert or update on table ... violates foreign key constraint ...").
// Those must never reach the screen verbatim — this module maps every known
// (table, status) pair to a short human sentence. Unknown reasons fall back
// to a generic line, never raw SQL. Pure: no imports, no side effects.
import { ht } from "../i18n";

export interface SyncAlert {
  title: string;
  lines: string[];
}

/** Friendly display name for tables users actually encounter. */
function tableName(table: string): string {
  switch (table) {
    case "store_members": return ht.tableTeam;
    case "profiles": return ht.tableProfile;
    case "employee_stores": return ht.tableTeam;
    case "sales": return ht.tableSale;
    case "customers": return ht.tableCustomer;
    case "products": return ht.tableProduct;
    case "credits": return ht.tableCredit;
    default: return table;
  }
}

/** One human line for a single rejected table. Never returns raw SQL. */
function describeReject(table: string, status: string): string {
  const name = tableName(table);
  const s = String(status ?? "");
  // The server's subscription write-gate (029). The row is NOT lost: it stays
  // in the outbox and rides the next push once the org renews.
  if (s.includes("subscription_expired")) return ht.issueSubscriptionExpired;
  if (s.includes("forbidden_roster")) return ht.issueForbiddenRoster;
  if (s.includes("not_self")) return ht.issueNotSelf;
  if (s.includes("no_organization")) return ht.issueNoOrganization;
  if (s.includes("unknown_table")) return ht.issueUnknownTable;
  if (/foreign key constraint/i.test(s) && table === "store_members") return ht.issueOrphanMember;
  if (/foreign key constraint/i.test(s)) return ht.issueBrokenReference.replace("{table}", name);
  if (/null value in column/i.test(s)) {
    const col = (s.match(/null value in column "([^"]+)"/i)?.[1] ?? "").trim();
    return col
      ? ht.issueMissingField.replace("{table}", name).replace("{field}", col)
      : ht.issueIncompleteRow.replace("{table}", name);
  }
  return ht.issueGeneric.replace("{table}", name);
}

/** Build the banner alert for a batch of push rejections (≤3 lines). */
export function describeRejects(rejected: { table: string; status: string }[]): SyncAlert | null {
  if (!rejected.length) return null;
  const seen = new Map<string, string>();
  for (const r of rejected) {
    const t = String(r?.table ?? "?");
    if (!seen.has(t)) seen.set(t, describeReject(t, String(r?.status ?? "")));
    if (seen.size >= 3) break;
  }
  return { title: ht.syncAlertTitle, lines: [...seen.values()] };
}

/** Build the banner alert for a failed pull (raw message stays in console). */
export function describePullError(): SyncAlert {
  return { title: ht.syncAlertPullTitle, lines: [ht.syncAlertPullBody] };
}

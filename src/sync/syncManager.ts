/**
 * SyncManager — handles 3 sync paths:
 * 1. Cloud sync via middleware (/api/sync/push & /pull)
 * 2. LAN P2P sync via WebSocket hub (same WiFi, no internet)
 * 3. Local SQLite as source of truth when offline
 */
import { getDb, getDirtyChanges } from "../db";

const MIDDLEWARE_URL = process.env.EXPO_PUBLIC_MIDDLEWARE_URL ?? "http://localhost:4000";

export class SyncManager {
  storeId: string;
  deviceId: string;
  lastSyncedAt: string | null = null;
  private accessToken: string | null = null;

  constructor(storeId: string, deviceId: string) {
    this.storeId = storeId;
    this.deviceId = deviceId;
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...(extra ?? {}) };
    if (this.accessToken) h["Authorization"] = `Bearer ${this.accessToken}`;
    return h;
  }

  async pushToCloud(): Promise<void> {
    const changesRaw = await getDirtyChanges();
    if (!changesRaw.length) return;
    const payload = {
      store_id: this.storeId,
      device_id: this.deviceId,
      changes: changesRaw.map(c => ({ table: c.table, operation: c.operation, record: c.payload })),
      last_synced_at: this.lastSyncedAt,
    };
    const res = await fetch(`${MIDDLEWARE_URL}/api/sync/push`, {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`push failed ${res.status}`);
    const data = await res.json();
    // clear outbox on success
    const db = await getDb();
    await db.runAsync("DELETE FROM outbox");
    this.lastSyncedAt = data.server_time;
    await db.runAsync("INSERT OR REPLACE INTO _meta (key,value) VALUES (?,?)", ["last_synced_at", this.lastSyncedAt!]);
  }

  async pullFromCloud(): Promise<void> {
    const since = this.lastSyncedAt ?? new Date(0).toISOString();
    const url = `${MIDDLEWARE_URL}/api/sync/pull?store_id=${this.storeId}&device_id=${this.deviceId}&since=${encodeURIComponent(since)}`;
    const res = await fetch(url, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`pull failed ${res.status}`);
    const { changes, server_time } = await res.json();
    await this.applyChanges(changes);
    this.lastSyncedAt = server_time;
  }

  async applyChanges(changes: any[]): Promise<void> {
    const db = await getDb();
    for (const ch of changes) {
      const r = ch.record;
      // Simple LWW: overwrite if remote lamport/newer
      // For brevity, upsert directly; resolveLWW from sync-engine can be used here
      try {
        if (ch.table === "products") {
          await db.runAsync(
            `INSERT OR REPLACE INTO products (id,store_id,name,stock_quantity,cost_price,lamport_clock,updated_at) VALUES (?,?,?,?,?,?,?)`,
            [r.id, r.store_id, r.name, r.stock_quantity, r.cost_price, r.lamport_clock, r.updated_at]
          );
        }
        // ... similar for other tables
      } catch (e) { console.warn("apply error", e); }
    }
  }

  // LAN P2P — connect to hub WebSocket (main register or middleware)
  connectLAN(hubUrl: string): WebSocket {
    const wsUrl = hubUrl.replace("http", "ws") + `/lan?store_id=${this.storeId}&device_id=${this.deviceId}`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.changes) await this.applyChanges(msg.changes);
      } catch {}
    };
    return ws;
  }

  async fullSync(): Promise<void> {
    try { await this.pushToCloud(); } catch (e) { console.warn("[sync] push failed offline?", e); }
    try { await this.pullFromCloud(); } catch (e) { console.warn("[sync] pull failed offline?", e); }
  }
}

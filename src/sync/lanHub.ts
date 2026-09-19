/**
 * lanHub.ts — Local hub for offline multi-cashier sync
 * When internet is down, one device acts as hub (WebSocket server).
 * Other registers connect via LAN (same router, no internet needed).
 * Uses mDNS discovery (expo) or manual IP entry fallback.
 *
 * Minimal implementation: WebSocket relay. Devices push changes to hub,
 * hub broadcasts to peers and keeps merged batch to flush to cloud later.
 */

export interface LanPeer {
  deviceId: string;
  deviceName: string;
  ip: string;
  port: number;
}

// Hub state (in-memory)
const peers = new Map<string, WebSocket>();
const pendingBatches: any[] = [];

export function hubOnConnect(deviceId: string, ws: WebSocket) {
  peers.set(deviceId, ws);
  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse((ev as any).data);
      // relay to all other peers
      for (const [id, peerWs] of peers) {
        if (id !== deviceId) peerWs.send(JSON.stringify(msg));
      }
      pendingBatches.push(msg);
    } catch {}
  });
  ws.addEventListener("close", () => peers.delete(deviceId));
}

export function getPendingBatches() { return [...pendingBatches]; }
export function clearPendingBatches() { pendingBatches.length = 0; }

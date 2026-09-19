/**
 * Bridge between the root-level TabsFab / App and POSScreen's tabs sheet.
 * Count ownership now lives at the app root so the FAB reflects open
 * suspended sales no matter which tab is on screen.
 *
 * Flow:
 *  - Root loads the open-tab count from the DB and publishes it here.
 *  - When a tab is created / updated / completed / voided, POSScreen bumps the
 *    root's refresh so the count stays accurate everywhere.
 *  - FAB tap calls requestOpen: root switches to the POS tab, then routes to
 *    POSScreen's tabs sheet (directly if mounted, or as a parked request that
 *    POSScreen drains as soon as it mounts).
 */
type CountListener = (n: number) => void;
type OpenListener = () => void;

let count = 0;
let pendingOpen = false;
const countLs = new Set<CountListener>();
const openLs = new Set<OpenListener>();

function notifyAll(ls: Set<OpenListener>) {
  ls.forEach(fn => {
    try { fn(); } catch {}
  });
}

export const tabsUI = {
  setCount(n: number) {
    const v = Math.max(0, n | 0);
    if (v === count) return;
    count = v;
    countLs.forEach(l => {
      try { l(v); } catch {}
    });
  },
  subscribeCount(l: CountListener) {
    countLs.add(l);
    try { l(count); } catch {}
    return () => { countLs.delete(l); };
  },
  // Called by the TabsFab tap. Root switches to POS and routes to the sheet.
  requestOpen(openSheet: () => void) {
    if (openLs.size) {
      notifyAll(openLs);
      return;
    }
    // No POS mounted yet (user on another tab): park the request so POSScreen
    // opens its sheet right after it mounts.
    pendingOpen = true;
  },
  // POSScreen registers the real sheet-opener. Drains a pending request.
  registerOpener(fn: OpenListener) {
    openLs.add(fn);
    if (pendingOpen) {
      pendingOpen = false;
      try { fn(); } catch {}
    }
    return () => { openLs.delete(fn); };
  },
};

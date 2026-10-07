// Home — a pure role router. The segment strip and the old analytics tab are
// gone; what lives here is decided by role:
//   owner/admin → AnalyticsScreen (General Analytics, aggregates only)
//   manager     → SalesReportScreen (aggregate numbers dashboard)
//   cashier/associate/cook → PickupsScreen (goods owed; no back — this IS home)
// TODO(spec): associate/cook likely want a different home than cashier.
import React from "react";
import AnalyticsScreen from "./AnalyticsScreen";
import SalesReportScreen from "./SalesReportScreen";
import PickupsScreen from "./PickupsScreen";
import { FALLBACK_STORE_ID } from "../db/ids";

type StoreItem = { id: string; name: string; location: string; code: string; createdAt: string };

type Props = {
  role?: string;
  currentUser?: any;
  storeId?: string;
  storeName?: string;
  userStoreIds?: string[];
  deviceId?: string;
  employees?: any[];
  stores?: StoreItem[];
  setStores?: (v: StoreItem[] | ((prev: StoreItem[]) => StoreItem[])) => void;
  activeStoreId?: string;
  setActiveStoreId?: (id: string) => void;
  appDisabled?: boolean;
  setAppDisabled?: (v: boolean | ((prev: boolean) => boolean)) => void;
  onGoPos?: () => void;
  onGoShift?: () => void;
  onOpenStore?: () => void;
  onOpenTeam?: () => void;
  onOpenAccountCenter?: () => void;
  onShiftResolved?: () => void;
};

export { type RangeKey } from "./home/types";

export default function HomeScreen({
  role = "cashier",
  currentUser,
  storeId = FALLBACK_STORE_ID,
  storeName,
  userStoreIds = [],
  deviceId = "device-unknown",
  stores,
  activeStoreId,
}: Props) {
  // Fallback name resolution when App doesn't pass storeName directly.
  const name = storeName ?? (stores ?? []).find(s => s.id === activeStoreId)?.name;

  if (role === "owner" || role === "admin") {
    return (
      <AnalyticsScreen
        role={role}
        storeId={storeId}
        storeName={name}
        currentUser={currentUser}
        userStoreIds={userStoreIds}
        deviceId={deviceId}
      />
    );
  }

  if (role === "manager") {
    return (
      <SalesReportScreen
        role={role}
        storeId={storeId}
        storeName={name}
        currentUser={currentUser}
        userStoreIds={userStoreIds}
        deviceId={deviceId}
      />
    );
  }

  // cashier / associate / cook — goods owed is the home. showBack=false: this
  // is a tab root, the bottom nav handles leaving it.
  return (
    <PickupsScreen
      role={role}
      currentUser={currentUser}
      storeId={storeId}
      showBack={false}
    />
  );
}

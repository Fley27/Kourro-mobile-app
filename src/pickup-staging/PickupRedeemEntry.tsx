// Redemption entry: visible when pickup is enabled, for every seller role.
import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { palette } from "../theme";
import { usePickupEnabled } from "./flag";
import RedeemPickup from "./RedeemPickup";

export default function PickupRedeemEntry({ storeId, cashierId, storeName, cashierName }: {
  storeId: string;
  cashierId?: string | null;
  storeName?: string | null;
  cashierName?: string | null;
}) {
  const enabled = usePickupEnabled(storeId);
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  return (
    <View style={{ backgroundColor: palette.successBg, borderWidth: 1, borderColor: palette.successBd, borderRadius: 14, padding: 12, marginTop: 12 }}>
      <Text style={{ fontWeight: "800", fontSize: 13, color: palette.success }}>Rekipere machandiz</Text>
      <Pressable onPress={() => setOpen(true)} style={{ marginTop: 10, backgroundColor: palette.success, borderRadius: 10, paddingVertical: 11, alignItems: "center" }}>
        <Text style={{ color: "white", fontWeight: "800", fontSize: 13 }}>Ouvri rekipere</Text>
      </Pressable>
      <RedeemPickup visible={open} storeId={storeId} cashierId={cashierId ?? null} storeName={storeName ?? null} cashierName={cashierName ?? null} onClose={() => setOpen(false)} />
    </View>
  );
}

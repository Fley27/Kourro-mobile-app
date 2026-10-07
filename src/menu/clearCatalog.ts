// Owner-only "Efase done katalòg" — two-step confirm then wipe. Shared by
// the phone Plis list (MoreScreen) and the tablet sidebar footer so the copy
// and the safety rails can't drift between navs.
import { Alert } from "react-native";
import { getDb } from "../db";
import { uploadSuccess, uploadError } from "../components/UploadTransition";

export function confirmClearCatalog() {
  Alert.alert(
    "Efase done katalòg?",
    "Ap efase TOUT pwodwi, inite, variant, batch, pri ak founisè (kategori yo rete). Aksyon sa a pa ka defèt.",
    [
      { text: "Anile", style: "cancel" },
      {
        text: "Efase tout", style: "destructive",
        onPress: () => {
          Alert.alert(
            "Konfime yon dènye fwa",
            "Vre efase? Fèmen app la epi relouvri apre.",
            [
              { text: "Retounen", style: "cancel" },
              {
                text: "Wi, efase", style: "destructive",
                onPress: async () => {
                  try {
                    const db = await getDb();
                    const { wipeCatalogData } = await import("../db/cutoverCatalog");
                    await wipeCatalogData(db);
                    uploadSuccess("Efase ✓", "Katalòg vid. Fèmen app la epi relouvri pou rekòmanse pwòp.");
                  } catch (e: any) {
                    uploadError("Erè", e?.message ?? "Efase echwe");
                  }
                },
              },
            ]
          );
        },
      },
    ]
  );
}

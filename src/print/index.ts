import * as Print from "expo-print";

// Generic printer facade — brand-agnostic on purpose (multi-tenant stores
// own their own hardware).
//
// Default backend = the platform print sheet via expo-print (AirPrint on
// iOS, the OS dialog / PDF elsewhere). It runs everywhere, including Expo
// Go. A native thermal backend (ESC-POS over Bluetooth Classic / BLE / USB
// / WiFi — e.g. react-native-thermal-pos-printer) plugs in behind
// setThermalBackend() once the app ships in a custom dev client:
//   npx expo prebuild   (Expo Go has no BT Classic SPP)
//   then register the backend at startup, e.g. in App.tsx:
//     import { setThermalBackend } from "./src/print";
//     import { yourThermalBackend } from "./src/print/backends/thermal";
//     setThermalBackend(yourThermalBackend);

export type ThermalBackend = {
  /** Pairing/discovery state — false falls through to the platform sheet. */
  isAvailable(): Promise<boolean>;
  printHtml(html: string): Promise<void>;
};

let thermal: ThermalBackend | null = null;

export function setThermalBackend(backend: ThermalBackend | null) {
  thermal = backend;
}

export function hasThermalBackend(): boolean {
  return thermal !== null;
}

/**
 * Print an HTML receipt: thermal printer first when a backend is registered
 * and reachable, otherwise the platform print sheet.
 * Returns which backend actually printed.
 */
export async function printHtml(html: string): Promise<"thermal" | "system"> {
  if (thermal) {
    try {
      if (await thermal.isAvailable()) {
        await thermal.printHtml(html);
        return "thermal";
      }
    } catch {
      // Backend failed mid-job — fall through to the platform sheet.
    }
  }
  await Print.printAsync({ html });
  return "system";
}

/** Render the HTML to a PDF file (share / email / archive flows). */
export async function printToPdf(html: string): Promise<{ uri: string; base64?: string }> {
  return Print.printToFileAsync({ html, base64: false });
}

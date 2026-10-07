/**
 * Hermes ships no WebCrypto, so `crypto.getRandomValues()` — which uuid v4
 * (`mintId()` in src/db/ids.ts) requires — is missing and every in-app id
 * mint throws "crypto.getRandomValues() not supported". index.js imports this
 * module FIRST (before ./App → db/ids → uuid), so uuid sees a working global
 * crypto the moment it loads. Entropy comes from expo-crypto's native RNG,
 * which is bundled in Expo Go.
 */
import { getRandomBytes } from "expo-crypto";

function getRandomValues<T extends ArrayBufferView>(array: T): T {
  if (array == null) throw new TypeError("getRandomValues: DataView/TypedArray required");
  const bytes = getRandomBytes(array.byteLength);
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(bytes);
  return array;
}

const g = globalThis as any;
if (typeof g.crypto?.getRandomValues !== "function") {
  g.crypto = { ...g.crypto, getRandomValues };
  console.log("[Jesyon] crypto.getRandomValues polyfilled via expo-crypto");
}

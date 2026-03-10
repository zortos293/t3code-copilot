import type { NativeApi } from "@t3tools/contracts";

import { createHybridNativeApi } from "./localWebGpuOrchestration";
import { createWsNativeApi } from "./wsNativeApi";

let cachedApi: NativeApi | undefined;

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedApi) return cachedApi;

  cachedApi = createHybridNativeApi(window.nativeApi ?? createWsNativeApi());
  return cachedApi;
}

export function ensureNativeApi(): NativeApi {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API not found");
  }
  return api;
}

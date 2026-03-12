import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveBundledCopilotCliPathFrom } from "./copilotCliPath.ts";

const CURRENT_DIR = "/repo/apps/server/src/provider/Layers";
const SDK_ENTRYPOINT = "/repo/apps/server/node_modules/@github/copilot-sdk/dist/index.js";

describe("copilotCliPath", () => {
  it("prefers the SDK JavaScript entrypoint on Windows", () => {
    const jsEntrypoint = join("/repo/apps/server/node_modules", "@github", "copilot", "index.js");
    const binaryPath = join(
      "/repo/apps/server/node_modules",
      "@github",
      "copilot-win32-x64",
      "copilot.exe",
    );
    const existingPaths = new Set([jsEntrypoint, binaryPath]);

    expect(
      resolveBundledCopilotCliPathFrom({
        currentDir: CURRENT_DIR,
        sdkEntrypoint: SDK_ENTRYPOINT,
        platform: "win32",
        arch: "x64",
        exists: (candidate) => existingPaths.has(candidate),
      }),
    ).toBe(jsEntrypoint);
  });

  it("keeps the native binary preference on non-Windows platforms", () => {
    const jsEntrypoint = join("/repo/apps/server/node_modules", "@github", "copilot", "index.js");
    const binaryPath = join(
      "/repo/apps/server/node_modules",
      "@github",
      "copilot-linux-x64",
      "copilot",
    );
    const existingPaths = new Set([jsEntrypoint, binaryPath]);

    expect(
      resolveBundledCopilotCliPathFrom({
        currentDir: CURRENT_DIR,
        sdkEntrypoint: SDK_ENTRYPOINT,
        platform: "linux",
        arch: "x64",
        exists: (candidate) => existingPaths.has(candidate),
      }),
    ).toBe(binaryPath);
  });

  it("does not fall back to npm-loader.js for SDK launches", () => {
    const npmLoaderPath = join(
      "/repo/apps/server/node_modules",
      "@github",
      "copilot",
      "npm-loader.js",
    );
    const existingPaths = new Set([npmLoaderPath]);

    expect(
      resolveBundledCopilotCliPathFrom({
        currentDir: CURRENT_DIR,
        sdkEntrypoint: SDK_ENTRYPOINT,
        platform: "win32",
        arch: "x64",
        exists: (candidate) => existingPaths.has(candidate),
      }),
    ).toBeUndefined();
  });
});

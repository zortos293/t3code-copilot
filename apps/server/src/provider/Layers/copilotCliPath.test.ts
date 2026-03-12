import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveBundledCopilotCliPathFrom } from "./copilotCliPath.ts";

const CURRENT_DIR = "/repo/apps/server/src/provider/Layers";
const SDK_ENTRYPOINT = "/repo/apps/server/node_modules/@github/copilot-sdk/dist/index.js";

describe("copilotCliPath", () => {
  it("prefers the native binary on Windows", () => {
    const npmLoaderPath = join(
      "/repo/apps/server/node_modules",
      "@github",
      "copilot",
      "npm-loader.js",
    );
    const binaryPath = join(
      "/repo/apps/server/node_modules",
      "@github",
      "copilot-win32-x64",
      "copilot.exe",
    );
    const existingPaths = new Set([npmLoaderPath, binaryPath]);

    expect(
      resolveBundledCopilotCliPathFrom({
        currentDir: CURRENT_DIR,
        sdkEntrypoint: SDK_ENTRYPOINT,
        platform: "win32",
        arch: "x64",
        exists: (candidate) => existingPaths.has(candidate),
      }),
    ).toBe(binaryPath);
  });

  it("keeps the native binary preference on non-Windows platforms", () => {
    const npmLoaderPath = join(
      "/repo/apps/server/node_modules",
      "@github",
      "copilot",
      "npm-loader.js",
    );
    const binaryPath = join(
      "/repo/apps/server/node_modules",
      "@github",
      "copilot-linux-x64",
      "copilot",
    );
    const existingPaths = new Set([npmLoaderPath, binaryPath]);

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

  it("falls back to npm-loader.js when no native binary is present on Windows", () => {
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
    ).toBe(npmLoaderPath);
  });

  it("falls back to npm-loader.js when no native binary is present on non-Windows platforms", () => {
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
        platform: "darwin",
        arch: "arm64",
        exists: (candidate) => existingPaths.has(candidate),
      }),
    ).toBe(npmLoaderPath);
  });
});

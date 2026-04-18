import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ServerSettingsPatch } from "./settings.ts";

const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

describe("ServerSettingsPatch", () => {
  it("preserves Claude launchArgs in provider patches", () => {
    expect(
      decodeServerSettingsPatch({
        providers: {
          claudeAgent: {
            launchArgs: "--verbose --dangerously-skip-permissions",
          },
        },
      }),
    ).toEqual({
      providers: {
        claudeAgent: {
          launchArgs: "--verbose --dangerously-skip-permissions",
        },
      },
    });
  });

  it("does not expose unsupported Codex launchArgs in provider patches", () => {
    const parsed = decodeServerSettingsPatch({
      providers: {
        codex: {
          binaryPath: "/tmp/codex",
          launchArgs: "--dangerously-skip-permissions",
        },
      },
    });

    expect(parsed).toEqual({
      providers: {
        codex: {
          binaryPath: "/tmp/codex",
        },
      },
    });
    expect("launchArgs" in (parsed.providers?.codex ?? {})).toBe(false);
  });
});

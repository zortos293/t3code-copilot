import { describe, expect, it } from "vitest";

import {
  MINIMUM_CLAUDE_OPUS_4_7_VERSION,
  resolveClaudeModelForVersion,
  supportsClaudeOpus47,
} from "./ClaudeProvider.ts";

describe("ClaudeProvider", () => {
  describe("supportsClaudeOpus47", () => {
    it("requires a known version", () => {
      expect(supportsClaudeOpus47(null)).toBe(false);
      expect(supportsClaudeOpus47(undefined)).toBe(false);
      expect(supportsClaudeOpus47("")).toBe(false);
    });

    it("accepts stable and newer prerelease versions semver-correctly", () => {
      expect(supportsClaudeOpus47(MINIMUM_CLAUDE_OPUS_4_7_VERSION)).toBe(true);
      expect(supportsClaudeOpus47("2.1.112-beta.1")).toBe(true);
      expect(supportsClaudeOpus47("2.1.111-beta.1")).toBe(false);
    });
  });

  describe("resolveClaudeModelForVersion", () => {
    it("does not expose Claude Opus 4.7 when the version is unknown", () => {
      expect(resolveClaudeModelForVersion("claude-opus-4-7", null)).toBe("claude-opus-4-6");
      expect(resolveClaudeModelForVersion("opus", null)).toBe("claude-opus-4-6");
      expect(resolveClaudeModelForVersion("opus-4.7", undefined)).toBe("claude-opus-4-6");
    });

    it("keeps supported Claude Opus 4.7 aliases once the CLI version is known to support them", () => {
      expect(resolveClaudeModelForVersion("claude-opus-4-7", "2.1.111")).toBe("claude-opus-4-7");
      expect(resolveClaudeModelForVersion("opus", "2.1.112-beta.1")).toBe("claude-opus-4-7");
    });
  });
});

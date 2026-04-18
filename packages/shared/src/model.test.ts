import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_BY_PROVIDER, type ModelCapabilities } from "@t3tools/contracts";

import {
  applyClaudePromptEffortPrefix,
  getDefaultContextWindow,
  getDefaultEffort,
  hasContextWindowOption,
  hasEffortLevel,
  isClaudeUltrathinkPrompt,
  normalizeClaudeModelOptionsWithCapabilities,
  normalizeCodexModelOptionsWithCapabilities,
  normalizeCopilotModelOptionsWithCapabilities,
  normalizeModelSlug,
  resolveApiModelId,
  resolveContextWindow,
  resolveEffort,
  resolveModelSlug,
  resolveModelSlugForProvider,
  resolveSelectableModel,
  trimOrNull,
} from "./model.ts";

const codexCaps: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "xhigh", label: "Extra High" },
    { value: "high", label: "High", isDefault: true },
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const claudeCaps: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "medium", label: "Medium" },
    { value: "high", label: "High", isDefault: true },
    { value: "ultrathink", label: "Ultrathink" },
  ],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [
    { value: "200k", label: "200k" },
    { value: "1m", label: "1M", isDefault: true },
  ],
  promptInjectedEffortLevels: ["ultrathink"],
};

const noOptionsCaps: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

describe("normalizeModelSlug", () => {
  it("maps known aliases to canonical slugs", () => {
    expect(normalizeModelSlug("gpt-5-codex")).toBe("gpt-5.4");
    expect(normalizeModelSlug("5.3")).toBe("gpt-5.3-codex");
    expect(normalizeModelSlug("opus", "copilot")).toBe("claude-opus-4.7");
    expect(normalizeModelSlug("sonnet", "claudeAgent")).toBe("claude-sonnet-4-6");
  });

  it("returns null for empty or missing values", () => {
    expect(normalizeModelSlug("")).toBeNull();
    expect(normalizeModelSlug("   ")).toBeNull();
    expect(normalizeModelSlug(null)).toBeNull();
    expect(normalizeModelSlug(undefined)).toBeNull();
  });
});

describe("resolveModelSlug", () => {
  it("returns defaults when the model is missing", () => {
    expect(resolveModelSlug(undefined, "codex")).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
    expect(resolveModelSlugForProvider("claudeAgent", undefined)).toBe(
      DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
    );
  });
});

describe("resolveSelectableModel", () => {
  it("resolves exact slugs, labels, and aliases", () => {
    const options = [
      { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
      { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    ];
    expect(resolveSelectableModel("codex", "gpt-5.3-codex", options)).toBe("gpt-5.3-codex");
    expect(resolveSelectableModel("claudeAgent", "sonnet", options)).toBe("claude-sonnet-4-6");
  });
});

describe("capability helpers", () => {
  it("read defaults and support", () => {
    expect(getDefaultEffort(codexCaps)).toBe("high");
    expect(getDefaultEffort(claudeCaps)).toBe("high");
    expect(hasEffortLevel(codexCaps, "xhigh")).toBe(true);
    expect(hasContextWindowOption(claudeCaps, "1m")).toBe(true);
    expect(getDefaultContextWindow(claudeCaps)).toBe("1m");
  });
});

describe("resolveEffort", () => {
  it("resolves supported values and defaults", () => {
    expect(resolveEffort(codexCaps, "xhigh")).toBe("xhigh");
    expect(resolveEffort(codexCaps, "bogus")).toBe("high");
    expect(resolveEffort(claudeCaps, "ultrathink")).toBe("high");
  });
});

describe("resolveContextWindow", () => {
  it("resolves explicit and default values", () => {
    expect(resolveContextWindow(claudeCaps, "200k")).toBe("200k");
    expect(resolveContextWindow(claudeCaps, "bogus")).toBe("1m");
    expect(resolveContextWindow(codexCaps, undefined)).toBeUndefined();
  });
});

describe("misc helpers", () => {
  it("handles prompt effort and trim", () => {
    expect(isClaudeUltrathinkPrompt("Ultrathink:\nInvestigate")).toBe(true);
    expect(applyClaudePromptEffortPrefix("Investigate", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate",
    );
    expect(trimOrNull("  hi  ")).toBe("hi");
  });
});

describe("resolveApiModelId", () => {
  it("applies claude context window suffix", () => {
    expect(
      resolveApiModelId({
        provider: "claudeAgent",
        model: "claude-opus-4-6",
        options: { contextWindow: "1m" },
      }),
    ).toBe("claude-opus-4-6[1m]");
  });

  it("leaves codex untouched", () => {
    expect(resolveApiModelId({ provider: "codex", model: "gpt-5.4" })).toBe("gpt-5.4");
  });
});

describe("normalize model options", () => {
  it("preserves codex fast mode and claude context window", () => {
    expect(
      normalizeCodexModelOptionsWithCapabilities(codexCaps, {
        reasoningEffort: "high",
        fastMode: false,
      }),
    ).toEqual({ reasoningEffort: "high", fastMode: false });

    expect(
      normalizeClaudeModelOptionsWithCapabilities(claudeCaps, {
        effort: "high",
        contextWindow: "200k",
      }),
    ).toEqual({ effort: "high", contextWindow: "200k" });
  });

  it("returns undefined when normalization removes every option", () => {
    expect(
      normalizeCodexModelOptionsWithCapabilities(noOptionsCaps, {
        reasoningEffort: "high",
        fastMode: true,
      }),
    ).toBeUndefined();

    expect(
      normalizeCopilotModelOptionsWithCapabilities(noOptionsCaps, {
        reasoningEffort: "high",
      }),
    ).toBeUndefined();

    expect(
      normalizeClaudeModelOptionsWithCapabilities(noOptionsCaps, {
        effort: "high",
        thinking: false,
        fastMode: true,
        contextWindow: "1m",
      }),
    ).toBeUndefined();
  });
});

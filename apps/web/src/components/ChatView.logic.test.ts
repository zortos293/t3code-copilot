import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import {
  deriveVisibleThreadWorkLogEntries,
  orderCopilotBuiltInModelOptions,
  resolveProviderHealthBannerProvider,
} from "./ChatView.logic";

function makeActivity(overrides: {
  id?: string;
  createdAt?: string;
  kind?: string;
  summary?: string;
  tone?: OrchestrationThreadActivity["tone"];
  payload?: Record<string, unknown>;
  turnId?: string;
  sequence?: number;
}): OrchestrationThreadActivity {
  return {
    id: EventId.makeUnsafe(overrides.id ?? crypto.randomUUID()),
    createdAt: overrides.createdAt ?? "2026-02-23T00:00:00.000Z",
    kind: overrides.kind ?? "tool.started",
    summary: overrides.summary ?? "Tool call",
    tone: overrides.tone ?? "tool",
    payload: overrides.payload ?? {},
    turnId: overrides.turnId ? TurnId.makeUnsafe(overrides.turnId) : null,
    ...(overrides.sequence !== undefined ? { sequence: overrides.sequence } : {}),
  };
}

describe("resolveProviderHealthBannerProvider", () => {
  it("uses the active session provider when a session exists", () => {
    expect(
      resolveProviderHealthBannerProvider({
        sessionProvider: "codex",
        selectedProvider: "copilot",
      }),
    ).toBe("codex");
  });

  it("uses selected draft provider before session starts", () => {
    expect(
      resolveProviderHealthBannerProvider({
        sessionProvider: null,
        selectedProvider: "copilot",
      }),
    ).toBe("copilot");
  });
});

describe("orderCopilotBuiltInModelOptions", () => {
  it("reorders runtime copilot models to match the preferred built-in picker order", () => {
    expect(
      orderCopilotBuiltInModelOptions([
        { slug: "gpt-5.4", name: "GPT-5.4" },
        { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
        { slug: "gpt-5.4-mini", name: "GPT-5.4 mini" },
        { slug: "gpt-5.2", name: "GPT-5.2" },
      ]).map((option) => option.slug),
    ).toEqual(["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"]);
  });

  it("keeps unknown runtime-only models after the preferred built-in models", () => {
    expect(
      orderCopilotBuiltInModelOptions([
        { slug: "gpt-5.4", name: "GPT-5.4" },
        { slug: "future-runtime-model", name: "Future Runtime Model" },
        { slug: "gpt-5.4-mini", name: "GPT-5.4 mini" },
      ]).map((option) => option.slug),
    ).toEqual(["gpt-5.4", "gpt-5.4-mini", "future-runtime-model"]);
  });
});

describe("deriveVisibleThreadWorkLogEntries", () => {
  it("keeps completed tool calls from previous turns visible in the thread timeline", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        turnId: "turn-1",
        kind: "tool.completed",
        summary: "First tool call",
      }),
      makeActivity({
        id: "tool-2",
        createdAt: "2026-02-23T00:00:03.000Z",
        turnId: "turn-2",
        kind: "tool.completed",
        summary: "Second tool call",
      }),
    ];

    expect(deriveVisibleThreadWorkLogEntries(activities).map((entry) => entry.id)).toEqual([
      "tool-1",
      "tool-2",
    ]);
  });
});

import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import {
  deriveVisibleThreadWorkLogEntries,
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

  it("hides delegated subagent markers from the main thread work log", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-subagent",
        kind: "tool.completed",
        summary: "Delegated to reviewer",
        payload: {
          itemType: "collab_agent_tool_call",
          data: {
            subagent: {
              receiverThreadId: "provider-child-1",
            },
          },
        },
      }),
      makeActivity({
        id: "tool-command",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
        },
      }),
    ];

    expect(deriveVisibleThreadWorkLogEntries(activities).map((entry) => entry.id)).toEqual([
      "tool-command",
    ]);
  });

  it("can focus a delegated subagent activity without mixing the full work log", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-parent",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.completed",
        summary: "Parent tool call",
      }),
      makeActivity({
        id: "tool-subagent",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Subagent task",
      }),
    ];

    expect(
      deriveVisibleThreadWorkLogEntries(activities, "tool-subagent").map((entry) => entry.id),
    ).toEqual(["tool-subagent"]);
  });
});

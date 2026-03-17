import { describe, expect, it } from "vitest";

import {
  deriveSidebarThreadGroups,
  flattenSidebarThreadGroupIds,
  formatSidebarSubagentTitle,
  hasUnseenCompletion,
  resolveSidebarNewThreadEnvMode,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  shouldClearThreadSelectionOnMouseDown,
} from "./Sidebar.logic";
import type { Thread } from "../types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: (overrides.id ?? "thread-1") as never,
    codexThreadId: null,
    projectId: "project-1" as never,
    title: "Thread",
    model: "gpt-5-codex",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-09T10:00:00.000Z",
    latestTurn: null,
    lastVisitedAt: undefined,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): Parameters<typeof hasUnseenCompletion>[0]["latestTurn"] {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: overrides?.startedAt ?? "2026-03-09T10:00:00.000Z",
    completedAt: overrides?.completedAt ?? "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        proposedPlans: [],
        session: null,
      }),
    ).toBe(true);
  });
});

describe("shouldClearThreadSelectionOnMouseDown", () => {
  it("preserves selection for thread items", () => {
    const child = {
      closest: (selector: string) =>
        selector.includes("[data-thread-item]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(child)).toBe(false);
  });

  it("preserves selection for thread list toggle controls", () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes("[data-thread-selection-safe]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(selectionSafe)).toBe(false);
  });

  it("clears selection for unrelated sidebar clicks", () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(unrelated)).toBe(true);
  });
});

describe("resolveSidebarNewThreadEnvMode", () => {
  it("uses the app default when the caller does not request a specific mode", () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        defaultEnvMode: "worktree",
      }),
    ).toBe("worktree");
  });

  it("preserves an explicit requested mode over the app default", () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        requestedEnvMode: "local",
        defaultEnvMode: "worktree",
      }),
    ).toBe("local");
  });
});

describe("deriveSidebarThreadGroups", () => {
  it("nests subagent child threads under their parent thread", () => {
    const parent = makeThread({
      id: "thread-parent" as never,
    });
    const child = makeThread({
      id: "thread-child" as never,
      title: "Subagent task - Review the diff",
      createdAt: "2026-03-09T10:00:02.000Z",
      session: {
        provider: "codex",
        status: "running",
        createdAt: "2026-03-09T10:00:02.000Z",
        updatedAt: "2026-03-09T10:00:02.000Z",
        orchestrationStatus: "running",
        parentThreadId: "thread-parent" as never,
      },
    });
    const other = makeThread({
      id: "thread-other" as never,
      title: "Standalone thread",
      createdAt: "2026-03-09T10:00:03.000Z",
    });

    const groups = deriveSidebarThreadGroups([other, child, parent]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.parent.id).toBe("thread-other");
    expect(groups[1]?.parent.id).toBe("thread-parent");
    expect(groups[1]?.children.map((childEntry) => childEntry.linkedThreadId)).toEqual([
      "thread-child",
    ]);
    expect(flattenSidebarThreadGroupIds(groups)).toEqual([
      "thread-other",
      "thread-parent",
      "thread-child",
    ]);
  });

  it("prefers the explicit parent thread id when provider linkage has not hydrated yet", () => {
    const parent = makeThread({
      id: "thread-parent-explicit" as never,
      title: "Parent thread",
    });
    const child = makeThread({
      id: "thread-child-explicit" as never,
      title: "Subagent task - Inspect junk",
      createdAt: "2026-03-09T10:00:02.000Z",
      session: {
        provider: "codex",
        status: "ready",
        createdAt: "2026-03-09T10:00:02.000Z",
        updatedAt: "2026-03-09T10:00:02.000Z",
        orchestrationStatus: "ready",
        parentThreadId: "thread-parent-explicit" as never,
      },
    });

    const groups = deriveSidebarThreadGroups([child, parent]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.parent.id).toBe("thread-parent-explicit");
    expect(groups[0]?.children.map((entry) => entry.linkedThreadId)).toEqual([
      "thread-child-explicit",
    ]);
  });

  it("keeps subagent links when the delegated activity is attached outside the latest turn id", () => {
    const parent = makeThread({
      id: "thread-parent-latest" as never,
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        assistantMessageId: null,
        requestedAt: "2026-03-09T10:00:00.000Z",
        startedAt: "2026-03-09T10:00:00.000Z",
        completedAt: null,
      },
      activities: [
        {
          id: "activity-latest-subagent" as never,
          createdAt: "2026-03-09T10:00:01.000Z",
          tone: "tool",
          kind: "tool.completed",
          summary: "Delegated to reviewer",
          payload: {
            itemType: "collab_agent_tool_call",
            data: {
              subagent: {
                receiverThreadId: "provider-child-latest",
              },
            },
          },
          turnId: null,
        },
      ],
    });
    const child = makeThread({
      id: "thread-child-latest" as never,
      codexThreadId: "provider-child-latest",
      title: "Subagent task - Inspect junk",
      createdAt: "2026-03-09T10:00:02.000Z",
    });

    const groups = deriveSidebarThreadGroups([child, parent]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.parent.id).toBe("thread-parent-latest");
    expect(groups[0]?.children.map((entry) => entry.linkedThreadId)).toEqual([
      "thread-child-latest",
    ]);
  });

  it("does not synthesize empty subagent rows before a delegated thread materializes", () => {
    const parent = makeThread({
      id: "thread-parent" as never,
      activities: [
        {
          id: "activity-1" as never,
          createdAt: "2026-03-09T10:00:01.000Z",
          tone: "tool",
          kind: "tool.completed",
          summary: "Subagent task - Inspect Downloads",
          payload: {
            itemType: "collab_agent_tool_call",
            data: {
              subagent: {
                description: "Inspect Downloads",
              },
            },
          },
          turnId: null,
        },
      ],
    });

    const groups = deriveSidebarThreadGroups([parent]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.children).toHaveLength(0);
  });
});

describe("formatSidebarSubagentTitle", () => {
  it("removes the default subagent task prefix for cleaner child rows", () => {
    expect(formatSidebarSubagentTitle("Subagent task - Inspect Downloads")).toBe(
      "Inspect Downloads",
    );
  });
});

describe("resolveThreadStatusPill", () => {
  const baseThread = {
    interactionMode: "plan" as const,
    latestTurn: null,
    lastVisitedAt: undefined,
    proposedPlans: [],
    session: {
      provider: "codex" as const,
      status: "running" as const,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      orchestrationStatus: "running" as const,
    },
  };

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when plan mode is blocked on user answers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("falls back to working when the thread is actively running without blockers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });
});

describe("resolveThreadRowClassName", () => {
  it("uses the darker selected palette when a thread is both selected and active", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: true });
    expect(className).toContain("bg-primary/22");
    expect(className).toContain("hover:bg-primary/26");
    expect(className).toContain("dark:bg-primary/30");
    expect(className).not.toContain("bg-accent/85");
  });

  it("uses selected hover colors for selected threads", () => {
    const className = resolveThreadRowClassName({ isActive: false, isSelected: true });
    expect(className).toContain("bg-primary/15");
    expect(className).toContain("hover:bg-primary/19");
    expect(className).toContain("dark:bg-primary/22");
    expect(className).not.toContain("hover:bg-accent");
  });

  it("keeps the accent palette for active-only threads", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: false });
    expect(className).toContain("bg-accent/85");
    expect(className).toContain("hover:bg-accent");
  });
});

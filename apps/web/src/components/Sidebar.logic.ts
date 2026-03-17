import type { ThreadId } from "@t3tools/contracts";

import type { Thread } from "../types";
import { cn } from "../lib/utils";
import { findLatestProposedPlan, isLatestTurnSettled } from "../session-logic";
import {
  extractSubagentMetadata,
  formatSubagentDisplayTitle,
  resolveSubagentProviderThreadId,
} from "../subagent";

export { resolveSubagentIdentity, type SubagentIdentity } from "../subagent";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export type SidebarNewThreadEnvMode = "local" | "worktree";

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

export interface SidebarThreadGroup {
  parent: Thread;
  children: SidebarSubagentEntry[];
}

export interface SidebarSubagentEntry {
  id: string;
  activityId: string;
  title: string;
  createdAt: string;
  providerThreadId: string | null;
  linkedThreadId: ThreadId | null;
  linkedThread: Thread | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveSidebarSubagentEntryTitle(input: {
  thread: Thread | null;
  payload: Record<string, unknown> | null;
  summary: string;
  description: string | undefined;
}): string {
  const threadTitle = input.thread ? formatSubagentDisplayTitle(input.thread.title) : null;
  if (threadTitle) {
    return threadTitle;
  }
  const payloadTitle = asTrimmedString(input.payload?.title);
  if (payloadTitle) {
    return formatSubagentDisplayTitle(payloadTitle);
  }
  if (input.description) {
    return input.description;
  }
  return formatSubagentDisplayTitle(input.summary);
}

export function deriveSidebarThreadGroups(threads: Thread[]): SidebarThreadGroup[] {
  const threadById = new Map(threads.map((thread) => [thread.id, thread] as const));
  const threadByProviderThreadId = new Map<string, Thread>();
  for (const thread of threads) {
    if (thread.codexThreadId) {
      threadByProviderThreadId.set(thread.codexThreadId, thread);
    }
  }

  const assignedChildThreadIds = new Set<ThreadId>();
  const explicitChildrenByParentId = new Map<ThreadId, SidebarSubagentEntry[]>();
  for (const thread of threads) {
    const parentThreadId = thread.session?.parentThreadId;
    if (!parentThreadId || parentThreadId === thread.id || !threadById.has(parentThreadId)) {
      continue;
    }
    assignedChildThreadIds.add(thread.id);
    const siblings = explicitChildrenByParentId.get(parentThreadId) ?? [];
    siblings.push({
      id: thread.id,
      activityId: `linked-thread:${thread.id}`,
      title: resolveSidebarSubagentEntryTitle({
        thread,
        payload: null,
        summary: thread.title,
        description: undefined,
      }),
      createdAt: thread.createdAt,
      providerThreadId: thread.codexThreadId,
      linkedThreadId: thread.id,
      linkedThread: thread,
    });
    explicitChildrenByParentId.set(parentThreadId, siblings);
  }

  const groups = threads.map((thread) => {
    const children = [...(explicitChildrenByParentId.get(thread.id) ?? [])].toSorted(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    );
    const seenLinkedThreadIds = new Set<ThreadId>(
      children
        .map((child) => child.linkedThreadId)
        .filter((threadId): threadId is ThreadId => threadId !== null),
    );
    const latestTurnId = thread.latestTurn?.turnId ?? null;
    const activities = latestTurnId
      ? thread.activities.filter(
          (activity) => activity.turnId === latestTurnId || activity.turnId === null,
        )
      : thread.activities;
    const orderedActivities = [...activities].toSorted(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    );

    for (const activity of orderedActivities) {
      const payload = asRecord(activity.payload);
      if (payload?.itemType !== "collab_agent_tool_call") {
        continue;
      }
      const subagent = extractSubagentMetadata(payload);
      const providerThreadId = resolveSubagentProviderThreadId(subagent);
      const linkedThread =
        providerThreadId && threadByProviderThreadId.get(providerThreadId)?.id !== thread.id
          ? (threadByProviderThreadId.get(providerThreadId) ?? null)
          : null;
      if (
        !linkedThread ||
        linkedThread.session?.parentThreadId === thread.id ||
        seenLinkedThreadIds.has(linkedThread.id)
      ) {
        continue;
      }
      assignedChildThreadIds.add(linkedThread.id);
      seenLinkedThreadIds.add(linkedThread.id);
      children.push({
        id: linkedThread.id,
        activityId: activity.id,
        title: resolveSidebarSubagentEntryTitle({
          thread: linkedThread,
          payload,
          summary: activity.summary,
          description: subagent?.description,
        }),
        createdAt: linkedThread.createdAt,
        providerThreadId,
        linkedThreadId: linkedThread.id,
        linkedThread,
      });
    }

    return { parent: thread, children };
  });

  return groups.filter((group) => !assignedChildThreadIds.has(group.parent.id));
}

export function flattenSidebarThreadGroupIds(
  groups: ReadonlyArray<SidebarThreadGroup>,
): ThreadId[] {
  return groups.flatMap((group) => [
    group.parent.id,
    ...group.children
      .map((child) => child.linkedThreadId)
      .filter((threadId): threadId is ThreadId => threadId !== null),
  ]);
}

export function formatSidebarSubagentTitle(title: string): string {
  return formatSubagentDisplayTitle(title);
}

type ThreadStatusInput = Pick<
  Thread,
  "interactionMode" | "latestTurn" | "lastVisitedAt" | "proposedPlans" | "session"
>;

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function resolveSidebarNewThreadEnvMode(input: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  defaultEnvMode: SidebarNewThreadEnvMode;
}): SidebarNewThreadEnvMode {
  return input.requestedEnvMode ?? input.defaultEnvMode;
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "h-7 w-full translate-x-0 cursor-default justify-start px-2 text-left select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-primary/22 text-foreground font-medium hover:bg-primary/26 hover:text-foreground dark:bg-primary/30 dark:hover:bg-primary/36",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-primary/15 text-foreground hover:bg-primary/19 hover:text-foreground dark:bg-primary/22 dark:hover:bg-primary/28",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-accent/85 text-foreground font-medium hover:bg-accent hover:text-foreground dark:bg-accent/55 dark:hover:bg-accent/70",
    );
  }

  return cn(baseClassName, "text-muted-foreground hover:bg-accent hover:text-foreground");
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
}): ThreadStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, thread } = input;

  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null) !== null;
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export type WorkEntryIconKind =
  | "bot"
  | "check"
  | "database"
  | "eye"
  | "file"
  | "folder"
  | "globe"
  | "hammer"
  | "list-todo"
  | "search"
  | "square-pen"
  | "target"
  | "terminal"
  | "wrench"
  | "zap";

export interface WorkEntryIconSource {
  label: string;
  toolTitle?: string | undefined;
  detail?: string | undefined;
  output?: string | undefined;
  command?: string | undefined;
  changedFiles?: ReadonlyArray<string> | undefined;
  itemType?:
    | "command_execution"
    | "file_change"
    | "mcp_tool_call"
    | "dynamic_tool_call"
    | "collab_agent_tool_call"
    | "web_search"
    | "image_view"
    | undefined;
  requestKind?: "command" | "file-read" | "file-change" | undefined;
  activityKind?: string | undefined;
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

export function resolveWorkEntryIconKind(workEntry: WorkEntryIconSource): WorkEntryIconKind | null {
  if (workEntry.requestKind === "command") return "terminal";
  if (workEntry.requestKind === "file-read") return "eye";
  if (workEntry.requestKind === "file-change") return "square-pen";

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return "terminal";
  }
  if (workEntry.itemType === "file_change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return "square-pen";
  }
  if (workEntry.itemType === "web_search") return "globe";
  if (workEntry.itemType === "image_view") return "eye";

  const haystack = [
    workEntry.label,
    workEntry.toolTitle,
    workEntry.detail,
    workEntry.output,
    workEntry.command,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();

  if (haystack.includes("report_intent") || haystack.includes("intent logged")) {
    return "target";
  }
  if (
    haystack.includes("bash") ||
    haystack.includes("read_bash") ||
    haystack.includes("write_bash") ||
    haystack.includes("stop_bash") ||
    haystack.includes("list_bash")
  ) {
    return "terminal";
  }
  if (haystack.includes("sql")) return "database";
  if (
    haystack.includes("context7") ||
    haystack.includes("resolve-library-id") ||
    haystack.includes("search")
  ) {
    return "search";
  }
  if (haystack.includes("view")) return "eye";
  if (haystack.includes("apply_patch")) return "square-pen";
  if (haystack.includes("skill")) return "zap";
  if (haystack.includes("ask_user") || haystack.includes("approval")) return "bot";
  if (haystack.includes("store_memory")) return "folder";
  if (haystack.includes("edit") || haystack.includes("patch")) return "wrench";
  if (haystack.includes("file")) return "file";

  if (haystack.includes("task")) return "hammer";

  if (workEntry.activityKind === "turn.plan.updated") return "list-todo";
  if (workEntry.activityKind === "task.progress") return "hammer";
  if (workEntry.activityKind === "approval.requested") return "bot";
  if (workEntry.activityKind === "approval.resolved") return "check";

  if (workEntry.itemType === "mcp_tool_call") return "wrench";
  if (
    workEntry.itemType === "dynamic_tool_call" ||
    workEntry.itemType === "collab_agent_tool_call"
  ) {
    return "hammer";
  }

  return null;
}

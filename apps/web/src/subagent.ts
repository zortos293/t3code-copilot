export interface SubagentMetadata {
  name?: string;
  description?: string;
  status?: string;
  senderThreadId?: string;
  receiverThreadId?: string;
  newThreadId?: string;
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

export function extractSubagentMetadata(payload: unknown): SubagentMetadata | undefined {
  const payloadRecord = asRecord(payload);
  const data = asRecord(payloadRecord?.data);
  const subagent = asRecord(data?.subagent);
  if (!subagent) {
    return undefined;
  }

  const metadata = {
    ...(asTrimmedString(subagent.name) ? { name: asTrimmedString(subagent.name)! } : {}),
    ...(asTrimmedString(subagent.description)
      ? { description: asTrimmedString(subagent.description)! }
      : {}),
    ...(asTrimmedString(subagent.status) ? { status: asTrimmedString(subagent.status)! } : {}),
    ...(asTrimmedString(subagent.senderThreadId)
      ? { senderThreadId: asTrimmedString(subagent.senderThreadId)! }
      : {}),
    ...(asTrimmedString(subagent.receiverThreadId)
      ? { receiverThreadId: asTrimmedString(subagent.receiverThreadId)! }
      : {}),
    ...(asTrimmedString(subagent.newThreadId)
      ? { newThreadId: asTrimmedString(subagent.newThreadId)! }
      : {}),
  } satisfies SubagentMetadata;

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function resolveSubagentProviderThreadId(
  subagent: SubagentMetadata | undefined,
): string | null {
  return subagent?.receiverThreadId ?? subagent?.newThreadId ?? null;
}

export function formatSubagentDisplayTitle(title: string): string {
  const normalized = title.replace(/^subagent task\s*-\s*/i, "").trim();
  return normalized.length > 0 ? normalized : title;
}

const SUBAGENT_NAMES = [
  "Atlas",
  "Nova",
  "Bolt",
  "Iris",
  "Sage",
  "Pixel",
  "Cosmo",
  "Ember",
  "Flux",
  "Luna",
  "Onyx",
  "Prism",
  "Spark",
  "Vex",
  "Wren",
  "Zeta",
] as const;

const SUBAGENT_COLORS = [
  {
    dot: "bg-violet-500",
    text: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-500/15 border-violet-500/25",
  },
  {
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/15 border-amber-500/25",
  },
  {
    dot: "bg-teal-500",
    text: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-500/15 border-teal-500/25",
  },
  {
    dot: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500/15 border-rose-500/25",
  },
  {
    dot: "bg-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-500/15 border-sky-500/25",
  },
  {
    dot: "bg-lime-500",
    text: "text-lime-600 dark:text-lime-400",
    bg: "bg-lime-500/15 border-lime-500/25",
  },
  {
    dot: "bg-fuchsia-500",
    text: "text-fuchsia-600 dark:text-fuchsia-400",
    bg: "bg-fuchsia-500/15 border-fuchsia-500/25",
  },
  {
    dot: "bg-cyan-500",
    text: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-500/15 border-cyan-500/25",
  },
] as const;

function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(31, hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export interface SubagentIdentity {
  name: string;
  color: (typeof SUBAGENT_COLORS)[number];
}

export function resolveSubagentIdentity(id: string, index: number): SubagentIdentity {
  const hash = stableHash(id);
  const nameIndex = (hash + index) % SUBAGENT_NAMES.length;
  const colorIndex = (hash + index) % SUBAGENT_COLORS.length;
  return {
    name: SUBAGENT_NAMES[nameIndex] ?? SUBAGENT_NAMES[0],
    color: SUBAGENT_COLORS[colorIndex] ?? SUBAGENT_COLORS[0],
  };
}

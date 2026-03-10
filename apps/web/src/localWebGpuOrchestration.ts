import {
  DEFAULT_MODEL_BY_PROVIDER,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type ClientOrchestrationCommand,
  type NativeApi,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationSessionStatus,
  type OrchestrationThread,
  type WebGpuModelDtype,
} from "@t3tools/contracts";
import { getAppSettingsSnapshot } from "./appSettings";
import { useComposerDraftStore } from "./composerDraftStore";
import { randomUUID } from "./lib/utils";
import { truncateTitle } from "./truncateTitle";

const LOCAL_WEBGPU_STORAGE_KEY = "t3code:webgpu-local-state:v1";

type LocalWebGpuRuntimePhase =
  | "idle"
  | "loading-model"
  | "ready"
  | "generating"
  | "error"
  | "unsupported";

export interface LocalWebGpuStatusSnapshot {
  enabled: boolean;
  supported: boolean;
  supportMessage: string | null;
  phase: LocalWebGpuRuntimePhase;
  model: string | null;
  dtype: WebGpuModelDtype;
  progress:
    | {
        file: string | null;
        loaded: number;
        total: number | null;
      }
    | null;
  lastError: string | null;
}

function localWebGpuProgressEquals(
  left: LocalWebGpuStatusSnapshot["progress"],
  right: LocalWebGpuStatusSnapshot["progress"],
): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.file === right.file &&
    left.loaded === right.loaded &&
    left.total === right.total
  );
}

function localWebGpuStatusSnapshotEquals(
  left: LocalWebGpuStatusSnapshot | null,
  right: LocalWebGpuStatusSnapshot,
): boolean {
  if (left === null) {
    return false;
  }
  return (
    left.enabled === right.enabled &&
    left.supported === right.supported &&
    left.supportMessage === right.supportMessage &&
    left.phase === right.phase &&
    left.model === right.model &&
    left.dtype === right.dtype &&
    localWebGpuProgressEquals(left.progress, right.progress) &&
    left.lastError === right.lastError
  );
}

interface PersistedLocalWebGpuState {
  threads: OrchestrationThread[];
  updatedAt: string;
}

interface LocalWebGpuChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

type WorkerGenerateMessage = {
  type: "generate";
  requestId: string;
  model: string;
  dtype: WebGpuModelDtype;
  messages: LocalWebGpuChatMessage[];
  maxNewTokens: number;
  temperature: number;
  topP: number;
};

type WorkerDisposeMessage = {
  type: "dispose";
};

type WorkerInboundMessage = WorkerGenerateMessage | WorkerDisposeMessage;

type WorkerStatusMessage = {
  type: "status";
  status: Exclude<LocalWebGpuRuntimePhase, "unsupported">;
  model: string | null;
  dtype: WebGpuModelDtype;
  message?: string;
};

type WorkerProgressMessage = {
  type: "download-progress";
  file: string | null;
  loaded: number;
  total: number | null;
};

type WorkerTextDeltaMessage = {
  type: "text-delta";
  requestId: string;
  delta: string;
};

type WorkerCompleteMessage = {
  type: "complete";
  requestId: string;
  text: string;
};

type WorkerErrorMessage = {
  type: "error";
  requestId?: string;
  message: string;
};

type WorkerOutboundMessage =
  | WorkerStatusMessage
  | WorkerProgressMessage
  | WorkerTextDeltaMessage
  | WorkerCompleteMessage
  | WorkerErrorMessage;

type WorkerGenerationRequest = {
  requestId: string;
  threadId: ThreadId;
  turnId: TurnId;
  assistantMessageId: MessageId;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  onDelta: (delta: string) => void;
};

function nowIso(): string {
  return new Date().toISOString();
}

function getWebGpuSupportMessage(): string | null {
  if (typeof window === "undefined") {
    return "Local WebGPU is only available in the browser.";
  }
  if (!("Worker" in window)) {
    return "This browser does not support Web Workers.";
  }
  if (!("gpu" in navigator)) {
    return "WebGPU is unavailable in this browser. Try a recent Chromium build with WebGPU enabled.";
  }
  return null;
}

function newEventId() {
  return EventId.makeUnsafe(randomUUID());
}

function newMessageId() {
  return MessageId.makeUnsafe(randomUUID());
}

function newTurnId() {
  return TurnId.makeUnsafe(randomUUID());
}

function emptyMetadata() {
  return { adapterKey: "webgpu.local" };
}

function createThreadEvent<TType extends OrchestrationEvent["type"]>(input: {
  type: TType;
  threadId: ThreadId;
  payload: Extract<OrchestrationEvent, { type: TType }>["payload"];
  commandId: string | null;
  occurredAt?: string;
}): OrchestrationEvent {
  return {
    sequence: 0,
    eventId: newEventId(),
    aggregateKind: "thread",
    aggregateId: input.threadId,
    occurredAt: input.occurredAt ?? nowIso(),
    commandId: input.commandId,
    causationEventId: null,
    correlationId: input.commandId,
    metadata: emptyMetadata(),
    type: input.type,
    payload: input.payload,
  } as OrchestrationEvent;
}

function persistLocalState(threadsById: ReadonlyMap<ThreadId, OrchestrationThread>): void {
  if (typeof window === "undefined") {
    return;
  }
  const value: PersistedLocalWebGpuState = {
    threads: Array.from(threadsById.values()),
    updatedAt: nowIso(),
  };
  try {
    window.localStorage.setItem(LOCAL_WEBGPU_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Best-effort persistence only.
  }
}

function loadPersistedLocalState(): Map<ThreadId, OrchestrationThread> {
  if (typeof window === "undefined") {
    return new Map();
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_WEBGPU_STORAGE_KEY);
    if (!raw) {
      return new Map();
    }
    const parsed = JSON.parse(raw) as Partial<PersistedLocalWebGpuState>;
    const threads = Array.isArray(parsed.threads) ? parsed.threads : [];
    return new Map(
      threads.flatMap((thread) =>
        thread && typeof thread.id === "string"
          ? [[ThreadId.makeUnsafe(thread.id), thread as OrchestrationThread] as const]
          : [],
      ),
    );
  } catch {
    return new Map();
  }
}

class WebGpuWorkerClient {
  private worker: Worker | null = null;
  private activeRequest: WorkerGenerationRequest | null = null;

  constructor(
    private readonly onStatus: (message: WorkerStatusMessage) => void,
    private readonly onProgress: (message: WorkerProgressMessage) => void,
  ) {}

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }
    const worker = new Worker(new URL("./workers/webgpuInference.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", (event: MessageEvent<WorkerOutboundMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "status":
          this.onStatus(message);
          break;
        case "download-progress":
          this.onProgress(message);
          break;
        case "text-delta":
          if (this.activeRequest?.requestId === message.requestId) {
            this.activeRequest.onDelta(message.delta);
          }
          break;
        case "complete":
          if (this.activeRequest?.requestId === message.requestId) {
            this.activeRequest.resolve(message.text);
            this.activeRequest = null;
          }
          break;
        case "error":
          if (this.activeRequest && (!message.requestId || this.activeRequest.requestId === message.requestId)) {
            this.activeRequest.reject(new Error(message.message));
            this.activeRequest = null;
          } else {
            this.onStatus({
              type: "status",
              status: "error",
              model: null,
              dtype: getAppSettingsSnapshot().webGpuPreferredDtype,
              message: message.message,
            });
          }
          break;
      }
    });
    this.worker = worker;
    return worker;
  }

  async generate(input: {
    requestId: string;
    threadId: ThreadId;
    turnId: TurnId;
    assistantMessageId: MessageId;
    model: string;
    dtype: WebGpuModelDtype;
    messages: LocalWebGpuChatMessage[];
    maxNewTokens: number;
    temperature: number;
    topP: number;
    onDelta: (delta: string) => void;
  }): Promise<string> {
    if (this.activeRequest !== null) {
      throw new Error("Only one local WebGPU generation can run at a time in v1.");
    }
    const worker = this.ensureWorker();
    const result = new Promise<string>((resolve, reject) => {
      this.activeRequest = {
        requestId: input.requestId,
        threadId: input.threadId,
        turnId: input.turnId,
        assistantMessageId: input.assistantMessageId,
        resolve,
        reject,
        onDelta: input.onDelta,
      };
    });
    const message: WorkerGenerateMessage = {
      type: "generate",
      requestId: input.requestId,
      model: input.model,
      dtype: input.dtype,
      messages: input.messages,
      maxNewTokens: input.maxNewTokens,
      temperature: input.temperature,
      topP: input.topP,
    };
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- Dedicated worker messaging does not use targetOrigin.
    worker.postMessage(message satisfies WorkerInboundMessage);
    return result;
  }

  interrupt(): void {
    if (this.activeRequest) {
      this.activeRequest.reject(new Error("Local WebGPU generation was interrupted."));
      this.activeRequest = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  dispose(): void {
    if (this.worker) {
      // eslint-disable-next-line unicorn/require-post-message-target-origin -- Dedicated worker messaging does not use targetOrigin.
      this.worker.postMessage({ type: "dispose" } satisfies WorkerInboundMessage);
      this.worker.terminate();
      this.worker = null;
    }
    this.activeRequest = null;
  }
}

class LocalWebGpuOrchestrationController {
  private readonly threadsById = loadPersistedLocalState();
  private readonly statusListeners = new Set<() => void>();
  private readonly domainEventListeners = new Set<(event: OrchestrationEvent) => void>();
  private cachedStatusSnapshot: LocalWebGpuStatusSnapshot | null = null;
  private status: Omit<LocalWebGpuStatusSnapshot, "enabled" | "supported" | "supportMessage"> = {
    phase: "idle",
    model: null,
    dtype: getAppSettingsSnapshot().webGpuPreferredDtype,
    progress: null,
    lastError: null,
  };
  private activeGeneration:
    | {
        threadId: ThreadId;
        turnId: TurnId;
        assistantMessageId: MessageId;
      }
    | null = null;

  private readonly workerClient = new WebGpuWorkerClient(
    (message) => {
      this.status = {
        ...this.status,
        phase: message.status,
        model: message.model,
        dtype: message.dtype,
        lastError: message.message ?? null,
        ...(message.status === "ready" || message.status === "idle" ? { progress: null } : {}),
      };
      this.emitStatus();
    },
    (message) => {
      this.status = {
        ...this.status,
        phase: "loading-model",
        progress: message,
      };
      this.emitStatus();
    },
  );

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribeDomainEvents(listener: (event: OrchestrationEvent) => void): () => void {
    this.domainEventListeners.add(listener);
    return () => {
      this.domainEventListeners.delete(listener);
    };
  }

  getStatusSnapshot(): LocalWebGpuStatusSnapshot {
    const settings = getAppSettingsSnapshot();
    const supportMessage = getWebGpuSupportMessage();
    const nextSnapshot: LocalWebGpuStatusSnapshot = {
      enabled: settings.webGpuEnabled,
      supported: supportMessage === null,
      supportMessage,
      ...this.status,
      dtype: this.status.dtype ?? settings.webGpuPreferredDtype,
    };
    const cachedSnapshot = this.cachedStatusSnapshot;
    if (cachedSnapshot && localWebGpuStatusSnapshotEquals(cachedSnapshot, nextSnapshot)) {
      return cachedSnapshot;
    }
    this.cachedStatusSnapshot = nextSnapshot;
    return nextSnapshot;
  }

  private emitStatus(): void {
    for (const listener of this.statusListeners) {
      listener();
    }
  }

  private emitDomainEvent(event: OrchestrationEvent): void {
    for (const listener of this.domainEventListeners) {
      listener(event);
    }
  }

  private persist(): void {
    persistLocalState(this.threadsById);
  }

  private getThread(threadId: ThreadId): OrchestrationThread {
    const thread = this.threadsById.get(threadId);
    if (!thread) {
      throw new Error("Local WebGPU thread not found.");
    }
    return thread;
  }

  private setThread(thread: OrchestrationThread): void {
    this.threadsById.set(thread.id, thread);
    this.persist();
  }

  isLocalThread(threadId: ThreadId): boolean {
    return this.threadsById.has(threadId);
  }

  mergeSnapshot(baseSnapshot: OrchestrationReadModel, snapshotSequence: number): OrchestrationReadModel {
    const projectIds = new Set(baseSnapshot.projects.filter((project) => project.deletedAt === null).map((project) => project.id));
    let changed = false;
    for (const [threadId, thread] of this.threadsById.entries()) {
      if (!projectIds.has(thread.projectId)) {
        this.threadsById.delete(threadId);
        changed = true;
      }
    }
    if (changed) {
      this.persist();
    }
    const localThreads = Array.from(this.threadsById.values()).toSorted((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
    return {
      ...baseSnapshot,
      snapshotSequence,
      threads: [...baseSnapshot.threads.filter((thread) => !this.threadsById.has(thread.id)), ...localThreads],
      updatedAt:
        localThreads.length > 0
          ? [baseSnapshot.updatedAt, localThreads.at(-1)?.updatedAt ?? baseSnapshot.updatedAt]
              .toSorted()
              .at(-1) ??
            baseSnapshot.updatedAt
          : baseSnapshot.updatedAt,
    };
  }

  private buildSession(
    threadId: ThreadId,
    status: OrchestrationSessionStatus,
    runtimeMode: OrchestrationThread["runtimeMode"],
    activeTurnId: TurnId | null,
    updatedAt: string,
    lastError?: string | null,
  ): OrchestrationSession {
    return {
      threadId,
      status,
      providerName: "webgpu",
      runtimeMode,
      activeTurnId,
      lastError: lastError ?? null,
      updatedAt,
    };
  }

  private ensureThreadForTurnStart(
    command: Extract<ClientOrchestrationCommand, { type: "thread.turn.start" }>,
    selectedModel: string,
  ): { thread: OrchestrationThread; created: boolean } {
    const existing = this.threadsById.get(command.threadId);
    if (existing) {
      return { thread: existing, created: false };
    }
    const draftThread = useComposerDraftStore.getState().getDraftThread(command.threadId);
    if (!draftThread) {
      throw new Error("Create a local draft thread before starting a WebGPU turn.");
    }
    const titleSeed = command.message.text.trim() || "New local thread";
    const thread: OrchestrationThread = {
      id: command.threadId,
      projectId: draftThread.projectId,
      title: truncateTitle(titleSeed),
      model: selectedModel,
      runtimeMode: draftThread.runtimeMode,
      interactionMode: draftThread.interactionMode,
      branch: draftThread.branch,
      worktreePath: draftThread.worktreePath,
      latestTurn: null,
      createdAt: draftThread.createdAt,
      updatedAt: command.createdAt,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    };
    this.setThread(thread);
    return { thread, created: true };
  }

  private buildGenerationMessages(
    thread: OrchestrationThread,
    userText: string,
  ): LocalWebGpuChatMessage[] {
    return [
      ...thread.messages
        .filter((message) => !message.streaming && message.text.trim().length > 0)
        .map((message) => ({
          role: message.role,
          content: message.text,
        })),
      { role: "user", content: userText },
    ];
  }

  private appendAssistantDelta(
    threadId: ThreadId,
    assistantMessageId: MessageId,
    turnId: TurnId,
    delta: string,
    commandId: string,
  ): void {
    const thread = this.getThread(threadId);
    const messages = thread.messages.map((message) =>
      message.id === assistantMessageId
        ? {
            ...message,
            text: `${message.text}${delta}`,
            updatedAt: nowIso(),
          }
        : message,
    );
    const updatedThread = {
      ...thread,
      messages,
      updatedAt: nowIso(),
    };
    this.setThread(updatedThread);
    const assistantMessage = messages.find((message) => message.id === assistantMessageId);
    if (!assistantMessage) {
      return;
    }
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.message-sent",
        threadId,
        commandId,
        payload: {
          threadId,
          messageId: assistantMessage.id,
          role: assistantMessage.role,
          text: assistantMessage.text,
          turnId,
          streaming: true,
          createdAt: assistantMessage.createdAt,
          updatedAt: assistantMessage.updatedAt,
        },
      }),
    );
  }

  private completeAssistantMessage(
    threadId: ThreadId,
    turnId: TurnId,
    assistantMessageId: MessageId,
    finalText: string,
    commandId: string,
  ): void {
    const completedAt = nowIso();
    const thread = this.getThread(threadId);
    const messages = thread.messages.map((message) =>
      message.id === assistantMessageId
        ? {
            ...message,
            text: finalText.length > 0 ? finalText : message.text,
            streaming: false,
            updatedAt: completedAt,
          }
        : message,
    );
    const assistantMessage = messages.find((message) => message.id === assistantMessageId);
    const updatedThread: OrchestrationThread = {
      ...thread,
      messages,
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: thread.latestTurn?.requestedAt ?? completedAt,
        startedAt: thread.latestTurn?.startedAt ?? completedAt,
        completedAt,
        assistantMessageId,
      },
      session: this.buildSession(threadId, "ready", thread.runtimeMode, null, completedAt),
      updatedAt: completedAt,
    };
    this.setThread(updatedThread);
    if (assistantMessage) {
      this.emitDomainEvent(
        createThreadEvent({
          type: "thread.message-sent",
          threadId,
          commandId,
          payload: {
            threadId,
            messageId: assistantMessage.id,
            role: assistantMessage.role,
            text: assistantMessage.text,
            turnId,
            streaming: false,
            createdAt: assistantMessage.createdAt,
            updatedAt: assistantMessage.updatedAt,
          },
        }),
      );
    }
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.session-set",
        threadId,
        commandId,
        payload: {
          threadId,
          session: updatedThread.session!,
        },
      }),
    );
  }

  private failGeneration(
    threadId: ThreadId,
    turnId: TurnId,
    assistantMessageId: MessageId,
    error: Error,
    commandId: string,
  ): void {
    const completedAt = nowIso();
    const thread = this.getThread(threadId);
    const messages = thread.messages.map((message) =>
      message.id === assistantMessageId
        ? {
            ...message,
            streaming: false,
            updatedAt: completedAt,
          }
        : message,
    );
    const updatedThread: OrchestrationThread = {
      ...thread,
      messages,
      latestTurn: {
        turnId,
        state: "error",
        requestedAt: thread.latestTurn?.requestedAt ?? completedAt,
        startedAt: thread.latestTurn?.startedAt ?? completedAt,
        completedAt,
        assistantMessageId,
      },
      session: this.buildSession(threadId, "error", thread.runtimeMode, null, completedAt, error.message),
      updatedAt: completedAt,
    };
    this.setThread(updatedThread);
    this.status = {
      ...this.status,
      phase: "error",
      lastError: error.message,
    };
    this.emitStatus();
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.session-set",
        threadId,
        commandId,
        payload: {
          threadId,
          session: updatedThread.session!,
        },
      }),
    );
  }

  async clearPersistedState(): Promise<void> {
    const threadIds = Array.from(this.threadsById.keys());
    this.workerClient.dispose();
    this.activeGeneration = null;
    this.status = {
      phase: "idle",
      model: null,
      dtype: getAppSettingsSnapshot().webGpuPreferredDtype,
      progress: null,
      lastError: null,
    };
    this.threadsById.clear();
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(LOCAL_WEBGPU_STORAGE_KEY);
      } catch {
        // Ignore storage failures.
      }
    }
    this.emitStatus();
    for (const threadId of threadIds) {
      this.emitDomainEvent(
        createThreadEvent({
          type: "thread.deleted",
          threadId,
          commandId: null,
          payload: {
            threadId,
            deletedAt: nowIso(),
          },
        }),
      );
    }
  }

  async dispatchCommand(
    baseApi: NativeApi,
    command: ClientOrchestrationCommand,
  ): Promise<{ sequence: number }> {
    if (!this.shouldHandleLocally(command)) {
      return baseApi.orchestration.dispatchCommand(command);
    }
    switch (command.type) {
      case "thread.turn.start":
        this.startLocalTurn(command);
        return { sequence: 0 };
      case "thread.turn.interrupt":
        this.interruptLocalTurn(command);
        return { sequence: 0 };
      case "thread.session.stop":
        this.stopLocalSession(command);
        return { sequence: 0 };
      case "thread.delete":
        this.deleteLocalThread(command);
        return { sequence: 0 };
      case "thread.meta.update":
        this.updateLocalThreadMeta(command);
        return { sequence: 0 };
      case "thread.runtime-mode.set":
        this.setLocalRuntimeMode(command);
        return { sequence: 0 };
      case "thread.interaction-mode.set":
        this.setLocalInteractionMode(command);
        return { sequence: 0 };
      case "thread.checkpoint.revert":
        throw new Error("Checkpoint revert is not supported for local WebGPU threads yet.");
      case "thread.approval.respond":
      case "thread.user-input.respond":
        throw new Error("Local WebGPU threads do not support interactive approval requests.");
      default:
        return baseApi.orchestration.dispatchCommand(command);
    }
  }

  private shouldHandleLocally(command: ClientOrchestrationCommand): boolean {
    if (command.type === "thread.turn.start" && command.provider === "webgpu") {
      return true;
    }
    if (!("threadId" in command)) {
      return false;
    }
    return this.threadsById.has(command.threadId);
  }

  private startLocalTurn(command: Extract<ClientOrchestrationCommand, { type: "thread.turn.start" }>): void {
    const settings = getAppSettingsSnapshot();
    const supportMessage = getWebGpuSupportMessage();
    if (!settings.webGpuEnabled) {
      throw new Error("Enable Local WebGPU in Settings before using the browser adapter.");
    }
    if (supportMessage) {
      throw new Error(supportMessage);
    }
    if (command.message.attachments.length > 0) {
      throw new Error("Local WebGPU does not support image attachments yet.");
    }
    if (this.activeGeneration !== null) {
      throw new Error("A local WebGPU turn is already running.");
    }

    const selectedModel = command.model?.trim() || settings.webGpuDefaultModel || DEFAULT_MODEL_BY_PROVIDER.webgpu;
    const { thread: existingThread, created } = this.ensureThreadForTurnStart(command, selectedModel);
    const requestId = randomUUID();
    const turnId = newTurnId();
    const assistantMessageId = newMessageId();
    const startedAt = command.createdAt;
    const generationMessages = this.buildGenerationMessages(existingThread, command.message.text);
    const userMessage = {
      id: command.message.messageId,
      role: "user" as const,
      text: command.message.text,
      attachments: [],
      turnId,
      streaming: false,
      createdAt: command.createdAt,
      updatedAt: command.createdAt,
    };
    const assistantMessage = {
      id: assistantMessageId,
      role: "assistant" as const,
      text: "",
      turnId,
      streaming: true,
      createdAt: startedAt,
      updatedAt: startedAt,
    };
    const updatedThread: OrchestrationThread = {
      ...existingThread,
      model: selectedModel,
      runtimeMode: command.runtimeMode,
      interactionMode: command.interactionMode,
      title:
        existingThread.messages.length === 0 && existingThread.title === "New thread"
          ? truncateTitle(command.message.text.trim() || existingThread.title)
          : existingThread.title,
      messages: [...existingThread.messages, userMessage, assistantMessage],
      latestTurn: {
        turnId,
        state: "running",
        requestedAt: startedAt,
        startedAt,
        completedAt: null,
        assistantMessageId,
      },
      session: this.buildSession(command.threadId, "running", command.runtimeMode, turnId, startedAt),
      updatedAt: startedAt,
    };
    this.setThread(updatedThread);
    if (created) {
      this.emitDomainEvent(
        createThreadEvent({
          type: "thread.created",
          threadId: command.threadId,
          commandId: command.commandId,
          occurredAt: command.createdAt,
          payload: {
            threadId: updatedThread.id,
            projectId: updatedThread.projectId,
            title: updatedThread.title,
            model: updatedThread.model,
            runtimeMode: updatedThread.runtimeMode,
            interactionMode: updatedThread.interactionMode,
            branch: updatedThread.branch,
            worktreePath: updatedThread.worktreePath,
            createdAt: updatedThread.createdAt,
            updatedAt: updatedThread.updatedAt,
          },
        }),
      );
    }
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.message-sent",
        threadId: command.threadId,
        commandId: command.commandId,
        occurredAt: command.createdAt,
        payload: {
          threadId: command.threadId,
          messageId: userMessage.id,
          role: "user",
          text: userMessage.text,
          attachments: [],
          turnId,
          streaming: false,
          createdAt: userMessage.createdAt,
          updatedAt: userMessage.updatedAt,
        },
      }),
    );
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.turn-start-requested",
        threadId: command.threadId,
        commandId: command.commandId,
        occurredAt: command.createdAt,
        payload: {
          threadId: command.threadId,
          messageId: userMessage.id,
          provider: "webgpu",
          model: selectedModel,
          ...(command.modelOptions ? { modelOptions: command.modelOptions } : {}),
          assistantDeliveryMode: command.assistantDeliveryMode,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          createdAt: command.createdAt,
        },
      }),
    );
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.message-sent",
        threadId: command.threadId,
        commandId: command.commandId,
        occurredAt: command.createdAt,
        payload: {
          threadId: command.threadId,
          messageId: assistantMessage.id,
          role: "assistant",
          text: "",
          turnId,
          streaming: true,
          createdAt: assistantMessage.createdAt,
          updatedAt: assistantMessage.updatedAt,
        },
      }),
    );
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.session-set",
        threadId: command.threadId,
        commandId: command.commandId,
        occurredAt: command.createdAt,
        payload: {
          threadId: command.threadId,
          session: updatedThread.session!,
        },
      }),
    );

    const webgpuOptions = command.modelOptions?.webgpu;
    const dtype = webgpuOptions?.dtype ?? settings.webGpuPreferredDtype;
    this.activeGeneration = {
      threadId: command.threadId,
      turnId,
      assistantMessageId,
    };
    void this.workerClient
      .generate({
        requestId,
        threadId: command.threadId,
        turnId,
        assistantMessageId,
        model: selectedModel,
        dtype,
        messages: generationMessages,
        maxNewTokens: webgpuOptions?.maxTokens ?? 384,
        temperature: webgpuOptions?.temperature ?? 0.7,
        topP: webgpuOptions?.topP ?? 0.95,
        onDelta: (delta) =>
          this.appendAssistantDelta(command.threadId, assistantMessageId, turnId, delta, command.commandId),
      })
      .then((finalText) => {
        if (
          !this.activeGeneration ||
          this.activeGeneration.threadId !== command.threadId ||
          this.activeGeneration.turnId !== turnId
        ) {
          return;
        }
        this.completeAssistantMessage(
          command.threadId,
          turnId,
          assistantMessageId,
          finalText,
          command.commandId,
        );
        this.activeGeneration = null;
      })
      .catch((error: unknown) => {
        if (
          !this.activeGeneration ||
          this.activeGeneration.threadId !== command.threadId ||
          this.activeGeneration.turnId !== turnId
        ) {
          return;
        }
        this.failGeneration(
          command.threadId,
          turnId,
          assistantMessageId,
          error instanceof Error ? error : new Error("Local WebGPU generation failed."),
          command.commandId,
        );
        this.activeGeneration = null;
      });
  }

  private interruptLocalTurn(
    command: Extract<ClientOrchestrationCommand, { type: "thread.turn.interrupt" }>,
  ): void {
    const thread = this.getThread(command.threadId);
    const activeGeneration =
      this.activeGeneration &&
      this.activeGeneration.threadId === command.threadId &&
      (command.turnId === undefined || this.activeGeneration.turnId === command.turnId)
        ? this.activeGeneration
        : null;
    if (!activeGeneration) {
      return;
    }
    this.workerClient.interrupt();
    const completedAt = command.createdAt;
    const messages = thread.messages.map((message) =>
      message.id === activeGeneration.assistantMessageId
        ? {
            ...message,
            streaming: false,
            updatedAt: completedAt,
          }
        : message,
    );
    const updatedThread: OrchestrationThread = {
      ...thread,
      messages,
      latestTurn: {
        turnId: activeGeneration.turnId,
        state: "interrupted",
        requestedAt: thread.latestTurn?.requestedAt ?? completedAt,
        startedAt: thread.latestTurn?.startedAt ?? completedAt,
        completedAt,
        assistantMessageId: activeGeneration.assistantMessageId,
      },
      session: this.buildSession(command.threadId, "interrupted", thread.runtimeMode, null, completedAt),
      updatedAt: completedAt,
    };
    this.setThread(updatedThread);
    this.activeGeneration = null;
    this.status = {
      ...this.status,
      phase: "idle",
      progress: null,
      lastError: null,
    };
    this.emitStatus();
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.session-set",
        threadId: command.threadId,
        commandId: command.commandId,
        occurredAt: completedAt,
        payload: {
          threadId: command.threadId,
          session: updatedThread.session!,
        },
      }),
    );
  }

  private stopLocalSession(
    command: Extract<ClientOrchestrationCommand, { type: "thread.session.stop" }>,
  ): void {
    if (this.activeGeneration?.threadId === command.threadId) {
      this.interruptLocalTurn({
        type: "thread.turn.interrupt",
        commandId: command.commandId,
        threadId: command.threadId,
        turnId: this.activeGeneration.turnId,
        createdAt: command.createdAt,
      });
    }
    const thread = this.getThread(command.threadId);
    const updatedThread: OrchestrationThread = {
      ...thread,
      session: this.buildSession(command.threadId, "stopped", thread.runtimeMode, null, command.createdAt),
      updatedAt: command.createdAt,
    };
    this.setThread(updatedThread);
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.session-set",
        threadId: command.threadId,
        commandId: command.commandId,
        occurredAt: command.createdAt,
        payload: {
          threadId: command.threadId,
          session: updatedThread.session!,
        },
      }),
    );
  }

  private deleteLocalThread(command: Extract<ClientOrchestrationCommand, { type: "thread.delete" }>): void {
    if (this.activeGeneration?.threadId === command.threadId) {
      this.workerClient.interrupt();
      this.activeGeneration = null;
    }
    this.threadsById.delete(command.threadId);
    this.persist();
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.deleted",
        threadId: command.threadId,
        commandId: command.commandId,
        payload: {
          threadId: command.threadId,
          deletedAt: nowIso(),
        },
      }),
    );
  }

  private updateLocalThreadMeta(
    command: Extract<ClientOrchestrationCommand, { type: "thread.meta.update" }>,
  ): void {
    const thread = this.getThread(command.threadId);
    const updatedThread: OrchestrationThread = {
      ...thread,
      ...(command.title ? { title: command.title } : {}),
      ...(command.model ? { model: command.model } : {}),
      ...(command.branch !== undefined ? { branch: command.branch } : {}),
      ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
      updatedAt: nowIso(),
    };
    this.setThread(updatedThread);
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.meta-updated",
        threadId: command.threadId,
        commandId: command.commandId,
        payload: {
          threadId: command.threadId,
          ...(command.title ? { title: command.title } : {}),
          ...(command.model ? { model: command.model } : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: updatedThread.updatedAt,
        },
      }),
    );
  }

  private setLocalRuntimeMode(
    command: Extract<ClientOrchestrationCommand, { type: "thread.runtime-mode.set" }>,
  ): void {
    const thread = this.getThread(command.threadId);
    const updatedThread = {
      ...thread,
      runtimeMode: command.runtimeMode,
      updatedAt: command.createdAt,
    };
    this.setThread(updatedThread);
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.runtime-mode-set",
        threadId: command.threadId,
        commandId: command.commandId,
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: command.createdAt,
        },
      }),
    );
  }

  private setLocalInteractionMode(
    command: Extract<ClientOrchestrationCommand, { type: "thread.interaction-mode.set" }>,
  ): void {
    const thread = this.getThread(command.threadId);
    const updatedThread = {
      ...thread,
      interactionMode: command.interactionMode,
      updatedAt: command.createdAt,
    };
    this.setThread(updatedThread);
    this.emitDomainEvent(
      createThreadEvent({
        type: "thread.interaction-mode-set",
        threadId: command.threadId,
        commandId: command.commandId,
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: command.createdAt,
        },
      }),
    );
  }
}

const localWebGpuController = new LocalWebGpuOrchestrationController();

export function getLocalWebGpuStatusSnapshot(): LocalWebGpuStatusSnapshot {
  return localWebGpuController.getStatusSnapshot();
}

export function subscribeLocalWebGpuStatus(listener: () => void): () => void {
  return localWebGpuController.subscribeStatus(listener);
}

export function clearLocalWebGpuState(): Promise<void> {
  return localWebGpuController.clearPersistedState();
}

export function createHybridNativeApi(baseApi: NativeApi): NativeApi {
  const domainEventListeners = new Set<(event: OrchestrationEvent) => void>();
  let snapshotSequence = 0;

  const emitMappedDomainEvent = (event: OrchestrationEvent) => {
    snapshotSequence += 1;
    const mappedEvent = {
      ...event,
      sequence: snapshotSequence,
    } satisfies OrchestrationEvent;
    for (const listener of domainEventListeners) {
      listener(mappedEvent);
    }
  };

  baseApi.orchestration.onDomainEvent((event) => {
    emitMappedDomainEvent(event);
  });
  localWebGpuController.subscribeDomainEvents((event) => {
    emitMappedDomainEvent(event);
  });

  return {
    ...baseApi,
    orchestration: {
      ...baseApi.orchestration,
      getSnapshot: async () => {
        const baseSnapshot = await baseApi.orchestration.getSnapshot();
        snapshotSequence = Math.max(snapshotSequence, baseSnapshot.snapshotSequence);
        return localWebGpuController.mergeSnapshot(baseSnapshot, snapshotSequence);
      },
      dispatchCommand: (command) => localWebGpuController.dispatchCommand(baseApi, command),
      onDomainEvent: (callback) => {
        domainEventListeners.add(callback);
        return () => {
          domainEventListeners.delete(callback);
        };
      },
    },
  };
}

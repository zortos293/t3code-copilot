import {
  MessageId,
  ProjectId,
  ThreadId,
  type NativeApi,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockWorkerMessage =
  | {
      type: "generate";
      requestId: string;
      model: string;
      dtype: string;
      messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    }
  | { type: "dispose" };

class MockWorker {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  addEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  postMessage(message: MockWorkerMessage): void {
    if (message.type !== "generate") {
      return;
    }
    queueMicrotask(() => {
      this.emit({
        type: "status",
        status: "ready",
        model: message.model,
        dtype: message.dtype,
      });
      this.emit({
        type: "text-delta",
        requestId: message.requestId,
        delta: "Hello from WebGPU",
      });
      this.emit({
        type: "complete",
        requestId: message.requestId,
        text: "Hello from WebGPU",
      });
    });
  }

  terminate(): void {}

  private emit(data: unknown): void {
    for (const listener of this.listeners) {
      listener({ data } as MessageEvent<unknown>);
    }
  }
}

function createLocalStorageMock() {
  const storage = new Map<string, string>();
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  };
}

function createBaseApi(): NativeApi {
  return {
    dialogs: { pickFolder: vi.fn(), confirm: vi.fn() },
    terminal: {
      open: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      clear: vi.fn(),
      restart: vi.fn(),
      close: vi.fn(),
      onEvent: vi.fn(() => () => {}),
    },
    projects: {
      searchEntries: vi.fn(),
      writeFile: vi.fn(),
    },
    shell: {
      openInEditor: vi.fn(),
      openExternal: vi.fn(),
    },
    git: {
      pull: vi.fn(),
      status: vi.fn(),
      runStackedAction: vi.fn(),
      listBranches: vi.fn(),
      createWorktree: vi.fn(),
      removeWorktree: vi.fn(),
      createBranch: vi.fn(),
      checkout: vi.fn(),
      init: vi.fn(),
      resolvePullRequest: vi.fn(),
      preparePullRequestThread: vi.fn(),
    },
    contextMenu: {
      show: vi.fn(),
    },
    server: {
      getConfig: vi.fn(),
      upsertKeybinding: vi.fn(),
      searchHuggingFaceModels: vi.fn(),
    },
    orchestration: {
      getSnapshot: vi.fn(async () => ({
        snapshotSequence: 7,
        updatedAt: "2026-03-10T00:00:00.000Z",
        projects: [
          {
            id: ProjectId.makeUnsafe("project-1"),
            title: "Project",
            workspaceRoot: "/tmp/project",
            defaultModel: null,
            scripts: [],
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            deletedAt: null,
          },
        ],
        threads: [],
      })),
      dispatchCommand: vi.fn(async () => ({ sequence: 1 })),
      getTurnDiff: vi.fn(),
      getFullThreadDiff: vi.fn(),
      replayEvents: vi.fn(),
      onDomainEvent: vi.fn(() => () => {}),
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  const localStorageMock = createLocalStorageMock();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: localStorageMock,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      Worker: MockWorker,
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: {} },
  });
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: MockWorker,
  });
});

afterEach(async () => {
  const { clearLocalWebGpuState } = await import("./localWebGpuOrchestration");
  await clearLocalWebGpuState();
  vi.restoreAllMocks();
});

describe("localWebGpuOrchestration", () => {
  it("returns the same status snapshot reference when nothing changed", async () => {
    const { getLocalWebGpuStatusSnapshot } = await import("./localWebGpuOrchestration");

    const first = getLocalWebGpuStatusSnapshot();
    const second = getLocalWebGpuStatusSnapshot();

    expect(second).toBe(first);
  });

  it("routes webgpu turns locally and merges them into snapshots", async () => {
    const { createHybridNativeApi, getLocalWebGpuStatusSnapshot } = await import(
      "./localWebGpuOrchestration"
    );
    const { useComposerDraftStore } = await import("./composerDraftStore");
    const api = createHybridNativeApi(createBaseApi());
    const threadId = ThreadId.makeUnsafe("local-thread-1");
    const projectId = ProjectId.makeUnsafe("project-1");
    const initialStatus = getLocalWebGpuStatusSnapshot();
    useComposerDraftStore.getState().setProjectDraftThreadId(projectId, threadId, {
      createdAt: "2026-03-10T00:00:00.000Z",
      envMode: "local",
    });

    const receivedEvents: OrchestrationEvent[] = [];
    api.orchestration.onDomainEvent((event) => {
      receivedEvents.push(event);
    });

    await api.orchestration.dispatchCommand({
      type: "thread.turn.start",
      commandId: "command-1" as never,
      threadId,
      message: {
        messageId: MessageId.makeUnsafe("message-1"),
        role: "user",
        text: "Say hi",
        attachments: [],
      },
      provider: "webgpu",
      model: "onnx-community/Qwen2.5-0.5B-Instruct",
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-03-10T00:00:00.000Z",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = await api.orchestration.getSnapshot();
    const thread = snapshot.threads.find((entry) => entry.id === threadId);
    const finalStatus = getLocalWebGpuStatusSnapshot();

    expect(thread).toBeDefined();
    expect(thread?.session?.providerName).toBe("webgpu");
    expect(thread?.messages.map((message) => message.text)).toEqual(["Say hi", "Hello from WebGPU"]);
    expect(thread?.messages.at(-1)?.streaming).toBe(false);
    expect(receivedEvents.some((event) => event.type === "thread.turn-start-requested")).toBe(true);
    expect(receivedEvents.some((event) => event.type === "thread.session-set")).toBe(true);
    expect(finalStatus).not.toBe(initialStatus);
    expect(finalStatus.phase).toBe("ready");
    expect(finalStatus.model).toBe("onnx-community/Qwen2.5-0.5B-Instruct");
  });
});

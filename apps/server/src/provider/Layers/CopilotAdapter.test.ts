import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ThreadId } from "@t3tools/contracts";
import { type ModelInfo, type SessionEvent } from "@github/copilot-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, it, vi } from "@effect/vitest";

import { Effect, Fiber, Layer, Stream } from "effect";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { CopilotAdapter } from "../Services/CopilotAdapter.ts";
import { makeCopilotAdapterLive } from "./CopilotAdapter.ts";

const asThreadId = (value: string): ThreadId => ThreadId.make(value);

class FakeCopilotSession {
  public readonly sessionId: string;

  public readonly modeSetImpl = vi.fn(
    async ({ mode }: { mode: "interactive" | "plan" | "autopilot" }) => ({
      mode,
    }),
  );

  public readonly planReadImpl = vi.fn(
    async (): Promise<{
      exists: boolean;
      content: string | null;
      path: string | null;
    }> => ({
      exists: false,
      content: null,
      path: null,
    }),
  );

  public readonly sendImpl = vi.fn(
    async (_options: { prompt: string; attachments?: unknown; mode?: string }) => "message-1",
  );

  public readonly abortImpl = vi.fn(async () => undefined);
  public readonly destroyImpl = vi.fn(async () => undefined);
  public readonly getMessagesImpl = vi.fn(async () => [] as SessionEvent[]);

  private readonly handlers = new Set<(event: SessionEvent) => void>();

  public readonly rpc = {
    mode: {
      set: this.modeSetImpl,
    },
    plan: {
      read: this.planReadImpl,
    },
  };

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  on(handler: (event: SessionEvent) => void) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  send(options: { prompt: string; attachments?: unknown; mode?: string }) {
    return this.sendImpl(options);
  }

  abort() {
    return this.abortImpl();
  }

  destroy() {
    return this.destroyImpl();
  }

  getMessages() {
    return this.getMessagesImpl();
  }

  emit(event: SessionEvent) {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}

class FakeCopilotClient {
  public readonly startImpl = vi.fn(async () => undefined);
  public readonly listModelsImpl = vi.fn<() => Promise<ModelInfo[]>>(async () => []);
  public readonly createSessionImpl = vi.fn(async (_config: unknown) => this.session);
  public readonly resumeSessionImpl = vi.fn(
    async (_sessionId: string, _config: unknown) => this.session,
  );
  public readonly stopImpl = vi.fn(async () => [] as Error[]);

  constructor(private readonly session: FakeCopilotSession) {}

  start() {
    return this.startImpl();
  }

  listModels() {
    return this.listModelsImpl();
  }

  createSession(config: unknown) {
    return this.createSessionImpl(config);
  }

  resumeSession(sessionId: string, config: unknown) {
    return this.resumeSessionImpl(sessionId, config);
  }

  stop() {
    return this.stopImpl();
  }
}

const modeSession = new FakeCopilotSession("copilot-session-mode");
const modeClient = new FakeCopilotClient(modeSession);
const modeLayer = it.layer(
  makeCopilotAdapterLive({
    clientFactory: () => modeClient,
  }).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(NodeServices.layer),
  ),
);

modeLayer("CopilotAdapterLive interaction mode", (it) => {
  it.effect("switches the Copilot session mode when interactionMode changes", () =>
    Effect.gen(function* () {
      modeSession.modeSetImpl.mockClear();
      modeSession.sendImpl.mockClear();

      const adapter = yield* CopilotAdapter;
      const session = yield* adapter.startSession({
        provider: "copilot",
        threadId: asThreadId("thread-mode"),
        runtimeMode: "full-access",
      });

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "Plan the work",
        interactionMode: "plan",
        attachments: [],
      });
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "Now execute it",
        interactionMode: "default",
        attachments: [],
      });

      assert.deepStrictEqual(modeSession.modeSetImpl.mock.calls, [
        [{ mode: "plan" }],
        [{ mode: "interactive" }],
      ]);
      assert.equal(modeSession.sendImpl.mock.calls[0]?.[0]?.mode, "immediate");
      assert.equal(modeSession.sendImpl.mock.calls[1]?.[0]?.mode, "immediate");
    }),
  );
});

const planSession = new FakeCopilotSession("copilot-session-plan");
const planClient = new FakeCopilotClient(planSession);
const planLayer = it.layer(
  makeCopilotAdapterLive({
    clientFactory: () => planClient,
  }).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(NodeServices.layer),
  ),
);

planLayer("CopilotAdapterLive proposed plan events", (it) => {
  it.effect("emits a proposed-plan completion event from Copilot plan updates", () =>
    Effect.gen(function* () {
      planSession.modeSetImpl.mockClear();
      planSession.planReadImpl.mockReset();
      planSession.planReadImpl.mockResolvedValue({
        exists: true,
        content: "# Ship it\n\n- first\n- second",
        path: "/tmp/copilot-session-plan/plan.md",
      });

      const adapter = yield* CopilotAdapter;
      const session = yield* adapter.startSession({
        provider: "copilot",
        threadId: asThreadId("thread-plan"),
        runtimeMode: "full-access",
      });

      yield* Stream.take(adapter.streamEvents, 4).pipe(Stream.runDrain);

      const turn = yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "Draft a plan",
        interactionMode: "plan",
        attachments: [],
      });

      const eventsFiber = yield* Stream.take(adapter.streamEvents, 2).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      planSession.emit({
        id: "evt-plan-changed",
        timestamp: new Date().toISOString(),
        parentId: null,
        type: "session.plan_changed",
        data: {
          operation: "update",
        },
      } satisfies SessionEvent);

      const events = Array.from(yield* Fiber.join(eventsFiber));
      assert.equal(events[0]?.type, "turn.plan.updated");
      if (events[0]?.type === "turn.plan.updated") {
        assert.equal(events[0].turnId, turn.turnId);
        assert.equal(events[0].payload.explanation, "Plan updated");
      }

      assert.equal(events[1]?.type, "turn.proposed.completed");
      if (events[1]?.type === "turn.proposed.completed") {
        assert.equal(events[1].turnId, turn.turnId);
        assert.equal(events[1].payload.planMarkdown, "# Ship it\n\n- first\n- second");
      }
    }),
  );
});

const mcpSession = new FakeCopilotSession("copilot-session-mcp");
const mcpClient = new FakeCopilotClient(mcpSession);
it.effect("CopilotAdapterLive MCP config loading", () =>
  Effect.suspend(() =>
    Effect.sync(() => mkdtempSync(path.join(os.tmpdir(), "t3-copilot-mcp-"))).pipe(
      Effect.flatMap((configDir) => {
        const layer = makeCopilotAdapterLive({
          clientFactory: () => mcpClient,
        }).pipe(
          Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
          Layer.provideMerge(
            ServerSettingsService.layerTest({
              providers: {
                copilot: {
                  homePath: configDir,
                },
              },
            }),
          ),
          Layer.provideMerge(NodeServices.layer),
        );

        return Effect.gen(function* () {
          try {
            writeFileSync(
              path.join(configDir, "mcp-config.json"),
              JSON.stringify({
                mcpServers: {
                  "local-badge-repro": {
                    command: "node",
                    args: ["/tmp/t3code-local-mcp-reproduction/dist/index.js"],
                  },
                },
              }),
              "utf8",
            );
            mcpClient.createSessionImpl.mockClear();
            mcpClient.listModelsImpl.mockImplementation(async () => [
              {
                id: "gpt-5",
                name: "GPT-5",
                capabilities: {} as ModelInfo["capabilities"],
                supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
              },
            ]);

            const adapter = yield* CopilotAdapter;
            yield* adapter.startSession({
              provider: "copilot",
              threadId: asThreadId("thread-mcp"),
              runtimeMode: "full-access",
              modelSelection: {
                provider: "copilot",
                model: "gpt-5",
              },
            });

            const config = mcpClient.createSessionImpl.mock.calls[0]?.[0] as
              | {
                  configDir?: string;
                  mcpServers?: Record<string, unknown>;
                }
              | undefined;

            assert.equal(config?.configDir, configDir);
            assert.deepStrictEqual(config?.mcpServers, {
              "local-badge-repro": {
                type: "local",
                command: "node",
                args: ["/tmp/t3code-local-mcp-reproduction/dist/index.js"],
                tools: ["*"],
              },
            });
          } finally {
            rmSync(configDir, { recursive: true, force: true });
          }
        }).pipe(Effect.provide(layer));
      }),
    ),
  ),
);

afterAll(() => {
  void modeSession.destroy();
  void modeClient.stop();
  void planSession.destroy();
  void planClient.stop();
  void mcpSession.destroy();
  void mcpClient.stop();
});

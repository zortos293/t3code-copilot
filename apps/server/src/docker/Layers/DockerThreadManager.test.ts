import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../../processRunner.ts", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner.ts";
import { DockerThreadManager } from "../Services/DockerThreadManager.ts";
import { DockerThreadManagerLive } from "./DockerThreadManager.ts";

const mockedRunProcess = vi.mocked(runProcess);
const layer = it.layer(DockerThreadManagerLive);

afterEach(() => {
  mockedRunProcess.mockReset();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
});

layer("DockerThreadManagerLive", (it) => {
  it.effect("builds a docker codex launch plan and pulls missing images", () =>
    Effect.gen(function* () {
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.OPENAI_BASE_URL = "https://example.test/v1";

      mockedRunProcess
        .mockResolvedValueOnce({
          stdout: "26.1.0",
          stderr: "",
          code: 0,
          signal: null,
          timedOut: false,
        })
        .mockResolvedValueOnce({
          stdout: "",
          stderr: "missing image",
          code: 1,
          signal: null,
          timedOut: false,
        })
        .mockResolvedValueOnce({
          stdout: "pulled",
          stderr: "",
          code: 0,
          signal: null,
          timedOut: false,
        });

      const manager = yield* DockerThreadManager;
      const plan = yield* manager.ensureCodexLaunchPlan({
        threadId: "Thread Docker / 123",
        hostWorkspacePath: "/tmp/project",
        image: "ghcr.io/t3tools/codex:latest",
        workspacePath: "/workspace",
        network: "bridge",
        codexBinaryPath: "/usr/local/bin/codex",
        codexHomePath: "/tmp/codex-home",
      });

      assert.equal(plan.command, "docker");
      assert.equal(plan.cwd, "/tmp/project");
      assert.deepEqual(plan.metadata, {
        containerName: "t3code-thread-thread-docker-123",
        image: "ghcr.io/t3tools/codex:latest",
        workspacePath: "/workspace",
        hostWorkspacePath: "/tmp/project",
        network: "bridge",
      });
      expect(plan.args).toEqual(
        expect.arrayContaining([
          "run",
          "--rm",
          "--init",
          "-i",
          "--name",
          "t3code-thread-thread-docker-123",
          "--label",
          "dev.t3tools.thread-id=Thread Docker / 123",
          "--label",
          "dev.t3tools.runtime=docker-thread",
          "--mount",
          "type=bind,src=/tmp/project,dst=/workspace",
          "--workdir",
          "/workspace",
          "--network",
          "bridge",
          "--mount",
          "type=bind,src=/tmp/codex-home,dst=/t3code/codex-home",
          "-e",
          "CODEX_HOME=/t3code/codex-home",
          "-e",
          "OPENAI_API_KEY=sk-test",
          "-e",
          "OPENAI_BASE_URL=https://example.test/v1",
          "ghcr.io/t3tools/codex:latest",
          "/usr/local/bin/codex",
          "app-server",
        ]),
      );

      expect(mockedRunProcess).toHaveBeenNthCalledWith(
        1,
        "docker",
        ["version", "--format", "{{.Server.Version}}"],
        expect.objectContaining({
          timeoutMs: 10_000,
          outputMode: "truncate",
        }),
      );
      expect(mockedRunProcess).toHaveBeenNthCalledWith(
        2,
        "docker",
        ["image", "inspect", "ghcr.io/t3tools/codex:latest"],
        expect.objectContaining({
          timeoutMs: 10_000,
          allowNonZeroExit: true,
          outputMode: "truncate",
        }),
      );
      expect(mockedRunProcess).toHaveBeenNthCalledWith(
        3,
        "docker",
        ["pull", "ghcr.io/t3tools/codex:latest"],
        expect.objectContaining({
          timeoutMs: 300_000,
          outputMode: "truncate",
        }),
      );
    }),
  );

  it.effect("skips image pull when the docker image already exists", () =>
    Effect.gen(function* () {
      mockedRunProcess
        .mockResolvedValueOnce({
          stdout: "26.1.0",
          stderr: "",
          code: 0,
          signal: null,
          timedOut: false,
        })
        .mockResolvedValueOnce({
          stdout: "[]",
          stderr: "",
          code: 0,
          signal: null,
          timedOut: false,
        });

      const manager = yield* DockerThreadManager;
      yield* manager.ensureCodexLaunchPlan({
        threadId: "thread-existing-image",
        hostWorkspacePath: "/tmp/project",
        image: "ghcr.io/t3tools/codex:cached",
        workspacePath: "/workspace",
        network: "none",
      });

      expect(mockedRunProcess).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect("best-effort stops containers even when docker rm fails", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockRejectedValueOnce(new Error("docker rm failed"));

      const manager = yield* DockerThreadManager;
      yield* manager.stopContainer("t3code-thread-thread-1");

      expect(mockedRunProcess).toHaveBeenCalledWith(
        "docker",
        ["rm", "-f", "t3code-thread-thread-1"],
        expect.objectContaining({
          timeoutMs: 10_000,
          allowNonZeroExit: true,
          outputMode: "truncate",
        }),
      );
    }),
  );
});

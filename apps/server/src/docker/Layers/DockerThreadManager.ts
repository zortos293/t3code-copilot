import { Effect, Layer } from "effect";

import { runProcess } from "../../processRunner.ts";
import {
  DockerThreadManager,
  DockerThreadManagerError,
  type DockerThreadLaunchPlan,
  type DockerThreadManagerShape,
} from "../Services/DockerThreadManager.ts";

const DEFAULT_CONTAINER_PREFIX = "t3code-thread";
const DEFAULT_CODEX_HOME_PATH = "/t3code/codex-home";
const FORWARDED_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT_ID",
];

function sanitizeContainerName(threadId: string): string {
  const normalized = threadId.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-");
  const suffix = normalized.replace(/^-+|-+$/g, "").slice(0, 40) || "thread";
  return `${DEFAULT_CONTAINER_PREFIX}-${suffix}`;
}

function toDockerError(operation: string, cause: unknown, fallback: string): DockerThreadManagerError {
  return new DockerThreadManagerError({
    operation,
    detail: cause instanceof Error ? cause.message : fallback,
    cause,
  });
}

function forwardedDockerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of FORWARDED_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }
  return env;
}

const makeDockerThreadManager = Effect.sync(() => {
  const ensureDockerAvailable = Effect.tryPromise({
    try: async () => {
      await runProcess("docker", ["version", "--format", "{{.Server.Version}}"], {
        timeoutMs: 10_000,
        outputMode: "truncate",
      });
    },
    catch: (cause) =>
      toDockerError(
        "DockerThreadManager.ensureDockerAvailable",
        cause,
        "Docker is unavailable.",
      ),
  });

  const ensureImage = (image: string) =>
    Effect.tryPromise({
      try: async () => {
        const inspect = await runProcess("docker", ["image", "inspect", image], {
          timeoutMs: 10_000,
          allowNonZeroExit: true,
          outputMode: "truncate",
        });
        if (inspect.code === 0) {
          return;
        }
        await runProcess("docker", ["pull", image], {
          timeoutMs: 300_000,
          outputMode: "truncate",
        });
      },
      catch: (cause) =>
        toDockerError(
          "DockerThreadManager.ensureImage",
          cause,
          `Unable to prepare Docker image '${image}'.`,
        ),
    });

  const ensureCodexLaunchPlan: DockerThreadManagerShape["ensureCodexLaunchPlan"] = (input) =>
    Effect.gen(function* () {
      yield* ensureDockerAvailable;
      yield* ensureImage(input.image);

      const containerName = sanitizeContainerName(input.threadId);
      const args = [
        "run",
        "--rm",
        "--init",
        "-i",
        "--name",
        containerName,
        "--label",
        `dev.t3tools.thread-id=${input.threadId}`,
        "--label",
        "dev.t3tools.runtime=docker-thread",
        "--mount",
        `type=bind,src=${input.hostWorkspacePath},dst=${input.workspacePath}`,
        "--workdir",
        input.workspacePath,
        "--network",
        input.network,
      ];

      if (typeof process.getuid === "function" && typeof process.getgid === "function") {
        args.push("--user", `${process.getuid()}:${process.getgid()}`);
      }

      if (input.codexHomePath) {
        args.push(
          "--mount",
          `type=bind,src=${input.codexHomePath},dst=${DEFAULT_CODEX_HOME_PATH}`,
          "-e",
          `CODEX_HOME=${DEFAULT_CODEX_HOME_PATH}`,
        );
      }

      for (const [key, value] of Object.entries(forwardedDockerEnv())) {
        if (!value) continue;
        args.push("-e", `${key}=${value}`);
      }

      args.push(input.image, input.codexBinaryPath ?? "codex", "app-server");

      const metadata = {
        containerName,
        image: input.image,
        workspacePath: input.workspacePath,
        hostWorkspacePath: input.hostWorkspacePath,
        network: input.network,
      } satisfies DockerThreadLaunchPlan["metadata"];

      return {
        command: "docker",
        args,
        cwd: input.hostWorkspacePath,
        env: process.env,
        metadata,
      } satisfies DockerThreadLaunchPlan;
    });

  const stopContainer: DockerThreadManagerShape["stopContainer"] = (containerName) =>
    Effect.tryPromise({
      try: async () => {
        await runProcess("docker", ["rm", "-f", containerName], {
          timeoutMs: 10_000,
          allowNonZeroExit: true,
          outputMode: "truncate",
        });
      },
      catch: (cause) =>
        toDockerError(
          "DockerThreadManager.stopContainer",
          cause,
          `Unable to stop Docker container '${containerName}'.`,
        ),
    }).pipe(Effect.ignore);

  return {
    ensureCodexLaunchPlan,
    stopContainer,
  } satisfies DockerThreadManagerShape;
});

export const DockerThreadManagerLive = Layer.effect(DockerThreadManager, makeDockerThreadManager);

import {
  DockerExecutionMetadata,
  type DockerProviderNetworkMode,
} from "@t3tools/contracts";
import { Effect, Schema, ServiceMap } from "effect";

export class DockerThreadManagerError extends Schema.TaggedErrorClass<DockerThreadManagerError>()(
  "DockerThreadManagerError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Docker thread manager error in ${this.operation}: ${this.detail}`;
  }
}

export interface DockerThreadLaunchPlan {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly metadata: typeof DockerExecutionMetadata.Type;
}

export interface DockerThreadManagerShape {
  readonly ensureCodexLaunchPlan: (input: {
    readonly threadId: string;
    readonly hostWorkspacePath: string;
    readonly image: string;
    readonly workspacePath: string;
    readonly network: DockerProviderNetworkMode;
    readonly codexBinaryPath?: string;
    readonly codexHomePath?: string;
  }) => Effect.Effect<DockerThreadLaunchPlan, DockerThreadManagerError>;
  readonly stopContainer: (containerName: string) => Effect.Effect<void>;
}

export class DockerThreadManager extends ServiceMap.Service<
  DockerThreadManager,
  DockerThreadManagerShape
>()("t3/docker/Services/DockerThreadManager") {}

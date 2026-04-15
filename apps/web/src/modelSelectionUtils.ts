import {
  type ClaudeModelOptions,
  type CodexModelOptions,
  type CopilotModelOptions,
  type ModelSelection,
  type ProviderKind,
  type ProviderModelOptions,
} from "@t3tools/contracts";

type ModelSelectionByProvider = {
  codex: Extract<ModelSelection, { provider: "codex" }>;
  copilot: Extract<ModelSelection, { provider: "copilot" }>;
  claudeAgent: Extract<ModelSelection, { provider: "claudeAgent" }>;
};

export type ModelSelectionOptionsForProvider<P extends ProviderKind> =
  ModelSelectionByProvider[P]["options"];

export function getProviderModelOptions<P extends ProviderKind>(
  provider: P,
  options: ProviderModelOptions | null | undefined,
): ModelSelectionOptionsForProvider<P> | undefined {
  if (provider === "codex") {
    return options?.codex as ModelSelectionOptionsForProvider<P> | undefined;
  }
  if (provider === "copilot") {
    return options?.copilot as ModelSelectionOptionsForProvider<P> | undefined;
  }
  return options?.claudeAgent as ModelSelectionOptionsForProvider<P> | undefined;
}

export function createModelSelection<P extends ProviderKind>(input: {
  provider: P;
  model: string;
  options?: ModelSelectionOptionsForProvider<P>;
}): ModelSelectionByProvider[P] {
  if (input.provider === "codex") {
    return {
      provider: "codex",
      model: input.model,
      ...(input.options !== undefined ? { options: input.options as CodexModelOptions } : {}),
    } as ModelSelectionByProvider[P];
  }
  if (input.provider === "copilot") {
    return {
      provider: "copilot",
      model: input.model,
      ...(input.options !== undefined ? { options: input.options as CopilotModelOptions } : {}),
    } as ModelSelectionByProvider[P];
  }
  return {
    provider: "claudeAgent",
    model: input.model,
    ...(input.options !== undefined ? { options: input.options as ClaudeModelOptions } : {}),
  } as ModelSelectionByProvider[P];
}

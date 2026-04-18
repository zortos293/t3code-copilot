/**
 * RoutingTextGeneration – Dispatches text generation requests to either the
 * Codex CLI or Claude CLI implementation based on the provider in each
 * request input.
 *
 * When `modelSelection.provider` is `"claudeAgent"` the request is forwarded to
 * the Claude layer; for any other value (including the default `undefined`) it
 * falls through to the Codex layer.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer, Context } from "effect";
import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ProviderKind,
  type ModelSelection,
} from "@t3tools/contracts";
import { createModelSelection, resolveModelSlugForProvider } from "@t3tools/shared/model";

import {
  TextGeneration,
  type TextGenerationProvider,
  type TextGenerationShape,
} from "../Services/TextGeneration.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";
import { CursorTextGenerationLive } from "./CursorTextGeneration.ts";
import { OpenCodeTextGenerationLive } from "./OpenCodeTextGeneration.ts";

// ---------------------------------------------------------------------------
// Internal service tags so both concrete layers can coexist.
// ---------------------------------------------------------------------------

class CodexTextGen extends Context.Service<CodexTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends Context.Service<ClaudeTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/ClaudeTextGen",
) {}

class CursorTextGen extends Context.Service<CursorTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/CursorTextGen",
) {}

class OpenCodeTextGen extends Context.Service<OpenCodeTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/OpenCodeTextGen",
) {}

export const resolveTextGenerationProvider = (
  provider: ProviderKind | undefined,
): TextGenerationProvider =>
  provider === "claudeAgent" || provider === "cursor" || provider === "opencode"
    ? provider
    : "codex";

export const normalizeTextGenerationModelSelection = (
  modelSelection: ModelSelection,
): ModelSelection => {
  const provider = resolveTextGenerationProvider(modelSelection.provider);
  if (provider === modelSelection.provider) {
    return createModelSelection(
      provider,
      resolveModelSlugForProvider(provider, modelSelection.model),
      modelSelection.options,
    );
  }

  if (modelSelection.provider === "copilot") {
    const options = modelSelection.options?.reasoningEffort
      ? { reasoningEffort: modelSelection.options.reasoningEffort }
      : undefined;
    return createModelSelection(
      "codex",
      DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
      options,
    );
  }

  return createModelSelection(provider, DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[provider]);
};

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const codex = yield* CodexTextGen;
  const claude = yield* ClaudeTextGen;
  const cursor = yield* CursorTextGen;
  const openCode = yield* OpenCodeTextGen;

  const route = (provider?: TextGenerationProvider): TextGenerationShape =>
    provider === "claudeAgent"
      ? claude
      : provider === "opencode"
        ? openCode
        : provider === "cursor"
          ? cursor
          : codex;
  const normalizeInput = <
    TInput extends {
      readonly modelSelection: ModelSelection;
    },
  >(
    input: TInput,
  ): { readonly provider: TextGenerationProvider; readonly input: TInput } => {
    const normalizedModelSelection = normalizeTextGenerationModelSelection(input.modelSelection);
    return {
      provider: resolveTextGenerationProvider(normalizedModelSelection.provider),
      input:
        normalizedModelSelection === input.modelSelection
          ? input
          : {
              ...input,
              modelSelection: normalizedModelSelection,
            },
    };
  };

  return {
    generateCommitMessage: (input) => {
      const normalized = normalizeInput(input);
      return route(normalized.provider).generateCommitMessage(normalized.input);
    },
    generatePrContent: (input) => {
      const normalized = normalizeInput(input);
      return route(normalized.provider).generatePrContent(normalized.input);
    },
    generateBranchName: (input) => {
      const normalized = normalizeInput(input);
      return route(normalized.provider).generateBranchName(normalized.input);
    },
    generateThreadTitle: (input) => {
      const normalized = normalizeInput(input);
      return route(normalized.provider).generateThreadTitle(normalized.input);
    },
  } satisfies TextGenerationShape;
});

const InternalCodexLayer = Layer.effect(
  CodexTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CodexTextGenerationLive));

const InternalClaudeLayer = Layer.effect(
  ClaudeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(ClaudeTextGenerationLive));

const InternalCursorLayer = Layer.effect(
  CursorTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CursorTextGenerationLive));

const InternalOpenCodeLayer = Layer.effect(
  OpenCodeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(OpenCodeTextGenerationLive));

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(
  Layer.provide(InternalCodexLayer),
  Layer.provide(InternalClaudeLayer),
  Layer.provide(InternalCursorLayer),
  Layer.provide(InternalOpenCodeLayer),
);

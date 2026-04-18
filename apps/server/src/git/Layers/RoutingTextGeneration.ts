/**
 * RoutingTextGeneration – Dispatches text generation requests to either the
 * Codex CLI or Claude CLI implementation based on the provider in each
 * request input.
 *
 * When `modelSelection.provider` is `"claudeAgent"` the request is forwarded to
 * the Claude layer; unsupported or absent providers fall back to the Codex
 * implementation as a defensive last resort.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer, Context } from "effect";

import {
  TextGeneration,
  isTextGenerationProvider,
  type TextGenerationProvider,
  type TextGenerationShape,
} from "../Services/TextGeneration.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";

// ---------------------------------------------------------------------------
// Internal service tags so both concrete layers can coexist.
// ---------------------------------------------------------------------------

class CodexTextGen extends Context.Service<CodexTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends Context.Service<ClaudeTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/ClaudeTextGen",
) {}

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const codex = yield* CodexTextGen;
  const claude = yield* ClaudeTextGen;

  const route = (provider?: TextGenerationProvider): TextGenerationShape => {
    if (provider === "claudeAgent") {
      return claude;
    }
    return codex;
  };

  const resolveProvider = (provider: string | undefined): TextGenerationProvider =>
    isTextGenerationProvider(provider as never) ? (provider as TextGenerationProvider) : "codex";

  return {
    generateCommitMessage: (input) =>
      route(resolveProvider(input.modelSelection.provider)).generateCommitMessage(input),
    generatePrContent: (input) =>
      route(resolveProvider(input.modelSelection.provider)).generatePrContent(input),
    generateBranchName: (input) =>
      route(resolveProvider(input.modelSelection.provider)).generateBranchName(input),
    generateThreadTitle: (input) =>
      route(resolveProvider(input.modelSelection.provider)).generateThreadTitle(input),
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

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(Layer.provide(InternalCodexLayer), Layer.provide(InternalClaudeLayer));

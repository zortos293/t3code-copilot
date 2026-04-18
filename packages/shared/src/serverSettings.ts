import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { Schema } from "effect";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";

const ServerSettingsJson = fromLenientJson(ServerSettings);

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  try {
    const decoded = Schema.decodeUnknownSync(ServerSettingsJson)(raw);
    return extractPersistedServerObservabilitySettings(decoded);
  } catch {
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }
}

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(patch && (patch.provider !== undefined || patch.model !== undefined));
}

/**
 * Applies a server settings patch while treating textGenerationModelSelection as
 * replace-on-provider/model updates. This prevents stale nested options from
 * surviving a reset patch that intentionally omits options.
 */
export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const next = deepMerge(current, patch);
  if (!selectionPatch || !shouldReplaceTextGenerationModelSelection(selectionPatch)) {
    return next;
  }

  const currentProvider = current.textGenerationModelSelection.provider;
  const provider = selectionPatch.provider ?? currentProvider;
  const model =
    selectionPatch.model ??
    (selectionPatch.provider !== undefined && selectionPatch.provider !== currentProvider
      ? DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[provider]
      : current.textGenerationModelSelection.model);
  if (provider === "codex") {
    const textGenerationModelSelection = selectionPatch.options
      ? ({
          provider: "codex",
          model,
          options: selectionPatch.options as Extract<
            ServerSettings["textGenerationModelSelection"],
            { provider: "codex" }
          >["options"],
        } as Extract<ServerSettings["textGenerationModelSelection"], { provider: "codex" }>)
      : ({ provider: "codex", model } as Extract<
          ServerSettings["textGenerationModelSelection"],
          { provider: "codex" }
        >);
    return {
      ...next,
      textGenerationModelSelection,
    };
  }
  if (provider === "copilot") {
    const textGenerationModelSelection = selectionPatch.options
      ? ({
          provider: "copilot",
          model,
          options: selectionPatch.options as Extract<
            ServerSettings["textGenerationModelSelection"],
            { provider: "copilot" }
          >["options"],
        } as Extract<ServerSettings["textGenerationModelSelection"], { provider: "copilot" }>)
      : ({ provider: "copilot", model } as Extract<
          ServerSettings["textGenerationModelSelection"],
          { provider: "copilot" }
        >);
    return {
      ...next,
      textGenerationModelSelection,
    };
  }
  const textGenerationModelSelection = selectionPatch.options
    ? ({
        provider: "claudeAgent",
        model,
        options: selectionPatch.options as Extract<
          ServerSettings["textGenerationModelSelection"],
          { provider: "claudeAgent" }
        >["options"],
      } as Extract<ServerSettings["textGenerationModelSelection"], { provider: "claudeAgent" }>)
    : ({ provider: "claudeAgent", model } as Extract<
        ServerSettings["textGenerationModelSelection"],
        { provider: "claudeAgent" }
      >);
  return {
    ...next,
    textGenerationModelSelection,
  };
}

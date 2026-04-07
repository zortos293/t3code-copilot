import type {
  CopilotSettings,
  ModelCapabilities,
  ServerProvider,
  ServerProviderModel,
} from "@t3tools/contracts";
import { CopilotClient, type CopilotClientOptions, type ModelInfo } from "@github/copilot-sdk";
import { Effect, Equal, Layer, Option, Result, Stream } from "effect";

import { ServerSettingsError } from "@t3tools/contracts";
import { ServerSettingsService } from "../../serverSettings";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  isCommandMissingCause,
  providerModelsFromSettings,
} from "../providerSnapshot";
import { CopilotProvider } from "../Services/CopilotProvider";
import {
  normalizeCopilotCliPathOverride,
  resolveBundledCopilotCliPath,
} from "./copilotCliPath";

const PROVIDER = "copilot" as const;

const DEFAULT_COPILOT_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, capabilities: null },
  { slug: "gpt-5.4-mini", name: "GPT-5.4 Mini", isCustom: false, capabilities: null },
  { slug: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", isCustom: false, capabilities: null },
  { slug: "claude-haiku-4.5", name: "Claude Haiku 4.5", isCustom: false, capabilities: null },
  { slug: "claude-opus-4.6", name: "Claude Opus 4.6", isCustom: false, capabilities: null },
  { slug: "claude-opus-4.5", name: "Claude Opus 4.5", isCustom: false, capabilities: null },
  { slug: "gemini-3-pro-preview", name: "Gemini 3 Pro (Preview)", isCustom: false, capabilities: null },
  { slug: "gemini-3.1-pro", name: "Gemini 3.1 Pro", isCustom: false, capabilities: null },
  { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex", isCustom: false, capabilities: null },
  { slug: "gpt-5.2-codex", name: "GPT-5.2 Codex", isCustom: false, capabilities: null },
  { slug: "gpt-5.2", name: "GPT-5.2", isCustom: false, capabilities: null },
  { slug: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", isCustom: false, capabilities: null },
  { slug: "gpt-5.1-codex", name: "GPT-5.1 Codex", isCustom: false, capabilities: null },
  { slug: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", isCustom: false, capabilities: null },
  { slug: "gpt-5.1", name: "GPT-5.1", isCustom: false, capabilities: null },
  { slug: "gpt-5-mini", name: "GPT-5 Mini", isCustom: false, capabilities: null },
  { slug: "gpt-4.1", name: "GPT-4.1", isCustom: false, capabilities: null },
  { slug: "raptor-mini", name: "Raptor Mini", isCustom: false, capabilities: null },
];

function reasoningEffortLabel(value: string): string {
  switch (value) {
    case "xhigh":
      return "Extra High";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    default:
      return value;
  }
}

function mapCopilotCapabilities(model: ModelInfo): ModelCapabilities {
  const reasoningEffortLevels = (model.supportedReasoningEfforts ?? []).map((value) => ({
    value,
    label: reasoningEffortLabel(value),
    ...(value === model.defaultReasoningEffort ? { isDefault: true } : {}),
  }));

  return {
    reasoningEffortLevels,
    supportsFastMode: false,
    supportsThinkingToggle: false,
    contextWindowOptions: [],
    promptInjectedEffortLevels: [],
  };
}

function mapCopilotModel(model: ModelInfo): ServerProviderModel {
  return {
    slug: model.id,
    name: model.name || model.id,
    isCustom: false,
    capabilities: mapCopilotCapabilities(model),
  };
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function makeCopilotClientOptions(settings: CopilotSettings): CopilotClientOptions {
  const cliPath =
    normalizeCopilotCliPathOverride(settings.cliPath) ?? resolveBundledCopilotCliPath();
  const configDir = trimToUndefined(settings.configDir);

  return {
    ...(cliPath ? { cliPath } : {}),
    ...(configDir ? { configDir } : {}),
    logLevel: "error",
  };
}

export function getCopilotHealthCheckTimeoutMs(platform: string = process.platform): number {
  return platform === "win32" ? 10_000 : DEFAULT_TIMEOUT_MS;
}

const probeCopilotProvider = (settings: CopilotSettings) =>
  Effect.tryPromise(async () => {
    const client = new CopilotClient(makeCopilotClientOptions(settings));

    try {
      await client.start();
      const [status, authStatus] = await Promise.all([
        client.getStatus().catch(() => undefined),
        client.getAuthStatus().catch(() => undefined),
      ]);
      const models =
        authStatus?.isAuthenticated === true
          ? await client.listModels().catch(() => undefined)
          : undefined;

      return {
        status,
        authStatus,
        models,
      };
    } finally {
      await client.stop().catch(() => []);
    }
  }).pipe(Effect.timeoutOption(getCopilotHealthCheckTimeoutMs()), Effect.result);

export const checkCopilotProviderStatus = Effect.fn("checkCopilotProviderStatus")(function* (): Effect.fn.Return<
  ServerProvider,
  ServerSettingsError,
  ServerSettingsService
> {
  const copilotSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((settings) => settings.providers.copilot),
  );
  const checkedAt = new Date().toISOString();
  const fallbackModels = providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    copilotSettings.customModels,
    DEFAULT_COPILOT_MODEL_CAPABILITIES,
  );

  if (!copilotSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "GitHub Copilot is disabled in T3 Code settings.",
      },
    });
  }

  const probe = yield* probeCopilotProvider(copilotSettings);

  if (Result.isFailure(probe)) {
    const error = probe.failure;
    return buildServerProvider({
      provider: PROVIDER,
      enabled: copilotSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "GitHub Copilot CLI (`copilot`) is not installed or not available to the SDK."
          : `Failed to start GitHub Copilot CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(probe.success)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: copilotSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "GitHub Copilot CLI health check timed out while starting the SDK client.",
      },
    });
  }

  const authStatus =
    probe.success.value.authStatus?.isAuthenticated === true
      ? "authenticated"
      : probe.success.value.authStatus?.isAuthenticated === false
        ? "unauthenticated"
        : "unknown";
  const resolvedModels =
    probe.success.value.models && probe.success.value.models.length > 0
      ? providerModelsFromSettings(
          probe.success.value.models.map(mapCopilotModel),
          PROVIDER,
          copilotSettings.customModels,
          DEFAULT_COPILOT_MODEL_CAPABILITIES,
        )
      : fallbackModels;

  return buildServerProvider({
    provider: PROVIDER,
    enabled: copilotSettings.enabled,
    checkedAt,
    models: resolvedModels,
    probe: {
      installed: true,
      version:
        typeof probe.success.value.status?.version === "string"
          ? probe.success.value.status.version
          : null,
      status:
        authStatus === "unauthenticated"
          ? "error"
          : authStatus === "unknown"
            ? "warning"
            : "ready",
      auth: {
        status: authStatus,
        ...(authStatus === "authenticated"
          ? { type: "github", label: "GitHub Copilot" }
          : {}),
      },
      message:
        trimToUndefined(probe.success.value.authStatus?.statusMessage) ??
        (typeof probe.success.value.status?.version === "string"
          ? `GitHub Copilot CLI ${probe.success.value.status.version}`
          : undefined),
    },
  });
});

export const CopilotProviderLive = Layer.effect(
  CopilotProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const getSettings = serverSettings.getSettings.pipe(Effect.map((settings) => settings.providers.copilot));
    const streamSettings = serverSettings.streamChanges.pipe(
      Stream.map((settings) => settings.providers.copilot),
    );
    const checkProvider = checkCopilotProviderStatus;

    return yield* makeManagedServerProvider<CopilotSettings>({
      getSettings,
      streamSettings,
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);

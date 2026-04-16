import { existsSync } from "node:fs";

import { CopilotClient, type CopilotClientOptions, type ModelInfo } from "@github/copilot-sdk";
import type {
  CopilotSettings,
  ModelCapabilities,
  ServerProviderAuth,
  ServerProviderModel,
  ServerProviderQuotaSnapshot,
  ServerProviderState,
} from "@t3tools/contracts";
import { Effect, Equal, Exit, Layer, Stream } from "effect";

import { ServerSettingsService } from "../../serverSettings";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import { buildServerProvider, providerModelsFromSettings } from "../providerSnapshot";
import { CopilotProvider } from "../Services/CopilotProvider";
import { normalizeCopilotCliPathOverride, resolveBundledCopilotCliPath } from "./copilotCliPath";

const PROVIDER = "copilot" as const;

const DEFAULT_COPILOT_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gpt-5",
    name: "GPT-5",
    isCustom: false,
    capabilities: {
      ...DEFAULT_COPILOT_MODEL_CAPABILITIES,
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
    },
  },
  {
    slug: "gpt-5-mini",
    name: "GPT-5 Mini",
    isCustom: false,
    capabilities: {
      ...DEFAULT_COPILOT_MODEL_CAPABILITIES,
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
    },
  },
  {
    slug: "gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: {
      ...DEFAULT_COPILOT_MODEL_CAPABILITIES,
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
    },
  },
  {
    slug: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    isCustom: false,
    capabilities: {
      ...DEFAULT_COPILOT_MODEL_CAPABILITIES,
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
    },
  },
  {
    slug: "gpt-4.1",
    name: "GPT-4.1",
    isCustom: false,
    capabilities: DEFAULT_COPILOT_MODEL_CAPABILITIES,
  },
  {
    slug: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    isCustom: false,
    capabilities: DEFAULT_COPILOT_MODEL_CAPABILITIES,
  },
  {
    slug: "claude-opus-4.7",
    name: "Claude Opus 4.7",
    isCustom: false,
    capabilities: DEFAULT_COPILOT_MODEL_CAPABILITIES,
  },
  {
    slug: "claude-opus-4.6",
    name: "Claude Opus 4.6",
    isCustom: false,
    capabilities: DEFAULT_COPILOT_MODEL_CAPABILITIES,
  },
  {
    slug: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    isCustom: false,
    capabilities: DEFAULT_COPILOT_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    isCustom: false,
    capabilities: DEFAULT_COPILOT_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3-pro-preview",
    name: "Gemini 3 Pro Preview",
    isCustom: false,
    capabilities: DEFAULT_COPILOT_MODEL_CAPABILITIES,
  },
];

function trimToUndefined(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return fallback;
}

function makeClientOptions(settings: CopilotSettings): CopilotClientOptions {
  const cliPath =
    normalizeCopilotCliPathOverride(settings.binaryPath) ?? resolveBundledCopilotCliPath();
  return {
    ...(cliPath ? { cliPath } : {}),
    logLevel: "error",
  };
}

function reasoningEffortLevelsFromModelInfo(
  model: ModelInfo,
): ModelCapabilities["reasoningEffortLevels"] {
  const levels = model.supportedReasoningEfforts ?? [];
  return levels.map((value) => {
    const label = value === "xhigh" ? "Extra High" : value.charAt(0).toUpperCase() + value.slice(1);
    return value === "high" ? { value, label, isDefault: true } : { value, label };
  });
}

function modelFromInfo(model: ModelInfo): ServerProviderModel {
  return {
    slug: model.id,
    name: trimToUndefined(model.name) ?? model.id,
    isCustom: false,
    ...(typeof model.billing?.multiplier === "number"
      ? { billingMultiplier: model.billing.multiplier }
      : {}),
    ...(Number.isFinite(model.capabilities.limits.max_context_window_tokens)
      ? { maxContextWindowTokens: model.capabilities.limits.max_context_window_tokens }
      : {}),
    capabilities: {
      ...DEFAULT_COPILOT_MODEL_CAPABILITIES,
      reasoningEffortLevels: reasoningEffortLevelsFromModelInfo(model),
    },
  };
}

function quotaSnapshotsFromAccountQuota(
  quotaSnapshots:
    | Record<
        string,
        {
          entitlementRequests: number;
          usedRequests: number;
          remainingPercentage: number;
          overage: number;
          overageAllowedWithExhaustedQuota: boolean;
          resetDate?: string;
        }
      >
    | undefined,
): ReadonlyArray<ServerProviderQuotaSnapshot> {
  if (!quotaSnapshots) return [];

  return Object.entries(quotaSnapshots)
    .flatMap(([key, snapshot]) => {
      const entitlementRequests = Math.max(0, Math.round(snapshot.entitlementRequests));
      const usedRequests = Math.max(0, Math.round(snapshot.usedRequests));
      const overage = Math.max(0, Math.round(snapshot.overage));
      const remainingPercentage = Number.isFinite(snapshot.remainingPercentage)
        ? snapshot.remainingPercentage
        : 0;

      return [
        {
          key,
          entitlementRequests,
          usedRequests,
          remainingPercentage,
          overage,
          overageAllowedWithExhaustedQuota: snapshot.overageAllowedWithExhaustedQuota,
          usageAllowedWithExhaustedQuota: snapshot.overageAllowedWithExhaustedQuota,
          ...(snapshot.resetDate ? { resetDate: snapshot.resetDate } : {}),
        } satisfies ServerProviderQuotaSnapshot,
      ];
    })
    .toSorted((left, right) => left.key.localeCompare(right.key));
}

function toAuthStatus(message: string): Pick<ServerProviderAuth, "status"> {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("not authenticated") ||
    normalized.includes("login required") ||
    normalized.includes("sign in") ||
    normalized.includes("sign-in") ||
    normalized.includes("authentication required")
  ) {
    return { status: "unauthenticated" };
  }
  return { status: "unknown" };
}

function toInstalled(message: string): boolean {
  const normalized = message.toLowerCase();
  return !normalized.includes("enoent") && !normalized.includes("not found");
}

function toStatus(message: string): Exclude<ServerProviderState, "disabled"> {
  return toAuthStatus(message).status === "unauthenticated" ? "error" : "warning";
}

function fallbackModels(settings: CopilotSettings) {
  return providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    settings.customModels,
    DEFAULT_COPILOT_MODEL_CAPABILITIES,
  );
}

function resolveRuntimeModels(models: ReadonlyArray<ModelInfo>, settings: CopilotSettings) {
  const runtimeModels = models.map(modelFromInfo);
  return providerModelsFromSettings(
    runtimeModels.length > 0 ? runtimeModels : BUILT_IN_MODELS,
    PROVIDER,
    settings.customModels,
    DEFAULT_COPILOT_MODEL_CAPABILITIES,
  );
}

export const checkCopilotProviderStatus = Effect.fn("checkCopilotProviderStatus")(function* () {
  const settings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((allSettings) => allSettings.providers.copilot),
  );
  const checkedAt = new Date().toISOString();
  const configuredBinaryPath = normalizeCopilotCliPathOverride(settings.binaryPath);

  if (!settings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: false,
      checkedAt,
      models: fallbackModels(settings),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "GitHub Copilot is disabled in T3 Code settings.",
      },
    });
  }

  if (configuredBinaryPath && !existsSync(configuredBinaryPath)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: settings.enabled,
      checkedAt,
      models: fallbackModels(settings),
      probe: {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: `GitHub Copilot CLI override was not found at '${configuredBinaryPath}'.`,
      },
    });
  }

  const client = new CopilotClient(makeClientOptions(settings));
  const probe = yield* Effect.exit(
    Effect.tryPromise({
      try: async () => {
        await client.start();
        const [models, quota] = await Promise.all([
          client.listModels(),
          client.rpc.account.getQuota().catch(() => null),
        ]);
        return { models, quotaSnapshots: quotaSnapshotsFromAccountQuota(quota?.quotaSnapshots) };
      },
      catch: (cause) =>
        new CopilotProbeError(toMessage(cause, "Failed to start GitHub Copilot."), cause),
    }).pipe(Effect.ensuring(Effect.promise(() => client.stop().catch(() => [])))),
  );

  if (Exit.isSuccess(probe)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: settings.enabled,
      checkedAt,
      models: resolveRuntimeModels(probe.value.models, settings),
      probe: {
        installed: true,
        version: null,
        status: "ready",
        auth: {
          status: "authenticated",
          type: "github",
          label: "GitHub Copilot",
        },
        quotaSnapshots: probe.value.quotaSnapshots,
      },
    });
  }

  const message = toMessage(probe.cause, "Failed to start GitHub Copilot.");

  return buildServerProvider({
    provider: PROVIDER,
    enabled: settings.enabled,
    checkedAt,
    models: fallbackModels(settings),
    probe: {
      installed: toInstalled(message),
      version: null,
      status: toStatus(message),
      auth: toAuthStatus(message),
      message:
        toAuthStatus(message).status === "unauthenticated"
          ? "GitHub Copilot is not authenticated. Sign in with the Copilot CLI and try again."
          : message,
    },
  });
});

export const CopilotProviderLive = Layer.effect(
  CopilotProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const checkProvider = checkCopilotProviderStatus().pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
    );

    return yield* makeManagedServerProvider<CopilotSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.copilot),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.copilot),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      initialSnapshot: (settings) =>
        buildServerProvider({
          provider: PROVIDER,
          enabled: settings.enabled,
          checkedAt: new Date(0).toISOString(),
          models: fallbackModels(settings),
          probe: {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Checking GitHub Copilot availability…",
          },
        }),
      checkProvider,
    });
  }),
);
class CopilotProbeError extends Error {
  constructor(
    message: string,
    readonly causeValue: unknown,
  ) {
    super(message);
  }
}

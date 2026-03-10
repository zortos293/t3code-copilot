import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { ArrowUpRightIcon, DownloadIcon, HeartIcon, SearchIcon } from "lucide-react";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  WEBGPU_DTYPE_OPTIONS,
  type ProviderKind,
  type ServerHuggingFaceModel,
  type WebGpuModelDtype,
} from "@t3tools/contracts";
import { getModelOptions, normalizeModelSlug } from "@t3tools/shared/model";

import { MAX_CUSTOM_MODEL_LENGTH, useAppSettings } from "../appSettings";
import { isElectron } from "../env";
import { useTheme } from "../hooks/useTheme";
import { huggingFaceModelSearchQueryOptions, serverConfigQueryOptions } from "../lib/serverReactQuery";
import {
  clearLocalWebGpuState,
  getLocalWebGpuStatusSnapshot,
  subscribeLocalWebGpuStatus,
} from "../localWebGpuOrchestration";
import { ensureNativeApi } from "../nativeApi";
import { preferredTerminalEditor } from "../terminal-links";
import { HUGGING_FACE_BRAND_ASSET_URL } from "../components/Icons";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { Switch } from "../components/ui/switch";
import { SidebarInset } from "~/components/ui/sidebar";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Match your OS appearance setting.",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
  },
] as const;

const HUGGING_FACE_QUICK_FILTERS = [
  { label: "Featured", query: "" },
  { label: "Qwen", query: "Qwen instruct" },
  { label: "Coder", query: "coder instruct" },
  { label: "Llama", query: "Llama instruct" },
  { label: "Phi", query: "Phi instruct" },
  { label: "SmolLM", query: "SmolLM instruct" },
] as const;

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const MODEL_PROVIDER_SETTINGS: Array<{
  provider: ProviderKind;
  title: string;
  description: string;
  placeholder: string;
  example: string;
}> = [
  {
    provider: "codex",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  {
    provider: "webgpu",
    title: "Local WebGPU",
    description: "Save additional Hugging Face / ONNX model ids for the local browser adapter.",
    placeholder: "onnx-community/your-model-id",
    example: "onnx-community/Qwen2.5-0.5B-Instruct",
  },
] as const;

type SaveCustomModelResult =
  | {
      ok: true;
      slug: string;
      builtIn: boolean;
      alreadySaved: boolean;
      added: boolean;
    }
  | {
      ok: false;
      error: string;
    };

function formatCompactMetric(value: number): string {
  return compactNumberFormatter.format(Math.max(0, value));
}

function huggingFaceModelUrl(modelId: string): string {
  return `https://huggingface.co/${modelId
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function huggingFaceSearchUrl(query: string): string {
  const normalizedQuery = query.trim();
  return normalizedQuery.length > 0
    ? `https://huggingface.co/models?search=${encodeURIComponent(normalizedQuery)}`
    : "https://huggingface.co/models?author=onnx-community&pipeline_tag=text-generation";
}

function getCustomModelsForProvider(
  settings: ReturnType<typeof useAppSettings>["settings"],
  provider: ProviderKind,
) {
  switch (provider) {
    case "codex":
      return settings.customCodexModels;
    case "webgpu":
      return settings.customWebGpuModels;
    default:
      return settings.customCodexModels;
  }
}

function getDefaultCustomModelsForProvider(
  defaults: ReturnType<typeof useAppSettings>["defaults"],
  provider: ProviderKind,
) {
  switch (provider) {
    case "codex":
      return defaults.customCodexModels;
    case "webgpu":
      return defaults.customWebGpuModels;
    default:
      return defaults.customCodexModels;
  }
}

function patchCustomModels(provider: ProviderKind, models: string[]) {
  switch (provider) {
    case "codex":
      return { customCodexModels: models };
    case "webgpu":
      return { customWebGpuModels: models };
    default:
      return { customCodexModels: models };
  }
}

function formatLocalWebGpuProgress(progress: {
  loaded: number;
  total: number | null;
  file: string | null;
} | null): string | null {
  if (!progress) return null;
  if (progress.total && progress.total > 0) {
    const percent = Math.max(0, Math.min(100, Math.round((progress.loaded / progress.total) * 100)));
    return `${percent}%${progress.file ? ` · ${progress.file}` : ""}`;
  }
  return progress.file ? `Downloading ${progress.file}` : "Downloading model files";
}

function SettingsRouteView() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { settings, defaults, updateSettings } = useAppSettings();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const localWebGpuStatus = useSyncExternalStore(
    subscribeLocalWebGpuStatus,
    getLocalWebGpuStatusSnapshot,
    getLocalWebGpuStatusSnapshot,
  );
  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
  const [openKeybindingsError, setOpenKeybindingsError] = useState<string | null>(null);
  const [isClearingLocalWebGpuState, setIsClearingLocalWebGpuState] = useState(false);
  const [localWebGpuActionMessage, setLocalWebGpuActionMessage] = useState<string | null>(null);
  const [huggingFaceModelQuery, setHuggingFaceModelQuery] = useState("");
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
    copilot: "",
    webgpu: "",
  });
  const [debouncedHuggingFaceModelQuery, huggingFaceModelQueryDebouncer] = useDebouncedValue(
    huggingFaceModelQuery,
    { wait: 350 },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});

  const codexBinaryPath = settings.codexBinaryPath;
  const codexHomePath = settings.codexHomePath;
  const keybindingsConfigPath = serverConfigQuery.data?.keybindingsConfigPath ?? null;
  const webGpuBuiltInOptions = getModelOptions("webgpu");
  const webGpuModelOptions = useMemo(
    () => [
      ...webGpuBuiltInOptions.map((option) => ({ slug: option.slug, name: option.name })),
      ...settings.customWebGpuModels
        .filter((slug) => !webGpuBuiltInOptions.some((option) => option.slug === slug))
        .map((slug) => ({ slug, name: slug })),
    ],
    [settings.customWebGpuModels, webGpuBuiltInOptions],
  );
  const webGpuBuiltInModelSlugs = useMemo(
    () => new Set<string>(webGpuBuiltInOptions.map((option) => option.slug)),
    [webGpuBuiltInOptions],
  );
  const localWebGpuProgressLabel = formatLocalWebGpuProgress(localWebGpuStatus.progress);
  const normalizedHuggingFaceModelQuery = debouncedHuggingFaceModelQuery.trim();
  const huggingFaceModelsQuery = useQuery(
    huggingFaceModelSearchQueryOptions({
      query: normalizedHuggingFaceModelQuery.length > 0 ? normalizedHuggingFaceModelQuery : null,
      limit: normalizedHuggingFaceModelQuery.length > 0 ? 10 : 8,
    }),
  );
  const huggingFaceModels = huggingFaceModelsQuery.data?.models ?? [];
  const isRefreshingHuggingFaceModels =
    huggingFaceModelQueryDebouncer.state.isPending || huggingFaceModelsQuery.isFetching;
  const huggingFaceBrowseError = huggingFaceModelsQuery.isError
    ? huggingFaceModelsQuery.error instanceof Error
      ? huggingFaceModelsQuery.error.message
      : "Unable to load Hugging Face models right now."
    : null;

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    setOpenKeybindingsError(null);
    setIsOpeningKeybindings(true);
    const api = ensureNativeApi();
    void api.shell
      .openInEditor(keybindingsConfigPath, preferredTerminalEditor())
      .catch((error) => {
        setOpenKeybindingsError(
          error instanceof Error ? error.message : "Unable to open keybindings file.",
        );
      })
      .finally(() => {
        setIsOpeningKeybindings(false);
      });
  }, [keybindingsConfigPath]);

  const saveCustomModel = useCallback(
    (provider: ProviderKind, rawModelSlug: string): SaveCustomModelResult => {
      const customModels = getCustomModelsForProvider(settings, provider);
      const normalized = normalizeModelSlug(rawModelSlug, provider);
      if (!normalized) {
        return { ok: false, error: "Enter a model slug." };
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        return {
          ok: false,
          error: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
        };
      }

      const builtIn = getModelOptions(provider).some((option) => option.slug === normalized);
      const alreadySaved = customModels.includes(normalized);
      if (!builtIn && !alreadySaved) {
        updateSettings(patchCustomModels(provider, [...customModels, normalized]));
      }

      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));

      return {
        ok: true,
        slug: normalized,
        builtIn,
        alreadySaved,
        added: !builtIn && !alreadySaved,
      };
    },
    [settings, updateSettings],
  );

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const result = saveCustomModel(provider, customModelInputByProvider[provider]);
      if (!result.ok) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: result.error,
        }));
        return;
      }
      if (result.builtIn) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That model is already built in.",
        }));
        return;
      }
      if (result.alreadySaved) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That custom model is already saved.",
        }));
        return;
      }

      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [provider]: "",
      }));
    },
    [customModelInputByProvider, saveCustomModel],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      updateSettings(
        patchCustomModels(
          provider,
          customModels.filter((model) => model !== slug),
        ),
      );
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  const resetLocalWebGpuState = useCallback(async () => {
    setIsClearingLocalWebGpuState(true);
    setLocalWebGpuActionMessage(null);
    try {
      await clearLocalWebGpuState();
      setLocalWebGpuActionMessage("Cleared local WebGPU threads and unloaded the active model.");
    } catch (error) {
      setLocalWebGpuActionMessage(
        error instanceof Error ? error.message : "Unable to clear local WebGPU state.",
      );
    } finally {
      setIsClearingLocalWebGpuState(false);
    }
  }, []);

  const openHuggingFaceModelPage = useCallback((modelId: string) => {
    const api = ensureNativeApi();
    void api.shell.openExternal(huggingFaceModelUrl(modelId)).catch((error) => {
      setLocalWebGpuActionMessage(
        error instanceof Error ? error.message : "Unable to open the Hugging Face model page.",
      );
    });
  }, []);

  const saveHuggingFaceModel = useCallback(
    (model: ServerHuggingFaceModel, options?: { setDefault?: boolean }) => {
      const result = saveCustomModel("webgpu", model.id);
      if (!result.ok) {
        setLocalWebGpuActionMessage(result.error);
        return;
      }

      const setDefault = options?.setDefault ?? false;
      const isAlreadyDefault = settings.webGpuDefaultModel === result.slug;
      if (setDefault && !isAlreadyDefault) {
        updateSettings({ webGpuDefaultModel: result.slug });
      }

      if (setDefault) {
        setLocalWebGpuActionMessage(
          isAlreadyDefault
            ? `${result.slug} is already the default local WebGPU model.`
            : `Set ${result.slug} as the default local WebGPU model.`,
        );
        return;
      }

      if (result.added) {
        setLocalWebGpuActionMessage(`Added ${result.slug} to your local WebGPU models.`);
        return;
      }
      if (result.builtIn) {
        setLocalWebGpuActionMessage(`${result.slug} is already available as a built-in local model.`);
        return;
      }
      setLocalWebGpuActionMessage(`${result.slug} is already saved in your custom local models.`);
    },
    [saveCustomModel, settings.webGpuDefaultModel, updateSettings],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Settings
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Configure app-level preferences for this device.
              </p>
            </header>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Appearance</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose how T3 Code handles light and dark mode.
                </p>
              </div>

              <div className="space-y-2" role="radiogroup" aria-label="Theme preference">
                {THEME_OPTIONS.map((option) => {
                  const selected = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-primary/60 bg-primary/8 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-accent"
                      }`}
                      onClick={() => setTheme(option.value)}
                    >
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">{option.label}</span>
                        <span className="text-xs">{option.description}</span>
                      </span>
                      {selected ? (
                        <span className="rounded bg-primary/14 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                          Selected
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <p className="mt-4 text-xs text-muted-foreground">
                Active theme: <span className="font-medium text-foreground">{resolvedTheme}</span>
              </p>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Codex App Server</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  These overrides apply to new sessions and let you use a non-default Codex install.
                </p>
              </div>

              <div className="space-y-4">
                <label htmlFor="codex-binary-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Codex binary path</span>
                  <Input
                    id="codex-binary-path"
                    value={codexBinaryPath}
                    onChange={(event) => updateSettings({ codexBinaryPath: event.target.value })}
                    placeholder="codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Leave blank to use <code>codex</code> from your PATH.
                  </span>
                </label>

                <label htmlFor="codex-home-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">CODEX_HOME path</span>
                  <Input
                    id="codex-home-path"
                    value={codexHomePath}
                    onChange={(event) => updateSettings({ codexHomePath: event.target.value })}
                    placeholder="/Users/you/.codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Optional custom Codex home/config directory.
                  </span>
                </label>

                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <p>
                    Binary source:{" "}
                    <span className="font-medium text-foreground">{codexBinaryPath || "PATH"}</span>
                  </p>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        codexBinaryPath: defaults.codexBinaryPath,
                        codexHomePath: defaults.codexHomePath,
                      })
                    }
                  >
                    Reset codex overrides
                  </Button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Models</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save additional provider model slugs so they appear in the chat model picker and
                  `/model` command suggestions.
                </p>
              </div>

              <div className="space-y-5">
                {MODEL_PROVIDER_SETTINGS.map((providerSettings) => {
                  const provider = providerSettings.provider;
                  const customModels = getCustomModelsForProvider(settings, provider);
                  const customModelInput = customModelInputByProvider[provider];
                  const customModelError = customModelErrorByProvider[provider] ?? null;
                  return (
                    <div
                      key={provider}
                      className="rounded-xl border border-border bg-background/50 p-4"
                    >
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-foreground">
                          {providerSettings.title}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {providerSettings.description}
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <label
                            htmlFor={`custom-model-slug-${provider}`}
                            className="block flex-1 space-y-1"
                          >
                            <span className="text-xs font-medium text-foreground">
                              Custom model slug
                            </span>
                            <Input
                              id={`custom-model-slug-${provider}`}
                              value={customModelInput}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCustomModelInputByProvider((existing) => ({
                                  ...existing,
                                  [provider]: value,
                                }));
                                if (customModelError) {
                                  setCustomModelErrorByProvider((existing) => ({
                                    ...existing,
                                    [provider]: null,
                                  }));
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                addCustomModel(provider);
                              }}
                              placeholder={providerSettings.placeholder}
                              spellCheck={false}
                            />
                            <span className="text-xs text-muted-foreground">
                              Example: <code>{providerSettings.example}</code>
                            </span>
                          </label>

                          <Button
                            className="sm:mt-6"
                            type="button"
                            onClick={() => addCustomModel(provider)}
                          >
                            Add model
                          </Button>
                        </div>

                        {customModelError ? (
                          <p className="text-xs text-destructive">{customModelError}</p>
                        ) : null}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <p>Saved custom models: {customModels.length}</p>
                            {customModels.length > 0 ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  updateSettings(
                                    patchCustomModels(provider, [
                                      ...getDefaultCustomModelsForProvider(defaults, provider),
                                    ]),
                                  )
                                }
                              >
                                Reset custom models
                              </Button>
                            ) : null}
                          </div>

                          {customModels.length > 0 ? (
                            <div className="space-y-2">
                              {customModels.map((slug) => (
                                <div
                                  key={`${provider}:${slug}`}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                                >
                                  <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                                    {slug}
                                  </code>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => removeCustomModel(provider, slug)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                              No custom models saved yet.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Local WebGPU</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Run curated Hugging Face ONNX models in the browser. The first run downloads
                  model files and may take a while.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background/50 p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">Enable local WebGPU provider</p>
                    <p className="text-xs text-muted-foreground">
                      Disable this to hide the browser-side local model adapter from the picker.
                    </p>
                  </div>
                  <Switch
                    checked={settings.webGpuEnabled}
                    onCheckedChange={(checked) => updateSettings({ webGpuEnabled: Boolean(checked) })}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-foreground">Default local model</span>
                    <select
                      value={settings.webGpuDefaultModel}
                      onChange={(event) => updateSettings({ webGpuDefaultModel: event.target.value })}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {webGpuModelOptions.map((option) => (
                        <option key={option.slug} value={option.slug}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-foreground">Preferred dtype</span>
                    <select
                      value={settings.webGpuPreferredDtype}
                      onChange={(event) =>
                        updateSettings({
                          webGpuPreferredDtype: event.target.value as WebGpuModelDtype,
                        })
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {WEBGPU_DTYPE_OPTIONS.map((dtype) => (
                        <option key={dtype} value={dtype}>
                          {dtype}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="rounded-xl border border-border bg-background/50 p-4 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Status:{" "}
                      <span className="font-medium text-foreground">
                        {localWebGpuStatus.supported ? localWebGpuStatus.phase : "unsupported"}
                      </span>
                    </span>
                    {localWebGpuProgressLabel ? <span>{localWebGpuProgressLabel}</span> : null}
                  </div>
                  <p className="mt-2">
                    {localWebGpuStatus.supportMessage ??
                      localWebGpuStatus.lastError ??
                      "Use a recent Chromium-based browser with WebGPU enabled for the best results."}
                  </p>
                  {localWebGpuActionMessage ? (
                    <p className="mt-2 text-foreground">{localWebGpuActionMessage}</p>
                  ) : null}
                </div>

                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
                  <div className="border-b border-border bg-muted/20 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background shadow-xs">
                          <img
                            alt=""
                            aria-hidden="true"
                            className="size-6"
                            src={HUGGING_FACE_BRAND_ASSET_URL}
                          />
                        </span>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-medium text-foreground">
                              Browse Hugging Face models
                            </h3>
                            <Badge size="sm" variant="warning">
                              Local WebGPU
                            </Badge>
                          </div>
                          <p className="max-w-2xl text-xs text-muted-foreground">
                            Search public text-generation repos filtered for Transformers.js
                            compatibility, then save them straight into your local model picker.
                          </p>
                        </div>
                      </div>

                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          const api = ensureNativeApi();
                          void api.shell
                            .openExternal(huggingFaceSearchUrl(normalizedHuggingFaceModelQuery))
                            .catch((error) => {
                              setLocalWebGpuActionMessage(
                                error instanceof Error
                                  ? error.message
                                  : "Unable to open Hugging Face.",
                              );
                            });
                        }}
                      >
                        Open Hub
                        <ArrowUpRightIcon className="size-3.5" />
                      </Button>
                    </div>

                    <div className="mt-4 rounded-xl border border-border bg-background px-3 py-3 shadow-xs">
                      <div className="space-y-3">
                        <label htmlFor="hugging-face-model-query" className="block space-y-1">
                          <span className="text-xs font-medium text-foreground">
                            Search compatible model ids
                          </span>
                          <div className="relative">
                            <SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground" />
                            <Input
                              id="hugging-face-model-query"
                              value={huggingFaceModelQuery}
                              onChange={(event) => setHuggingFaceModelQuery(event.target.value)}
                              placeholder="Search Qwen, Phi, Llama, SmolLM, coder..."
                              className="pr-10 pl-9"
                              spellCheck={false}
                            />
                            {isRefreshingHuggingFaceModels ? (
                              <Spinner className="-translate-y-1/2 absolute top-1/2 right-3 size-4 text-muted-foreground" />
                            ) : null}
                          </div>
                        </label>

                        <div className="flex flex-wrap gap-2">
                          {HUGGING_FACE_QUICK_FILTERS.map((filter) => {
                            const active =
                              (filter.query.length === 0 && huggingFaceModelQuery.length === 0) ||
                              huggingFaceModelQuery === filter.query;
                            return (
                              <Button
                                key={filter.label}
                                size="xs"
                                variant={active ? "secondary" : "outline"}
                                onClick={() => setHuggingFaceModelQuery(filter.query)}
                              >
                                {filter.label}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 bg-background px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            huggingFaceModelsQuery.data?.mode === "search" ? "info" : "success"
                          }
                          size="sm"
                        >
                          {huggingFaceModelsQuery.data?.mode === "search"
                            ? "Search results"
                            : "Featured picks"}
                        </Badge>
                        <span>
                          {huggingFaceModels.length} model{huggingFaceModels.length === 1 ? "" : "s"}
                          {huggingFaceModelsQuery.data?.truncated ? " shown" : ""}
                        </span>
                      </div>
                      <span>
                        {normalizedHuggingFaceModelQuery.length > 0
                          ? `Query: ${normalizedHuggingFaceModelQuery}`
                          : "Showing onnx-community instruct models first"}
                      </span>
                    </div>

                    {huggingFaceBrowseError ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/6 px-3 py-2 text-xs text-destructive">
                        {huggingFaceBrowseError}
                      </div>
                    ) : null}

                    {huggingFaceModels.length > 0 ? (
                      <div className="space-y-3">
                        {huggingFaceModels.map((model) => {
                          const isBuiltIn = webGpuBuiltInModelSlugs.has(model.id);
                          const isSaved = settings.customWebGpuModels.includes(model.id);
                          const isDefault = settings.webGpuDefaultModel === model.id;
                          return (
                            <article
                              key={model.id}
                              className="rounded-xl border border-border bg-muted/15 p-4 shadow-xs"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-medium text-foreground">
                                      {model.name}
                                    </p>
                                    <Badge
                                      size="sm"
                                      variant={
                                        model.compatibility === "recommended" ? "success" : "warning"
                                      }
                                    >
                                      {model.compatibility === "recommended"
                                        ? "Recommended"
                                        : "Community"}
                                    </Badge>
                                    {isBuiltIn ? (
                                      <Badge size="sm" variant="secondary">
                                        Built in
                                      </Badge>
                                    ) : null}
                                    {isSaved ? (
                                      <Badge size="sm" variant="outline">
                                        Saved
                                      </Badge>
                                    ) : null}
                                    {isDefault ? (
                                      <Badge size="sm" variant="default">
                                        Default
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <code className="mt-1 block truncate text-xs text-muted-foreground">
                                    {model.id}
                                  </code>
                                </div>

                                <Button
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => openHuggingFaceModelPage(model.id)}
                                >
                                  View
                                  <ArrowUpRightIcon className="size-3.5" />
                                </Button>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1">
                                  <DownloadIcon className="size-3.5" />
                                  {formatCompactMetric(model.downloads)}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1">
                                  <HeartIcon className="size-3.5" />
                                  {formatCompactMetric(model.likes)}
                                </span>
                                <span className="rounded-md border border-border bg-background px-2 py-1">
                                  {model.pipelineTag}
                                </span>
                                {model.libraryName ? (
                                  <span className="rounded-md border border-border bg-background px-2 py-1">
                                    {model.libraryName}
                                  </span>
                                ) : null}
                                {model.license ? (
                                  <span className="rounded-md border border-border bg-background px-2 py-1">
                                    {model.license}
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                  size="xs"
                                  variant={isBuiltIn || isSaved ? "outline" : "default"}
                                  disabled={isBuiltIn || isSaved}
                                  onClick={() => saveHuggingFaceModel(model)}
                                >
                                  {isBuiltIn ? "Built in" : isSaved ? "Saved" : "Add model"}
                                </Button>
                                <Button
                                  size="xs"
                                  variant={isDefault ? "secondary" : "outline"}
                                  onClick={() => saveHuggingFaceModel(model, { setDefault: true })}
                                >
                                  {isDefault ? "Default selected" : "Set as default"}
                                </Button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : isRefreshingHuggingFaceModels ? (
                      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/10 px-3 py-4 text-xs text-muted-foreground">
                        <Spinner className="size-4" />
                        Loading compatible Hugging Face models...
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border bg-muted/10 px-3 py-4 text-xs text-muted-foreground">
                        No compatible public text-generation models matched that search. Try a
                        broader family name like <code>Qwen</code> or <code>Llama</code>.
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isClearingLocalWebGpuState}
                    onClick={() => void resetLocalWebGpuState()}
                  >
                    {isClearingLocalWebGpuState ? "Clearing..." : "Clear local WebGPU threads"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    This resets locally persisted threads and unloads the current browser model.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Responses</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control how assistant output is rendered during a turn.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Stream assistant messages</p>
                  <p className="text-xs text-muted-foreground">
                    Show token-by-token output while a response is in progress.
                  </p>
                </div>
                <Switch
                  checked={settings.enableAssistantStreaming}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      enableAssistantStreaming: Boolean(checked),
                    })
                  }
                  aria-label="Stream assistant messages"
                />
              </div>

              {settings.enableAssistantStreaming !== defaults.enableAssistantStreaming ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        enableAssistantStreaming: defaults.enableAssistantStreaming,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Keybindings</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open the persisted <code>keybindings.json</code> file to edit advanced bindings
                  directly.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">Config file path</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {keybindingsConfigPath ?? "Resolving keybindings path..."}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!keybindingsConfigPath || isOpeningKeybindings}
                    onClick={openKeybindingsFile}
                  >
                    {isOpeningKeybindings ? "Opening..." : "Open keybindings.json"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Opens in your preferred editor selection.
                </p>
                {openKeybindingsError ? (
                  <p className="text-xs text-destructive">{openKeybindingsError}</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Safety</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Additional guardrails for destructive local actions.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Confirm thread deletion</p>
                  <p className="text-xs text-muted-foreground">
                    Ask for confirmation before deleting a thread and its chat history.
                  </p>
                </div>
                <Switch
                  checked={settings.confirmThreadDelete}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      confirmThreadDelete: Boolean(checked),
                    })
                  }
                  aria-label="Confirm thread deletion"
                />
              </div>

              {settings.confirmThreadDelete !== defaults.confirmThreadDelete ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        confirmThreadDelete: defaults.confirmThreadDelete,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});

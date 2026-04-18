import * as nodePath from "node:path";
import { type ServerProvider, ServerProvider as ServerProviderSchema } from "@t3tools/contracts";
import { Cause, Effect, FileSystem, Path, Schema, Semaphore } from "effect";

export const PROVIDER_CACHE_IDS = [
  "codex",
  "copilot",
  "claudeAgent",
  "opencode",
  "cursor",
] as const satisfies ReadonlyArray<ServerProvider["provider"]>;

const decodeProviderStatusCache = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ServerProviderSchema),
);

const cacheWriteSemaphoreByPath = new Map<string, Semaphore.Semaphore>();

const providerOrderRank = (provider: ServerProvider["provider"]): number => {
  const rank = PROVIDER_CACHE_IDS.indexOf(provider);
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
};

const mergeProviderModels = (
  fallbackModels: ReadonlyArray<ServerProvider["models"][number]>,
  cachedModels: ReadonlyArray<ServerProvider["models"][number]>,
): ReadonlyArray<ServerProvider["models"][number]> => {
  const fallbackSlugs = new Set(fallbackModels.map((model) => model.slug));
  return [...fallbackModels, ...cachedModels.filter((model) => !fallbackSlugs.has(model.slug))];
};

export const orderProviderSnapshots = (
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> =>
  [...providers].toSorted(
    (left, right) => providerOrderRank(left.provider) - providerOrderRank(right.provider),
  );

export const hydrateCachedProvider = (input: {
  readonly cachedProvider: ServerProvider;
  readonly fallbackProvider: ServerProvider;
}): ServerProvider => {
  if (
    !input.fallbackProvider.enabled ||
    input.cachedProvider.enabled !== input.fallbackProvider.enabled
  ) {
    return input.fallbackProvider;
  }

  const { message: _fallbackMessage, ...fallbackWithoutMessage } = input.fallbackProvider;
  const hydratedProvider: ServerProvider = {
    ...fallbackWithoutMessage,
    models: mergeProviderModels(input.fallbackProvider.models, input.cachedProvider.models),
    installed: input.cachedProvider.installed,
    version: input.cachedProvider.version,
    status: input.cachedProvider.status,
    auth: input.cachedProvider.auth,
    checkedAt: input.cachedProvider.checkedAt,
    slashCommands: input.cachedProvider.slashCommands,
    skills: input.cachedProvider.skills,
    ...(input.cachedProvider.quotaSnapshots
      ? { quotaSnapshots: input.cachedProvider.quotaSnapshots }
      : {}),
  };

  return input.cachedProvider.message
    ? { ...hydratedProvider, message: input.cachedProvider.message }
    : hydratedProvider;
};

export const resolveProviderStatusCachePath = (input: {
  readonly cacheDir: string;
  readonly provider: ServerProvider["provider"];
}) => nodePath.join(input.cacheDir, `${input.provider}.json`);

export const readProviderStatusCache = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return undefined;
    }

    const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    return yield* decodeProviderStatusCache(trimmed).pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          Effect.logWarning("failed to parse provider status cache, ignoring", {
            path: filePath,
            issues: Cause.pretty(cause),
          }).pipe(Effect.as(undefined)),
        onSuccess: Effect.succeed,
      }),
    );
  });

const parseCheckedAt = (value: string): number => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
};

const isStaleCacheWrite = (input: {
  readonly current: ServerProvider | undefined;
  readonly next: ServerProvider;
}): boolean => {
  if (!input.current || input.current.provider !== input.next.provider) {
    return false;
  }
  const currentCheckedAt = parseCheckedAt(input.current.checkedAt);
  const nextCheckedAt = parseCheckedAt(input.next.checkedAt);
  if (!Number.isFinite(currentCheckedAt) || !Number.isFinite(nextCheckedAt)) {
    return false;
  }
  return currentCheckedAt > nextCheckedAt;
};

const getCacheWriteSemaphore = (filePath: string): Semaphore.Semaphore => {
  const existing = cacheWriteSemaphoreByPath.get(filePath);
  if (existing) {
    return existing;
  }
  const semaphore = Effect.runSync(Semaphore.make(1));
  cacheWriteSemaphoreByPath.set(filePath, semaphore);
  return semaphore;
};

export const writeProviderStatusCache = (input: {
  readonly filePath: string;
  readonly provider: ServerProvider;
}) =>
  getCacheWriteSemaphore(input.filePath).withPermits(1)(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const currentProvider = yield* readProviderStatusCache(input.filePath).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
      );
      if (isStaleCacheWrite({ current: currentProvider, next: input.provider })) {
        return;
      }

      const tempPath = `${input.filePath}.${process.pid}.${Date.now()}.tmp`;
      const encoded = `${JSON.stringify(input.provider, null, 2)}\n`;

      yield* fs.makeDirectory(path.dirname(input.filePath), { recursive: true });
      yield* fs.writeFileString(tempPath, encoded);
      yield* fs
        .rename(tempPath, input.filePath)
        .pipe(
          Effect.ensuring(fs.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true }))),
        );
    }),
  );

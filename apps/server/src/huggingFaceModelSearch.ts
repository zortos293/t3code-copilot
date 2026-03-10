import type {
  ServerHuggingFaceModel,
  ServerHuggingFaceModelSearchInput,
  ServerHuggingFaceModelSearchResult,
} from "@t3tools/contracts";

const HUGGING_FACE_MODELS_API_URL = "https://huggingface.co/api/models";
const HUGGING_FACE_SEARCH_CACHE_TTL_MS = 60_000;
const HUGGING_FACE_SEARCH_TIMEOUT_MS = 8_000;
const HUGGING_FACE_FETCH_LIMIT_MULTIPLIER = 4;
const HUGGING_FACE_FETCH_LIMIT_MIN = 24;
const HUGGING_FACE_FETCH_LIMIT_MAX = 96;

type HuggingFaceApiModel = {
  id?: unknown;
  modelId?: unknown;
  likes?: unknown;
  downloads?: unknown;
  private?: unknown;
  tags?: unknown;
  pipeline_tag?: unknown;
  library_name?: unknown;
};

interface SearchCacheEntry {
  expiresAt: number;
  result: ServerHuggingFaceModelSearchResult;
}

const searchCache = new Map<string, SearchCacheEntry>();
const inFlightSearches = new Map<string, Promise<ServerHuggingFaceModelSearchResult>>();

function normalizeSearchQuery(input: string | undefined): string | undefined {
  const normalized = input?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function searchCacheKey(input: ServerHuggingFaceModelSearchInput): string {
  return `${normalizeSearchQuery(input.query)?.toLowerCase() ?? ""}::${input.limit ?? ""}`;
}

function clampFetchLimit(limit: number): number {
  return Math.max(
    HUGGING_FACE_FETCH_LIMIT_MIN,
    Math.min(HUGGING_FACE_FETCH_LIMIT_MAX, limit * HUGGING_FACE_FETCH_LIMIT_MULTIPLIER),
  );
}

function coerceNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.trunc(parsed);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry !== "string") {
      return [];
    }
    const normalized = entry.trim();
    return normalized.length > 0 ? [normalized] : [];
  });
}

function hasTransformersJsSupport(model: HuggingFaceApiModel, tags: readonly string[]): boolean {
  return model.library_name === "transformers.js" || tags.includes("transformers.js");
}

function readLicense(tags: readonly string[]): string | undefined {
  const licenseTag = tags.find((tag) => tag.startsWith("license:"));
  const license = licenseTag?.slice("license:".length).trim();
  return license && license.length > 0 ? license : undefined;
}

function normalizeHuggingFaceModel(raw: unknown): ServerHuggingFaceModel | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const model = raw as HuggingFaceApiModel;
  const id = typeof model.id === "string" ? model.id.trim() : "";
  const fallbackId = typeof model.modelId === "string" ? model.modelId.trim() : "";
  const resolvedId = id || fallbackId;
  if (!resolvedId || model.private === true) {
    return null;
  }

  const tags = toStringArray(model.tags);
  if (
    model.pipeline_tag !== "text-generation" ||
    !hasTransformersJsSupport(model, tags) ||
    tags.includes("custom_code")
  ) {
    return null;
  }

  const slashIndex = resolvedId.indexOf("/");
  const author =
    slashIndex > 0 ? resolvedId.slice(0, slashIndex).trim() : "huggingface";
  const name =
    slashIndex > 0 ? resolvedId.slice(slashIndex + 1).trim() : resolvedId;
  if (!author || !name) {
    return null;
  }

  return {
    id: resolvedId,
    author,
    name,
    downloads: coerceNonNegativeInt(model.downloads),
    likes: coerceNonNegativeInt(model.likes),
    pipelineTag: "text-generation",
    ...(typeof model.library_name === "string" && model.library_name.trim().length > 0
      ? { libraryName: model.library_name.trim() }
      : {}),
    ...(readLicense(tags) ? { license: readLicense(tags) } : {}),
    compatibility: resolvedId.startsWith("onnx-community/") ? "recommended" : "community",
  };
}

function scoreModelMatch(model: ServerHuggingFaceModel, query: string | undefined): number {
  if (!query) {
    return 6;
  }
  const normalizedQuery = query.toLowerCase();
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  if (id === normalizedQuery) return 0;
  if (name === normalizedQuery) return 1;
  if (id.startsWith(normalizedQuery)) return 2;
  if (name.startsWith(normalizedQuery)) return 3;
  if (id.includes(normalizedQuery)) return 4;
  if (name.includes(normalizedQuery)) return 5;
  return 6;
}

function compareModels(
  left: ServerHuggingFaceModel,
  right: ServerHuggingFaceModel,
  query: string | undefined,
): number {
  const matchDifference = scoreModelMatch(left, query) - scoreModelMatch(right, query);
  if (matchDifference !== 0) {
    return matchDifference;
  }
  if (left.compatibility !== right.compatibility) {
    return left.compatibility === "recommended" ? -1 : 1;
  }
  const leftInstruct = left.name.toLowerCase().includes("instruct");
  const rightInstruct = right.name.toLowerCase().includes("instruct");
  if (leftInstruct !== rightInstruct) {
    return leftInstruct ? -1 : 1;
  }
  const downloadDifference = right.downloads - left.downloads;
  if (downloadDifference !== 0) {
    return downloadDifference;
  }
  const likesDifference = right.likes - left.likes;
  if (likesDifference !== 0) {
    return likesDifference;
  }
  return left.id.localeCompare(right.id);
}

function dedupeModels(models: readonly ServerHuggingFaceModel[]): ServerHuggingFaceModel[] {
  const byId = new Map<string, ServerHuggingFaceModel>();
  for (const model of models) {
    byId.set(model.id, model);
  }
  return Array.from(byId.values());
}

async function requestHuggingFaceModels(
  input: ServerHuggingFaceModelSearchInput,
): Promise<ServerHuggingFaceModelSearchResult> {
  const limit = input.limit ?? 12;
  const query = normalizeSearchQuery(input.query);
  const mode = query ? "search" : "featured";
  const params = new URLSearchParams({
    limit: String(clampFetchLimit(limit)),
  });

  if (query) {
    params.set("search", query);
  } else {
    params.set("author", "onnx-community");
    params.set("search", "Instruct");
  }

  const response = await fetch(`${HUGGING_FACE_MODELS_API_URL}?${params.toString()}`, {
    headers: {
      accept: "application/json",
    },
    signal: AbortSignal.timeout(HUGGING_FACE_SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Hugging Face search failed (${response.status} ${response.statusText}).`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Hugging Face search returned an unexpected response.");
  }

  const normalizedModels = dedupeModels(
    payload.flatMap((entry) => {
      const normalized = normalizeHuggingFaceModel(entry);
      return normalized ? [normalized] : [];
    }),
  ).toSorted((left, right) => compareModels(left, right, query));

  const featuredModels =
    mode === "featured"
      ? normalizedModels.filter((model) => model.compatibility === "recommended")
      : normalizedModels;
  const models = (featuredModels.length > 0 ? featuredModels : normalizedModels).slice(0, limit);

  return {
    mode,
    ...(query ? { query } : {}),
    models,
    truncated: (featuredModels.length > 0 ? featuredModels : normalizedModels).length > limit,
  };
}

export function clearHuggingFaceModelSearchCache(): void {
  searchCache.clear();
  inFlightSearches.clear();
}

export async function searchHuggingFaceModels(
  input: ServerHuggingFaceModelSearchInput,
): Promise<ServerHuggingFaceModelSearchResult> {
  const key = searchCacheKey(input);
  const now = Date.now();
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  const inFlight = inFlightSearches.get(key);
  if (inFlight) {
    return inFlight;
  }

  const request = requestHuggingFaceModels(input)
    .then((result) => {
      searchCache.set(key, {
        expiresAt: Date.now() + HUGGING_FACE_SEARCH_CACHE_TTL_MS,
        result,
      });
      return result;
    })
    .finally(() => {
      inFlightSearches.delete(key);
    });

  inFlightSearches.set(key, request);
  return request;
}

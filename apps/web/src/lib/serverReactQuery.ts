import type { ServerHuggingFaceModelSearchResult } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const serverQueryKeys = {
  all: ["server"] as const,
  config: () => ["server", "config"] as const,
  huggingFaceModels: (query: string | null, limit: number) =>
    ["server", "hugging-face-models", query, limit] as const,
};

const DEFAULT_HUGGING_FACE_MODEL_SEARCH_LIMIT = 12;
const DEFAULT_HUGGING_FACE_MODEL_SEARCH_STALE_TIME = 30_000;
const EMPTY_HUGGING_FACE_MODEL_SEARCH_RESULT: ServerHuggingFaceModelSearchResult = {
  mode: "featured",
  models: [],
  truncated: false,
};

export function serverConfigQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.config(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getConfig();
    },
    staleTime: Infinity,
  });
}

export function huggingFaceModelSearchQueryOptions(input: {
  query: string | null;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const normalizedQuery = input.query?.trim() || null;
  const limit = input.limit ?? DEFAULT_HUGGING_FACE_MODEL_SEARCH_LIMIT;
  return queryOptions({
    queryKey: serverQueryKeys.huggingFaceModels(normalizedQuery, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.searchHuggingFaceModels({
        ...(normalizedQuery ? { query: normalizedQuery } : {}),
        limit,
      });
    },
    enabled: input.enabled ?? true,
    staleTime: input.staleTime ?? DEFAULT_HUGGING_FACE_MODEL_SEARCH_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_HUGGING_FACE_MODEL_SEARCH_RESULT,
  });
}

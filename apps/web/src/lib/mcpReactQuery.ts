import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";

export const mcpQueryKeys = {
  all: ["mcp"] as const,
  list: () => ["mcp", "list"] as const,
  browse: () => ["mcp", "browse"] as const,
};

export function mcpListQueryOptions() {
  return queryOptions({
    queryKey: mcpQueryKeys.list(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.mcp.list();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function mcpBrowseQueryOptions() {
  return queryOptions({
    queryKey: mcpQueryKeys.browse(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.mcp.browse();
    },
    staleTime: 300_000,
  });
}

export function invalidateMcpQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: mcpQueryKeys.all });
}

export function mcpToggleMutationOptions(opts: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (vars: { name: string; provider: "codex" | "copilot"; enabled: boolean }) => {
      const api = ensureNativeApi();
      return api.mcp.toggle(vars);
    },
    onSettled: async () => {
      await invalidateMcpQueries(opts.queryClient);
    },
  });
}

export function mcpAddMutationOptions(opts: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (vars: {
      name: string;
      provider: "codex" | "copilot";
      command?: string;
      args?: string[];
      url?: string;
      headers?: Record<string, string>;
      bearerToken?: string;
    }) => {
      const api = ensureNativeApi();
      return api.mcp.add(vars);
    },
    onSettled: async () => {
      await invalidateMcpQueries(opts.queryClient);
    },
  });
}

export function mcpRemoveMutationOptions(opts: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (vars: { name: string; provider: "codex" | "copilot" }) => {
      const api = ensureNativeApi();
      return api.mcp.remove(vars);
    },
    onSettled: async () => {
      await invalidateMcpQueries(opts.queryClient);
    },
  });
}

export function mcpUpdateMutationOptions(opts: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (vars: {
      name: string;
      provider: "codex" | "copilot";
      command?: string;
      args?: string[];
      url?: string;
      headers?: Record<string, string>;
      bearerToken?: string;
    }) => {
      const api = ensureNativeApi();
      return api.mcp.update(vars);
    },
    onSettled: async () => {
      await invalidateMcpQueries(opts.queryClient);
    },
  });
}

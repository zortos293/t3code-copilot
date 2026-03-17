import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as nativeApi from "../nativeApi";
import {
  gitMutationKeys,
  gitPreparePullRequestThreadMutationOptions,
  gitPullMutationOptions,
  gitRunStackedActionMutationOptions,
} from "./gitReactQuery";

describe("gitMutationKeys", () => {
  it("scopes stacked action keys by cwd", () => {
    expect(gitMutationKeys.runStackedAction("/repo/a")).not.toEqual(
      gitMutationKeys.runStackedAction("/repo/b"),
    );
  });

  it("scopes pull keys by cwd", () => {
    expect(gitMutationKeys.pull("/repo/a")).not.toEqual(gitMutationKeys.pull("/repo/b"));
  });

  it("scopes pull request thread preparation keys by cwd", () => {
    expect(gitMutationKeys.preparePullRequestThread("/repo/a")).not.toEqual(
      gitMutationKeys.preparePullRequestThread("/repo/b"),
    );
  });
});

describe("git mutation options", () => {
  const queryClient = new QueryClient();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches cwd-scoped mutation key for runStackedAction", () => {
    const options = gitRunStackedActionMutationOptions({ cwd: "/repo/a", queryClient });
    expect(options.mutationKey).toEqual(gitMutationKeys.runStackedAction("/repo/a"));
  });

  it("forwards provider to runStackedAction RPC", async () => {
    const runStackedAction = vi.fn(async () => ({
      action: "commit",
      branch: { status: "skipped_not_requested" },
      commit: { status: "created", subject: "Use Copilot" },
      push: { status: "skipped_not_requested" },
      pr: { status: "skipped_not_requested" },
    }));

    vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
      git: {
        runStackedAction,
      },
    } as never);

    const options = gitRunStackedActionMutationOptions({ cwd: "/repo/a", queryClient });
    if (!options.mutationFn) {
      throw new Error("Expected mutationFn to be defined.");
    }

    await options.mutationFn(
      {
        action: "commit",
        provider: "copilot",
      },
      {} as never,
    );

    expect(runStackedAction).toHaveBeenCalledWith({
      cwd: "/repo/a",
      action: "commit",
      provider: "copilot",
    });
  });

  it("attaches cwd-scoped mutation key for pull", () => {
    const options = gitPullMutationOptions({ cwd: "/repo/a", queryClient });
    expect(options.mutationKey).toEqual(gitMutationKeys.pull("/repo/a"));
  });

  it("attaches cwd-scoped mutation key for preparePullRequestThread", () => {
    const options = gitPreparePullRequestThreadMutationOptions({
      cwd: "/repo/a",
      queryClient,
    });
    expect(options.mutationKey).toEqual(gitMutationKeys.preparePullRequestThread("/repo/a"));
  });
});

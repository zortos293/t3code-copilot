import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { syncProjects, type UiState } from "~/uiStateStore";
import type { Project } from "~/types";
import { buildProjectUiSyncInputs, shouldApplyTerminalEvent } from "./service";

const PRIMARY_ENVIRONMENT_ID = EnvironmentId.make("env-local");
const REMOTE_ENVIRONMENT_ID = EnvironmentId.make("env-remote");

function makeProject(
  input: Partial<Project> & Pick<Project, "id" | "cwd" | "environmentId">,
): Project {
  return {
    id: input.id,
    environmentId: input.environmentId,
    cwd: input.cwd,
    name: input.name ?? "project",
    createdAt: input.createdAt ?? "2026-04-17T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-17T00:00:00.000Z",
    repositoryIdentity: input.repositoryIdentity ?? {
      canonicalKey: "github.com/t3tools/repo",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/t3tools/repo.git",
      },
      displayName: "t3code-copilot",
      name: "t3code-copilot",
      rootPath: "/repo",
    },
    defaultModelSelection: input.defaultModelSelection ?? null,
    scripts: input.scripts ?? [],
  };
}

function makeUiState(input?: Partial<UiState>): UiState {
  return {
    projectExpandedById: {},
    projectOrder: [],
    threadLastVisitedAtById: {},
    threadChangedFilesExpandedById: {},
    ...input,
  };
}

describe("shouldApplyTerminalEvent", () => {
  it("applies terminal events for draft-only threads", () => {
    expect(
      shouldApplyTerminalEvent({
        serverThreadArchivedAt: undefined,
        hasDraftThread: true,
      }),
    ).toBe(true);
  });

  it("drops terminal events for unknown threads", () => {
    expect(
      shouldApplyTerminalEvent({
        serverThreadArchivedAt: undefined,
        hasDraftThread: false,
      }),
    ).toBe(false);
  });

  it("drops terminal events for archived server threads even if a draft exists", () => {
    expect(
      shouldApplyTerminalEvent({
        serverThreadArchivedAt: "2026-04-09T00:00:00.000Z",
        hasDraftThread: true,
      }),
    ).toBe(false);
  });

  it("applies terminal events for active server threads", () => {
    expect(
      shouldApplyTerminalEvent({
        serverThreadArchivedAt: null,
        hasDraftThread: false,
      }),
    ).toBe(true);
  });
});

describe("buildProjectUiSyncInputs", () => {
  it("uses logical project keys so grouped rows keep stable expansion state", () => {
    const localProject = makeProject({
      id: ProjectId.make("project-local"),
      environmentId: PRIMARY_ENVIRONMENT_ID,
      cwd: "/repo",
    });
    const remoteProject = makeProject({
      id: ProjectId.make("project-remote"),
      environmentId: REMOTE_ENVIRONMENT_ID,
      cwd: "/repo",
    });

    const initialState = makeUiState({
      projectExpandedById: {
        "github.com/t3tools/repo": false,
      },
      projectOrder: ["github.com/t3tools/repo"],
    });

    const next = syncProjects(
      initialState,
      buildProjectUiSyncInputs([localProject, remoteProject]),
    );

    expect(next.projectOrder).toEqual(["github.com/t3tools/repo"]);
    expect(next.projectExpandedById["github.com/t3tools/repo"]).toBe(false);
  });

  it("deduplicates grouped projects before syncing ui state", () => {
    const localProject = makeProject({
      id: ProjectId.make("project-local"),
      environmentId: PRIMARY_ENVIRONMENT_ID,
      cwd: "/repo",
    });
    const remoteProject = makeProject({
      id: ProjectId.make("project-remote"),
      environmentId: REMOTE_ENVIRONMENT_ID,
      cwd: "/repo",
      name: "Remote rename",
    });

    expect(buildProjectUiSyncInputs([localProject, remoteProject])).toEqual([
      {
        key: "github.com/t3tools/repo",
        cwd: "/repo",
      },
    ]);
  });
});

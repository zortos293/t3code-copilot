import { describe, expect, it } from "vitest";

import {
  DEFAULT_GITHUB_REPOSITORY,
  formatGitHubRepository,
  parseGitHubRepository,
} from "./githubRepository";

describe("parseGitHubRepository", () => {
  it("parses valid owner/repo slugs", () => {
    expect(parseGitHubRepository("zortos293/t3code-copilot")).toEqual({
      owner: "zortos293",
      repo: "t3code-copilot",
    });
  });

  it("rejects invalid repository slugs", () => {
    expect(parseGitHubRepository("")).toBeNull();
    expect(parseGitHubRepository("zortos293")).toBeNull();
    expect(parseGitHubRepository("zortos293/t3code-copilot/releases")).toBeNull();
    expect(parseGitHubRepository("zortos293 /t3code-copilot")).toBeNull();
  });
});

describe("formatGitHubRepository", () => {
  it("round-trips the default repository slug", () => {
    const repository = parseGitHubRepository(DEFAULT_GITHUB_REPOSITORY);
    expect(repository).not.toBeNull();
    expect(formatGitHubRepository(repository!)).toBe(DEFAULT_GITHUB_REPOSITORY);
  });
});

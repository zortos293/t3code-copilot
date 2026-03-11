export interface GitHubRepositorySlug {
  readonly owner: string;
  readonly repo: string;
}

export const DEFAULT_GITHUB_REPOSITORY = "zortos293/t3code-copilot";

export function parseGitHubRepository(
  value: string | null | undefined,
): GitHubRepositorySlug | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

export function formatGitHubRepository(repository: GitHubRepositorySlug): string {
  return `${repository.owner}/${repository.repo}`;
}

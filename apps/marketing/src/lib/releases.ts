import {
  DEFAULT_GITHUB_REPOSITORY,
  formatGitHubRepository,
  parseGitHubRepository,
} from "@t3tools/shared/githubRepository";

const REPOSITORY =
  parseGitHubRepository(import.meta.env.PUBLIC_T3CODE_RELEASE_REPOSITORY) ??
  parseGitHubRepository(DEFAULT_GITHUB_REPOSITORY);

if (!REPOSITORY) {
  throw new Error("Default GitHub release repository is invalid.");
}

const REPO = formatGitHubRepository(REPOSITORY);

export const RELEASES_URL = `https://github.com/${REPO}/releases`;

const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_KEY = `t3code-latest-release:${REPO}`;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export async function fetchLatestRelease(): Promise<Release> {
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const data = await fetch(API_URL).then((r) => r.json());

  if (data?.assets) {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  }

  return data;
}

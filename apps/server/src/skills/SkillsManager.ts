/**
 * SkillsManager - Service for listing, toggling, searching, installing, and
 * uninstalling agent skills.
 *
 * Skills are enabled when their directory lives under `~/.agents/skills/<name>/`
 * and disabled when moved to `~/.t3/disabledSkills/<name>/`.
 *
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  SkillMetadata,
  SkillsListResult,
  SkillsToggleInput,
  SkillsToggleResult,
  SkillsSearchInput,
  SkillsSearchResult,
  SkillSearchResultEntry,
  SkillsInstallInput,
  SkillsInstallResult,
  SkillsUninstallInput,
  SkillsUninstallResult,
  SkillsReadContentInput,
  SkillsReadContentResult,
} from "@t3tools/contracts";
import { Effect, Layer, Schema, ServiceMap } from "effect";
import { runProcess } from "../processRunner";

// ── Error ────────────────────────────────────────────────────────────

export class SkillsError extends Schema.TaggedErrorClass<SkillsError>()("SkillsError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

// ── Service Interface ────────────────────────────────────────────────

export interface SkillsManagerShape {
  readonly list: Effect.Effect<SkillsListResult, SkillsError>;
  readonly toggle: (input: SkillsToggleInput) => Effect.Effect<SkillsToggleResult, SkillsError>;
  readonly search: (input: SkillsSearchInput) => Effect.Effect<SkillsSearchResult, SkillsError>;
  readonly install: (input: SkillsInstallInput) => Effect.Effect<SkillsInstallResult, SkillsError>;
  readonly uninstall: (
    input: SkillsUninstallInput,
  ) => Effect.Effect<SkillsUninstallResult, SkillsError>;
  readonly readContent: (
    input: SkillsReadContentInput,
  ) => Effect.Effect<SkillsReadContentResult, SkillsError>;
}

export class SkillsManager extends ServiceMap.Service<SkillsManager, SkillsManagerShape>()(
  "t3/skills/SkillsManager",
) {}

const home = os.homedir();

// ── Helpers ──────────────────────────────────────────────────────────

const ENABLED_SKILLS_DIR = path.join(home, ".agents", "skills");
const DISABLED_SKILLS_DIR = path.join(home, ".t3", "disabledSkills");

const VALID_SKILL_SLUG = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const SKILLS_SEARCH_TIMEOUT_MS = 5_000;

function assertValidSkillSlug(name: string): void {
  if (!VALID_SKILL_SLUG.test(name)) {
    throw new Error(`Invalid skill name: ${name}`);
  }
}

function stripQuotes(s: string): string {
  return (s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))
    ? s.slice(1, -1)
    : s;
}

/** Extract `name` and `description` from SKILL.md YAML frontmatter. */
function parseSkillFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { name: "", description: "" };

  const frontmatter = match[1]!;
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

  const rawName = nameMatch?.[1]?.trim() ?? "";
  const rawDesc = descMatch?.[1]?.trim() ?? "";

  return {
    name: stripQuotes(rawName),
    description: stripQuotes(rawDesc),
  };
}

/**
 * Resolve the SKILL.md path for a skill directory, trying SKILL.md then skill.md.
 * Returns the absolute path or undefined if neither exists.
 */
function resolveSkillMdPath(skillDir: string): string | undefined {
  for (const filename of ["SKILL.md", "skill.md"]) {
    const p = path.join(skillDir, filename);
    try {
      fs.accessSync(p);
      return p;
    } catch {
      // try next
    }
  }
  return undefined;
}

type SkillDirectoryState = {
  readonly enabled: boolean;
  readonly skillDir: string;
};

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fsp.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveSkillDirectoryState(
  skillName: string,
): Promise<SkillDirectoryState | undefined> {
  const enabledSkillDir = path.join(ENABLED_SKILLS_DIR, skillName);
  if (await pathExists(enabledSkillDir)) {
    return { enabled: true, skillDir: enabledSkillDir };
  }

  const disabledSkillDir = path.join(DISABLED_SKILLS_DIR, skillName);
  if (await pathExists(disabledSkillDir)) {
    return { enabled: false, skillDir: disabledSkillDir };
  }

  return undefined;
}

async function moveSkillDirectory(sourceDir: string, destinationDir: string): Promise<void> {
  await fsp.mkdir(path.dirname(destinationDir), { recursive: true });
  await fsp.rename(sourceDir, destinationDir);
}

async function listSkillDirectoryStates(): Promise<SkillDirectoryState[]> {
  const states: SkillDirectoryState[] = [];
  const seenNames = new Set<string>();

  for (const [rootDir, enabled] of [
    [ENABLED_SKILLS_DIR, true],
    [DISABLED_SKILLS_DIR, false],
  ] as const) {
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = await fsp.readdir(rootDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of dirEntries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (seenNames.has(entry.name)) continue;
      seenNames.add(entry.name);
      states.push({
        enabled,
        skillDir: path.join(rootDir, entry.name),
      });
    }
  }

  return states;
}

/** Run a CLI command and return stdout. */
function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Effect.Effect<string, SkillsError> {
  return Effect.tryPromise({
    try: () => runProcess(command, args, { timeoutMs }).then((r) => r.stdout),
    catch: (cause) =>
      new SkillsError({ message: `Command failed: ${command} ${args.join(" ")}`, cause }),
  });
}

/** Read all installed skills from the enabled and disabled skill roots. */
function listSkills(): Effect.Effect<SkillsListResult, SkillsError> {
  return Effect.tryPromise({
    try: async () => {
      const skills: SkillMetadata[] = [];
      const directoryStates = await listSkillDirectoryStates();

      for (const directoryState of directoryStates) {
        const skillName = path.basename(directoryState.skillDir);
        const skillDir = directoryState.skillDir;
        const skillMdPath = resolveSkillMdPath(skillDir);

        let content = "";
        if (skillMdPath) {
          try {
            content = await fsp.readFile(skillMdPath, "utf-8");
          } catch {
            // Couldn't read SKILL.md
          }
        }

        const { description } = parseSkillFrontmatter(content);
        const enabled = directoryState.enabled;
        const agents = enabled ? ["Codex"] : [];

        skills.push({
          name: skillName,
          description,
          enabled,
          agents,
        });
      }

      skills.sort((a, b) => a.name.localeCompare(b.name));
      return { skills } satisfies SkillsListResult;
    },
    catch: (cause) => new SkillsError({ message: `Failed to list skills`, cause }),
  });
}

/** Toggle a skill by moving its directory between the enabled and disabled roots. */
function toggleSkill(input: SkillsToggleInput): Effect.Effect<SkillsToggleResult, SkillsError> {
  return Effect.tryPromise({
    try: async () => {
      assertValidSkillSlug(input.skillName);
      const skillState = await resolveSkillDirectoryState(input.skillName);
      if (!skillState) {
        throw new Error(`Skill not found: ${input.skillName}`);
      }
      if (skillState.enabled === input.enabled) {
        return { skillName: input.skillName, enabled: input.enabled } satisfies SkillsToggleResult;
      }

      const destinationRootDir = input.enabled ? ENABLED_SKILLS_DIR : DISABLED_SKILLS_DIR;
      const destinationDir = path.join(destinationRootDir, input.skillName);
      if (await pathExists(destinationDir)) {
        throw new Error(`Destination already exists for skill: ${input.skillName}`);
      }
      await moveSkillDirectory(skillState.skillDir, destinationDir);

      return { skillName: input.skillName, enabled: input.enabled } satisfies SkillsToggleResult;
    },
    catch: (cause) =>
      new SkillsError({ message: `Failed to toggle skill: ${input.skillName}`, cause }),
  });
}

/** Search skills.sh registry via HTTP API. */
function searchSkills(input: SkillsSearchInput): Effect.Effect<SkillsSearchResult, SkillsError> {
  return Effect.tryPromise({
    try: async () => {
      const url = `https://skills.sh/api/search?q=${encodeURIComponent(input.query)}&limit=10`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SKILLS_SEARCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`skills.sh API timed out after ${SKILLS_SEARCH_TIMEOUT_MS}ms`, {
            cause: error,
          });
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) throw new Error(`skills.sh API returned ${res.status}`);
      const data = (await res.json()) as {
        skills: Array<{ id: string; name: string; installs: number; source: string }>;
      };
      const skills: SkillSearchResultEntry[] = data.skills.map((s) => ({
        name: s.name,
        source: s.source,
        installs: s.installs,
        url: `https://skills.sh/${s.id}`,
      }));
      return { skills } satisfies SkillsSearchResult;
    },
    catch: (cause) => new SkillsError({ message: `Failed to search skills.sh`, cause }),
  });
}

/** Install a skill from skills.sh into the enabled skills directory. */
function installSkill(input: SkillsInstallInput): Effect.Effect<SkillsInstallResult, SkillsError> {
  try {
    assertValidSkillSlug(input.skillName);
  } catch (error) {
    return Effect.succeed({
      success: false,
      message: error instanceof Error ? error.message : `Invalid skill name: ${input.skillName}`,
    } satisfies SkillsInstallResult);
  }
  return runCommand(
    "npx",
    ["skills", "add", input.source, "-s", input.skillName, "-g", "-y"],
    120_000,
  ).pipe(
    Effect.map(
      () =>
        ({
          success: true,
          message: `Successfully installed ${input.skillName}`,
        }) satisfies SkillsInstallResult,
    ),
    Effect.catch((error: SkillsError) =>
      Effect.succeed({
        success: false,
        message: error.message,
      } satisfies SkillsInstallResult),
    ),
  );
}

/** Uninstall a skill by removing it from both enabled and disabled storage. */
function uninstallSkill(
  input: SkillsUninstallInput,
): Effect.Effect<SkillsUninstallResult, SkillsError> {
  return Effect.tryPromise({
    try: async () => {
      assertValidSkillSlug(input.skillName);
      const candidates = [
        path.join(ENABLED_SKILLS_DIR, input.skillName),
        path.join(DISABLED_SKILLS_DIR, input.skillName),
      ];
      let removedAny = false;

      for (const candidate of candidates) {
        if (!(await pathExists(candidate))) continue;
        await fsp.rm(candidate, { recursive: true, force: false });
        removedAny = true;
      }

      if (!removedAny) {
        return {
          success: false,
          message: `Skill not found: ${input.skillName}`,
        } satisfies SkillsUninstallResult;
      }

      return {
        success: true,
        message: `Successfully uninstalled ${input.skillName}`,
      } satisfies SkillsUninstallResult;
    },
    catch: (cause) =>
      new SkillsError({ message: `Failed to uninstall skill: ${input.skillName}`, cause }),
  }).pipe(
    Effect.catch((error: SkillsError) =>
      Effect.succeed({
        success: false,
        message: error.message,
      } satisfies SkillsUninstallResult),
    ),
  );
}

/** Read the full SKILL.md content (stripping YAML frontmatter) for a given skill. */
function readContent(
  input: SkillsReadContentInput,
): Effect.Effect<SkillsReadContentResult, SkillsError> {
  return Effect.tryPromise({
    try: async () => {
      assertValidSkillSlug(input.skillName);
      const skillState = await resolveSkillDirectoryState(input.skillName);
      if (!skillState) {
        throw new Error(`Skill not found: ${input.skillName}`);
      }
      const skillMdPath = resolveSkillMdPath(skillState.skillDir);
      if (!skillMdPath) {
        throw new Error(`No SKILL.md found for ${input.skillName}`);
      }

      const raw = await fsp.readFile(skillMdPath, "utf-8");

      // Strip YAML frontmatter (everything between opening and closing ---)
      const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/, "").trim();

      return { skillName: input.skillName, content } satisfies SkillsReadContentResult;
    },
    catch: (cause) =>
      new SkillsError({ message: `Failed to read skill content: ${input.skillName}`, cause }),
  });
}

// ── Live Layer ───────────────────────────────────────────────────────

export const SkillsManagerLive = Layer.succeed(SkillsManager, {
  list: listSkills(),
  toggle: toggleSkill,
  search: searchSkills,
  install: installSkill,
  uninstall: uninstallSkill,
  readContent,
});

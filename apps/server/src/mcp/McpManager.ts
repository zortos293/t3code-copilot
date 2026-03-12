/**
 * McpManager - Service for listing, adding, removing, toggling, and browsing
 * MCP (Model Context Protocol) servers.
 *
 * Reads/writes from native CLI config files:
 *  - Codex:  ~/.codex/config.toml   ([mcp_servers.*] sections)
 *  - Copilot: ~/.copilot/mcp-config.json  (mcpServers object)
 *
 * Disabled servers are tracked in ~/.t3/mcp-disabled.json so they can be
 * re-enabled without data loss.
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import type {
  McpServerConfig,
  McpListResult,
  McpAddInput,
  McpAddResult,
  McpRemoveInput,
  McpRemoveResult,
  McpToggleInput,
  McpToggleResult,
  McpUpdateInput,
  McpUpdateResult,
  McpBrowseResult,
  McpCatalogEntry,
} from "@t3tools/contracts";
import { Effect, Layer, Schema, ServiceMap } from "effect";

// ── Error ────────────────────────────────────────────────────────────

export class McpError extends Schema.TaggedErrorClass<McpError>()("McpError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

// ── Service Interface ────────────────────────────────────────────────

export interface McpManagerShape {
  readonly list: Effect.Effect<McpListResult, McpError>;
  readonly add: (input: McpAddInput) => Effect.Effect<McpAddResult, McpError>;
  readonly remove: (input: McpRemoveInput) => Effect.Effect<McpRemoveResult, McpError>;
  readonly toggle: (input: McpToggleInput) => Effect.Effect<McpToggleResult, McpError>;
  readonly update: (input: McpUpdateInput) => Effect.Effect<McpUpdateResult, McpError>;
  readonly browse: Effect.Effect<McpBrowseResult, McpError>;
}

export class McpManager extends ServiceMap.Service<McpManager, McpManagerShape>()(
  "t3/mcp/McpManager",
) {}

// ── Paths ────────────────────────────────────────────────────────────

const home = os.homedir();
const CODEX_CONFIG_PATH = path.join(home, ".codex", "config.toml");
const COPILOT_MCP_PATH = path.join(home, ".copilot", "mcp-config.json");
const DISABLED_CACHE_PATH = path.join(home, ".t3", "mcp-disabled.json");
const VALID_SERVER_NAME = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function assertValidServerName(name: string): void {
  if (!VALID_SERVER_NAME.test(name)) {
    throw new Error(`Invalid MCP server name: ${name}`);
  }
}

/** Validate that an add/update input has a valid transport configuration. */
function assertValidTransport(input: {
  command?: string | undefined;
  url?: string | undefined;
  bearerToken?: string | undefined;
  provider: "codex" | "copilot";
}): void {
  if (!input.command && !input.url) {
    throw new Error("Either command (stdio) or url (http) must be provided");
  }
  if (input.command && input.url) {
    throw new Error("Cannot specify both command and url — pick stdio or http transport");
  }
  if (input.bearerToken && input.provider !== "codex") {
    throw new Error("bearerToken is only supported for Codex provider");
  }
}

// ── Per-file mutex to serialize config read-modify-write ─────────────

class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => resolve(() => this.release()));
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

const codexMutex = new Mutex();
const copilotMutex = new Mutex();
const disabledMutex = new Mutex();

/** Run fn while holding the mutexes for the given provider + disabled cache. */
async function withConfigLock<T>(provider: "codex" | "copilot", fn: () => Promise<T>): Promise<T> {
  const configRelease = await (provider === "codex" ? codexMutex : copilotMutex).acquire();
  const disabledRelease = await disabledMutex.acquire();
  try {
    return await fn();
  } finally {
    disabledRelease();
    configRelease();
  }
}

// ── Disabled cache (preserves configs of disabled servers) ───────────

interface DisabledEntry {
  provider: "codex" | "copilot";
  config: Record<string, unknown>;
}

type DisabledCache = Record<string, DisabledEntry>;

async function readDisabledCache(): Promise<DisabledCache> {
  try {
    const raw = await fsp.readFile(DISABLED_CACHE_PATH, "utf-8");
    return JSON.parse(raw) as DisabledCache;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeDisabledCache(cache: DisabledCache): Promise<void> {
  await fsp.mkdir(path.dirname(DISABLED_CACHE_PATH), { recursive: true });
  await fsp.writeFile(DISABLED_CACHE_PATH, JSON.stringify(cache, null, 2) + "\n", "utf-8");
}

// ── Codex config (TOML) ─────────────────────────────────────────────

interface CodexTomlConfig {
  [key: string]: unknown;
  mcp_servers?: Record<string, Record<string, unknown>>;
}

async function readCodexConfig(): Promise<CodexTomlConfig> {
  try {
    const raw = await fsp.readFile(CODEX_CONFIG_PATH, "utf-8");
    return parseToml(raw) as CodexTomlConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeCodexConfig(config: CodexTomlConfig): Promise<void> {
  await fsp.mkdir(path.dirname(CODEX_CONFIG_PATH), { recursive: true });
  await fsp.writeFile(CODEX_CONFIG_PATH, stringifyToml(config) + "\n", "utf-8");
}

function codexEntryToMcpServer(
  name: string,
  entry: Record<string, unknown>,
  enabled: boolean,
): McpServerConfig {
  const headers =
    entry.headers != null && typeof entry.headers === "object" && !Array.isArray(entry.headers)
      ? (entry.headers as Record<string, string>)
      : undefined;
  return {
    name,
    provider: "codex",
    enabled,
    ...(typeof entry.type === "string" ? { type: entry.type } : {}),
    ...(typeof entry.command === "string" ? { command: entry.command } : {}),
    ...(Array.isArray(entry.args) ? { args: entry.args as string[] } : {}),
    ...(typeof entry.url === "string" ? { url: entry.url } : {}),
    ...(headers ? { headers } : {}),
    ...(typeof entry.bearer_token_env_var === "string"
      ? { bearerToken: entry.bearer_token_env_var }
      : {}),
    ...(Array.isArray(entry.tools) ? { tools: entry.tools as string[] } : {}),
  };
}

// ── Copilot config (JSON) ────────────────────────────────────────────

interface CopilotMcpConfig {
  mcpServers?: Record<string, Record<string, unknown>>;
}

async function readCopilotConfig(): Promise<CopilotMcpConfig> {
  try {
    const raw = await fsp.readFile(COPILOT_MCP_PATH, "utf-8");
    return JSON.parse(raw) as CopilotMcpConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeCopilotConfig(config: CopilotMcpConfig): Promise<void> {
  await fsp.mkdir(path.dirname(COPILOT_MCP_PATH), { recursive: true });
  await fsp.writeFile(COPILOT_MCP_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function copilotEntryToMcpServer(
  name: string,
  entry: Record<string, unknown>,
  enabled: boolean,
): McpServerConfig {
  const headers =
    entry.headers != null && typeof entry.headers === "object" && !Array.isArray(entry.headers)
      ? (entry.headers as Record<string, string>)
      : undefined;
  return {
    name,
    provider: "copilot",
    enabled,
    ...(typeof entry.type === "string" ? { type: entry.type } : {}),
    ...(typeof entry.command === "string" ? { command: entry.command } : {}),
    ...(Array.isArray(entry.args) ? { args: entry.args as string[] } : {}),
    ...(typeof entry.url === "string" ? { url: entry.url } : {}),
    ...(headers ? { headers } : {}),
    ...(Array.isArray(entry.tools) ? { tools: entry.tools as string[] } : {}),
  };
}

// ── Curated MCP Catalog ──────────────────────────────────────────────

const MCP_CATALOG: McpCatalogEntry[] = [
  {
    name: "context7",
    description: "Up-to-date documentation and code examples for any library",
    mcpUrl: "https://mcp.context7.com/mcp",
    infoUrl: "https://context7.com",
  },
  {
    name: "playwright",
    description: "Browser automation, testing, and scraping with Playwright",
    command: "npx",
    args: ["@playwright/mcp@latest"],
    infoUrl: "https://github.com/microsoft/playwright-mcp",
  },
  {
    name: "filesystem",
    description: "Read, write, and manage files and directories",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    infoUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    installPrompts: [
      {
        id: "path",
        label: "Allowed Directory",
        placeholder: "/Users/you/Documents",
        required: true,
      },
    ],
  },
  {
    name: "github",
    description: "Interact with GitHub repos, issues, and pull requests",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    infoUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    installPrompts: [
      {
        id: "token",
        label: "GitHub Personal Access Token",
        placeholder: "ghp_xxxxxxxxxxxx",
        required: false,
      },
    ],
  },
  {
    name: "postgres",
    description: "Query and manage PostgreSQL databases",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    infoUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    installPrompts: [
      {
        id: "connectionString",
        label: "Connection String",
        placeholder: "postgresql://user:pass@localhost:5432/mydb",
        required: true,
      },
    ],
  },
  {
    name: "sqlite",
    description: "Query and manage SQLite databases",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
    infoUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    installPrompts: [
      {
        id: "dbPath",
        label: "Database Path",
        placeholder: "/path/to/database.sqlite",
        required: true,
      },
    ],
  },
  {
    name: "brave-search",
    description: "Search the web using Brave Search API",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    infoUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    installPrompts: [
      {
        id: "apiKey",
        label: "Brave API Key",
        placeholder: "BSA_xxxxxxxxxxxxxxxx",
        required: true,
      },
    ],
  },
  {
    name: "memory",
    description: "Persistent memory using a local knowledge graph",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    infoUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    name: "fetch",
    description: "Fetch and convert web content to markdown",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    infoUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
  {
    name: "puppeteer",
    description: "Automate browser interactions and take screenshots",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    infoUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
  },
  {
    name: "slack",
    description: "Interact with Slack workspaces and channels",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    infoUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    installPrompts: [
      {
        id: "botToken",
        label: "Slack Bot Token",
        placeholder: "xoxb-xxxxxxxxxxxx",
        required: true,
      },
      {
        id: "teamId",
        label: "Slack Team ID",
        placeholder: "T0123456789",
        required: true,
      },
    ],
  },
  {
    name: "sequential-thinking",
    description: "Dynamic problem-solving through structured thought sequences",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    infoUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
  },
];

// ── Implementation ───────────────────────────────────────────────────

function listServers(): Effect.Effect<McpListResult, McpError> {
  return Effect.tryPromise({
    try: async () => {
      const [codexConfig, copilotConfig, disabled] = await Promise.all([
        readCodexConfig(),
        readCopilotConfig(),
        readDisabledCache(),
      ]);

      const servers: McpServerConfig[] = [];

      // Codex servers (from config.toml)
      if (codexConfig.mcp_servers) {
        for (const [name, entry] of Object.entries(codexConfig.mcp_servers)) {
          servers.push(codexEntryToMcpServer(name, entry, true));
        }
      }

      // Copilot servers (from mcp-config.json)
      if (copilotConfig.mcpServers) {
        for (const [name, entry] of Object.entries(copilotConfig.mcpServers)) {
          servers.push(copilotEntryToMcpServer(name, entry, true));
        }
      }

      // Disabled servers (from cache — keys are "provider:name")
      for (const [cacheKey, entry] of Object.entries(disabled)) {
        const name = cacheKey.slice(entry.provider.length + 1);
        const alreadyListed = servers.some((s) => s.name === name && s.provider === entry.provider);
        if (!alreadyListed) {
          if (entry.provider === "codex") {
            servers.push(codexEntryToMcpServer(name, entry.config, false));
          } else {
            servers.push(copilotEntryToMcpServer(name, entry.config, false));
          }
        }
      }

      servers.sort((a, b) => a.name.localeCompare(b.name));
      return { servers } satisfies McpListResult;
    },
    catch: (cause) => new McpError({ message: "Failed to list MCP servers", cause }),
  });
}

function addServer(input: McpAddInput): Effect.Effect<McpAddResult, McpError> {
  return Effect.tryPromise({
    try: () =>
      withConfigLock(input.provider, async () => {
        assertValidServerName(input.name);
        assertValidTransport(input);
        if (input.provider === "codex") {
          const config = await readCodexConfig();
          if (!config.mcp_servers) config.mcp_servers = {};

          if (config.mcp_servers[input.name]) {
            return { success: false, message: `"${input.name}" already exists in Codex config` };
          }

          const entry: Record<string, unknown> = {};
          if (input.command) entry.command = input.command;
          if (input.args?.length) entry.args = [...input.args];
          if (input.url) entry.url = input.url;
          if (input.bearerToken) entry.bearer_token_env_var = input.bearerToken;
          config.mcp_servers[input.name] = entry;
          await writeCodexConfig(config);
        } else {
          const config = await readCopilotConfig();
          if (!config.mcpServers) config.mcpServers = {};

          if (config.mcpServers[input.name]) {
            return { success: false, message: `"${input.name}" already exists in Copilot config` };
          }

          const entry: Record<string, unknown> = {};
          if (input.command) {
            entry.type = "stdio";
            entry.command = input.command;
          }
          if (input.args?.length) entry.args = [...input.args];
          if (input.url) {
            if (!input.command) entry.type = "http";
            entry.url = input.url;
          }
          if (input.headers && Object.keys(input.headers).length > 0) {
            entry.headers = { ...input.headers };
          }
          config.mcpServers[input.name] = entry;
          await writeCopilotConfig(config);
        }

        return { success: true, message: `Added "${input.name}" to ${input.provider}` };
      }),
    catch: (cause) => new McpError({ message: `Failed to add MCP server: ${input.name}`, cause }),
  });
}

function removeServer(input: McpRemoveInput): Effect.Effect<McpRemoveResult, McpError> {
  return Effect.tryPromise({
    try: () =>
      withConfigLock(input.provider, async () => {
        if (input.provider === "codex") {
          const config = await readCodexConfig();
          if (!config.mcp_servers?.[input.name]) {
            return { success: false, message: `"${input.name}" not found in Codex config` };
          }
          delete config.mcp_servers[input.name];
          await writeCodexConfig(config);
        } else {
          const config = await readCopilotConfig();
          if (!config.mcpServers?.[input.name]) {
            return { success: false, message: `"${input.name}" not found in Copilot config` };
          }
          delete config.mcpServers[input.name];
          await writeCopilotConfig(config);
        }

        // Also remove from disabled cache if present
        const disabled = await readDisabledCache();
        const key = `${input.provider}:${input.name}`;
        if (disabled[key]) {
          delete disabled[key];
          await writeDisabledCache(disabled);
        }

        return { success: true, message: `Removed "${input.name}" from ${input.provider}` };
      }),
    catch: (cause) =>
      new McpError({ message: `Failed to remove MCP server: ${input.name}`, cause }),
  });
}

function toggleServer(input: McpToggleInput): Effect.Effect<McpToggleResult, McpError> {
  return Effect.tryPromise({
    try: () =>
      withConfigLock(input.provider, async () => {
        const cacheKey = `${input.provider}:${input.name}`;

        if (!input.enabled) {
          // Disable: move from native config to disabled cache
          let config: Record<string, unknown> | undefined;

          if (input.provider === "codex") {
            const codexConfig = await readCodexConfig();
            config = codexConfig.mcp_servers?.[input.name];
            if (!config) {
              throw new Error(`"${input.name}" not found in Codex config`);
            }
            delete codexConfig.mcp_servers![input.name];
            await writeCodexConfig(codexConfig);
          } else {
            const copilotConfig = await readCopilotConfig();
            config = copilotConfig.mcpServers?.[input.name];
            if (!config) {
              throw new Error(`"${input.name}" not found in Copilot config`);
            }
            delete copilotConfig.mcpServers![input.name];
            await writeCopilotConfig(copilotConfig);
          }

          const disabled = await readDisabledCache();
          disabled[cacheKey] = { provider: input.provider, config };
          await writeDisabledCache(disabled);
        } else {
          // Enable: move from disabled cache back to native config
          const disabled = await readDisabledCache();
          const entry = disabled[cacheKey];

          if (!entry) {
            throw new Error(`"${input.name}" not found in disabled cache`);
          }

          if (input.provider === "codex") {
            const codexConfig = await readCodexConfig();
            if (!codexConfig.mcp_servers) codexConfig.mcp_servers = {};
            codexConfig.mcp_servers[input.name] = entry.config;
            await writeCodexConfig(codexConfig);
          } else {
            const copilotConfig = await readCopilotConfig();
            if (!copilotConfig.mcpServers) copilotConfig.mcpServers = {};
            copilotConfig.mcpServers[input.name] = entry.config;
            await writeCopilotConfig(copilotConfig);
          }
          delete disabled[cacheKey];
          await writeDisabledCache(disabled);
        }

        return { name: input.name, enabled: input.enabled } satisfies McpToggleResult;
      }),
    catch: (cause) =>
      new McpError({ message: `Failed to toggle MCP server: ${input.name}`, cause }),
  });
}

function browseCatalog(): Effect.Effect<McpBrowseResult, McpError> {
  return Effect.succeed({ servers: MCP_CATALOG } satisfies McpBrowseResult);
}

function updateServer(input: McpUpdateInput): Effect.Effect<McpUpdateResult, McpError> {
  return Effect.tryPromise({
    try: () =>
      withConfigLock(input.provider, async () => {
        if (input.provider === "codex") {
          const config = await readCodexConfig();
          const entry = config.mcp_servers?.[input.name];
          if (!entry) {
            return { success: false, message: `"${input.name}" not found in Codex config` };
          }
          if (input.command !== undefined) entry.command = input.command;
          if (input.args !== undefined) entry.args = [...input.args];
          if (input.url !== undefined) entry.url = input.url;
          if (input.headers !== undefined) entry.headers = { ...input.headers };
          if (input.bearerToken !== undefined) entry.bearer_token_env_var = input.bearerToken;
          await writeCodexConfig(config);
        } else {
          const config = await readCopilotConfig();
          const entry = config.mcpServers?.[input.name];
          if (!entry) {
            return { success: false, message: `"${input.name}" not found in Copilot config` };
          }
          if (input.command !== undefined) entry.command = input.command;
          if (input.args !== undefined) entry.args = [...input.args];
          if (input.url !== undefined) entry.url = input.url;
          if (input.headers !== undefined) entry.headers = { ...input.headers };
          await writeCopilotConfig(config);
        }

        return { success: true, message: `Updated "${input.name}" in ${input.provider}` };
      }),
    catch: (cause) =>
      new McpError({ message: `Failed to update MCP server: ${input.name}`, cause }),
  });
}

// ── Live Layer ───────────────────────────────────────────────────────

export const McpManagerLive = Layer.succeed(McpManager, {
  list: listServers(),
  add: addServer,
  remove: removeServer,
  toggle: toggleServer,
  update: updateServer,
  browse: browseCatalog(),
});

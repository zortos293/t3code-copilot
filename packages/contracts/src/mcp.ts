import { Schema } from "effect";

// ── Provider kind for MCP server source ──────────────────────────────

export const McpProviderKind = Schema.Union([Schema.Literal("codex"), Schema.Literal("copilot")]);
export type McpProviderKind = typeof McpProviderKind.Type;

// ── MCP Server config (read from native CLI configs) ─────────────────

export const McpServerConfig = Schema.Struct({
  /** Unique server name (key in the config file). */
  name: Schema.String,
  /** Which CLI owns this server config. */
  provider: McpProviderKind,
  /** Whether the server is currently enabled (present in config). */
  enabled: Schema.Boolean,
  /** Transport type: "stdio" | "http". */
  type: Schema.optional(Schema.String),
  /** Stdio transport: the command to run. */
  command: Schema.optional(Schema.String),
  /** Stdio transport: command arguments. */
  args: Schema.optional(Schema.Array(Schema.String)),
  /** URL transport: remote MCP endpoint. */
  url: Schema.optional(Schema.String),
  /** HTTP transport: request headers (e.g. auth tokens). */
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Codex URL transport: bearer token or env var name for Authorization header. */
  bearerToken: Schema.optional(Schema.String),
  /** Declared tool names this server provides. */
  tools: Schema.optional(Schema.Array(Schema.String)),
});
export type McpServerConfig = typeof McpServerConfig.Type;

export const McpListResult = Schema.Struct({
  servers: Schema.Array(McpServerConfig),
});
export type McpListResult = typeof McpListResult.Type;

// ── Add MCP server ──────────────────────────────────────────────────

export const McpAddInput = Schema.Struct({
  name: Schema.String,
  provider: McpProviderKind,
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  bearerToken: Schema.optional(Schema.String),
});
export type McpAddInput = typeof McpAddInput.Type;

export const McpAddResult = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
});
export type McpAddResult = typeof McpAddResult.Type;

// ── Remove MCP server ───────────────────────────────────────────────

export const McpRemoveInput = Schema.Struct({
  name: Schema.String,
  provider: McpProviderKind,
});
export type McpRemoveInput = typeof McpRemoveInput.Type;

export const McpRemoveResult = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
});
export type McpRemoveResult = typeof McpRemoveResult.Type;

// ── Toggle MCP server on/off ────────────────────────────────────────

export const McpToggleInput = Schema.Struct({
  name: Schema.String,
  provider: McpProviderKind,
  enabled: Schema.Boolean,
});
export type McpToggleInput = typeof McpToggleInput.Type;

export const McpToggleResult = Schema.Struct({
  name: Schema.String,
  enabled: Schema.Boolean,
});
export type McpToggleResult = typeof McpToggleResult.Type;

// ── Update MCP server config (command, args, url) ───────────────────

export const McpUpdateInput = Schema.Struct({
  name: Schema.String,
  provider: McpProviderKind,
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  bearerToken: Schema.optional(Schema.String),
});
export type McpUpdateInput = typeof McpUpdateInput.Type;

export const McpUpdateResult = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
});
export type McpUpdateResult = typeof McpUpdateResult.Type;

// ── Browse MCP catalog ──────────────────────────────────────────────

export const McpInstallPrompt = Schema.Struct({
  /** Unique identifier for this prompt. */
  id: Schema.String,
  /** Label shown to the user. */
  label: Schema.String,
  /** Placeholder hint text. */
  placeholder: Schema.String,
  /** Whether a value is required to install. */
  required: Schema.Boolean,
});
export type McpInstallPrompt = typeof McpInstallPrompt.Type;

export const McpCatalogEntry = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  /** Stdio transport: the command to run. */
  command: Schema.optional(Schema.String),
  /** Stdio transport: base arguments (user-prompted values are appended). */
  args: Schema.optional(Schema.Array(Schema.String)),
  /** Documentation / info URL (GitHub, homepage). */
  infoUrl: Schema.optional(Schema.String),
  /** HTTP transport: remote MCP endpoint URL. */
  mcpUrl: Schema.optional(Schema.String),
  /** Prompts to collect from user before installing (values appended to args). */
  installPrompts: Schema.optional(Schema.Array(McpInstallPrompt)),
});
export type McpCatalogEntry = typeof McpCatalogEntry.Type;

export const McpBrowseResult = Schema.Struct({
  servers: Schema.Array(McpCatalogEntry),
});
export type McpBrowseResult = typeof McpBrowseResult.Type;

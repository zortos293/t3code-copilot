import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LoaderIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";

import type { McpCatalogEntry, McpServerConfig } from "@t3tools/contracts";
import { isElectron } from "../env";
import { GitHubIcon, OpenAI } from "../components/Icons";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { SidebarInset } from "~/components/ui/sidebar";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import {
  mcpListQueryOptions,
  mcpBrowseQueryOptions,
  mcpToggleMutationOptions,
  mcpAddMutationOptions,
  mcpRemoveMutationOptions,
  mcpUpdateMutationOptions,
} from "../lib/mcpReactQuery";
import { toastManager } from "../components/ui/toast";

// ── Colors for server icons ─────────────────────────────────────────

const SERVER_COLORS = [
  "text-blue-500",
  "text-violet-500",
  "text-emerald-500",
  "text-amber-500",
  "text-rose-500",
  "text-cyan-500",
  "text-indigo-500",
  "text-teal-500",
  "text-orange-500",
  "text-pink-500",
];

function serverColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return SERVER_COLORS[Math.abs(hash) % SERVER_COLORS.length]!;
}

function formatDisplayName(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function mutationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

// ── Provider Badge ──────────────────────────────────────────────────

function ProviderBadge({ provider }: { provider: "codex" | "copilot" }) {
  const styles =
    provider === "codex"
      ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
      : "bg-blue-500/10 text-blue-400 ring-blue-500/20";
  const Icon = provider === "codex" ? OpenAI : GitHubIcon;
  const tooltip = provider === "codex" ? "Codex" : "GitHub Copilot";
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center rounded-full p-0.5 ring-1 ring-inset ${styles}`}
    >
      <Icon className="size-3" />
    </span>
  );
}

// ── Server transport badge ──────────────────────────────────────────

function TransportBadge({ server }: { server: McpServerConfig }) {
  const isUrl = !!server.url && !server.command;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
      {isUrl ? (
        <>
          <GlobeIcon className="size-2.5" />
          URL
        </>
      ) : (
        <>
          <TerminalIcon className="size-2.5" />
          stdio
        </>
      )}
    </span>
  );
}

// ── Server Settings Editor (command/args or url/headers) ────────────

function ServerSettingsEditor({
  server,
  onSave,
  isSaving,
  onClose,
}: {
  server: McpServerConfig;
  onSave: (data: {
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
    bearerToken?: string;
  }) => void;
  isSaving: boolean;
  onClose: () => void;
}) {
  const isHttpServer = server.type === "http" || (!!server.url && !server.command);
  const [command, setCommand] = useState(server.command ?? "");
  const [argsText, setArgsText] = useState((server.args ?? []).join("\n"));
  const [url, setUrl] = useState(server.url ?? "");
  const [bearerToken, setBearerToken] = useState(server.bearerToken ?? "");
  const [headersText, setHeadersText] = useState(
    server.headers
      ? Object.entries(server.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      : "",
  );

  const handleSave = () => {
    if (isHttpServer) {
      const trimmedUrl = url.trim();
      const trimmedToken = bearerToken.trim();
      const parsedHeaders: Record<string, string> = {};
      for (const line of headersText.split("\n")) {
        const idx = line.indexOf(":");
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim();
          if (key) parsedHeaders[key] = val;
        }
      }
      onSave({
        ...(trimmedUrl ? { url: trimmedUrl } : {}),
        ...(trimmedToken ? { bearerToken: trimmedToken } : {}),
        ...(Object.keys(parsedHeaders).length > 0 ? { headers: parsedHeaders } : {}),
      });
    } else {
      const trimmedCmd = command.trim();
      const parsedArgs = argsText
        .split("\n")
        .map((a) => a.trim())
        .filter(Boolean);
      onSave({
        ...(trimmedCmd ? { command: trimmedCmd } : {}),
        ...(parsedArgs.length > 0 ? { args: parsedArgs } : {}),
      });
    }
  };

  return (
    <div className="mt-3 space-y-2.5 border-t border-border/50 pt-3">
      <div className="flex items-center gap-2">
        <SettingsIcon className="size-3 text-muted-foreground/60" />
        <span className="text-[11px] font-medium text-muted-foreground">Server Configuration</span>
      </div>

      {isHttpServer ? (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-[10px] font-medium text-muted-foreground/70">
              URL
            </label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/mcp/"
              className="h-7 font-mono text-[11px]"
            />
          </div>
          {server.provider === "codex" ? (
            <div>
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground/70">
                Bearer Token
              </label>
              <Input
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                placeholder="Token or env var name"
                className="h-7 font-mono text-[11px]"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground/70">
                Headers <span className="text-muted-foreground/40">(one per line, Key: Value)</span>
              </label>
              <textarea
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                placeholder={"Authorization: Bearer sk-...\nX-Custom: value"}
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[10px] font-medium text-muted-foreground/70">
              Command
            </label>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
              className="h-7 font-mono text-[11px]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-muted-foreground/70">
              Arguments (one per line)
            </label>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder={"-y\n@scope/package\n--api-key=..."}
              className="h-16 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              rows={3}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-1.5">
        <Button size="xs" variant="ghost" onClick={onClose} className="h-6 text-[11px]">
          Cancel
        </Button>
        <Button
          size="xs"
          onClick={handleSave}
          disabled={isSaving}
          className="h-6 gap-1 text-[11px]"
        >
          {isSaving ? (
            <LoaderIcon className="size-2.5 animate-spin" />
          ) : (
            <CheckIcon className="size-2.5" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}

// ── Tool Badges ─────────────────────────────────────────────────────

const MAX_VISIBLE_TOOLS = 10;

function ToolBadges({ tools }: { tools?: readonly string[] }) {
  if (!tools || tools.length === 0) return null;

  const visible = tools.slice(0, MAX_VISIBLE_TOOLS);
  const overflow = tools.length - MAX_VISIBLE_TOOLS;

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {visible.map((tool) => (
        <span
          key={tool}
          className="inline-flex items-center rounded-md bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-inset ring-foreground/10"
        >
          {tool}
        </span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center rounded-md bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/60 ring-1 ring-inset ring-foreground/10">
          +{overflow}
        </span>
      )}
    </div>
  );
}

// ── Installed MCP Server Card ───────────────────────────────────────

function McpServerCard({
  server,
  onToggle,
  isToggling,
  onRemove,
  isRemoving,
  onUpdate,
  isUpdating,
}: {
  server: McpServerConfig;
  onToggle: (name: string, provider: "codex" | "copilot", enabled: boolean) => void;
  isToggling: boolean;
  onRemove: (name: string, provider: "codex" | "copilot") => void;
  isRemoving: boolean;
  onUpdate: (
    name: string,
    provider: "codex" | "copilot",
    data: {
      command?: string;
      args?: string[];
      url?: string;
      headers?: Record<string, string>;
      bearerToken?: string;
    },
  ) => Promise<boolean>;
  isUpdating: boolean;
}) {
  const [showSettings, setShowSettings] = useState(false);

  const cmd = server.command
    ? `${server.command} ${(server.args ?? []).join(" ")}`
    : (server.url ?? "—");

  return (
    <div
      className={`rounded-xl border border-border bg-card p-4 transition-colors ${!server.enabled ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-3">
        <PlugIcon className={`mt-0.5 size-5 shrink-0 ${serverColor(server.name)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">{formatDisplayName(server.name)}</p>
            <ProviderBadge provider={server.provider} />
            <TransportBadge server={server} />
          </div>
          <p className="mt-0.5 truncate text-xs font-mono text-muted-foreground/70">{cmd}</p>
          <ToolBadges {...(server.tools ? { tools: server.tools } : {})} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className={`inline-flex size-7 items-center justify-center rounded-md transition-colors ${
              showSettings
                ? "bg-accent text-foreground"
                : "text-muted-foreground/50 hover:bg-accent hover:text-foreground"
            }`}
            onClick={() => setShowSettings(!showSettings)}
            aria-label={`Settings for ${server.name}`}
          >
            <SettingsIcon className="size-3.5" />
          </button>
          <Switch
            checked={server.enabled}
            onCheckedChange={(checked) => onToggle(server.name, server.provider, Boolean(checked))}
            disabled={isToggling}
            aria-label={`Toggle ${server.name}`}
          />
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            onClick={() => onRemove(server.name, server.provider)}
            disabled={isRemoving}
            aria-label={`Remove ${server.name}`}
          >
            {isRemoving ? (
              <LoaderIcon className="size-3.5 animate-spin" />
            ) : (
              <Trash2Icon className="size-3.5" />
            )}
          </button>
        </div>
      </div>

      {showSettings && (
        <ServerSettingsEditor
          server={server}
          onSave={async (data) => {
            const ok = await onUpdate(server.name, server.provider, data);
            if (ok) setShowSettings(false);
          }}
          isSaving={isUpdating}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// ── Catalog Card ────────────────────────────────────────────────────

function CatalogCard({
  entry,
  installedProviders,
  onInstall,
  isInstalling,
}: {
  entry: McpCatalogEntry;
  installedProviders: Set<string>;
  onInstall: (entry: McpCatalogEntry, provider: "codex" | "copilot") => void;
  isInstalling: boolean;
}) {
  const codexInstalled = installedProviders.has(`codex:${entry.name}`);
  const copilotInstalled = installedProviders.has(`copilot:${entry.name}`);
  const hasPrompts = entry.installPrompts && entry.installPrompts.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/50">
      <div className="flex items-start gap-3">
        <PlugIcon className={`mt-0.5 size-5 shrink-0 ${serverColor(entry.name)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">{formatDisplayName(entry.name)}</p>
            {entry.infoUrl && (
              <a
                href={entry.infoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground/40 transition-colors hover:text-muted-foreground"
              >
                <ExternalLinkIcon className="size-3" />
              </a>
            )}
            {hasPrompts && (
              <span className="text-[9px] text-muted-foreground/40">requires setup</span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{entry.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {codexInstalled ? (
            <span
              title="Codex"
              className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 p-1 text-emerald-400 ring-1 ring-inset ring-emerald-500/20"
            >
              <OpenAI className="size-3" />
              <CheckIcon className="size-2" />
            </span>
          ) : (
            <Button
              size="xs"
              variant="outline"
              disabled={isInstalling}
              onClick={() => onInstall(entry, "codex")}
              className="size-6 p-0"
              title="Install for Codex"
              aria-label="Install for Codex"
            >
              {isInstalling ? (
                <LoaderIcon className="size-2.5 animate-spin" />
              ) : (
                <OpenAI className="size-3 opacity-50" />
              )}
            </Button>
          )}
          {copilotInstalled ? (
            <span
              title="GitHub Copilot"
              className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/10 p-1 text-blue-400 ring-1 ring-inset ring-blue-500/20"
            >
              <GitHubIcon className="size-3" />
              <CheckIcon className="size-2" />
            </span>
          ) : (
            <Button
              size="xs"
              variant="outline"
              disabled={isInstalling}
              onClick={() => onInstall(entry, "copilot")}
              className="size-6 p-0"
              title="Install for GitHub Copilot"
              aria-label="Install for GitHub Copilot"
            >
              {isInstalling ? (
                <LoaderIcon className="size-2.5 animate-spin" />
              ) : (
                <GitHubIcon className="size-3 opacity-50" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Install Prompt Dialog ───────────────────────────────────────────

function InstallPromptDialog({
  open,
  onOpenChange,
  entry,
  provider,
  onConfirm,
  isInstalling,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: McpCatalogEntry | null;
  provider: "codex" | "copilot";
  onConfirm: (
    entry: McpCatalogEntry,
    provider: "codex" | "copilot",
    promptValues: string[],
  ) => void;
  isInstalling: boolean;
}) {
  const prompts = entry?.installPrompts ?? [];
  const [values, setValues] = useState<string[]>([]);

  // Reset values when dialog opens with a new entry
  const entryName = entry?.name;
  const promptCount = prompts.length;
  useEffect(() => {
    setValues(Array.from({ length: promptCount }, () => ""));
  }, [entryName, promptCount]);

  const updateValue = (index: number, value: string) => {
    setValues((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const canSubmit =
    entry != null && prompts.every((p, i) => !p.required || (values[i] ?? "").trim().length > 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entry || !canSubmit) return;
    onConfirm(entry, provider, values);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isInstalling) {
          onOpenChange(nextOpen);
          if (!nextOpen) setValues(Array.from({ length: promptCount }, () => ""));
        }
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Install {entry ? formatDisplayName(entry.name) : ""}</DialogTitle>
          <DialogDescription>
            Configure required settings for{" "}
            <span className="inline-flex items-center gap-1 align-middle font-medium">
              {provider === "codex" ? (
                <>
                  <OpenAI className="size-3.5" /> Codex
                </>
              ) : (
                <>
                  <GitHubIcon className="size-3.5" /> GitHub Copilot
                </>
              )}
            </span>
            .
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="install-prompt-form" onSubmit={handleSubmit} className="space-y-4">
            {prompts.map((prompt, i) => (
              <div key={prompt.id}>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {prompt.label}
                  {prompt.required && <span className="ml-0.5 text-destructive">*</span>}
                </label>
                <Input
                  value={values[i] ?? ""}
                  onChange={(e) => updateValue(i, e.target.value)}
                  placeholder={prompt.placeholder}
                  className="font-mono text-sm"
                  required={prompt.required}
                />
              </div>
            ))}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              setValues(Array.from({ length: promptCount }, () => ""));
            }}
            disabled={isInstalling}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="install-prompt-form"
            size="sm"
            disabled={isInstalling || !canSubmit}
          >
            {isInstalling && <LoaderIcon className="mr-1.5 size-3.5 animate-spin" />}
            Install
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

// ── Add Server Dialog ───────────────────────────────────────────────

function AddServerDialog({
  open,
  onOpenChange,
  onAdd,
  isAdding,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (data: {
    name: string;
    provider: "codex" | "copilot";
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
    bearerToken?: string;
  }) => void;
  isAdding: boolean;
}) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<"codex" | "copilot">("codex");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [mode, setMode] = useState<"stdio" | "url">("stdio");

  const resetForm = () => {
    setName("");
    setProvider("codex");
    setCommand("");
    setArgs([]);
    setUrl("");
    setBearerToken("");
    setHeadersText("");
    setMode("stdio");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const base = { name: name.trim(), provider } as const;

    if (mode === "stdio") {
      const trimmedCmd = command.trim();
      onAdd({
        ...base,
        ...(trimmedCmd ? { command: trimmedCmd } : {}),
        ...(args.length > 0 ? { args } : {}),
      });
    } else {
      const trimmedUrl = url.trim();
      const trimmedToken = bearerToken.trim();
      const parsedHeaders: Record<string, string> = {};
      for (const line of headersText.split("\n")) {
        const idx = line.indexOf(":");
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim();
          if (key) parsedHeaders[key] = val;
        }
      }
      onAdd({
        ...base,
        ...(trimmedUrl ? { url: trimmedUrl } : {}),
        ...(trimmedToken ? { bearerToken: trimmedToken } : {}),
        ...(Object.keys(parsedHeaders).length > 0 ? { headers: parsedHeaders } : {}),
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isAdding) {
          onOpenChange(nextOpen);
          if (!nextOpen) resetForm();
        }
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add MCP Server</DialogTitle>
          <DialogDescription>Configure a new MCP server for Codex or Copilot.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="add-mcp-form" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">
                Server Name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-server"
                className="text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Provider</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setProvider("codex")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    provider === "codex"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                  title="Codex"
                >
                  <OpenAI className="size-4" />
                  Codex
                </button>
                <button
                  type="button"
                  onClick={() => setProvider("copilot")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    provider === "copilot"
                      ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                  title="GitHub Copilot"
                >
                  <GitHubIcon className="size-4" />
                  Copilot
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Transport</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("stdio")}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    mode === "stdio"
                      ? "border-foreground/20 bg-foreground/5 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <TerminalIcon className="size-3.5" />
                  Command (stdio)
                </button>
                <button
                  type="button"
                  onClick={() => setMode("url")}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    mode === "url"
                      ? "border-foreground/20 bg-foreground/5 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <GlobeIcon className="size-3.5" />
                  URL
                </button>
              </div>
            </div>

            {mode === "stdio" ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    Command
                  </label>
                  <Input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="npx"
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    Arguments (one per line)
                  </label>
                  <textarea
                    value={args.join("\n")}
                    onChange={(e) =>
                      setArgs(
                        e.target.value
                          .split("\n")
                          .map((a) => a.trim())
                          .filter(Boolean),
                      )
                    }
                    placeholder={"-y\n@scope/package\n--api-key=..."}
                    className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    rows={3}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">URL</label>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://api.example.com/mcp/"
                    className="font-mono text-sm"
                  />
                </div>
                {provider === "codex" ? (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-foreground">
                      Bearer Token{" "}
                      <span className="font-normal text-muted-foreground">(optional)</span>
                    </label>
                    <Input
                      value={bearerToken}
                      onChange={(e) => setBearerToken(e.target.value)}
                      placeholder="Token or env var name"
                      className="font-mono text-sm"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-foreground">
                      Headers{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional, one per line)
                      </span>
                    </label>
                    <textarea
                      value={headersText}
                      onChange={(e) => setHeadersText(e.target.value)}
                      placeholder={"Authorization: Bearer sk-...\nX-Custom: value"}
                      rows={3}
                      className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                )}
              </div>
            )}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              resetForm();
            }}
            disabled={isAdding}
          >
            Cancel
          </Button>
          <Button type="submit" form="add-mcp-form" size="sm" disabled={isAdding || !name.trim()}>
            {isAdding && <LoaderIcon className="mr-1.5 size-3.5 animate-spin" />}
            Add Server
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

// ── Main Route View ─────────────────────────────────────────────────

function McpRouteView() {
  const queryClient = useQueryClient();
  const listQuery = useQuery(mcpListQueryOptions());
  const browseQuery = useQuery(mcpBrowseQueryOptions());
  const toggleMutation = useMutation(mcpToggleMutationOptions({ queryClient }));
  const addMutation = useMutation(mcpAddMutationOptions({ queryClient }));
  const removeMutation = useMutation(mcpRemoveMutationOptions({ queryClient }));
  const updateMutation = useMutation(mcpUpdateMutationOptions({ queryClient }));

  const [search, setSearch] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [installPromptState, setInstallPromptState] = useState<{
    entry: McpCatalogEntry;
    provider: "codex" | "copilot";
  } | null>(null);

  const normalizedSearch = search.trim().toLowerCase();
  const servers = listQuery.data?.servers;

  const filteredServers = useMemo(() => {
    if (!servers) return [];
    if (!normalizedSearch) return servers;
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(normalizedSearch) ||
        s.command?.toLowerCase().includes(normalizedSearch) ||
        s.url?.toLowerCase().includes(normalizedSearch),
    );
  }, [normalizedSearch, servers]);

  // Track installed servers per provider (provider:name)
  const installedProviders = useMemo(() => {
    if (!servers) return new Set<string>();
    return new Set(servers.map((s) => `${s.provider}:${s.name}`));
  }, [servers]);

  const filteredCatalog = useMemo(() => {
    const catalog = browseQuery.data?.servers;
    if (!catalog) return [];
    if (!normalizedSearch) return catalog;
    return catalog.filter(
      (e) =>
        e.name.toLowerCase().includes(normalizedSearch) ||
        e.description.toLowerCase().includes(normalizedSearch),
    );
  }, [browseQuery.data?.servers, normalizedSearch]);

  const handleToggle = (name: string, provider: "codex" | "copilot", enabled: boolean) => {
    toggleMutation.mutate(
      { name, provider, enabled },
      {
        onError: (error) => {
          toastManager.add({
            type: "error",
            title: "Toggle failed",
            description: mutationErrorMessage(error),
          });
        },
      },
    );
  };

  const handleRemove = (name: string, provider: "codex" | "copilot") => {
    removeMutation.mutate(
      { name, provider },
      {
        onSuccess: (result) => {
          toastManager.add({
            type: result.success ? "success" : "error",
            title: result.success ? "Server removed" : "Remove failed",
            description: result.message,
          });
        },
        onError: (error) => {
          toastManager.add({
            type: "error",
            title: "Remove failed",
            description: mutationErrorMessage(error),
          });
        },
      },
    );
  };

  const handleUpdate = (
    name: string,
    provider: "codex" | "copilot",
    data: {
      command?: string;
      args?: string[];
      url?: string;
      headers?: Record<string, string>;
      bearerToken?: string;
    },
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      updateMutation.mutate(
        { name, provider, ...data },
        {
          onSuccess: (result) => {
            toastManager.add({
              type: result.success ? "success" : "error",
              title: result.success ? "Settings saved" : "Update failed",
              description: result.message,
            });
            resolve(result.success);
          },
          onError: (error) => {
            toastManager.add({
              type: "error",
              title: "Update failed",
              description: mutationErrorMessage(error),
            });
            resolve(false);
          },
        },
      );
    });
  };

  const handleAddFromCatalog = (entry: McpCatalogEntry, provider: "codex" | "copilot") => {
    // If entry has install prompts, show dialog first
    if (entry.installPrompts && entry.installPrompts.length > 0) {
      setInstallPromptState({ entry, provider });
      return;
    }
    // No prompts needed — install directly
    doInstallCatalog(entry, provider, []);
  };

  const doInstallCatalog = (
    entry: McpCatalogEntry,
    provider: "codex" | "copilot",
    promptValues: string[],
  ) => {
    const extraArgs = promptValues.filter((v) => v.trim().length > 0);
    addMutation.mutate(
      {
        name: entry.name,
        provider,
        ...(entry.command ? { command: entry.command } : {}),
        ...(entry.args || extraArgs.length ? { args: [...(entry.args ?? []), ...extraArgs] } : {}),
        ...(entry.mcpUrl ? { url: entry.mcpUrl } : {}),
      },
      {
        onSuccess: (result) => {
          if (result.success) setInstallPromptState(null);
          toastManager.add({
            type: result.success ? "success" : "error",
            title: result.success ? "Server added" : "Add failed",
            description: result.message,
          });
        },
        onError: (error) => {
          toastManager.add({
            type: "error",
            title: "Add failed",
            description: mutationErrorMessage(error),
          });
        },
      },
    );
  };

  const handleAddManual = (data: {
    name: string;
    provider: "codex" | "copilot";
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
    bearerToken?: string;
  }) => {
    addMutation.mutate(data, {
      onSuccess: (result) => {
        if (result.success) {
          setShowAddDialog(false);
          toastManager.add({
            type: "success",
            title: "Server added",
            description: result.message,
          });
        } else {
          toastManager.add({
            type: "error",
            title: "Add failed",
            description: result.message,
          });
        }
      },
      onError: (error) => {
        toastManager.add({
          type: "error",
          title: "Add failed",
          description: mutationErrorMessage(error),
        });
      },
    });
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              MCP Servers
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">MCP Servers</h1>
              <p className="text-sm text-muted-foreground">
                Manage Model Context Protocol servers for Codex and Copilot.
              </p>
            </header>

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                onClick={() => void listQuery.refetch()}
                disabled={listQuery.isFetching}
                aria-label="Refresh MCP servers"
              >
                <RefreshCwIcon
                  className={`size-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`}
                />
              </button>
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search servers..."
                  className="pl-8"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAddDialog(true)}
                className="gap-1.5"
              >
                <PlusIcon className="size-3.5" />
                Add Server
              </Button>
            </div>

            <AddServerDialog
              open={showAddDialog}
              onOpenChange={setShowAddDialog}
              onAdd={handleAddManual}
              isAdding={addMutation.isPending}
            />

            <InstallPromptDialog
              open={installPromptState !== null}
              onOpenChange={(open) => {
                if (!open) setInstallPromptState(null);
              }}
              entry={installPromptState?.entry ?? null}
              provider={installPromptState?.provider ?? "codex"}
              onConfirm={doInstallCatalog}
              isInstalling={addMutation.isPending}
            />

            {/* Installed Servers */}
            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                Installed
              </h2>

              {listQuery.isLoading ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {Array.from({ length: 4 }, (_, i) => (
                    <div
                      key={i}
                      className="h-[76px] animate-pulse rounded-xl border border-border bg-card"
                    />
                  ))}
                </div>
              ) : listQuery.isError ? (
                <div className="rounded-xl border border-border bg-card p-6 text-center">
                  <p className="text-sm text-destructive">Failed to load MCP servers.</p>
                  <Button
                    size="xs"
                    variant="outline"
                    className="mt-3"
                    onClick={() => void listQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : filteredServers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card px-6 py-8 text-center">
                  <PlugIcon className="mx-auto mb-2 size-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    {search ? "No servers match your search." : "No MCP servers installed."}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    {search
                      ? "Try a different search term."
                      : "Add servers from the catalog below or configure them manually."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {filteredServers.map((server) => (
                    <McpServerCard
                      key={`${server.provider}:${server.name}`}
                      server={server}
                      onToggle={handleToggle}
                      isToggling={
                        toggleMutation.isPending &&
                        toggleMutation.variables?.name === server.name &&
                        toggleMutation.variables?.provider === server.provider
                      }
                      onRemove={handleRemove}
                      isRemoving={
                        removeMutation.isPending &&
                        removeMutation.variables?.name === server.name &&
                        removeMutation.variables?.provider === server.provider
                      }
                      onUpdate={handleUpdate}
                      isUpdating={
                        updateMutation.isPending &&
                        updateMutation.variables?.name === server.name &&
                        updateMutation.variables?.provider === server.provider
                      }
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Catalog */}
            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                Browse Catalog
              </h2>

              {browseQuery.isLoading ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div
                      key={i}
                      className="h-[76px] animate-pulse rounded-xl border border-border bg-card"
                    />
                  ))}
                </div>
              ) : browseQuery.isError ? (
                <div className="rounded-xl border border-border bg-card p-6 text-center">
                  <p className="text-sm text-destructive">Failed to load MCP catalog.</p>
                  <Button
                    size="xs"
                    variant="outline"
                    className="mt-3"
                    onClick={() => void browseQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : filteredCatalog.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {filteredCatalog.map((entry) => (
                    <CatalogCard
                      key={entry.name}
                      entry={entry}
                      installedProviders={installedProviders}
                      onInstall={handleAddFromCatalog}
                      isInstalling={
                        addMutation.isPending && addMutation.variables?.name === entry.name
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="py-4 text-xs text-muted-foreground">No catalog entries found.</p>
              )}
            </section>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/mcp")({
  component: McpRouteView,
});

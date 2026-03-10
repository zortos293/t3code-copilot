import type { ExecutionEnvironment, GitResolvePullRequestResult } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  gitPreparePullRequestThreadMutationOptions,
  gitResolvePullRequestQueryOptions,
} from "~/lib/gitReactQuery";
import { cn } from "~/lib/utils";
import { parsePullRequestReference } from "~/pullRequestReference";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";

interface PullRequestThreadDialogProps {
  open: boolean;
  cwd: string | null;
  initialReference: string | null;
  dockerEnabled: boolean;
  initialExecutionEnvironment: ExecutionEnvironment;
  onOpenChange: (open: boolean) => void;
  onPrepared: (input: {
    branch: string;
    worktreePath: string | null;
    executionEnvironment: ExecutionEnvironment;
  }) => Promise<void> | void;
}

export function PullRequestThreadDialog({
  open,
  cwd,
  initialReference,
  dockerEnabled,
  initialExecutionEnvironment,
  onOpenChange,
  onPrepared,
}: PullRequestThreadDialogProps) {
  const queryClient = useQueryClient();
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState(initialReference ?? "");
  const [referenceDirty, setReferenceDirty] = useState(false);
  const [preparingMode, setPreparingMode] = useState<"local" | "worktree" | null>(null);
  const [executionEnvironment, setExecutionEnvironment] =
    useState<ExecutionEnvironment>(initialExecutionEnvironment);
  const [debouncedReference, referenceDebouncer] = useDebouncedValue(
    reference,
    { wait: 450 },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );

  useEffect(() => {
    if (!open) return;
    setReference(initialReference ?? "");
    setReferenceDirty(false);
    setPreparingMode(null);
    setExecutionEnvironment(initialExecutionEnvironment);
  }, [initialExecutionEnvironment, initialReference, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      referenceInputRef.current?.focus();
      referenceInputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  const parsedReference = parsePullRequestReference(reference);
  const parsedDebouncedReference = parsePullRequestReference(debouncedReference);
  const resolvePullRequestQuery = useQuery(
    gitResolvePullRequestQueryOptions({
      cwd,
      reference: open ? parsedDebouncedReference : null,
    }),
  );
  const cachedPullRequest = useMemo(() => {
    if (!cwd || !parsedReference) {
      return null;
    }
    const cached = queryClient.getQueryData<GitResolvePullRequestResult>([
      "git",
      "pull-request",
      cwd,
      parsedReference,
    ]);
    return cached?.pullRequest ?? null;
  }, [cwd, parsedReference, queryClient]);
  const preparePullRequestThreadMutation = useMutation(
    gitPreparePullRequestThreadMutationOptions({ cwd, queryClient }),
  );

  const liveResolvedPullRequest =
    parsedReference !== null && parsedReference === parsedDebouncedReference
      ? (resolvePullRequestQuery.data?.pullRequest ?? null)
      : null;
  const resolvedPullRequest = liveResolvedPullRequest ?? cachedPullRequest;
  const isResolving =
    open &&
    parsedReference !== null &&
    resolvedPullRequest === null &&
    (referenceDebouncer.state.isPending ||
      parsedReference !== parsedDebouncedReference ||
      resolvePullRequestQuery.isPending ||
      resolvePullRequestQuery.isFetching);
  const statusTone = useMemo(() => {
    switch (resolvedPullRequest?.state) {
      case "merged":
        return "text-violet-600 dark:text-violet-300/90";
      case "closed":
        return "text-zinc-500 dark:text-zinc-400/80";
      case "open":
        return "text-emerald-600 dark:text-emerald-300/90";
      default:
        return "text-muted-foreground";
    }
  }, [resolvedPullRequest?.state]);

  const handleConfirm = useCallback(
    async (mode: "local" | "worktree") => {
      if (!parsedReference) {
        setReferenceDirty(true);
        return;
      }
      if (!parsedReference || !resolvedPullRequest || !cwd) {
        return;
      }
      setPreparingMode(mode);
      try {
        const result = await preparePullRequestThreadMutation.mutateAsync({
          reference: parsedReference,
          mode,
        });
        await onPrepared({
          branch: result.branch,
          worktreePath: result.worktreePath,
          executionEnvironment,
        });
        onOpenChange(false);
      } finally {
        setPreparingMode(null);
      }
    },
    [
      cwd,
      onOpenChange,
      onPrepared,
      parsedReference,
      preparePullRequestThreadMutation,
      executionEnvironment,
      resolvedPullRequest,
    ],
  );

  const validationMessage = !referenceDirty
    ? null
    : reference.trim().length === 0
      ? "Paste a GitHub pull request URL or enter 123 / #123."
      : parsedReference === null
        ? "Use a GitHub pull request URL, 123, or #123."
        : null;
  const errorMessage =
    validationMessage ??
    (resolvedPullRequest === null && resolvePullRequestQuery.isError
      ? resolvePullRequestQuery.error instanceof Error
        ? resolvePullRequestQuery.error.message
        : "Failed to resolve pull request."
      : preparePullRequestThreadMutation.error instanceof Error
        ? preparePullRequestThreadMutation.error.message
        : preparePullRequestThreadMutation.error
          ? "Failed to prepare pull request thread."
          : null);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!preparePullRequestThreadMutation.isPending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Checkout Pull Request</DialogTitle>
          <DialogDescription>
            Resolve a GitHub pull request, then create the draft thread in the main repo or in a
            dedicated worktree.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Pull request</span>
            <Input
              ref={referenceInputRef}
              placeholder="https://github.com/owner/repo/pull/42 or #42"
              value={reference}
              onChange={(event) => {
                setReferenceDirty(true);
                setReference(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                event.preventDefault();
                if (!isResolving && !preparePullRequestThreadMutation.isPending) {
                  void handleConfirm("local");
                }
              }}
            />
          </label>

          {resolvedPullRequest ? (
            <div className="rounded-xl border border-border/70 bg-muted/24 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{resolvedPullRequest.title}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    #{resolvedPullRequest.number} · {resolvedPullRequest.headBranch} to{" "}
                    {resolvedPullRequest.baseBranch}
                  </p>
                </div>
                <span className={cn("shrink-0 text-xs capitalize", statusTone)}>
                  {resolvedPullRequest.state}
                </span>
              </div>
            </div>
          ) : null}

          {isResolving ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Spinner className="size-3.5" />
              Resolving pull request...
            </div>
          ) : null}

          {errorMessage ? <p className="text-destructive text-xs">{errorMessage}</p> : null}

          <div className="space-y-2">
            <span className="text-xs font-medium text-foreground">Execution environment</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                {
                  value: "host" as const,
                  label: "Host",
                  description: "Run the provider directly on your machine.",
                  disabled: false,
                },
                {
                  value: "docker" as const,
                  label: "Docker",
                  description: dockerEnabled
                    ? "Run the provider in a Docker container with this checkout mounted in."
                    : "Enable Docker threads in Settings and use Codex to select this option.",
                  disabled: !dockerEnabled,
                },
              ].map((option) => {
                const selected = executionEnvironment === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={option.disabled}
                    className={cn(
                      "flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left transition-colors",
                      selected
                        ? "border-primary/60 bg-primary/8 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-accent",
                      option.disabled ? "cursor-not-allowed opacity-60 hover:bg-background" : "",
                    )}
                    onClick={() => {
                      if (!option.disabled) {
                        setExecutionEnvironment(option.value);
                      }
                    }}
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">{option.label}</span>
                      <span className="text-xs">{option.description}</span>
                    </span>
                    {selected ? (
                      <span className="rounded bg-primary/14 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                        Selected
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={preparePullRequestThreadMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void handleConfirm("local");
            }}
            disabled={
              !cwd ||
              !resolvedPullRequest ||
              isResolving ||
              preparePullRequestThreadMutation.isPending
            }
          >
            {preparingMode === "local" ? "Preparing local..." : "Local"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void handleConfirm("worktree");
            }}
            disabled={
              !cwd ||
              !resolvedPullRequest ||
              isResolving ||
              preparePullRequestThreadMutation.isPending
            }
          >
            {preparingMode === "worktree" ? "Preparing worktree..." : "Worktree"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

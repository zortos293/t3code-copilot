import type { ServerProviderModel, ServerProviderQuotaSnapshot } from "@t3tools/contracts";

export const COPILOT_QUOTA_PRIORITY = ["premium_interactions", "chat", "completions"] as const;

export interface CopilotQuotaSummary {
  key: string;
  label: string;
  entitlementRequests: number;
  usedRequests: number;
  remainingRequests: number | null;
  remainingPercentage: number | null;
  overage: number;
  overageAllowedWithExhaustedQuota: boolean;
  usageAllowedWithExhaustedQuota: boolean;
  isUnlimitedEntitlement: boolean;
  resetDate: string | null;
}

export function pickCopilotQuotaSnapshot(
  quotaSnapshots: ReadonlyArray<ServerProviderQuotaSnapshot> | undefined,
): ServerProviderQuotaSnapshot | null {
  if (!quotaSnapshots || quotaSnapshots.length === 0) return null;

  return (
    quotaSnapshots.toSorted((left, right) => {
      const leftPriority = COPILOT_QUOTA_PRIORITY.indexOf(
        left.key as (typeof COPILOT_QUOTA_PRIORITY)[number],
      );
      const rightPriority = COPILOT_QUOTA_PRIORITY.indexOf(
        right.key as (typeof COPILOT_QUOTA_PRIORITY)[number],
      );
      const normalizedLeftPriority =
        leftPriority === -1 ? COPILOT_QUOTA_PRIORITY.length : leftPriority;
      const normalizedRightPriority =
        rightPriority === -1 ? COPILOT_QUOTA_PRIORITY.length : rightPriority;
      if (normalizedLeftPriority !== normalizedRightPriority) {
        return normalizedLeftPriority - normalizedRightPriority;
      }
      return left.key.localeCompare(right.key);
    })[0] ?? null
  );
}

export function deriveCopilotQuotaSummary(
  quotaSnapshots: ReadonlyArray<ServerProviderQuotaSnapshot> | undefined,
): CopilotQuotaSummary | null {
  const snapshot = pickCopilotQuotaSnapshot(quotaSnapshots);
  if (!snapshot) return null;

  const isUnlimitedEntitlement = snapshot.isUnlimitedEntitlement ?? false;
  const remainingRequests = isUnlimitedEntitlement
    ? null
    : Math.max(0, snapshot.entitlementRequests - snapshot.usedRequests);
  const derivedRemainingPercentage =
    !isUnlimitedEntitlement && remainingRequests !== null && snapshot.entitlementRequests > 0
      ? (remainingRequests / snapshot.entitlementRequests) * 100
      : null;
  const normalizedSnapshotRemainingPercentage = Number.isFinite(snapshot.remainingPercentage)
    ? snapshot.remainingPercentage > 1
      ? snapshot.remainingPercentage
      : snapshot.remainingPercentage * 100
    : null;
  const remainingPercentage =
    derivedRemainingPercentage ??
    (normalizedSnapshotRemainingPercentage !== null
      ? Math.max(0, Math.min(100, normalizedSnapshotRemainingPercentage))
      : null);

  return {
    key: snapshot.key,
    label: formatCopilotQuotaLabel(snapshot.key),
    entitlementRequests: snapshot.entitlementRequests,
    usedRequests: snapshot.usedRequests,
    remainingRequests,
    remainingPercentage,
    overage: snapshot.overage,
    overageAllowedWithExhaustedQuota: snapshot.overageAllowedWithExhaustedQuota,
    usageAllowedWithExhaustedQuota: snapshot.usageAllowedWithExhaustedQuota ?? false,
    isUnlimitedEntitlement,
    resetDate: snapshot.resetDate ?? null,
  };
}

export function findServerProviderModel(
  models: ReadonlyArray<ServerProviderModel>,
  slug: string,
): ServerProviderModel | null {
  return models.find((model) => model.slug === slug) ?? null;
}

export function formatCopilotBillingMultiplier(multiplier: number): string {
  const normalized = Number.isFinite(multiplier) ? multiplier : 1;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(normalized)}x`;
}

export function formatCopilotQuotaLabel(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

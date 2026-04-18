import { describe, expect, it } from "vitest";

import {
  deriveCopilotQuotaSummary,
  findServerProviderModel,
  formatCopilotBillingMultiplier,
  pickCopilotQuotaSnapshot,
} from "./copilotQuota";

describe("copilotQuota", () => {
  it("prioritizes premium quota snapshots over generic chat quotas", () => {
    const snapshot = pickCopilotQuotaSnapshot([
      {
        key: "chat",
        entitlementRequests: 500,
        usedRequests: 125,
        remainingPercentage: 0.75,
        overage: 0,
        overageAllowedWithExhaustedQuota: false,
      },
      {
        key: "premium_interactions",
        entitlementRequests: 300,
        usedRequests: 90,
        remainingPercentage: 0.7,
        overage: 0,
        overageAllowedWithExhaustedQuota: true,
      },
    ]);

    expect(snapshot?.key).toBe("premium_interactions");
  });

  it("derives remaining request counts and percentages", () => {
    expect(
      deriveCopilotQuotaSummary([
        {
          key: "premium_interactions",
          entitlementRequests: 300,
          usedRequests: 90,
          remainingPercentage: 0.7,
          overage: 2,
          overageAllowedWithExhaustedQuota: true,
          usageAllowedWithExhaustedQuota: true,
          resetDate: "2026-04-30T00:00:00.000Z",
        },
      ]),
    ).toEqual({
      key: "premium_interactions",
      label: "Premium Interactions",
      entitlementRequests: 300,
      usedRequests: 90,
      remainingRequests: 210,
      remainingPercentage: 70,
      overage: 2,
      overageAllowedWithExhaustedQuota: true,
      usageAllowedWithExhaustedQuota: true,
      isUnlimitedEntitlement: false,
      resetDate: "2026-04-30T00:00:00.000Z",
    });
  });

  it("prefers derived remaining percentages over stale snapshot percentages", () => {
    const summary = deriveCopilotQuotaSummary([
      {
        key: "premium_interactions",
        entitlementRequests: 1500,
        usedRequests: 651,
        remainingPercentage: 100,
        overage: 0,
        overageAllowedWithExhaustedQuota: false,
      },
    ]);

    expect(summary?.remainingRequests).toBe(849);
    expect(summary?.remainingPercentage).toBeCloseTo(56.6, 5);
  });

  it("formats model multipliers compactly", () => {
    expect(formatCopilotBillingMultiplier(1)).toBe("1x");
    expect(formatCopilotBillingMultiplier(1.5)).toBe("1.5x");
  });

  it("resolves the selected model from provider status data", () => {
    expect(
      findServerProviderModel(
        [
          {
            slug: "gpt-5.4",
            name: "GPT-5.4",
            isCustom: false,
            billingMultiplier: 1,
            maxContextWindowTokens: 256_000,
            capabilities: null,
          },
        ],
        "gpt-5.4",
      )?.billingMultiplier,
    ).toBe(1);
  });
});

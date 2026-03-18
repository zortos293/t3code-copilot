import { describe, expect, it } from "vitest";

import {
  BACKEND_MAX_CONSECUTIVE_FAILURES,
  BACKEND_STABLE_RUN_MS,
  decideBackendRestart,
  INITIAL_BACKEND_RESTART_STATE,
  noteBackendLaunch,
} from "./backendRestartPolicy";

describe("backendRestartPolicy", () => {
  it("backs off for consecutive fast crashes", () => {
    const firstLaunch = noteBackendLaunch(INITIAL_BACKEND_RESTART_STATE, 1_000);
    const firstFailure = decideBackendRestart(firstLaunch, 1_100);
    expect(firstFailure.type).toBe("restart");
    expect(firstFailure.delayMs).toBe(500);

    const secondLaunch = noteBackendLaunch(firstFailure.nextState, 2_000);
    const secondFailure = decideBackendRestart(secondLaunch, 2_100);
    expect(secondFailure.type).toBe("restart");
    expect(secondFailure.delayMs).toBe(1_000);
  });

  it("treats a stable run as a fresh failure streak", () => {
    const priorFailures = {
      consecutiveFailures: 4,
      lastLaunchAtMs: 10_000,
    };

    const decision = decideBackendRestart(priorFailures, 10_000 + BACKEND_STABLE_RUN_MS);

    expect(decision.type).toBe("restart");
    expect(decision.delayMs).toBe(500);
    expect(decision.nextState.consecutiveFailures).toBe(1);
  });

  it("stops restarting after too many rapid failures", () => {
    let state = INITIAL_BACKEND_RESTART_STATE;

    for (let index = 0; index < BACKEND_MAX_CONSECUTIVE_FAILURES - 1; index += 1) {
      state = noteBackendLaunch(state, 1_000 + index * 100);
      const decision = decideBackendRestart(state, 1_050 + index * 100);
      expect(decision.type).toBe("restart");
      state = decision.nextState;
    }

    state = noteBackendLaunch(state, 5_000);
    const fatalDecision = decideBackendRestart(state, 5_050);

    expect(fatalDecision.type).toBe("fatal");
    expect(fatalDecision.nextState.consecutiveFailures).toBe(BACKEND_MAX_CONSECUTIVE_FAILURES);
  });
});

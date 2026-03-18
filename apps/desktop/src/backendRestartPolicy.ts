export interface BackendRestartState {
  readonly consecutiveFailures: number;
  readonly lastLaunchAtMs: number | null;
}

export interface BackendRestartDecision {
  readonly type: "restart" | "fatal";
  readonly delayMs: number;
  readonly nextState: BackendRestartState;
  readonly uptimeMs: number;
}

export const BACKEND_STABLE_RUN_MS = 5_000;
export const BACKEND_MAX_CONSECUTIVE_FAILURES = 5;
const BACKEND_RESTART_BASE_DELAY_MS = 500;
const BACKEND_RESTART_MAX_DELAY_MS = 10_000;

export const INITIAL_BACKEND_RESTART_STATE: BackendRestartState = {
  consecutiveFailures: 0,
  lastLaunchAtMs: null,
};

export function noteBackendLaunch(
  state: BackendRestartState,
  launchedAtMs: number,
): BackendRestartState {
  return {
    ...state,
    lastLaunchAtMs: launchedAtMs,
  };
}

export function decideBackendRestart(
  state: BackendRestartState,
  nowMs: number,
): BackendRestartDecision {
  const uptimeMs = state.lastLaunchAtMs === null ? 0 : Math.max(0, nowMs - state.lastLaunchAtMs);
  const stableRun = uptimeMs >= BACKEND_STABLE_RUN_MS;
  const consecutiveFailures = stableRun ? 1 : state.consecutiveFailures + 1;
  const delayMs = Math.min(
    BACKEND_RESTART_BASE_DELAY_MS * 2 ** Math.max(consecutiveFailures - 1, 0),
    BACKEND_RESTART_MAX_DELAY_MS,
  );

  return {
    type: consecutiveFailures >= BACKEND_MAX_CONSECUTIVE_FAILURES ? "fatal" : "restart",
    delayMs,
    nextState: {
      consecutiveFailures,
      lastLaunchAtMs: null,
    },
    uptimeMs,
  };
}

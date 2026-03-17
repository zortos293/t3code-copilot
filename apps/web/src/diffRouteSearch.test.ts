import { describe, expect, it } from "vitest";

import {
  parseDiffRouteSearch,
  stripDiffSearchParams,
  stripSubagentSearchParams,
} from "./diffRouteSearch";

describe("parseDiffRouteSearch", () => {
  it("parses valid diff search values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });
  });

  it("treats numeric and boolean diff toggles as open", () => {
    expect(
      parseDiffRouteSearch({
        diff: 1,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });

    expect(
      parseDiffRouteSearch({
        diff: true,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });
  });

  it("drops turn and file values when diff is closed", () => {
    const parsed = parseDiffRouteSearch({
      diff: "0",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({});
  });

  it("drops file value when turn is not selected", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });

  it("normalizes whitespace-only values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "  ",
      diffFilePath: "  ",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });

  it("preserves delegated task focus outside diff-only parsing", () => {
    const parsed = parseDiffRouteSearch({
      subagentActivityId: " activity-1 ",
    });

    expect(parsed).toEqual({
      subagentActivityId: "activity-1",
    });
  });
});

describe("search param stripping", () => {
  it("removes diff params without clearing delegated task focus", () => {
    expect(
      stripDiffSearchParams({
        diff: "1",
        diffTurnId: "turn-1",
        subagentActivityId: "activity-1",
      }),
    ).toEqual({
      subagentActivityId: "activity-1",
    });
  });

  it("removes delegated task focus without clearing diff params", () => {
    expect(
      stripSubagentSearchParams({
        diff: "1",
        subagentActivityId: "activity-1",
      }),
    ).toEqual({
      diff: "1",
    });
  });
});

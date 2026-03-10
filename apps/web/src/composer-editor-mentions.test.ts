import { describe, expect, it } from "vitest";

import { splitPromptIntoComposerSegments } from "./composer-editor-mentions";

describe("splitPromptIntoComposerSegments", () => {
  it("splits mention tokens followed by whitespace into mention segments", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md please")).toEqual([
      { type: "text", text: "Inspect " },
      { type: "mention", path: "AGENTS.md" },
      { type: "text", text: " please" },
    ]);
  });

  it("converts a trailing mention token at end of input", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md")).toEqual([
      { type: "text", text: "Inspect " },
      { type: "mention", path: "AGENTS.md" },
    ]);
  });

  it("converts a trailing skill token at end of input", () => {
    expect(splitPromptIntoComposerSegments("Use $reviewer")).toEqual([
      { type: "text", text: "Use " },
      { type: "skill", name: "reviewer" },
    ]);
  });

  it("keeps newlines around mention tokens", () => {
    expect(splitPromptIntoComposerSegments("one\n@src/index.ts \ntwo")).toEqual([
      { type: "text", text: "one\n" },
      { type: "mention", path: "src/index.ts" },
      { type: "text", text: " \ntwo" },
    ]);
  });
});

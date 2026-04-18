import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ChatMarkdown from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  it("renders standalone file URLs with file-link behavior", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown text="<file:///home/project/src/index.ts#L12>" cwd="/home/project" />,
    );

    expect(html).toContain("chat-markdown-file-link");
    expect(html).toContain("index.ts");
    expect(html).toContain("L12");
  });

  it("renders bare file URLs inside plain text as file links", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        text="Open file:///home/project/src/index.ts#L12 directly"
        cwd="/home/project"
      />,
    );

    expect(html).toContain("chat-markdown-file-link");
    expect(html).toContain("index.ts");
    expect(html).toContain("L12");
  });

  it("excludes trailing punctuation from bare file URL targets", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        text="Open file:///home/project/src/index.ts#L12, then continue."
        cwd="/home/project"
      />,
    );

    expect(html).toContain('href="/home/project/src/index.ts#L12"');
    expect(html).toContain("chat-markdown-file-link");
    expect(html).toContain(", then continue.");
  });
});

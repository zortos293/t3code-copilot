import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeAttachmentRelativePathFrom,
  resolveAttachmentRelativePathFrom,
} from "./attachmentPaths.ts";

describe("attachmentPaths", () => {
  it("normalizes Windows-style separators for persisted attachment paths", () => {
    expect(normalizeAttachmentRelativePathFrom("thread-a\\message-a\\image.png", path.win32)).toBe(
      "thread-a/message-a/image.png",
    );
  });

  it("rejects Windows traversal attempts", () => {
    expect(
      resolveAttachmentRelativePathFrom(
        {
          stateDir: "C:\\state",
          relativePath: "..\\outside.png",
        },
        path.win32,
      ),
    ).toBeNull();
  });

  it("resolves valid Windows attachment paths inside the attachments root", () => {
    expect(
      resolveAttachmentRelativePathFrom(
        {
          stateDir: "C:\\state",
          relativePath: "thread-a\\message-a\\image.png",
        },
        path.win32,
      ),
    ).toBe(path.win32.resolve("C:\\state\\attachments\\thread-a\\message-a\\image.png"));
  });
});

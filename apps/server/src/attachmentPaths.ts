import path from "node:path";

export const ATTACHMENTS_ROUTE_PREFIX = "/attachments";

interface AttachmentPathApi {
  normalize(path: string): string;
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
}

export function normalizeAttachmentRelativePathFrom(
  rawRelativePath: string,
  pathApi: AttachmentPathApi,
): string | null {
  const normalized = pathApi.normalize(rawRelativePath).replace(/^[/\\]+/, "");
  if (normalized.length === 0 || normalized.startsWith("..") || normalized.includes("\0")) {
    return null;
  }
  return normalized.replace(/\\/g, "/");
}

export function normalizeAttachmentRelativePath(rawRelativePath: string): string | null {
  return normalizeAttachmentRelativePathFrom(rawRelativePath, path);
}

export function resolveAttachmentRelativePathFrom(
  input: {
    readonly stateDir: string;
    readonly relativePath: string;
  },
  pathApi: AttachmentPathApi,
): string | null {
  const normalizedRelativePath = normalizeAttachmentRelativePathFrom(input.relativePath, pathApi);
  if (!normalizedRelativePath) {
    return null;
  }

  const attachmentsRoot = pathApi.resolve(pathApi.join(input.stateDir, "attachments"));
  const filePath = pathApi.resolve(pathApi.join(attachmentsRoot, normalizedRelativePath));
  const relativeToRoot = pathApi.relative(attachmentsRoot, filePath);
  if (
    relativeToRoot.length === 0 ||
    relativeToRoot.startsWith("..") ||
    pathApi.isAbsolute(relativeToRoot)
  ) {
    return null;
  }
  return filePath;
}

export function resolveAttachmentRelativePath(input: {
  readonly stateDir: string;
  readonly relativePath: string;
}): string | null {
  return resolveAttachmentRelativePathFrom(input, path);
}

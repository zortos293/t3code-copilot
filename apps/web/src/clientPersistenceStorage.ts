import {
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  type ClientSettings,
  type EnvironmentId as EnvironmentIdValue,
  type PersistedSavedEnvironmentRecord,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

export const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";
export const SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY = "t3code:saved-environment-registry:v1";
const LEGACY_CLIENT_SETTINGS_STORAGE_KEY = "t3code:app-settings:v1";

const BrowserSavedEnvironmentRecordSchema = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
  createdAt: Schema.String,
  lastConnectedAt: Schema.NullOr(Schema.String),
  bearerToken: Schema.optionalKey(Schema.String),
});
type BrowserSavedEnvironmentRecord = typeof BrowserSavedEnvironmentRecordSchema.Type;

const BrowserSavedEnvironmentRegistryDocumentSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Number),
  records: Schema.optionalKey(Schema.Array(BrowserSavedEnvironmentRecordSchema)),
});
type BrowserSavedEnvironmentRegistryDocument =
  typeof BrowserSavedEnvironmentRegistryDocumentSchema.Type;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function toPersistedSavedEnvironmentRecord(
  record: PersistedSavedEnvironmentRecord,
): PersistedSavedEnvironmentRecord {
  return {
    environmentId: record.environmentId,
    label: record.label,
    httpBaseUrl: record.httpBaseUrl,
    wsBaseUrl: record.wsBaseUrl,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
  };
}

function readLegacyBrowserClientSettings(): ClientSettings | null {
  const raw = window.localStorage.getItem(LEGACY_CLIENT_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const sidebarProjectGroupingOverrides =
      parsed.sidebarProjectGroupingOverrides &&
      typeof parsed.sidebarProjectGroupingOverrides === "object" &&
      !Array.isArray(parsed.sidebarProjectGroupingOverrides)
        ? Object.fromEntries(
            Object.entries(parsed.sidebarProjectGroupingOverrides).filter(
              ([key, value]) =>
                typeof key === "string" &&
                key.length > 0 &&
                (value === "repository" || value === "repository_path" || value === "separate"),
            ),
          )
        : undefined;

    const migrated = Schema.decodeSync(ClientSettingsSchema)({
      ...DEFAULT_CLIENT_SETTINGS,
      ...(typeof parsed.confirmThreadArchive === "boolean"
        ? { confirmThreadArchive: parsed.confirmThreadArchive }
        : {}),
      ...(typeof parsed.confirmThreadDelete === "boolean"
        ? { confirmThreadDelete: parsed.confirmThreadDelete }
        : {}),
      ...(typeof parsed.diffWordWrap === "boolean" ? { diffWordWrap: parsed.diffWordWrap } : {}),
      ...(parsed.sidebarProjectGroupingMode === "repository" ||
      parsed.sidebarProjectGroupingMode === "repository_path" ||
      parsed.sidebarProjectGroupingMode === "separate"
        ? { sidebarProjectGroupingMode: parsed.sidebarProjectGroupingMode }
        : {}),
      ...(sidebarProjectGroupingOverrides ? { sidebarProjectGroupingOverrides } : {}),
      ...(parsed.sidebarProjectSortOrder === "updated_at" ||
      parsed.sidebarProjectSortOrder === "created_at" ||
      parsed.sidebarProjectSortOrder === "manual"
        ? { sidebarProjectSortOrder: parsed.sidebarProjectSortOrder }
        : {}),
      ...(parsed.sidebarThreadSortOrder === "updated_at" ||
      parsed.sidebarThreadSortOrder === "created_at"
        ? { sidebarThreadSortOrder: parsed.sidebarThreadSortOrder }
        : {}),
      ...(parsed.timestampFormat === "locale" ||
      parsed.timestampFormat === "12-hour" ||
      parsed.timestampFormat === "24-hour"
        ? { timestampFormat: parsed.timestampFormat }
        : {}),
    });

    window.localStorage.setItem(CLIENT_SETTINGS_STORAGE_KEY, JSON.stringify(migrated));
    window.localStorage.removeItem(LEGACY_CLIENT_SETTINGS_STORAGE_KEY);
    return migrated;
  } catch {
    return null;
  }
}

export function readBrowserClientSettings(): ClientSettings | null {
  if (!hasWindow()) {
    return null;
  }

  try {
    const settings = getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema);
    return settings ?? readLegacyBrowserClientSettings();
  } catch {
    try {
      const raw = window.localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ClientSettings>;
        return Schema.decodeSync(ClientSettingsSchema)({
          ...DEFAULT_CLIENT_SETTINGS,
          ...parsed,
        });
      }
    } catch {}

    return readLegacyBrowserClientSettings();
  }
}

export function writeBrowserClientSettings(settings: ClientSettings): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, settings, ClientSettingsSchema);
}

function readBrowserSavedEnvironmentRegistryDocument(): BrowserSavedEnvironmentRegistryDocument {
  if (!hasWindow()) {
    return {};
  }

  try {
    const parsed = getLocalStorageItem(
      SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY,
      BrowserSavedEnvironmentRegistryDocumentSchema,
    );
    return parsed ?? {};
  } catch {
    return {};
  }
}

function writeBrowserSavedEnvironmentRegistryDocument(
  document: BrowserSavedEnvironmentRegistryDocument,
): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(
    SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY,
    document,
    BrowserSavedEnvironmentRegistryDocumentSchema,
  );
}

function readBrowserSavedEnvironmentRecordsWithSecrets(): ReadonlyArray<BrowserSavedEnvironmentRecord> {
  return readBrowserSavedEnvironmentRegistryDocument().records ?? [];
}

function writeBrowserSavedEnvironmentRecords(
  records: ReadonlyArray<BrowserSavedEnvironmentRecord>,
): void {
  writeBrowserSavedEnvironmentRegistryDocument({
    version: 1,
    records,
  });
}

export function readBrowserSavedEnvironmentRegistry(): ReadonlyArray<PersistedSavedEnvironmentRecord> {
  return readBrowserSavedEnvironmentRecordsWithSecrets().map((record) =>
    toPersistedSavedEnvironmentRecord(record),
  );
}

export function writeBrowserSavedEnvironmentRegistry(
  records: ReadonlyArray<PersistedSavedEnvironmentRecord>,
): void {
  const existing = new Map(
    readBrowserSavedEnvironmentRecordsWithSecrets().map(
      (record) => [record.environmentId, record] as const,
    ),
  );
  writeBrowserSavedEnvironmentRecords(
    records.map((record) => {
      const bearerToken = existing.get(record.environmentId)?.bearerToken;
      return bearerToken
        ? {
            environmentId: record.environmentId,
            label: record.label,
            httpBaseUrl: record.httpBaseUrl,
            wsBaseUrl: record.wsBaseUrl,
            createdAt: record.createdAt,
            lastConnectedAt: record.lastConnectedAt,
            bearerToken,
          }
        : toPersistedSavedEnvironmentRecord(record);
    }),
  );
}

export function readBrowserSavedEnvironmentSecret(
  environmentId: EnvironmentIdValue,
): string | null {
  return (
    readBrowserSavedEnvironmentRecordsWithSecrets().find(
      (record) => record.environmentId === environmentId,
    )?.bearerToken ?? null
  );
}

export function writeBrowserSavedEnvironmentSecret(
  environmentId: EnvironmentIdValue,
  secret: string,
): boolean {
  const document = readBrowserSavedEnvironmentRegistryDocument();
  const records = document.records ?? [];
  let found = false;
  writeBrowserSavedEnvironmentRegistryDocument({
    version: document.version ?? 1,
    records: records.map((record) => {
      if (record.environmentId !== environmentId) {
        return record;
      }
      found = true;
      return {
        environmentId: record.environmentId,
        label: record.label,
        httpBaseUrl: record.httpBaseUrl,
        wsBaseUrl: record.wsBaseUrl,
        createdAt: record.createdAt,
        lastConnectedAt: record.lastConnectedAt,
        bearerToken: secret,
      } satisfies BrowserSavedEnvironmentRecord;
    }),
  });
  return found;
}

export function removeBrowserSavedEnvironmentSecret(environmentId: EnvironmentIdValue): void {
  const document = readBrowserSavedEnvironmentRegistryDocument();
  writeBrowserSavedEnvironmentRegistryDocument({
    version: document.version ?? 1,
    records: (document.records ?? []).map((record) => {
      if (record.environmentId !== environmentId) {
        return record;
      }
      return toPersistedSavedEnvironmentRecord(record);
    }),
  });
}

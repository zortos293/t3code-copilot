import { EnvironmentId, type PersistedSavedEnvironmentRecord } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const testEnvironmentId = EnvironmentId.make("environment-1");

const savedRegistryRecord: PersistedSavedEnvironmentRecord = {
  environmentId: testEnvironmentId,
  label: "Remote environment",
  httpBaseUrl: "https://remote.example.com/",
  wsBaseUrl: "wss://remote.example.com/",
  createdAt: "2026-04-09T00:00:00.000Z",
  lastConnectedAt: null,
};

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function getTestWindow(): Window & typeof globalThis {
  const localStorage = createLocalStorageStub();
  const testWindow = {
    localStorage,
  } as Window & typeof globalThis;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: testWindow,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  return testWindow;
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("clientPersistenceStorage", () => {
  it("stores browser secrets inline with the saved environment record", async () => {
    const testWindow = getTestWindow();
    const {
      SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY,
      readBrowserSavedEnvironmentRegistry,
      readBrowserSavedEnvironmentSecret,
      writeBrowserSavedEnvironmentRegistry,
      writeBrowserSavedEnvironmentSecret,
    } = await import("./clientPersistenceStorage");

    writeBrowserSavedEnvironmentRegistry([savedRegistryRecord]);
    expect(writeBrowserSavedEnvironmentSecret(testEnvironmentId, "bearer-token")).toBe(true);
    writeBrowserSavedEnvironmentRegistry([savedRegistryRecord]);

    expect(readBrowserSavedEnvironmentRegistry()).toEqual([savedRegistryRecord]);
    expect(readBrowserSavedEnvironmentSecret(testEnvironmentId)).toBe("bearer-token");
    expect(
      JSON.parse(testWindow.localStorage.getItem(SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY)!),
    ).toEqual({
      version: 1,
      records: [
        {
          ...savedRegistryRecord,
          bearerToken: "bearer-token",
        },
      ],
    });
  });

  it("migrates legacy browser client settings during hydration", async () => {
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "t3code:app-settings:v1",
      JSON.stringify({
        confirmThreadArchive: true,
        confirmThreadDelete: false,
        diffWordWrap: true,
        sidebarProjectGroupingMode: "repository_path",
        sidebarProjectGroupingOverrides: {
          "/repo": "separate",
        },
        sidebarProjectSortOrder: "manual",
        sidebarThreadSortOrder: "created_at",
        timestampFormat: "24-hour",
      }),
    );

    const { CLIENT_SETTINGS_STORAGE_KEY, readBrowserClientSettings } =
      await import("./clientPersistenceStorage");

    expect(readBrowserClientSettings()).toEqual({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      diffWordWrap: true,
      sidebarProjectGroupingMode: "repository_path",
      sidebarProjectGroupingOverrides: {
        "/repo": "separate",
      },
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      timestampFormat: "24-hour",
    });
    expect(JSON.parse(testWindow.localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY)!)).toEqual({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      diffWordWrap: true,
      sidebarProjectGroupingMode: "repository_path",
      sidebarProjectGroupingOverrides: {
        "/repo": "separate",
      },
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      timestampFormat: "24-hour",
    });
    expect(testWindow.localStorage.getItem("t3code:app-settings:v1")).toBeNull();
  });
});

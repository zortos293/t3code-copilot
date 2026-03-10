import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearHuggingFaceModelSearchCache,
  searchHuggingFaceModels,
} from "./huggingFaceModelSearch";

describe("huggingFaceModelSearch", () => {
  afterEach(() => {
    clearHuggingFaceModelSearchCache();
    vi.restoreAllMocks();
  });

  it("returns featured recommended models and caches repeated requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "onnx-community/Qwen2.5-1.5B-Instruct",
            likes: 12,
            downloads: 845,
            private: false,
            tags: ["transformers.js", "onnx", "text-generation", "license:apache-2.0"],
            pipeline_tag: "text-generation",
            library_name: "transformers.js",
          },
          {
            id: "community/SmallLM-Instruct",
            likes: 4,
            downloads: 120,
            private: false,
            tags: ["transformers.js", "text-generation"],
            pipeline_tag: "text-generation",
            library_name: "transformers.js",
          },
          {
            id: "onnx-community/Skip-Me",
            likes: 1,
            downloads: 2,
            private: false,
            tags: ["transformers.js", "custom_code"],
            pipeline_tag: "text-generation",
            library_name: "transformers.js",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const first = await searchHuggingFaceModels({ limit: 5 });
    const second = await searchHuggingFaceModels({ limit: 5 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first).toEqual({
      mode: "featured",
      models: [
        {
          id: "onnx-community/Qwen2.5-1.5B-Instruct",
          author: "onnx-community",
          name: "Qwen2.5-1.5B-Instruct",
          downloads: 845,
          likes: 12,
          pipelineTag: "text-generation",
          libraryName: "transformers.js",
          license: "apache-2.0",
          compatibility: "recommended",
        },
      ],
      truncated: false,
    });
    expect(second).toEqual(first);
  });

  it("returns compatible search results for explicit queries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "community/Phi-lite-Instruct",
            likes: 14,
            downloads: 912,
            private: false,
            tags: ["transformers.js", "text-generation", "license:mit"],
            pipeline_tag: "text-generation",
            library_name: "transformers.js",
          },
          {
            id: "onnx-community/Phi-3.5-mini-instruct-onnx-web",
            likes: 36,
            downloads: 1500,
            private: false,
            tags: ["transformers.js", "onnx", "text-generation", "license:mit"],
            pipeline_tag: "text-generation",
            library_name: "transformers.js",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await searchHuggingFaceModels({ query: "phi", limit: 10 });

    expect(result.mode).toBe("search");
    expect(result.query).toBe("phi");
    expect(result.models.map((model) => model.id)).toEqual([
      "onnx-community/Phi-3.5-mini-instruct-onnx-web",
      "community/Phi-lite-Instruct",
    ]);
  });
});

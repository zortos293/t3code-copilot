import type { WebGpuModelDtype } from "@t3tools/contracts";

const TRANSFORMERS_JS_CDN_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers/+esm";

type LocalWebGpuChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type WorkerGenerateMessage = {
  type: "generate";
  requestId: string;
  model: string;
  dtype: WebGpuModelDtype;
  messages: LocalWebGpuChatMessage[];
  maxNewTokens: number;
  temperature: number;
  topP: number;
};

type WorkerDisposeMessage = {
  type: "dispose";
};

type WorkerInboundMessage = WorkerGenerateMessage | WorkerDisposeMessage;

type WorkerStatusMessage = {
  type: "status";
  status: "idle" | "loading-model" | "ready" | "generating" | "error";
  model: string | null;
  dtype: WebGpuModelDtype;
  message?: string;
};

type WorkerProgressMessage = {
  type: "download-progress";
  file: string | null;
  loaded: number;
  total: number | null;
};

type WorkerTextDeltaMessage = {
  type: "text-delta";
  requestId: string;
  delta: string;
};

type WorkerCompleteMessage = {
  type: "complete";
  requestId: string;
  text: string;
};

type WorkerErrorMessage = {
  type: "error";
  requestId?: string;
  message: string;
};

type WorkerOutboundMessage =
  | WorkerStatusMessage
  | WorkerProgressMessage
  | WorkerTextDeltaMessage
  | WorkerCompleteMessage
  | WorkerErrorMessage;

type TextGenerationResult =
  | Array<{
      generated_text?: string | Array<{ role?: string; content?: string }>;
    }>
  | {
      generated_text?: string | Array<{ role?: string; content?: string }>;
    };

type TextGenerationPipeline = ((messages: LocalWebGpuChatMessage[], options: Record<string, unknown>) => Promise<TextGenerationResult>) & {
  tokenizer: unknown;
};

type TransformersModule = {
  pipeline: (
    task: "text-generation",
    model: string,
    options: Record<string, unknown>,
  ) => Promise<TextGenerationPipeline>;
  TextStreamer: new (
    tokenizer: unknown,
    options: {
      skip_prompt?: boolean;
      callback_function?: (text: string) => void;
    },
  ) => unknown;
};

const workerScope = self as typeof globalThis & {
  postMessage: (message: WorkerOutboundMessage) => void;
};

let transformersPromise: Promise<TransformersModule> | null = null;
let activePipeline: TextGenerationPipeline | null = null;
let activeModel: string | null = null;
let activeDtype: WebGpuModelDtype | null = null;

function postMessageToMain(message: WorkerOutboundMessage): void {
  // eslint-disable-next-line unicorn/require-post-message-target-origin -- Dedicated worker messaging does not use targetOrigin.
  workerScope.postMessage(message);
}

async function loadTransformersModule(): Promise<TransformersModule> {
  if (!transformersPromise) {
    transformersPromise = import(/* @vite-ignore */ TRANSFORMERS_JS_CDN_URL) as Promise<TransformersModule>;
  }
  return transformersPromise;
}

function extractGeneratedText(result: TextGenerationResult, fallback: string): string {
  const first = Array.isArray(result) ? result[0] : result;
  const generated = first?.generated_text;
  if (typeof generated === "string") {
    return generated;
  }
  if (Array.isArray(generated)) {
    const lastMessage = generated.at(-1);
    if (lastMessage?.content) {
      return lastMessage.content;
    }
  }
  return fallback;
}

async function ensurePipeline(
  model: string,
  dtype: WebGpuModelDtype,
): Promise<{ module: TransformersModule; pipeline: TextGenerationPipeline }> {
  const module = await loadTransformersModule();
  if (activePipeline && activeModel === model && activeDtype === dtype) {
    return { module, pipeline: activePipeline };
  }
  postMessageToMain({
    type: "status",
    status: "loading-model",
    model,
    dtype,
  });
  activePipeline = await module.pipeline("text-generation", model, {
    device: "webgpu",
    dtype,
    progress_callback: (progress: { file?: string; loaded?: number; total?: number }) => {
      postMessageToMain({
        type: "download-progress",
        file: progress.file ?? null,
        loaded: progress.loaded ?? 0,
        total: progress.total ?? null,
      });
    },
  });
  activeModel = model;
  activeDtype = dtype;
  postMessageToMain({
    type: "status",
    status: "ready",
    model,
    dtype,
  });
  return { module, pipeline: activePipeline };
}

async function handleGenerate(message: WorkerGenerateMessage): Promise<void> {
  const { module, pipeline } = await ensurePipeline(message.model, message.dtype);
  postMessageToMain({
    type: "status",
    status: "generating",
    model: message.model,
    dtype: message.dtype,
  });
  let streamedText = "";
  const streamer = new module.TextStreamer(pipeline.tokenizer, {
    skip_prompt: true,
    callback_function: (text) => {
      if (!text) {
        return;
      }
      streamedText += text;
      postMessageToMain({
        type: "text-delta",
        requestId: message.requestId,
        delta: text,
      });
    },
  });
  const result = await pipeline(message.messages, {
    max_new_tokens: message.maxNewTokens,
    temperature: message.temperature,
    top_p: message.topP,
    do_sample: message.temperature > 0,
    return_full_text: false,
    streamer,
  });
  postMessageToMain({
    type: "complete",
    requestId: message.requestId,
    text: extractGeneratedText(result, streamedText),
  });
  postMessageToMain({
    type: "status",
    status: "ready",
    model: message.model,
    dtype: message.dtype,
  });
}

workerScope.addEventListener("message", (event: MessageEvent<WorkerInboundMessage>) => {
  const message = event.data;
  if (message.type === "dispose") {
    activePipeline = null;
    activeModel = null;
    activeDtype = null;
    postMessageToMain({
      type: "status",
      status: "idle",
      model: null,
      dtype: "q4",
    });
    return;
  }
  void handleGenerate(message).catch((error: unknown) => {
    postMessageToMain({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : "Local WebGPU generation failed.",
    });
    postMessageToMain({
      type: "status",
      status: "error",
      model: message.model,
      dtype: message.dtype,
      message: error instanceof Error ? error.message : "Local WebGPU generation failed.",
    });
  });
});

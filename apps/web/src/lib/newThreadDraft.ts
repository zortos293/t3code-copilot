import { type ProviderKind, type ProviderModelOptions, type ThreadId } from "@t3tools/contracts";
import { inferProviderForModel } from "@t3tools/shared/model";

interface SeedNewThreadDraftInput {
  readonly threadId: ThreadId;
  readonly provider?: ProviderKind | null;
  readonly model?: string | null;
  readonly stickyModel: string | null;
  readonly stickyModelOptions: ProviderModelOptions;
  readonly setProvider: (threadId: ThreadId, provider: ProviderKind | null | undefined) => void;
  readonly setModel: (
    threadId: ThreadId,
    model: string | null | undefined,
    provider?: ProviderKind | null | undefined,
  ) => void;
  readonly setModelOptions: (
    threadId: ThreadId,
    modelOptions: ProviderModelOptions | null | undefined,
  ) => void;
}

export function seedNewThreadDraft(input: SeedNewThreadDraftInput): void {
  const nextModel = input.model ?? input.stickyModel ?? null;
  const nextProvider = input.provider ?? (nextModel ? inferProviderForModel(nextModel) : null);

  if (nextProvider) {
    input.setProvider(input.threadId, nextProvider);
  }
  if (nextModel) {
    input.setModel(input.threadId, nextModel, nextProvider);
  }
  if (Object.keys(input.stickyModelOptions).length > 0) {
    input.setModelOptions(input.threadId, input.stickyModelOptions);
  }
}

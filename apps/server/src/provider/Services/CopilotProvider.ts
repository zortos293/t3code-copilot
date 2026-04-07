import { ServiceMap } from "effect";

import type { ServerProviderShape } from "./ServerProvider";

export interface CopilotProviderShape extends ServerProviderShape {}

export class CopilotProvider extends ServiceMap.Service<
  CopilotProvider,
  CopilotProviderShape
>()("t3/provider/Services/CopilotProvider") {}

/**
 * Dev-only shim; clawhub bundles the real @openclaw/plugin-sdk at publish time.
 *
 * Declares only the OpenClaw Plugin API surface used by research-radar.
 * Source of truth: docs/OPENCLAW_PLUGIN_SDK.md (pinned to openclaw@12a56910).
 */

declare module "openclaw/plugin-sdk/plugin-entry" {
  export type OpenClawPluginApi = {
    id: string;
    name: string;
    version?: string;
    description?: string;
    source: string;
    rootDir?: string;
    registrationMode: string;
    config: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    runtime: PluginRuntime;
    logger: PluginLogger;
    session: OpenClawPluginSessionApi;
    agent: Record<string, unknown>;
    runContext: Record<string, unknown>;
    lifecycle: Record<string, unknown>;
    registerTool(tool: PluginTool, opts?: { optional?: boolean }): void;
    registerCommand(def: PluginCommandDef): void;
    registerHook(
      events: string | string[],
      handler: (ctx: PluginHookContext) => Promise<PluginHookResult | void> | PluginHookResult | void,
      opts?: Record<string, unknown>,
    ): void;
    registerWebSearchProvider(provider: unknown): void;
    registerProvider(provider: unknown): void;
    registerChannel(registration: unknown): void;
    registerService(service: unknown): void;
    registerHttpRoute(params: unknown): void;
    registerGatewayMethod(method: unknown, handler: unknown, opts?: unknown): void;
  };

  export type PluginRuntime = {
    llm: {
      complete(params: LlmCompleteParams): Promise<LlmCompleteResult>;
    };
    config?: { current?: Record<string, unknown> };
    modelAuth?: unknown;
    agent?: unknown;
  };

  export type LlmCompleteParams = {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
    signal?: AbortSignal;
    purpose?: string;
    agentId?: string;
  };

  export type LlmCompleteResult = {
    text: string;
    provider: string;
    model: string;
    agentId: string;
    usage: unknown;
    audit: { caller: unknown; purpose?: string; sessionKey?: string };
  };

  export type PluginLogger = {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  };

  export type PluginTool = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(
      _id: string,
      params: Record<string, unknown>,
    ): Promise<{ content: Array<{ type: string; text?: string; [k: string]: unknown }> }>;
  };

  export type PluginCommandDef = {
    name: string;
    description: string;
    execute(ctx: PluginCommandContext): Promise<PluginCommandResult> | PluginCommandResult;
  };

  export type PluginCommandContext = {
    message: string;
    sessionKey: string;
    config: Record<string, unknown>;
  };

  export type PluginCommandResult = {
    text: string;
    continueAgent?: boolean;
  };

  export type PluginHookContext = {
    message?: string;
    sessionKey?: string;
    [key: string]: unknown;
  };

  export type PluginHookResult = {
    handled?: boolean;
    [key: string]: unknown;
  };

  export type OpenClawPluginSessionApi = {
    workflow: {
      scheduleSessionTurn(
        params: PluginSessionTurnScheduleParams,
      ): Promise<PluginSessionSchedulerJobHandle | undefined>;
      unscheduleSessionTurnsByTag(params: { sessionKey: string; tag: string }): Promise<void>;
      sendSessionAttachment(params: PluginSessionAttachmentParams): Promise<void>;
      enqueueNextTurnInjection(injection: unknown): Promise<void>;
      registerSessionSchedulerJob(registration: PluginSessionSchedulerJobRegistration): Promise<void>;
    };
  };

  export type PluginSessionTurnScheduleParams =
    | { at: string | number | Date; deleteAfterRun?: boolean; sessionKey: string; message: string; agentId?: string; deliveryMode?: string; name?: string; tag?: string }
    | { delayMs: number; deleteAfterRun?: boolean; sessionKey: string; message: string; agentId?: string; deliveryMode?: string; name?: string; tag?: string }
    | { cron: string; tz?: string; deleteAfterRun?: false; sessionKey: string; message: string; agentId?: string; deliveryMode?: string; name?: string; tag?: string };

  export type PluginSessionSchedulerJobHandle = {
    id: string;
  };

  export type PluginSessionAttachmentParams = {
    sessionKey: string;
    files: Array<{ path: string }>;
    text?: string;
    threadId?: string | number;
    forceDocument?: boolean;
    maxBytes?: number;
    captionFormat?: "plain" | "html" | "markdown";
  };

  export type PluginSessionSchedulerJobRegistration = {
    id: string;
    sessionKey: string;
    kind: string;
    description?: string;
    cleanup?: (ctx: { reason: string; sessionKey: string; jobId: string }) => void | Promise<void>;
  };

  export type DefinePluginEntryOptions = {
    id: string;
    name: string;
    description: string;
    kind?: string;
    configSchema?: Record<string, unknown> | (() => Record<string, unknown>);
    reload?: unknown;
    nodeHostCommands?: unknown;
    securityAuditCollectors?: unknown;
    register(api: OpenClawPluginApi): void;
  };

  export function definePluginEntry(opts: DefinePluginEntryOptions): unknown;
}

import type {
  LogEntry,
  Metrics,
  Operation,
  ServerInfo,
  ServerStatus
} from "@mcsm/contracts";

export interface PrivateRconConnection {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly password: string;
}

export interface ValidatedLaunchPlan {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly javaExecutable: string;
  readonly jarPath: string;
  readonly argv: readonly string[];
  readonly statusEndpoint: {
    readonly host: "127.0.0.1";
    readonly port: number;
  };
  readonly eulaAccepted: boolean;
  readonly serverInfo: ServerInfo;
  /** Reads the secret only when RCON is used. Never serialize or log the result. */
  readonly getRconConnection: () => Promise<PrivateRconConnection | null>;
}

export interface RegisteredExecutionIdentity {
  readonly rootIdentity: string;
  readonly javaIdentity: string;
  readonly javaSha256: string;
  readonly launcherIdentity: string;
  readonly launcherSha256: string;
  /** Exact unattended Fabric bundle/loader/classpath binding; never an HTTP DTO. */
  readonly fabricExecutionSha256?: string | null;
}

export interface RuntimeOperationContext {
  readonly operationId: string;
  readonly signal: AbortSignal;
  readonly onStep: (step: string) => Promise<Operation>;
  readonly onResult?: (result: NonNullable<Operation["result"]>) => Promise<void>;
}

export interface RuntimeSnapshot {
  readonly status: ServerStatus;
  readonly metrics: Metrics;
  readonly commandTransport: "rcon" | "stdin" | "unavailable";
}

export interface RuntimeCommandResult {
  readonly status: "executed" | "submitted";
  readonly transport: "rcon" | "stdin";
  readonly output: string | null;
}

export interface RuntimeLogPage {
  readonly items: LogEntry[];
  readonly nextCursor: string;
  readonly truncated: boolean;
}

export type RuntimeEvent =
  | { readonly type: "log"; readonly entry: LogEntry }
  | { readonly type: "status"; readonly status: ServerStatus };

export interface SequencedRuntimeEvent {
  readonly sequence: number;
  readonly event: RuntimeEvent;
}

export interface RuntimeStreamSnapshot {
  readonly streamId: string;
  readonly latestSequence: number;
  readonly status: ServerStatus;
  readonly logs: LogEntry[];
}

export interface RuntimeStreamReplay {
  readonly streamId: string;
  readonly latestSequence: number;
  readonly events: SequencedRuntimeEvent[];
  readonly gap: boolean;
  readonly reason: string | null;
}

export interface MinecraftRuntime {
  getProcessResources?(): Promise<Pick<Metrics, "cpu" | "ram">>;
  snapshot(): Promise<RuntimeSnapshot>;
  start(context: RuntimeOperationContext): Promise<void>;
  stop(context: RuntimeOperationContext): Promise<void>;
  stopOwnedForRecovery?(context: RuntimeOperationContext, ownerOperationId: string): Promise<void>;
  command(validatedLine: string): Promise<RuntimeCommandResult>;
  getLogs(after: string | undefined, limit: number): Promise<RuntimeLogPage>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  streamSnapshot(): Promise<RuntimeStreamSnapshot>;
  replayStream(streamId: string, afterSequence: number): Promise<RuntimeStreamReplay>;
  closeObserver(): Promise<void>;
}

export interface RuntimeFactory {
  create(plan: ValidatedLaunchPlan): Promise<MinecraftRuntime>;
}

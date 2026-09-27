import type {
  Activity,
  Alert,
  Capabilities,
  Metrics,
  ServerInfo,
  ServerStatus
} from "@mcsm/contracts";

/** Read-only Phase 1 boundary. Lifecycle and file methods arrive with their phases. */
export interface MinecraftServerAdapter {
  readonly serverId: string;
  getServerInfo(): Promise<ServerInfo>;
  getCapabilities(): Promise<Capabilities>;
  getStatus(): Promise<ServerStatus>;
  getMetrics(): Promise<Metrics>;
  getActivity(): Promise<Activity[]>;
  getAlerts(): Promise<Alert[]>;
}

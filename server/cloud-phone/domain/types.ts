export type RuntimeStatus = "RUNNING" | "STOPPED" | "UNKNOWN";

export type OccupancyStatus = "IDLE" | "OCCUPIED";

export type ConnectionStatus = "CONNECTING" | "CONNECTED" | "EXPIRED" | "CLOSED" | "REPLACED";

export type AgentTaskStatus = "PENDING" | "RUNNING" | "PAUSING" | "PAUSED" | "CALL_FOR_USER" | "COMPLETED" | "FAILED" | "TIMEOUT" | "CANCELLING" | "CANCELED" | "STOPPED";

export type CloudPhoneDevice = {
  id: string;
  tenantId: string;
  instanceId: string;
  name: string;
  runtimeStatus: RuntimeStatus;
  occupancyStatus: OccupancyStatus;
  expireTime?: string;
  lastSyncedAt?: string;
};

export type CloudPhoneConnection = {
  id: string;
  tenantId: string;
  userId: string;
  deviceId: string;
  status: ConnectionStatus;
  leaseExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  ticket?: string;
  instanceId?: string;
  regionId?: string;
  sdkPath?: string;
  port?: number;
  persistentAppInstanceId?: string;
  appInstanceId?: string;
  appInstanceGroupId?: string;
  requestId?: string;
};

export type AgentTask = {
  id: string;
  tenantId: string;
  userId: string;
  connectionId: string;
  deviceId: string;
  instruction: string;
  status: AgentTaskStatus;
  providerTaskId?: string;
  result?: string;
  errorMessage?: string;
  steps?: string;
  duration?: string;
  requestId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "DEVICE_NOT_FOUND"
  | "DEVICE_BUSY"
  | "CONNECTION_NOT_READY"
  | "TASK_NOT_PAUSABLE"
  | "TASK_NOT_RESUMABLE"
  | "ALIYUN_NOT_CONFIGURED"
  | "PROVIDER_NOT_IMPLEMENTED";

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;
  };
};

export const firstPhaseScope = [
  "设备查看",
  "云手机连接",
  "画面操控",
  "自然语言任务",
  "任务状态",
  "暂停和人工接管",
] as const;

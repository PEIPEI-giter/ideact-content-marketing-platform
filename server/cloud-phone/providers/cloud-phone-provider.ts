import type { AgentTask, CloudPhoneDevice } from "../domain/types";

export type ConnectionTicket = {
  ticket: string;
  instanceId: string;
  regionId: string;
  sdkPath: string;
  persistentAppInstanceId?: string;
  appInstanceId?: string;
  appInstanceGroupId?: string;
  port?: number;
  requestId?: string;
};

export type CloudPhoneProvider = {
  describeDevices(): Promise<CloudPhoneDevice[]>;
  getConnectionTicket(input: { device: CloudPhoneDevice; endUserId: string }): Promise<ConnectionTicket>;
  runAgentTask(input: { device: CloudPhoneDevice; instruction: string; idempotencyKey: string }): Promise<AgentTask>;
  describeAgentTask(input: { task: AgentTask }): Promise<AgentTask>;
  pauseAgentTask(input: { task: AgentTask }): Promise<AgentTask>;
  resumeAgentTask(input: { task: AgentTask }): Promise<AgentTask>;
  cancelAgentTask(input: { task: AgentTask }): Promise<AgentTask>;
};

import type { AgentTask, CloudPhoneDevice } from "../domain/types";
import type { CloudPhoneProvider, ConnectionTicket } from "./cloud-phone-provider";

export class MockCloudPhoneProvider implements CloudPhoneProvider {
  async describeDevices(): Promise<CloudPhoneDevice[]> {
    return [];
  }

  async getConnectionTicket(): Promise<ConnectionTicket> {
    throw new Error("Mock Provider 尚未接入连接流程。");
  }

  async runAgentTask(): Promise<AgentTask> {
    throw new Error("Mock Provider 尚未接入自然语言任务流程。");
  }

  async describeAgentTask(input: { task: AgentTask }): Promise<AgentTask> {
    return input.task;
  }

  async pauseAgentTask(input: { task: AgentTask }): Promise<AgentTask> {
    return input.task;
  }

  async resumeAgentTask(input: { task: AgentTask }): Promise<AgentTask> {
    return input.task;
  }

  async cancelAgentTask(input: { task: AgentTask }): Promise<AgentTask> {
    return { ...input.task, status: "FAILED", errorMessage: "Mock Provider 尚未接入结束任务流程。" };
  }
}

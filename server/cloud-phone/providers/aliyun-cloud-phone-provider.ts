import OpenApiClientModule, { Config, OpenApiRequest, Params } from "@alicloud/openapi-client/dist/client";
import { RuntimeOptions } from "@alicloud/tea-util";
import type { AgentTask, CloudPhoneDevice } from "../domain/types";
import type { CloudPhoneProvider, ConnectionTicket } from "./cloud-phone-provider";
import { transferLocalImage } from "../local-image-transfer";

type AliyunProviderConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
  regionId: string;
  endpoint: string;
  instanceId: string;
  instanceIds: string[];
  sdkPath: string;
};

type TicketModel = {
  AppInstanceGroupId?: string;
  InstanceId?: string;
  TaskStatus?: string;
  TaskId?: string;
  Ticket?: string;
  ErrorCode?: string;
  PersistentAppInstanceId?: string;
  AppInstanceId?: string;
  Port?: number;
};

export function createAliyunCloudPhoneProviderFromEnv(env: NodeJS.ProcessEnv): AliyunCloudPhoneProvider {
  const accessKeyId = env.ALIYUN_ACCESS_KEY_ID || env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret = env.ALIYUN_ACCESS_KEY_SECRET || env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  const instanceIds = (env.ALIYUN_CLOUD_PHONE_INSTANCE_IDS || env.ALIYUN_CLOUD_PHONE_INSTANCE_ID || env.ALIYUN_INSTANCE_ID || "").split(",").map((value) => value.trim()).filter(Boolean);
  const regionId = env.ALIYUN_REGION_ID || env.ALIBABA_CLOUD_REGION_ID || "cn-shanghai";
  const endpoint = env.ALIBABA_CLOUD_ENDPOINT || `eds-aic.${regionId}.aliyuncs.com`;
  const sdkPath = env.VITE_WUYING_SDK_URL?.includes("WuyingWebSDK.js")
    ? "/vendor/wuying/sdk/ASP/container.html"
    : env.WUYING_SDK_CONTAINER_PATH || "/vendor/wuying/sdk/ASP/container.html";

  const missing = [
    ["ALIBABA_CLOUD_ACCESS_KEY_ID 或 ALIYUN_ACCESS_KEY_ID", accessKeyId],
    ["ALIBABA_CLOUD_ACCESS_KEY_SECRET 或 ALIYUN_ACCESS_KEY_SECRET", accessKeySecret],
    ["ALIYUN_INSTANCE_ID 或 ALIYUN_CLOUD_PHONE_INSTANCE_ID(S)", instanceIds.length ? "present" : ""],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`云手机配置不完整：缺少 ${missing.map(([key]) => key).join("、")}。`);
  }

  return new AliyunCloudPhoneProvider({
    accessKeyId: accessKeyId!,
    accessKeySecret: accessKeySecret!,
    securityToken: env.ALIBABA_CLOUD_SECURITY_TOKEN,
    regionId,
    endpoint,
    instanceId: instanceIds[0],
    instanceIds,
    sdkPath,
  });
}

export class AliyunCloudPhoneProvider implements CloudPhoneProvider {
  private client: InstanceType<typeof OpenApiClientModule>;

  constructor(private readonly config: AliyunProviderConfig) {
    const OpenApiClient = (OpenApiClientModule as unknown as { default?: typeof OpenApiClientModule }).default || OpenApiClientModule;
    this.client = new OpenApiClient(
      new Config({
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        securityToken: config.securityToken,
        endpoint: config.endpoint,
        regionId: config.regionId,
        protocol: "https",
      }),
    );
  }

  async describeDevices(): Promise<CloudPhoneDevice[]> {
    const startedAt = new Date().toISOString();
    const body = await this.call("DescribeJVSInstance", {
      ...Object.fromEntries(this.config.instanceIds.map((id, index) => [`InstanceIds.${index + 1}`, id])),
      MaxResults: String(Math.max(10, this.config.instanceIds.length)),
    });
    const rows = Array.isArray(body?.Data) ? body.Data : [];
    const matched = rows.filter((item: { InstanceId?: string }) => this.config.instanceIds.includes(item.InstanceId || ""));
    if (!matched.length) {
      throw new Error("阿里云未返回当前配置的云手机实例，请检查实例 ID 和地域是否匹配。");
    }
    return matched.map((item: { InstanceId: string; Status?: string; ExpireTime?: string }) =>
      ({
        id: item.InstanceId,
        tenantId: "local",
        instanceId: item.InstanceId,
        name: `云手机 ${item.InstanceId}`,
        runtimeStatus: normalizeRuntimeStatus(item.Status),
        occupancyStatus: "IDLE",
        expireTime: item.ExpireTime,
        lastSyncedAt: startedAt,
      }));
  }

  async runReadOnlyCommand(device: CloudPhoneDevice, command: string): Promise<string> {
    const started = await this.call("RunCommand", {
      "InstanceIds.1": device.instanceId, CommandContent: command, Timeout: "25", AgentType: "EdsAgent", ContentEncoding: "PlainText",
    });
    const invokeId = started?.InvokeId || started?.RunCommandInfos?.[0]?.InvokeId;
    if (!invokeId) throw new Error("阿里云未返回远程命令编号，无法确认采集结果。");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const response = await this.call("DescribeInvocations", { "InstanceIds.1": device.instanceId, InvocationId: invokeId });
      const result = response?.Data?.find?.((item: { InstanceId?: string }) => item.InstanceId === device.instanceId) || response?.Data?.[0];
      if (!result) continue;
      const status = String(result.InvocationStatus || "").toLowerCase();
      if (status === "success") return String(result.Output || "");
      if (["failed", "timeout"].includes(status)) throw new Error(`云手机只读采集命令${status === "timeout" ? "超时" : "失败"}，请确认设备在线且允许远程命令。`);
    }
    throw new Error("等待云手机采集结果超时，请稍后重试。 ");
  }

  async getConnectionTicket(input: { device: CloudPhoneDevice; endUserId: string }): Promise<ConnectionTicket> {
    const first = await this.call("BatchGetAcpConnectionTicket", {
      "InstanceIds.1": input.device.instanceId,
    });
    let model = firstTicketModel(first, input.device.instanceId);
    for (let attempt = 0; attempt < 5 && model?.TaskId && model.TaskStatus !== "FINISHED"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const next = await this.call("BatchGetAcpConnectionTicket", {
        "InstanceTasks.1.InstanceId": input.device.instanceId,
        "InstanceTasks.1.TaskId": model.TaskId,
      });
      model = firstTicketModel(next, input.device.instanceId);
    }

    if (!model?.Ticket) {
      throw new Error(`阿里云连接凭证尚未生成${model?.ErrorCode ? `：${model.ErrorCode}` : "，请稍后重试"}`);
    }

    return {
      ticket: model.Ticket,
      instanceId: input.device.instanceId,
      regionId: this.config.regionId,
      sdkPath: this.config.sdkPath,
      persistentAppInstanceId: model.PersistentAppInstanceId,
      appInstanceId: model.AppInstanceId,
      appInstanceGroupId: model.AppInstanceGroupId,
      port: model.Port,
      requestId: first?.RequestId,
    };
  }

  async runAgentTask(input: { device: CloudPhoneDevice; instruction: string; idempotencyKey: string }): Promise<AgentTask> {
    const body = await this.call("RunAgentTask", {
      "InstanceIds.1": input.device.instanceId,
      UserPrompt: input.instruction,
      MaxSteps: String(clampNumber(process.env.ALIYUN_MAX_STEPS, 30, 1000, 30)),
      TimeoutSeconds: String(clampNumber(process.env.ALIYUN_TASK_TIMEOUT_SECONDS, 300, 3600, 300)),
      BizRegionId: this.config.regionId,
    });
    const task = firstTaskModel(body, input.device.instanceId);
    if (!task?.TaskId) throw new Error(body?.Message || "阿里云未返回 Agent 任务编号。");
    const now = new Date().toISOString();
    return {
      id: input.idempotencyKey,
      tenantId: "local",
      userId: "local",
      connectionId: "",
      deviceId: input.device.id,
      instruction: input.instruction,
      status: normalizeAgentTaskStatus(task.CurrentStatus),
      providerTaskId: task.TaskId,
      requestId: body?.RequestId,
      createdAt: task.RunningAt || now,
      updatedAt: now,
    };
  }

  async sendFileToDevice(input: { device: CloudPhoneDevice; sourceUrl: string; targetPath: string; idempotencyKey: string }) {
    const response = await this.call("SendFile", {
      "AndroidInstanceIdList.1": input.device.instanceId,
      SourceFilePath: input.targetPath,
      UploadType: "DOWNLOAD_URL",
      UploadUrl: input.sourceUrl,
      ClientToken: input.idempotencyKey.slice(0, 100),
    });
    const taskId = response?.Data?.find?.((item: { AndroidInstanceId?: string }) => item.AndroidInstanceId === input.device.instanceId)?.TaskId || response?.TaskId;
    if (!taskId) throw new Error("阿里云未返回图片传输任务编号，无法确认图片已进入云手机。 ");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const statusResponse = await this.call("DescribeTasks", { "TaskIds.1": taskId, MaxResults: "10" });
      const task = statusResponse?.Data?.find?.((item: { TaskId?: string }) => item.TaskId === taskId);
      if (!task) continue;
      if (task.TaskStatus === "Finished") return { taskId, targetPath: input.targetPath };
      if (["Failed", "Skipped", "PartFinished"].includes(task.TaskStatus)) throw new Error(`图片传入云手机失败：${task.ErrorMsg || task.ErrorCode || task.TaskStatus}`);
    }
    throw new Error("图片传输状态查询超时，未确认图片已经进入云手机。请先检查云手机文件，再决定是否重试。 ");
  }

  async sendLocalImageToDevice(input: { device: CloudPhoneDevice; image: Buffer; targetPath: string; onProgress?: (completed: number, total: number) => Promise<void> }) {
    return transferLocalImage({
      image: input.image, targetPath: input.targetPath, onProgress: input.onProgress,
      run: async (command) => {
        let body: any;
        try {
          body = await this.call("RunSyncCommand", {
            "InstanceIds.1": input.device.instanceId, CommandContent: command,
            Timeout: "25", WaitTime: "3000", AgentType: "EdsAgent", ContentEncoding: "PlainText",
          });
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80) : "unknown";
          throw new Error(`云手机传图命令调用失败（${code}）。请确认设备在线、AccessKey 有 RunSyncCommand 权限，或稍后手动重试。`);
        }
        const result = body?.Data?.find?.((item: { InstanceId?: string }) => item.InstanceId === input.device.instanceId);
        if (result?.InvocationStatus !== "Success") throw new Error("云手机图片传输命令未成功，请确认设备在线且有远程命令权限。 ");
        return String(result.Output || "");
      },
    });
  }

  async describeAgentTask(input: { task: AgentTask }): Promise<AgentTask> {
    if (!input.task.providerTaskId) return input.task;
    const body = await this.call("DescribeAgentTask", { "TaskIds.1": input.task.providerTaskId });
    const task = firstTaskModel(body);
    if (!task) return input.task;
    return mergeProviderTask(input.task, task);
  }

  async pauseAgentTask(input: { task: AgentTask }): Promise<AgentTask> {
    return this.changeTask("PauseAgentTask", input.task);
  }

  async resumeAgentTask(input: { task: AgentTask }): Promise<AgentTask> {
    return this.changeTask("ResumeAgentTask", input.task);
  }

  async cancelAgentTask(input: { task: AgentTask }): Promise<AgentTask> {
    return this.changeTask("CancelAgentTask", input.task);
  }

  private async changeTask(action: "PauseAgentTask" | "ResumeAgentTask" | "CancelAgentTask", task: AgentTask): Promise<AgentTask> {
    if (!task.providerTaskId) throw new Error("缺少阿里云任务编号，无法操作任务。");
    const body = await this.call(action, { "TaskIds.1": task.providerTaskId });
    const providerTask = firstTaskModel(body);
    if (!providerTask) return task;
    return mergeProviderTask(task, providerTask);
  }

  private async call(action: string, query: Record<string, string>) {
    const request = new OpenApiRequest({ query });
    const params = new Params({
      action,
      version: "2023-09-30",
      protocol: "HTTPS",
      pathname: "/",
      method: "POST",
      authType: "AK",
      bodyType: "json",
      reqBodyType: "json",
      style: "RPC",
    });
    const response = await this.client.callApi(params, request, new RuntimeOptions({ readTimeout: 20000, connectTimeout: 10000 }));
    return response.body;
  }
}

function normalizeRuntimeStatus(status: unknown): CloudPhoneDevice["runtimeStatus"] {
  const value = String(status || "").toUpperCase();
  if (value.includes("RUN")) return "RUNNING";
  if (value.includes("STOP")) return "STOPPED";
  return "UNKNOWN";
}

function firstTicketModel(body: any, instanceId: string): TicketModel | undefined {
  const rows = Array.isArray(body?.InstanceConnectionModels) ? body.InstanceConnectionModels : [];
  return rows.find((item: TicketModel) => item.InstanceId === instanceId) ?? rows[0];
}

function firstTaskModel(body: any, instanceId?: string): any | undefined {
  const rows = Array.isArray(body?.Tasks) ? body.Tasks : [];
  return instanceId ? rows.find((item: any) => item.InstanceId === instanceId) ?? rows[0] : rows[0];
}

function normalizeAgentTaskStatus(status: unknown): AgentTask["status"] {
  const value = String(status || "").toUpperCase();
  if (value === "PENDING") return "PENDING";
  if (value === "RUNNING") return "RUNNING";
  if (value === "PAUSING") return "PAUSING";
  if (value === "PAUSED") return "PAUSED";
  if (value === "CALL_FOR_USER") return "CALL_FOR_USER";
  if (value === "COMPLETED") return "COMPLETED";
  if (value === "TIMEOUT") return "TIMEOUT";
  if (value === "CANCELLING") return "CANCELLING";
  if (value === "CANCELED") return "CANCELED";
  if (value === "STOPPED") return "STOPPED";
  if (value === "FAILED") return "FAILED";
  return "PENDING";
}

function mergeProviderTask(task: AgentTask, providerTask: any): AgentTask {
  return {
    ...task,
    status: normalizeAgentTaskStatus(providerTask.CurrentStatus),
    result: providerTask.TaskResult || task.result,
    errorMessage: providerTask.FailedReason || providerTask.Reason || task.errorMessage,
    steps: providerTask.Steps || task.steps,
    duration: providerTask.TaskDuration || task.duration,
    updatedAt: new Date().toISOString(),
  };
}

function clampNumber(raw: string | undefined, min: number, max: number, fallback: number) {
  const value = Number(raw || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

import express from "express";
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import BailianClientModule from "@alicloud/bailian20231229";
import { ListIndicesRequest, RetrieveRequest } from "@alicloud/bailian20231229/dist/models/model";
import { Config } from "@alicloud/openapi-client/dist/client";
import { RuntimeOptions } from "@darabonba/typescript/dist/core";
import {
  buildGroundedPrompt,
  extractProductsFromCitations,
  hasKnowledgeBaseIndex,
  loadKnowledgeBases,
  normalizeRetrieveNodes,
  publicKnowledgeBase,
  toSafeError,
  type KnowledgeBaseConfig,
} from "./knowledge-utils";
import { generateImage, generateText } from "./model-clients";
import {
  assertCompleteCopies,
  buildCopyRequestKey,
  buildCopywritingPrompt,
  normalizeChannels,
  parseCopywritingJson,
  validateCopywritingContext,
  type CopywritingContext,
} from "./copywriting-utils";
import { buildTopicPrompt, getHotspots, parseTopicJson } from "./topic-utils";
import {
  buildSocialImagePrompt,
  buildVisualDirectionsPrompt,
  parseVisualDirectionsJson,
  validateSocialImageRequest,
  type SocialImageRequest,
} from "./image-workflow-utils";
import { createAliyunCloudPhoneProviderFromEnv } from "./cloud-phone/providers/aliyun-cloud-phone-provider";
import type { AgentTask, CloudPhoneConnection, CloudPhoneDevice } from "./cloud-phone/domain/types";
import { buildPublishInstruction, createPublishAlbum, isPublishDue, parsePublishRequest, publishAgentFailureMessage, publishProgressEvent, PublishingStore, type PublishJob } from "./publishing";
import { registerPrivateInboxRoutes } from "./private-inbox-routes";
import { detectXhsLoggedOut } from "./private-inbox";
import { createAuthService } from "./auth";
import { ContentWorkspaceStore, validateContentWorkspaceValues } from "./content-workspace";

const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const BailianClient = (BailianClientModule as unknown as { default?: typeof BailianClientModule }).default || BailianClientModule;
const cloudPhoneConnections = new Map<string, CloudPhoneConnection>();
const cloudPhoneTasks = new Map<string, AgentTask & { deviceName?: string; providerReason?: string; steps?: string; duration?: string; requestId?: string }>();
const cloudPhoneTaskIdempotency = new Map<string, string>();
const publishingStore = new PublishingStore(path.join(process.cwd(), "data", "publishing-jobs.json"));
const authService = createAuthService();
const contentWorkspaceStore = new ContentWorkspaceStore(
  process.env.CONTENT_WORKSPACE_PATH || path.join(process.cwd(), "data", "content-workspace.json"),
);
let publishingTickRunning = false;

app.use(express.json({ limit: "10mb" }));
app.get("/api/auth/status", authService.status);
app.post("/api/auth/login", authService.login);
app.post("/api/auth/logout", authService.logout);
app.use("/api", authService.requireAuth);
app.use("/generated-images", authService.requireAuth, express.static(path.join(process.cwd(), "public", "generated-images")));

app.get("/api/content-workspace", async (_request, response) => {
  try {
    response.json(await contentWorkspaceStore.read());
  } catch (error) {
    response.status(500).json({ message: toSafeError(error) });
  }
});

app.put("/api/content-workspace", async (request, response) => {
  let values: Record<string, string>;
  try {
    values = validateContentWorkspaceValues(request.body?.values);
  } catch (error) {
    response.status(422).json({ message: toSafeError(error) });
    return;
  }
  try {
    response.json(await contentWorkspaceStore.replace(values));
  } catch (error) {
    response.status(500).json({ message: toSafeError(error) });
  }
});

function getKnowledgeBases() {
  return loadKnowledgeBases(process.env);
}

function getBaseOrThrow(id: string) {
  const base = getKnowledgeBases().find((item) => item.id === id);
  if (!base) {
    throw new Error("未找到当前选择的知识库配置，请检查知识库 ID 是否仍在服务端配置中。");
  }
  return base;
}

function createBailianClient(base: KnowledgeBaseConfig) {
  const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("缺少阿里云 AccessKey 配置，请在服务端环境变量中设置 ALIBABA_CLOUD_ACCESS_KEY_ID 和 ALIBABA_CLOUD_ACCESS_KEY_SECRET。");
  }

  const config = new Config({
    accessKeyId,
    accessKeySecret,
    endpoint: base.endpoint,
    regionId: base.regionId,
  });

  return new BailianClient(config);
}

function getCloudPhoneProvider() {
  return createAliyunCloudPhoneProviderFromEnv(process.env);
}

function getCloudPhoneEndUserId() {
  return process.env.ALIYUN_END_USER_ID || process.env.ALIYUN_CLOUD_PHONE_USER || "ideact-local-user";
}

function cloudPhoneLeaseExpiresAt() {
  const seconds = Number(process.env.CONNECTION_LEASE_SECONDS || 60);
  return new Date(Date.now() + Math.max(30, seconds) * 1000).toISOString();
}

function getActiveConnectionForDevice(deviceId: string) {
  const now = Date.now();
  return [...cloudPhoneConnections.values()].find(
    (item) => item.deviceId === deviceId && item.status === "CONNECTED" && new Date(item.leaseExpiresAt).getTime() > now,
  );
}

function publicCloudPhoneConnection(connection: CloudPhoneConnection) {
  return {
    connectionId: connection.id,
    deviceId: connection.deviceId,
    instanceId: connection.instanceId,
    status: connection.status,
    leaseExpiresAt: connection.leaseExpiresAt,
    ticket: connection.ticket,
    persistentAppInstanceId: connection.persistentAppInstanceId,
    appInstanceId: connection.appInstanceId,
    appInstanceGroupId: connection.appInstanceGroupId,
    port: connection.port,
    requestId: connection.requestId,
    regionId: connection.regionId,
    sdkPath: connection.sdkPath,
  };
}

function isActiveAgentTask(task: AgentTask) {
  return ["PENDING", "RUNNING", "PAUSING", "PAUSED", "CALL_FOR_USER", "CANCELLING"].includes(task.status);
}

function publicAgentTask(task: AgentTask & { deviceName?: string; steps?: string; duration?: string; requestId?: string }) {
  return {
    id: task.id,
    providerTaskId: task.providerTaskId,
    deviceId: task.deviceId,
    deviceName: task.deviceName,
    connectionId: task.connectionId,
    instruction: task.instruction,
    status: task.status,
    result: task.result,
    errorMessage: task.errorMessage,
    steps: task.steps,
    duration: task.duration,
    requestId: task.requestId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function maskCloudPhoneError(error: unknown) {
  return toSafeError(error)
    .replace(/(ALIYUN_ACCESS_KEY_SECRET=)[^\s]+/g, "$1***")
    .replace(/(ALIYUN_ACCESS_KEY_ID=)[^\s]+/g, "$1***")
    .replace(/(AccessKeySecret=)[^\s]+/gi, "$1***")
    .replace(/(AccessKeyId=)[^\s]+/gi, "$1***");
}

registerPrivateInboxRoutes(app, { getProvider: getCloudPhoneProvider, safeError: maskCloudPhoneError });

async function retrieve(base: KnowledgeBaseConfig, question: string) {
  const client = createBailianClient(base);
  const request = new RetrieveRequest({
    indexId: base.indexId,
    query: question,
  });
  const runtime = new RuntimeOptions({});
  const startedAt = performance.now();
  const response = await client.retrieveWithOptions(base.workspaceId, request, {}, runtime);
  const durationMs = Math.round(performance.now() - startedAt);

  return {
    durationMs,
    citations: normalizeRetrieveNodes(response.body?.data),
  };
}

app.get("/api/cloud-phone/devices", async (_req, res) => {
  try {
    const provider = getCloudPhoneProvider();
    const devices = await provider.describeDevices();
    res.json({
      devices: devices.map((device) => {
        const activeConnection = getActiveConnectionForDevice(device.id);
        return {
          ...device,
          occupancyStatus: activeConnection ? "OCCUPIED" : device.occupancyStatus,
          activeConnectionId: activeConnection?.id,
        };
      }),
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      message: maskCloudPhoneError(error),
      suggestions: ["检查 .env 中云手机实例 ID、地域和阿里云 AccessKey 是否完整。", "确认实例属于 cn-shanghai，且 AccessKey 有 EDS-AIC 查询权限。"],
    });
  }
});

app.post("/api/cloud-phone/devices/:deviceId/connections", async (req, res) => {
  try {
    const provider = getCloudPhoneProvider();
    const devices = await provider.describeDevices();
    const device = devices.find((item: CloudPhoneDevice) => item.id === req.params.deviceId || item.instanceId === req.params.deviceId);
    if (!device) {
      res.status(404).json({ message: "未找到这台云手机，请先刷新设备列表。" });
      return;
    }
    if (device.runtimeStatus !== "RUNNING") {
      res.status(409).json({ message: "云手机当前不是运行中状态，无法连接。", suggestions: ["请到阿里云控制台确认实例已开机并处于 RUNNING。"] });
      return;
    }

    const activeConnection = getActiveConnectionForDevice(device.id);
    if (activeConnection && !req.body?.force) {
      res.status(409).json({ message: "这台云手机当前已有活动连接，请先断开后再重新连接。", connectionId: activeConnection.id });
      return;
    }
    if (activeConnection) {
      activeConnection.status = "REPLACED";
      activeConnection.updatedAt = new Date().toISOString();
    }

    const ticket = await provider.getConnectionTicket({ device, endUserId: getCloudPhoneEndUserId() });
    const now = new Date().toISOString();
    const connection: CloudPhoneConnection = {
      id: crypto.randomUUID(),
      tenantId: "local",
      userId: getCloudPhoneEndUserId(),
      deviceId: device.id,
      status: "CONNECTED",
      leaseExpiresAt: cloudPhoneLeaseExpiresAt(),
      createdAt: now,
      updatedAt: now,
      ...ticket,
    };
    cloudPhoneConnections.set(connection.id, connection);
    res.status(201).json(publicCloudPhoneConnection(connection));
  } catch (error) {
    res.status(502).json({
      message: maskCloudPhoneError(error),
      suggestions: ["确认云手机实例 ID 正确且处于运行中。", "确认 AccessKey 有 BatchGetAcpConnectionTicket 权限。", "如果返回 Ticket 生成中，请稍后再点连接。"],
    });
  }
});

app.post("/api/cloud-phone/connections/:connectionId/heartbeat", (req, res) => {
  const connection = cloudPhoneConnections.get(req.params.connectionId);
  if (!connection || connection.status !== "CONNECTED") {
    res.status(409).json({ message: "连接已失效或已断开，请重新连接云手机。" });
    return;
  }
  connection.leaseExpiresAt = cloudPhoneLeaseExpiresAt();
  connection.updatedAt = new Date().toISOString();
  res.json({ status: connection.status, leaseExpiresAt: connection.leaseExpiresAt });
});

app.delete("/api/cloud-phone/connections/:connectionId", (req, res) => {
  const connection = cloudPhoneConnections.get(req.params.connectionId);
  if (connection) {
    connection.status = "CLOSED";
    connection.updatedAt = new Date().toISOString();
  }
  res.status(204).send();
});

app.post("/api/cloud-phone/connections/:connectionId/tasks", async (req, res) => {
  const instruction = typeof req.body?.instruction === "string" ? req.body.instruction.trim() : "";
  const idempotencyKey = String(req.header("Idempotency-Key") || req.body?.idempotencyKey || "").trim();
  if (!instruction) {
    res.status(422).json({ message: "请输入自然语言指令后再发送。" });
    return;
  }
  if (instruction.length > 2000) {
    res.status(422).json({ message: "指令最多 2000 个字，请精简后重试。" });
    return;
  }
  if (!idempotencyKey) {
    res.status(422).json({ message: "缺少幂等键，请刷新页面后重试。" });
    return;
  }

  try {
    const connection = cloudPhoneConnections.get(req.params.connectionId);
    if (!connection || connection.status !== "CONNECTED") {
      res.status(409).json({ message: "云手机尚未连接或连接已断开，请先重新连接。" });
      return;
    }

    const scopedKey = `${connection.deviceId}:${idempotencyKey}`;
    const existingTaskId = cloudPhoneTaskIdempotency.get(scopedKey);
    if (existingTaskId && cloudPhoneTasks.has(existingTaskId)) {
      res.status(202).json({ task: publicAgentTask(cloudPhoneTasks.get(existingTaskId)!), repeated: true });
      return;
    }

    const activeTask = [...cloudPhoneTasks.values()].find((task) => task.deviceId === connection.deviceId && isActiveAgentTask(task));
    if (activeTask) {
      res.status(409).json({ message: "这台云手机已有一个未结束的 AI 任务，请等待完成、暂停接管或结束任务后再发送新指令。", task: publicAgentTask(activeTask) });
      return;
    }

    const provider = getCloudPhoneProvider();
    const devices = await provider.describeDevices();
    const device = devices.find((item) => item.id === connection.deviceId || item.instanceId === connection.instanceId);
    if (!device) {
      res.status(404).json({ message: "未找到当前连接对应的云手机，请重新刷新设备并连接。" });
      return;
    }

    const task = await provider.runAgentTask({ device, instruction, idempotencyKey: crypto.randomUUID() });
    const savedTask = {
      ...task,
      id: crypto.randomUUID(),
      tenantId: "local",
      userId: connection.userId,
      connectionId: connection.id,
      deviceId: connection.deviceId,
      deviceName: device.name,
      instruction,
      createdAt: task.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    cloudPhoneTasks.set(savedTask.id, savedTask);
    cloudPhoneTaskIdempotency.set(scopedKey, savedTask.id);
    res.status(202).json({ task: publicAgentTask(savedTask), repeated: false });
  } catch (error) {
    res.status(502).json({
      message: maskCloudPhoneError(error),
      suggestions: ["确认当前云手机画面仍然连接。", "确认 AccessKey 有 RunAgentTask 权限。", "不要重复点击发送，保留原指令后稍后重试。"],
    });
  }
});

app.get("/api/cloud-phone/tasks/:taskId", async (req, res) => {
  const task = cloudPhoneTasks.get(req.params.taskId);
  if (!task) {
    res.status(404).json({ message: "未找到这条 AI 任务记录，请回到云手机页面重新查看。" });
    return;
  }
  try {
    if (isActiveAgentTask(task)) {
      const provider = getCloudPhoneProvider();
      const synced = await provider.describeAgentTask({ task });
      const savedTask = { ...task, ...synced, updatedAt: new Date().toISOString() };
      cloudPhoneTasks.set(task.id, savedTask);
      res.json({ task: publicAgentTask(savedTask) });
      return;
    }
    res.json({ task: publicAgentTask(task) });
  } catch (error) {
    res.status(502).json({
      message: maskCloudPhoneError(error),
      task: publicAgentTask(task),
      suggestions: ["任务已保留，但同步阿里云状态失败。", "请确认 DescribeAgentTask 权限后重试。"],
    });
  }
});

app.post("/api/cloud-phone/tasks/:taskId/pause", async (req, res) => {
  await changeCloudPhoneTask(req, res, "pause");
});

app.post("/api/cloud-phone/tasks/:taskId/resume", async (req, res) => {
  await changeCloudPhoneTask(req, res, "resume");
});

app.post("/api/cloud-phone/tasks/:taskId/cancel", async (req, res) => {
  await changeCloudPhoneTask(req, res, "cancel");
});

async function changeCloudPhoneTask(req: express.Request, res: express.Response, action: "pause" | "resume" | "cancel") {
  const taskId = String(req.params.taskId);
  const task = cloudPhoneTasks.get(taskId);
  if (!task) {
    res.status(404).json({ message: "未找到这条 AI 任务记录。" });
    return;
  }
  try {
    const provider = getCloudPhoneProvider();
    const next =
      action === "pause"
        ? await provider.pauseAgentTask({ task })
        : action === "resume"
          ? await provider.resumeAgentTask({ task })
          : await provider.cancelAgentTask({ task });
    const savedTask = { ...task, ...next, updatedAt: new Date().toISOString() };
    cloudPhoneTasks.set(task.id, savedTask);
    res.status(202).json({ task: publicAgentTask(savedTask) });
  } catch (error) {
    res.status(502).json({
      message: maskCloudPhoneError(error),
      task: publicAgentTask(task),
      suggestions: ["确认任务仍处于可操作状态。", "如果阿里云提示状态不允许，请先刷新任务状态。"],
    });
  }
}

app.get("/api/publishing/capabilities", (_req, res) => {
  res.json({ imageDeliveryReady: true, imageDeliveryMessage: "千问生成图将通过阿里云 SendFile 整图直传云手机；本机副本继续保留。" });
});

function publicPublishJob(job: PublishJob) {
  const { imageSources: _imageSources, ...safe } = job;
  if (safe.status !== "FAILED" && isStatusSyncNetworkError(safe.errorMessage)) {
    if (["SCHEDULED", "QUEUED", "PREPARING", "RUNNING"].includes(safe.status)) {
      safe.syncWarning = "阿里云状态查询曾短暂中断，发布任务仍在执行，系统会自动继续查询，无需重新提交。";
    }
    safe.errorMessage = undefined;
  }
  return safe;
}

function isStatusSyncNetworkError(message?: string) {
  return /socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|temporarily unavailable/i.test(message || "");
}

app.get("/api/publishing/jobs", async (_req, res) => {
  try {
    const jobs = (await publishingStore.list()).map((job) => /任务TIMEOUT/.test(job.errorMessage || "")
      ? { ...job, errorMessage: publishAgentFailureMessage("TIMEOUT", job.providerDuration, job.errorMessage) }
      : job).map(publicPublishJob);
    res.json({ jobs });
  }
  catch { res.status(500).json({ message: "读取发布记录失败，请检查本地数据目录。" }); }
});

app.post("/api/publishing/jobs", async (req, res) => {
  try {
    const idempotencyKey = String(req.header("Idempotency-Key") || "").trim();
    if (!idempotencyKey || idempotencyKey.length > 100) {
      res.status(422).json({ message: "缺少有效的提交标识，请刷新页面后重试。" }); return;
    }
    const existing = await publishingStore.findIdempotency(idempotencyKey);
    if (existing) { res.status(200).json({ job: publicPublishJob(existing), repeated: true }); return; }
    const input = parsePublishRequest(req.body);
    for (const imagePath of input.imagePaths) {
      await fs.access(path.join(process.cwd(), "public", imagePath.slice(1)));
    }
    const provider = getCloudPhoneProvider();
    const targetDevice = (await provider.describeDevices()).find((device) => device.id === input.deviceId);
    if (!targetDevice || targetDevice.runtimeStatus !== "RUNNING") throw new Error("目标云手机当前不可用，请确认设备已经开机并处于运行中。");
    try {
      const hierarchy = await provider.runReadOnlyCommand(targetDevice, "uiautomator dump --compressed /proc/self/fd/1");
      const loggedOut = detectXhsLoggedOut(hierarchy);
      if (loggedOut) throw new Error(loggedOut);
    } catch (error) {
      if (error instanceof Error && /小红书登录失效/.test(error.message)) throw error;
      // 页面不在小红书时无法判断登录状态，后续仍由真实发布任务处理。
    }
    const now = new Date().toISOString();
    const job: PublishJob = {
      id: crypto.randomUUID(), idempotencyKey, ...input,
      approvedAt: now, status: input.mode === "scheduled" ? "SCHEDULED" : "QUEUED",
      progressEvents: [publishProgressEvent("queued", input.mode === "scheduled" ? "等待预约时间" : "发布任务已保存", input.mode === "scheduled" ? `将在 ${input.scheduledAt} 进入执行队列。` : "审核内容和目标设备已保存，等待服务端开始处理。", input.mode === "scheduled" ? "pending" : "completed", now)],
      createdAt: now, updatedAt: now,
    };
    const album = createPublishAlbum(job.id);
    buildPublishInstruction(
      job,
      input.imagePaths.map((imagePath, index) => `${album.directory}/${String(index + 1).padStart(2, "0")}${path.extname(imagePath).toLowerCase()}`),
      album.name,
    );
    const saved = await publishingStore.save(job);
    res.status(saved.repeated ? 200 : 201).json({ ...saved, job: publicPublishJob(saved.job) });
    if (!saved.repeated) void runPublishingTick();
  } catch (error) {
    const message = error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "所选图片文件已不存在，请回到内容生产流水线重新生成或选择图片。"
      : error instanceof Error ? error.message.trim() : "创建发布任务失败，请稍后重试。";
    res.status(422).json({ message });
  }
});

app.post("/api/publishing/jobs/:jobId/cancel", async (req, res) => {
  const job = await publishingStore.find(req.params.jobId);
  if (!job) { res.status(404).json({ message: "未找到发布任务。" }); return; }
  if (!["SCHEDULED", "QUEUED"].includes(job.status)) { res.status(409).json({ message: "任务已进入执行阶段，不能从这里取消；请到操控中心查看云手机。" }); return; }
  const updated = await publishingStore.update(job.id, { status: "CANCELED" });
  res.json({ job: updated ? publicPublishJob(updated) : updated });
});

app.post("/api/publishing/jobs/:jobId/confirm", async (req, res) => {
  const job = await publishingStore.find(req.params.jobId);
  if (!job) { res.status(404).json({ message: "未找到发布任务。" }); return; }
  if (job.status !== "REVIEW_REQUIRED") { res.status(409).json({ message: "只有 AI 执行完成、待人工核验的任务才能确认已发布。" }); return; }
  const publishedAt = new Date().toISOString();
  const updated = await publishingStore.updateProgress(job.id, { status: "PUBLISHED", publishedAt }, publishProgressEvent("review", "人工核验完成", "运营人员已在目标平台确认内容发布完成。", "completed", publishedAt));
  res.json({ job: updated ? publicPublishJob(updated) : updated });
});

async function runPublishingTick() {
  if (publishingTickRunning) return;
  publishingTickRunning = true;
  try {
    const jobs = await publishingStore.list();
    for (const job of jobs.filter((item) => item.status === "RUNNING")) {
      if (!job.providerTaskId) {
        await publishingStore.update(job.id, { status: "REVIEW_REQUIRED", errorMessage: "缺少阿里云任务编号，无法确认是否已经发布，请人工核验。" });
        continue;
      }
      try {
        const provider = getCloudPhoneProvider();
        const task = await provider.describeAgentTask({ task: {
          id: job.id, tenantId: "local", userId: "local", connectionId: "", deviceId: job.deviceId,
          instruction: "", status: "RUNNING", providerTaskId: job.providerTaskId,
          createdAt: job.createdAt, updatedAt: job.updatedAt,
        } });
        if (task.status === "COMPLETED") {
          await publishingStore.updateProgress(job.id, { status: "REVIEW_REQUIRED", providerSteps: task.steps, providerDuration: task.duration, providerResult: task.result || "AI 任务执行完成，请在平台账号中核实帖子是否真正发布。", errorMessage: undefined, syncWarning: undefined }, publishProgressEvent("executing", "AI 操作已结束", `阿里云任务已完成${task.steps ? `，共执行 ${task.steps} 步` : ""}${task.duration ? `，用时 ${task.duration} 秒` : ""}。`, "completed"));
          await publishingStore.updateProgress(job.id, {}, publishProgressEvent("review", "等待人工核验", "请在实时画面或目标平台确认帖子、文案和图片无误。", "running"));
        } else if (["FAILED", "TIMEOUT", "CANCELED", "STOPPED"].includes(task.status)) {
          const failure = publishAgentFailureMessage(task.status, task.duration, task.errorMessage);
          await publishingStore.updateProgress(job.id, { status: "FAILED", providerSteps: task.steps, providerDuration: task.duration, errorMessage: failure, syncWarning: undefined }, publishProgressEvent("executing", "AI 执行未完成", failure, "failed"));
        } else if (task.steps !== job.providerSteps || task.duration !== job.providerDuration || job.errorMessage || job.syncWarning) {
          await publishingStore.updateProgress(job.id, { providerSteps: task.steps, providerDuration: task.duration, errorMessage: undefined, syncWarning: undefined }, publishProgressEvent("executing", "AI 正在操作云手机", task.steps ? `阿里云已执行 ${task.steps} 步，实时画面会同步显示当前操作。` : "阿里云任务运行中，正在等待返回已执行步数。", "running"));
        }
      } catch (error) {
        await publishingStore.update(job.id, {
          errorMessage: undefined,
          syncWarning: "阿里云状态查询暂时中断，任务记录已保留，系统会自动继续查询。请勿重复提交发布。",
        });
      }
    }

    for (const job of jobs.filter((item) => isPublishDue(item))) {
      const current = await publishingStore.find(job.id);
      if (!current || !["SCHEDULED", "QUEUED"].includes(current.status)) continue;
      const all = await publishingStore.list();
      if (all.some((item) => item.id !== job.id && item.deviceId === job.deviceId && ["PREPARING", "RUNNING"].includes(item.status))) continue;
      if ([...cloudPhoneTasks.values()].some((item) => item.deviceId === job.deviceId && isActiveAgentTask(item))) continue;
      await publishingStore.updateProgress(job.id, { status: "PREPARING", errorMessage: undefined }, publishProgressEvent("preparing", "校验设备与素材", "正在确认云手机在线状态、文案和所选图片。", "running"));
      let agentDispatchStarted = false;
      try {
        const provider = getCloudPhoneProvider();
        const devices = await provider.describeDevices();
        const device = devices.find((item) => item.id === job.deviceId || item.instanceId === job.deviceId);
        if (!device || device.runtimeStatus !== "RUNNING") throw new Error("目标云手机不在线，发布任务未执行。" );
        if (job.imagePaths.length > 0 && (!Array.isArray(job.imageSources) || job.imageSources.length !== job.imagePaths.length)) {
          throw new Error("发布记录缺少图片直传地址。请回到内容生产流水线重新生成图片，再创建新的发布任务。");
        }
        const album = createPublishAlbum(job.id);
        await publishingStore.updateProgress(job.id, {}, publishProgressEvent("preparing", "设备与素材校验完成", "目标云手机在线，发布内容和图片来源有效。", "completed"));
        if (job.imagePaths.length > 0) {
          await publishingStore.updateProgress(job.id, {}, publishProgressEvent("images", "传入本次发布图片", `正在把 ${job.imagePaths.length} 张图片传入任务独立相册。`, "running"));
          await provider.preparePublishAlbum({ device, directory: album.directory });
          await publishingStore.update(job.id, { deviceAlbum: album.name });
        }
        const devicePaths = Array<string>(job.imagePaths.length);
        let completedImages = 0;
        await mapWithConcurrency(job.imagePaths, 3, async (imagePath, index) => {
          const extension = path.extname(imagePath);
          const targetPath = `${album.directory}/${String(index + 1).padStart(2, "0")}${extension.toLowerCase()}`;
          const image = await fs.readFile(path.join(process.cwd(), "public", imagePath.slice(1)));
          await publishingStore.update(job.id, {
            imageTransfer: { image: index + 1, totalImages: job.imagePaths.length, completed: completedImages, total: job.imagePaths.length, mode: "direct-url" },
          });
          await provider.sendFileToDevice({
            device,
            sourceUrl: job.imageSources[index],
            targetPath,
            fileMd5: crypto.createHash("md5").update(image).digest("hex"),
            idempotencyKey: `${job.id}-${index + 1}`,
          });
          devicePaths[index] = targetPath;
          completedImages += 1;
          await publishingStore.update(job.id, {
            imageTransfer: { image: index + 1, totalImages: job.imagePaths.length, completed: completedImages, total: job.imagePaths.length, mode: "direct-url" },
          });
        });
        await provider.refreshPublishImages({ device, paths: devicePaths });
        await publishingStore.updateProgress(job.id, {}, publishProgressEvent("images", job.imagePaths.length ? "图片传输完成" : "本次无需配图", job.imagePaths.length ? `${job.imagePaths.length} 张图片已进入云手机独立相册并完成媒体索引。` : "本次发布没有选择图片。", "completed"));
        const instruction = buildPublishInstruction(job, devicePaths, album.name);
        agentDispatchStarted = true;
        await publishingStore.updateProgress(job.id, {}, publishProgressEvent("dispatching", "提交阿里云 Mobile Agent", "正在创建自动发布任务，只会提交一次。", "running"));
        const task = await provider.runAgentTask({ device, instruction, idempotencyKey: job.id });
        const providerStartedAt = new Date().toISOString();
        await publishingStore.updateProgress(job.id, {
          status: task.status === "COMPLETED" ? "REVIEW_REQUIRED" : ["FAILED", "TIMEOUT"].includes(task.status) ? "FAILED" : "RUNNING",
          providerTaskId: task.providerTaskId,
          providerStartedAt,
          providerResult: task.result,
          providerDuration: task.duration,
          providerSteps: task.steps,
          errorMessage: ["FAILED", "TIMEOUT"].includes(task.status) ? publishAgentFailureMessage(task.status, task.duration, task.errorMessage) : undefined,
          syncWarning: undefined,
        }, publishProgressEvent("dispatching", "阿里云任务已接收", `任务编号 ${task.providerTaskId || "未返回"}，已进入执行链路。`, "completed", providerStartedAt));
        if (!["COMPLETED", "FAILED", "TIMEOUT"].includes(task.status)) {
          await publishingStore.updateProgress(job.id, {}, publishProgressEvent("executing", "AI 正在操作云手机", "已开始执行发布动作，可在右侧实时画面查看。", "running", providerStartedAt));
        }
      } catch (error) {
        const failure = agentDispatchStarted
          ? `提交云手机任务后状态不明，请先核验平台账号，避免重复发布。详情：${maskCloudPhoneError(error)}`
          : maskCloudPhoneError(error);
        await publishingStore.updateProgress(job.id, {
          status: agentDispatchStarted ? "REVIEW_REQUIRED" : "FAILED",
          errorMessage: failure,
        }, publishProgressEvent(agentDispatchStarted ? "executing" : "preparing", agentDispatchStarted ? "任务状态需要人工核验" : "发布准备失败", failure, agentDispatchStarted ? "running" : "failed"));
      }
    }
  } catch (error) {
    console.error("发布队列处理失败：", error instanceof Error ? error.message : "未知错误");
  } finally { publishingTickRunning = false; }
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, run: (item: T, index: number) => Promise<void>) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await run(items[index], index);
    }
  });
  await Promise.all(workers);
}

app.get("/api/knowledge/bases", (_req, res) => {
  try {
    const bases = getKnowledgeBases();
    res.json({
      bases: bases.map(publicKnowledgeBase),
      configured: bases.length > 0,
    });
  } catch (error) {
    res.status(500).json({
      message: toSafeError(error),
      suggestions: ["检查 .env 中两个知识库的 ID、名称、业务空间 ID 和知识库 ID 是否填写完整。"],
    });
  }
});

app.get("/api/knowledge/bases/:id/health", async (req, res) => {
  try {
    const base = getBaseOrThrow(req.params.id);
    const client = createBailianClient(base);
    const request = new ListIndicesRequest({});
    const runtime = new RuntimeOptions({});
    const response = await client.listIndicesWithOptions(base.workspaceId, request, {}, runtime);
    const matchedIndex = response.body?.data?.indices?.find((index) => index.id === base.indexId);
    if (!hasKnowledgeBaseIndex(response.body?.data?.indices, base.indexId) || !matchedIndex) {
      throw new Error(`业务空间可访问，但未找到配置的知识库 ID：${base.indexId}。`);
    }
    res.json({ ok: true, knowledgeBaseName: matchedIndex.name || base.name, checkedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: toSafeError(error),
      suggestions: ["确认 AccessKey 权限包含 AliyunBailianDataFullAccess 或读取权限。", "确认业务空间 ID、知识库 ID 与服务接入点属于同一地域。"],
    });
  }
});

app.get("/api/knowledge/bases/:id/products", async (req, res) => {
  try {
    const base = getBaseOrThrow(req.params.id);
    const query = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : "产品信息 商品名称 猫用品";
    const retrieval = await retrieve(base, query);
    res.json({
      knowledgeBaseId: base.id,
      knowledgeBaseName: base.name,
      retrievalMs: retrieval.durationMs,
      products: extractProductsFromCitations(retrieval.citations, base.id),
    });
  } catch (error) {
    res.status(500).json({
      message: toSafeError(error),
      suggestions: ["确认当前对象关联的知识库已配置并完成索引。", "点击重试重新读取产品，或先选择“不指定具体产品”。"],
    });
  }
});

app.post("/api/knowledge/ask", async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  const knowledgeBaseId = typeof req.body?.knowledgeBaseId === "string" ? req.body.knowledgeBaseId.trim() : "";

  if (!question) {
    res.status(400).json({ message: "请输入问题后再提问。" });
    return;
  }

  try {
    const base = getBaseOrThrow(knowledgeBaseId);
    const retrieval = await retrieve(base, question);
    if (retrieval.citations.length === 0) {
      res.json({
        answer: "当前知识库没有找到足够资料，暂时无法可靠回答这个问题。",
        knowledgeBaseName: base.name,
        hitDocumentCount: 0,
        retrievalMs: retrieval.durationMs,
        citations: [],
        grounded: false,
      });
      return;
    }

    const generated = await generateText({
      messages: buildGroundedPrompt(question, retrieval.citations),
      temperature: 0.1,
    });
    res.json({
      answer: generated.text,
      knowledgeBaseName: base.name,
      hitDocumentCount: new Set(retrieval.citations.map((item) => item.documentName)).size,
      retrievalMs: retrieval.durationMs,
      citations: retrieval.citations,
      grounded: true,
    });
  } catch (error) {
    res.status(500).json({
      message: toSafeError(error),
      suggestions: [
        "检查服务端环境变量是否配置了阿里云 AccessKey、DashScope API Key、业务空间 ID 和知识库 ID。",
        "确认当前知识库已完成索引构建，且接口地域与知识库地域一致。",
        "查看终端中的 API 服务日志，定位百炼检索或大模型调用失败原因。",
      ],
    });
  }
});

app.post("/api/social/topics/generate", async (req, res) => {
  const object = req.body?.object;
  const product = req.body?.product ?? null;
  const historyTitles = Array.isArray(req.body?.historyTitles) ? req.body.historyTitles.map(String).slice(0, 50) : [];

  if (!object?.id || !object?.knowledgeBaseId || !object?.topicWeights) {
    res.status(400).json({ message: "缺少创作对象、关联知识库或选题权重。" });
    return;
  }
  if (product && product.knowledgeBaseId !== object.knowledgeBaseId) {
    res.status(400).json({ message: "选中的推广产品不属于当前创作对象关联的知识库，已拒绝生成。" });
    return;
  }

  try {
    const base = getBaseOrThrow(object.knowledgeBaseId);
    const productQuery = product ? `商品名称 ${product.name} 产品信息 使用场景 用户问题` : "品牌资料 优秀内容案例 用户常见问题 使用场景";
    const retrieval = await retrieve(base, productQuery);
    const knowledgeSnippets = retrieval.citations.slice(0, 8).map((item) => `[${item.sourceNumber}] ${item.documentName}\n${item.snippet}`);
    const hotspots = getHotspots();
    const generated = await generateText({
      messages: buildTopicPrompt({ object, product, historyTitles }, knowledgeSnippets, hotspots),
      temperature: 0.7,
      maxTokens: 2400,
    });
    const topics = parseTopicJson(generated.text);
    if (topics.length < 6) {
      throw new Error(`模型返回的合格选题数量不足：${topics.length} 个。`);
    }

    res.json({
      topics: topics.slice(0, 10),
      generatedAt: new Date().toISOString(),
      model: generated.model,
      elapsedMs: generated.elapsedMs,
      retrievalMs: retrieval.durationMs,
      hotspotStatus: hotspots.status,
      hotspotMessage: hotspots.message,
      hotspotItems: hotspots.items,
      warnings: topics.length < 10 ? [`模型返回 ${topics.length} 个合格选题，未复制凑数。`] : [],
    });
  } catch (error) {
    res.status(500).json({
      message: toSafeError(error),
      suggestions: ["确认当前创作对象关联的知识库已配置。", "确认 DASHSCOPE_API_KEY 可用。", "保留旧选题后重试生成。"],
    });
  }
});

app.post("/api/social/copy/generate", async (req, res) => {
  const context = req.body?.context as CopywritingContext;

  try { validateCopywritingContext(context); }
  catch (error) { res.status(422).json({ message: toSafeError(error) }); return; }

  try {
    const base = getBaseOrThrow(context.object.knowledgeBaseId);
    const requestedChannels = normalizeChannels(context.brief.channels);
    const productQuery = context.brief.useProduct && context.brief.product
      ? `商品名称 ${context.brief.product.name} ${context.topic.title} 产品事实 使用场景`
      : `${context.object.name} ${context.topic.title} 品牌资料 优秀内容案例 用户问题 使用场景`;
    const retrieval = await retrieve(base, productQuery);
    if (context.brief.useProduct && retrieval.citations.length === 0) {
      throw new Error("当前知识库没有找到足够的商品资料，无法可靠生成关联产品文案。");
    }

    const generated = await generateText({
      messages: buildCopywritingPrompt(context, retrieval.citations),
      temperature: 0.68,
      maxTokens: 3200,
    });
    const generatedAt = new Date().toISOString();
    const copies = parseCopywritingJson(generated.text, requestedChannels, generatedAt);
    assertCompleteCopies(copies, requestedChannels);

    res.json({
      key: buildCopyRequestKey(context),
      copies,
      generatedAt,
      model: generated.model,
      elapsedMs: generated.elapsedMs,
      retrievalMs: retrieval.durationMs,
      knowledgeBaseName: base.name,
      citations: retrieval.citations.slice(0, 8),
    });
  } catch (error) {
    res.status(500).json({
      message: toSafeError(error),
      suggestions: ["确认创作简报已填写观点并选择渠道。", "确认当前对象关联知识库可检索，且商品确实属于该知识库。", "检查服务端 DASHSCOPE_API_KEY 后重试。"],
    });
  }
});

app.get("/api/social/image-models", (_req, res) => {
  const configured = Boolean(process.env.DASHSCOPE_API_KEY?.trim());
  const configuredModel = process.env.DASHSCOPE_IMAGE_MODEL?.trim() || "qwen-image-plus";
  res.json({
    models: [
      {
        id: configuredModel,
        name: configuredModel,
        provider: "DashScope",
        configured,
        supportsImageToImage: false,
        supportedSizes: ["1472*1104", "1104*1472", "928*1664", "1328*1328"],
      },
    ],
  });
});

app.get("/api/social/model-status", (_req, res) => {
  const configured = Boolean(process.env.DASHSCOPE_API_KEY?.trim());
  res.json({
    text: {
      configured,
      model: process.env.DASHSCOPE_TEXT_MODEL?.trim() || process.env.DASHSCOPE_MODEL?.trim() || "qwen3.7-plus",
    },
    image: {
      configured,
      model: process.env.DASHSCOPE_IMAGE_MODEL?.trim() || "qwen-image-plus",
    },
  });
});

app.post("/api/social/images/directions", async (req, res) => {
  const context = req.body?.context as CopywritingContext;
  const copies = Array.isArray(req.body?.copies) ? req.body.copies : [];

  try { validateCopywritingContext(context); }
  catch (error) { res.status(422).json({ message: toSafeError(error) }); return; }

  try {
    const generated = await generateText({
      messages: buildVisualDirectionsPrompt(context, copies),
      temperature: 0.72,
      maxTokens: 2600,
    });
    const directions = parseVisualDirectionsJson(generated.text);
    if (directions.length < 2) throw new Error(`模型返回的合格视觉方向不足：${directions.length} 个。`);
    res.json({ directions, generatedAt: new Date().toISOString(), elapsedMs: generated.elapsedMs, model: generated.model });
  } catch (error) {
    res.status(500).json({
      message: toSafeError(error),
      suggestions: ["确认文字定稿结果和创作简报仍然完整。", "确认 DASHSCOPE_API_KEY 可用。", "稍后重试生成视觉方向。"],
    });
  }
});

app.post("/api/social/images/generate", async (req, res) => {
  const request = req.body as SocialImageRequest;

  try { validateSocialImageRequest(request); }
  catch (error) { res.status(422).json({ message: toSafeError(error) }); return; }

  try {
    const generated = await generateImage({
      prompt: buildSocialImagePrompt(request),
      size: request.size,
      promptExtend: true,
      watermark: false,
      timeoutMs: 180000,
      pollIntervalMs: 8000,
    });
    const savedImages = await Promise.all(generated.images.map((image, index) => saveGeneratedImage(image.url, generated.taskId, index)));

    res.json({
      generatedAt: new Date().toISOString(),
      taskId: generated.taskId,
      elapsedMs: generated.elapsedMs,
      images: generated.images.map((image, index) => ({ ...image, localUrl: savedImages[index] })),
    });
  } catch (error) {
    res.status(500).json({
      message: toSafeError(error),
      suggestions: ["确认服务端 .env 中已填写 DASHSCOPE_API_KEY。", "确认当前文案已生成且简报中的商品属于当前知识库。", "图片生成是异步任务，网络慢时可稍后重试。"],
    });
  }
});

async function saveGeneratedImage(url: string, taskId: string, index: number) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片生成成功，但保存图片失败：${response.status}`);
  const contentType = response.headers.get("content-type") || "image/png";
  const extension = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
  const dir = path.join(process.cwd(), "public", "generated-images");
  await fs.mkdir(dir, { recursive: true });
  const filename = `${taskId}-${index + 1}.${extension}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(path.join(dir, filename), buffer);
  return `/generated-images/${filename}`;
}

app.use(express.static(path.join(process.cwd(), "dist")));

app.listen(port, host, () => {
  console.log(`Knowledge API server listening on http://${host}:${port}`);
  void (async () => {
    try {
      for (const job of await publishingStore.list()) {
        if (job.status === "PREPARING") await publishingStore.update(job.id, {
          status: "REVIEW_REQUIRED", errorMessage: "服务在准备发布时中断，可能已传图或提交任务；请先在云手机核验，避免重复发布。",
        });
        else if (job.status === "REVIEW_REQUIRED" && isStatusSyncNetworkError(job.errorMessage)) await publishingStore.update(job.id, {
          errorMessage: undefined,
          syncWarning: undefined,
        });
      }
      await runPublishingTick();
      setInterval(() => { void runPublishingTick(); }, 5000);
    } catch (error) {
      console.error("发布队列启动失败：", error instanceof Error ? error.message : "未知错误");
    }
  })();
});

import fs from "node:fs/promises";
import path from "node:path";

export type PublishChannel = "小红书" | "公众号" | "朋友圈";
export type PublishStatus = "SCHEDULED" | "QUEUED" | "PREPARING" | "RUNNING" | "REVIEW_REQUIRED" | "PUBLISHED" | "FAILED" | "CANCELED";

export type PublishCopy = { channel: PublishChannel; title?: string; body: string; hashtags?: string[] };
export type PublishProgressStage = "queued" | "preparing" | "images" | "dispatching" | "executing" | "review";
export type PublishProgressEvent = {
  stage: PublishProgressStage;
  title: string;
  detail: string;
  status: "pending" | "running" | "completed" | "failed";
  updatedAt: string;
};
export type PublishJob = {
  id: string;
  idempotencyKey: string;
  sourceRecordId: string;
  objectName: string;
  topicTitle: string;
  deviceId: string;
  channel: PublishChannel;
  copy: PublishCopy;
  imagePaths: string[];
  imageSources: string[];
  deviceAlbum?: string;
  imageTransfer?: { image: number; totalImages: number; completed: number; total: number; mode?: "direct-url" };
  mode: "now" | "scheduled";
  scheduledAt: string | null;
  approvedAt: string;
  status: PublishStatus;
  providerTaskId?: string;
  providerStartedAt?: string;
  providerSteps?: string;
  providerDuration?: string;
  providerResult?: string;
  errorMessage?: string;
  syncWarning?: string;
  progressEvents?: PublishProgressEvent[];
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PublishAlbum = { name: string; directory: string };

export function publishProgressEvent(stage: PublishProgressStage, title: string, detail: string, status: PublishProgressEvent["status"], updatedAt = new Date().toISOString()): PublishProgressEvent {
  return { stage, title, detail, status, updatedAt };
}

const imagePathPattern = /^\/generated-images\/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp)$/;

function isTrustedGeneratedImageUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "aliyuncs.com" || url.hostname.endsWith(".aliyuncs.com"));
  } catch {
    return false;
  }
}

export function parsePublishRequest(value: unknown) {
  const input = value as Record<string, unknown> | null;
  const copy = input?.copy as Record<string, unknown> | null;
  const channel = input?.channel;
  if (input?.approved !== true) throw new Error("请先完成预览审核并确认内容。 ");
  if (!["小红书", "公众号", "朋友圈"].includes(String(channel)) || !copy || copy.channel !== channel) throw new Error("发布渠道与文案不一致，请重新选择。 ");
  const body = String(copy.body || "").trim();
  const title = typeof copy.title === "string" ? copy.title.trim() : undefined;
  const hashtags = Array.isArray(copy.hashtags) ? copy.hashtags.filter((item): item is string => typeof item === "string").slice(0, 20) : [];
  if (!body || body.length > 1600) throw new Error("正文不能为空且最多 1600 字；请在文字定稿中调整后再发布。 ");
  if (channel !== "朋友圈" && !title) throw new Error("当前渠道缺少标题，请先完成文字定稿。 ");
  if (channel === "小红书" && title && [...title].length > 20) throw new Error("小红书标题不能超过 20 个字符。 ");
  const imagePaths = input.imagePaths;
  if (!Array.isArray(imagePaths) || imagePaths.length > 9 || imagePaths.some((item) => typeof item !== "string" || !imagePathPattern.test(item))) {
    throw new Error("图片必须是本系统保存的生成图，最多选择 9 张。 ");
  }
  const imageSources = input.imageSources;
  if (!Array.isArray(imageSources) || imageSources.length !== imagePaths.length || imageSources.some((item) => !isTrustedGeneratedImageUrl(item))) {
    throw new Error("所选图片缺少可供云手机直接下载的千问 HTTPS 地址。请重新生成图片后再发布。 ");
  }
  const mode = input.mode;
  if (mode !== "now" && mode !== "scheduled") throw new Error("请选择立即发布或定时发布。 ");
  const scheduledAt = mode === "scheduled" ? String(input.scheduledAt || "") : null;
  if (mode === "scheduled" && (!scheduledAt || Number.isNaN(Date.parse(scheduledAt)) || Date.parse(scheduledAt) < Date.now() + 60_000)) {
    throw new Error("定时时间需晚于当前时间至少 1 分钟。 ");
  }
  const sourceRecordId = String(input.sourceRecordId || "").trim();
  const objectName = String(input.objectName || "").trim();
  const topicTitle = String(input.topicTitle || "").trim();
  const deviceId = String(input.deviceId || "").trim();
  if (!sourceRecordId || !objectName || !topicTitle || !deviceId) throw new Error("创作记录、选题或云手机不完整，请重新选择。 ");
  return {
    sourceRecordId, objectName: objectName.slice(0, 100), topicTitle: topicTitle.slice(0, 200), deviceId,
    channel: channel as PublishChannel,
    copy: { channel: channel as PublishChannel, title: channel === "朋友圈" ? undefined : title, body, hashtags: channel === "小红书" ? hashtags : undefined },
    imagePaths: imagePaths as string[], imageSources: imageSources as string[], mode: mode as "now" | "scheduled", scheduledAt,
  };
}

export function publishAgentFailureMessage(status: string, duration?: string, reason?: string) {
  const seconds = Number(duration);
  const durationText = Number.isFinite(seconds) && seconds > 0 ? `${Math.round(seconds)} 秒` : "设定时限";
  if (status === "TIMEOUT") {
    return `云手机自动发布执行超过 ${durationText}，阿里云已停止任务，无法确认帖子是否发布。请先查看云手机和小红书账号，确认未发布后再重新提交；不要直接重复发布。`;
  }
  return reason?.trim() || `云手机任务${status}，未确认发布成功。`;
}

export function createPublishAlbum(jobId: string): PublishAlbum {
  const suffix = jobId.replace(/[^a-fA-F0-9]/g, "").toLowerCase().slice(0, 12);
  if (suffix.length < 8) throw new Error("发布任务编号无效，无法创建独立图片相册。");
  const name = `IdeactPublish-${suffix}`;
  return { name, directory: `/sdcard/Pictures/${name}` };
}

const lineBreakToken = "〔换行〕";
const blankLineToken = "〔空行〕";

export function encodePublishBodyLayout(body: string) {
  const normalized = body.replace(/\r\n?/g, "\n");
  return normalized.replace(/\n+/g, (breaks) => {
    const blankLines = Math.floor(breaks.length / 2);
    const singleLine = breaks.length % 2;
    return `${blankLineToken.repeat(blankLines)}${singleLine ? lineBreakToken : ""}`;
  });
}

export function summarizePublishBodyLayout(body: string) {
  const normalized = body.replace(/\r\n?/g, "\n").trim();
  const contentLines = normalized.split("\n").filter((line) => line.trim()).length;
  const paragraphs = normalized ? normalized.split(/\n\s*\n+/).filter((paragraph) => paragraph.trim()).length : 0;
  return { contentLines, paragraphs };
}

export function buildPublishInstruction(job: PublishJob, deviceImagePaths: string[], albumName?: string) {
  const app = job.channel === "小红书" ? "小红书" : job.channel === "朋友圈" ? "微信的朋友圈" : "微信公众号的正式发布入口";
  const title = job.copy.title ? `标题：${job.copy.title}\n` : "";
  const encodedBody = encodePublishBodyLayout(job.copy.body);
  const layout = summarizePublishBodyLayout(job.copy.body);
  const tags = job.copy.hashtags?.length
    ? `\n正文输入完成后按两次回车，再输入话题标签：${job.copy.hashtags.join(" ")}`
    : "";
  const files = deviceImagePaths.length
    ? `\n打开图片选择器后，必须进入相册“${albumName || "本次发布任务"}”，仅选择其中这 ${deviceImagePaths.length} 张图：${deviceImagePaths.join("、")}。严禁从“最近项目”、下载目录或其他相册选图；如果找不到该相册、图片数量不符或无法确认，立即停止并报告，不得用其他图片替代。`
    : "\n本次未选择配图，不得从相册中随意选图。";
  const instruction = `请在${app}使用当前已登录账号发布一条新内容。只发布一次，不要发给联系人，也不要改写审核过的文案。\n${title}正文必须严格按排版协议逐段输入：${lineBreakToken}表示按一次回车，${blankLineToken}表示按两次回车；这些标记本身绝不能输入。正文应有 ${layout.paragraphs} 个段落、${layout.contentLines} 行有效文字。\n排版正文：${encodedBody}${tags}${files}\n输入完成后、点击发布前，检查段落空行仍然存在，编号列表每项独立成行，标题、正文和标签没有粘连。若排版无法保持，立即停止并报告，不得以连续大段文字发布。\n如果账号未登录、需要验证码、平台限制或图片找不到，请停止并如实报告，不要声称已发布。完成后请返回能核查的帖子链接或明确的页面位置。`;
  if (instruction.length > 2000) throw new Error("内容与发布要求超过云手机任务的长度限制，请缩短文案后重试。 ");
  return instruction;
}

export function isPublishDue(job: PublishJob, now = Date.now()) {
  if (job.status === "QUEUED") return true;
  return job.status === "SCHEDULED" && Boolean(job.scheduledAt) && !Number.isNaN(Date.parse(job.scheduledAt!)) && Date.parse(job.scheduledAt!) <= now;
}

export class PublishingStore {
  private jobs: PublishJob[] | null = null;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<PublishJob[]> {
    if (!this.jobs) {
      try { this.jobs = JSON.parse(await fs.readFile(this.filePath, "utf8")) as PublishJob[]; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        this.jobs = [];
      }
    }
    return [...this.jobs];
  }

  async find(id: string) { return (await this.list()).find((job) => job.id === id); }
  async findIdempotency(key: string) { return (await this.list()).find((job) => job.idempotencyKey === key); }

  async save(job: PublishJob): Promise<{ job: PublishJob; repeated: boolean }> {
    let saved = job;
    let repeated = false;
    await this.mutate((jobs) => {
      const existing = jobs.find((item) => item.idempotencyKey === job.idempotencyKey);
      if (existing) { saved = existing; repeated = true; return jobs; }
      return [job, ...jobs];
    });
    return { job: saved, repeated };
  }

  async update(id: string, patch: Partial<PublishJob>): Promise<PublishJob | undefined> {
    let updated: PublishJob | undefined;
    await this.mutate((jobs) => jobs.map((job) => {
      if (job.id !== id) return job;
      updated = { ...job, ...patch, updatedAt: new Date().toISOString() };
      return updated;
    }));
    return updated;
  }

  async updateProgress(id: string, patch: Partial<PublishJob>, event: PublishProgressEvent): Promise<PublishJob | undefined> {
    let updated: PublishJob | undefined;
    await this.mutate((jobs) => jobs.map((job) => {
      if (job.id !== id) return job;
      const progressEvents = [...(job.progressEvents || [])];
      const eventIndex = progressEvents.findIndex((item) => item.stage === event.stage);
      if (eventIndex >= 0) progressEvents[eventIndex] = event;
      else progressEvents.push(event);
      updated = { ...job, ...patch, progressEvents, updatedAt: new Date().toISOString() };
      return updated;
    }));
    return updated;
  }

  private async mutate(change: (jobs: PublishJob[]) => PublishJob[]) {
    const operation = this.pending.then(async () => {
      const jobs = change(await this.list());
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(jobs, null, 2), "utf8");
      await fs.rename(tempPath, this.filePath);
      this.jobs = jobs;
    });
    this.pending = operation.catch(() => undefined);
    await operation;
  }
}

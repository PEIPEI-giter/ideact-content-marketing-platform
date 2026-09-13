import fs from "node:fs/promises";
import path from "node:path";

export type PublishChannel = "小红书" | "公众号" | "朋友圈";
export type PublishStatus = "SCHEDULED" | "QUEUED" | "PREPARING" | "RUNNING" | "REVIEW_REQUIRED" | "PUBLISHED" | "FAILED" | "CANCELED";

export type PublishCopy = { channel: PublishChannel; title?: string; body: string; hashtags?: string[] };
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
  imageTransfer?: { image: number; totalImages: number; completed: number; total: number };
  mode: "now" | "scheduled";
  scheduledAt: string | null;
  approvedAt: string;
  status: PublishStatus;
  providerTaskId?: string;
  providerSteps?: string;
  providerDuration?: string;
  providerResult?: string;
  errorMessage?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

const imagePathPattern = /^\/generated-images\/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp)$/;

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
    imagePaths: imagePaths as string[], mode: mode as "now" | "scheduled", scheduledAt,
  };
}

export function buildPublishInstruction(job: PublishJob, deviceImagePaths: string[]) {
  const app = job.channel === "小红书" ? "小红书" : job.channel === "朋友圈" ? "微信的朋友圈" : "微信公众号的正式发布入口";
  const title = job.copy.title ? `标题：${job.copy.title}\n` : "";
  const tags = job.copy.hashtags?.length ? `\n话题标签：${job.copy.hashtags.join(" ")}` : "";
  const files = deviceImagePaths.length ? `\n从云手机本地文件选择这些图片，且仅选择这些图片：${deviceImagePaths.join("、")}` : "\n本次未选择配图，不得从相册中随意选图。";
  const instruction = `请在${app}使用当前已登录账号发布一条新内容。只发布一次，不要发给联系人，也不要改写审核过的文案。\n${title}正文：${job.copy.body}${tags}${files}\n如果账号未登录、需要验证码、平台限制或图片找不到，请停止并如实报告，不要声称已发布。完成后请返回能核查的帖子链接或明确的页面位置。`;
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

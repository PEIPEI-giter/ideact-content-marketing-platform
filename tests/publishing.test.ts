import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPublishInstruction, createPublishAlbum, encodePublishBodyLayout, isPublishDue, parsePublishRequest, publishAgentFailureMessage, PublishingStore, summarizePublishBodyLayout, type PublishJob } from "../server/publishing";
import { getPublishBlockReason, summarizeProviderResult } from "../src/publish-content";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

function request(overrides: Record<string, unknown> = {}) {
  return {
    approved: true, sourceRecordId: "record-1", objectName: "猫品牌", topicTitle: "猫咪磨爪场景",
    deviceId: "device-1", channel: "小红书", copy: { channel: "小红书", title: "猫咪为什么磨爪", body: "从沙发边的场景说起。", hashtags: ["#养猫"] },
    imagePaths: ["/generated-images/task-1.png"], imageSources: ["https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/task-1.png"], mode: "now", ...overrides,
  };
}

describe("publishing validation", () => {
  it("turns provider JSON into a readable summary while retaining technical details", () => {
    const raw = JSON.stringify({ result: "任务已成功完成。\n发布状态：成功", actual_steps: 4, success: true });
    expect(summarizeProviderResult(raw)).toMatchObject({ summary: "任务已成功完成。", steps: "4", success: true, technical: raw });
    expect(summarizeProviderResult("普通反馈")).toEqual({ summary: "普通反馈", technical: "" });
  });
  it("distinguishes review from local image transfer availability", () => {
    const state = { hasCopy: true, approved: true, deviceRunning: true, selectedImageCount: 1, imageDeliveryReady: false, mode: "now" as const, scheduledLocal: "" };
    expect(getPublishBlockReason(state)).toMatch(/本机图片传输服务不可用/);
    expect(getPublishBlockReason({ ...state, approved: false })).toMatch(/勾选审核确认/);
    expect(getPublishBlockReason({ ...state, selectedImageCount: 0 })).toBeNull();
    expect(getPublishBlockReason({ ...state, imageDeliveryReady: true })).toBeNull();
  });

  it("blocks invalid scheduled time even after review", () => {
    const state = { hasCopy: true, approved: true, deviceRunning: true, selectedImageCount: 0, imageDeliveryReady: false, mode: "scheduled" as const, scheduledLocal: "2026-09-13T09:00", now: Date.parse("2026-09-13T09:00") };
    expect(getPublishBlockReason(state)).toMatch(/1 分钟/);
    expect(getPublishBlockReason({ ...state, scheduledLocal: "2026-09-13T09:02" })).toBeNull();
  });

  it("requires review and a matching channel copy", () => {
    expect(() => parsePublishRequest(request({ approved: false }))).toThrow(/审核/);
    expect(() => parsePublishRequest(request({ channel: "朋友圈" }))).toThrow(/渠道/);
  });

  it("accepts only local generated image paths", () => {
    expect(parsePublishRequest(request()).imagePaths).toEqual(["/generated-images/task-1.png"]);
    expect(() => parsePublishRequest(request({ imagePaths: ["https://example.com/other.png"] }))).toThrow(/本系统/);
    expect(() => parsePublishRequest(request({ imagePaths: ["/generated-images/../secret.png"] }))).toThrow(/本系统/);
    expect(() => parsePublishRequest(request({ imageSources: ["https://example.com/task-1.png"] }))).toThrow(/千问 HTTPS 地址/);
    expect(() => parsePublishRequest(request({ imageSources: [] }))).toThrow(/千问 HTTPS 地址/);
  });

  it("explains an Agent timeout without claiming publication failed or succeeded", () => {
    expect(publishAgentFailureMessage("TIMEOUT", "301.00")).toContain("301 秒");
    expect(publishAgentFailureMessage("TIMEOUT", "301.00")).toContain("先查看云手机");
  });

  it("validates scheduled time and preserves reviewed copy", () => {
    expect(() => parsePublishRequest(request({ mode: "scheduled", scheduledAt: new Date(Date.now() - 1000).toISOString() }))).toThrow(/定时时间/);
    const parsed = parsePublishRequest(request({ mode: "scheduled", scheduledAt: new Date(Date.now() + 600_000).toISOString() }));
    expect(parsed.copy.body).toBe("从沙发边的场景说起。");
    expect(parsed.mode).toBe("scheduled");
  });

  it("does not invent a title for Moments", () => {
    const parsed = parsePublishRequest(request({ channel: "朋友圈", copy: { channel: "朋友圈", body: "今天聊聊猫咪磨爪。" }, imagePaths: [], imageSources: [] }));
    const job = { ...parsed, id: "job", idempotencyKey: "key", approvedAt: "now", status: "QUEUED", createdAt: "now", updatedAt: "now" } as PublishJob;
    expect(job.copy.title).toBeUndefined();
    expect(buildPublishInstruction(job, [])).toContain("朋友圈");
    expect(buildPublishInstruction(job, [])).not.toContain("标题：");
  });

  it("isolates each publish job in its own device album and forbids historical images", () => {
    const album = createPublishAlbum("b8aa39ce-d63d-45aa-a7eb-e5f7ba2eb9fe");
    expect(album).toEqual({ name: "IdeactPublish-b8aa39ced63d", directory: "/sdcard/Pictures/IdeactPublish-b8aa39ced63d" });
    const parsed = parsePublishRequest(request());
    const job = { ...parsed, id: "b8aa39ce-d63d-45aa-a7eb-e5f7ba2eb9fe", idempotencyKey: "key", approvedAt: "now", status: "QUEUED", createdAt: "now", updatedAt: "now" } as PublishJob;
    const instruction = buildPublishInstruction(job, [`${album.directory}/01.png`], album.name);
    expect(instruction).toContain(`相册“${album.name}”`);
    expect(instruction).toContain("严禁从“最近项目”");
    expect(instruction).toContain("不得用其他图片替代");
  });

  it("turns reviewed line breaks into explicit phone input actions", () => {
    const body = "开场第一行。\n\n第二段。\n❶ 第一项\n❷ 第二项";
    expect(encodePublishBodyLayout(body)).toBe("开场第一行。〔空行〕第二段。〔换行〕❶ 第一项〔换行〕❷ 第二项");
    expect(summarizePublishBodyLayout(body)).toEqual({ paragraphs: 2, contentLines: 4 });

    const parsed = parsePublishRequest(request({ copy: { channel: "小红书", title: "排版测试", body, hashtags: ["#测试"] } }));
    const job = { ...parsed, id: "layout-job", idempotencyKey: "layout-key", approvedAt: "now", status: "QUEUED", createdAt: "now", updatedAt: "now" } as PublishJob;
    const instruction = buildPublishInstruction(job, []);
    expect(instruction).toContain("〔换行〕表示按一次回车");
    expect(instruction).toContain("〔空行〕表示按两次回车");
    expect(instruction).toContain("正文应有 2 个段落、4 行有效文字");
    expect(instruction).toContain("编号列表每项独立成行");
    expect(instruction).toContain("正文输入完成后按两次回车，再输入话题标签：#测试");
    expect(instruction).not.toContain("开场第一行。\n\n第二段。");
  });

  it("dispatches only due scheduled jobs", () => {
    const base = { ...parsePublishRequest(request({ imagePaths: [], imageSources: [] })), id: "job", idempotencyKey: "key", approvedAt: "now", createdAt: "now", updatedAt: "now" } as PublishJob;
    expect(isPublishDue({ ...base, status: "QUEUED" }, 1000)).toBe(true);
    expect(isPublishDue({ ...base, status: "SCHEDULED", scheduledAt: new Date(2000).toISOString() }, 1000)).toBe(false);
    expect(isPublishDue({ ...base, status: "SCHEDULED", scheduledAt: new Date(2000).toISOString() }, 2000)).toBe(true);
    expect(isPublishDue({ ...base, status: "CANCELED" }, 3000)).toBe(false);
  });
});

describe("publishing records", () => {
  it("persists scheduled jobs and deduplicates submissions", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ideact-publish-"));
    directories.push(directory);
    const file = path.join(directory, "jobs.json");
    const store = new PublishingStore(file);
    const job = {
      ...parsePublishRequest(request({ imagePaths: [], imageSources: [], mode: "scheduled", scheduledAt: new Date(Date.now() + 600_000).toISOString() })),
      id: "job-1", idempotencyKey: "same-key", approvedAt: "now", status: "SCHEDULED", createdAt: "now", updatedAt: "now",
    } as PublishJob;
    expect((await store.save(job)).repeated).toBe(false);
    expect((await store.save({ ...job, id: "job-2" })).repeated).toBe(true);
    expect((await new PublishingStore(file).list()).map((item) => item.id)).toEqual(["job-1"]);
    await store.update("job-1", { status: "CANCELED" });
    expect((await new PublishingStore(file).find("job-1"))?.status).toBe("CANCELED");
  });
});

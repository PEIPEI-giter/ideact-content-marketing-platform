import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPublishInstruction, isPublishDue, parsePublishRequest, PublishingStore, type PublishJob } from "../server/publishing";
import { getPublishBlockReason } from "../src/publish-content";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

function request(overrides: Record<string, unknown> = {}) {
  return {
    approved: true, sourceRecordId: "record-1", objectName: "猫品牌", topicTitle: "猫咪磨爪场景",
    deviceId: "device-1", channel: "小红书", copy: { channel: "小红书", title: "猫咪为什么磨爪", body: "从沙发边的场景说起。", hashtags: ["#养猫"] },
    imagePaths: ["/generated-images/task-1.png"], mode: "now", ...overrides,
  };
}

describe("publishing validation", () => {
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
  });

  it("validates scheduled time and preserves reviewed copy", () => {
    expect(() => parsePublishRequest(request({ mode: "scheduled", scheduledAt: new Date(Date.now() - 1000).toISOString() }))).toThrow(/定时时间/);
    const parsed = parsePublishRequest(request({ mode: "scheduled", scheduledAt: new Date(Date.now() + 600_000).toISOString() }));
    expect(parsed.copy.body).toBe("从沙发边的场景说起。");
    expect(parsed.mode).toBe("scheduled");
  });

  it("does not invent a title for Moments", () => {
    const parsed = parsePublishRequest(request({ channel: "朋友圈", copy: { channel: "朋友圈", body: "今天聊聊猫咪磨爪。" }, imagePaths: [] }));
    const job = { ...parsed, id: "job", idempotencyKey: "key", approvedAt: "now", status: "QUEUED", createdAt: "now", updatedAt: "now" } as PublishJob;
    expect(job.copy.title).toBeUndefined();
    expect(buildPublishInstruction(job, [])).toContain("朋友圈");
    expect(buildPublishInstruction(job, [])).not.toContain("标题：");
  });

  it("dispatches only due scheduled jobs", () => {
    const base = { ...parsePublishRequest(request({ imagePaths: [] })), id: "job", idempotencyKey: "key", approvedAt: "now", createdAt: "now", updatedAt: "now" } as PublishJob;
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
      ...parsePublishRequest(request({ imagePaths: [], mode: "scheduled", scheduledAt: new Date(Date.now() + 600_000).toISOString() })),
      id: "job-1", idempotencyKey: "same-key", approvedAt: "now", status: "SCHEDULED", createdAt: "now", updatedAt: "now",
    } as PublishJob;
    expect((await store.save(job)).repeated).toBe(false);
    expect((await store.save({ ...job, id: "job-2" })).repeated).toBe(true);
    expect((await new PublishingStore(file).list()).map((item) => item.id)).toEqual(["job-1"]);
    await store.update("job-1", { status: "CANCELED" });
    expect((await new PublishingStore(file).find("job-1"))?.status).toBe("CANCELED");
  });
});

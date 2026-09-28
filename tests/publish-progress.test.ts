import { describe, expect, it } from "vitest";
import { buildPublishProgressView, formatElapsed } from "../src/publish-progress";

describe("publish progress view", () => {
  it("shows a running Agent stage with real step count and elapsed time", () => {
    const view = buildPublishProgressView({
      status: "RUNNING",
      createdAt: "2026-09-27T08:00:00.000Z",
      providerStartedAt: "2026-09-27T08:00:10.000Z",
      providerSteps: "4",
      progressEvents: [
        { stage: "queued", title: "任务已保存", detail: "ok", status: "completed", updatedAt: "2026-09-27T08:00:00.000Z" },
        { stage: "executing", title: "AI 正在操作云手机", detail: "已执行 4 步", status: "running", updatedAt: "2026-09-27T08:00:10.000Z" },
      ],
    }, Date.parse("2026-09-27T08:01:15.000Z"));
    expect(view.current.stage).toBe("executing");
    expect(view.elapsedSeconds).toBe(65);
    expect(view.percent).toBeGreaterThan(0);
    expect(view.percent).toBeLessThan(100);
  });

  it("marks a fully confirmed publication as complete", () => {
    const view = buildPublishProgressView({ status: "PUBLISHED", providerDuration: "125" });
    expect(view.percent).toBe(100);
    expect(formatElapsed(view.elapsedSeconds)).toBe("2 分 05 秒");
  });
});

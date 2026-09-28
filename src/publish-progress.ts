export type PublishProgressStage = "queued" | "preparing" | "images" | "dispatching" | "executing" | "review";
export type PublishProgressEvent = {
  stage: PublishProgressStage;
  title: string;
  detail: string;
  status: "pending" | "running" | "completed" | "failed";
  updatedAt: string;
};

export type PublishProgressJob = {
  status: "SCHEDULED" | "QUEUED" | "PREPARING" | "RUNNING" | "REVIEW_REQUIRED" | "PUBLISHED" | "FAILED" | "CANCELED";
  createdAt?: string;
  providerStartedAt?: string;
  providerSteps?: string;
  providerDuration?: string;
  errorMessage?: string;
  progressEvents?: PublishProgressEvent[];
};

const stages: Array<{ stage: PublishProgressStage; title: string; detail: string }> = [
  { stage: "queued", title: "任务进入队列", detail: "等待服务端处理发布请求。" },
  { stage: "preparing", title: "校验设备与素材", detail: "检查设备、文案和图片来源。" },
  { stage: "images", title: "准备发布图片", detail: "将本次图片传入任务独立相册。" },
  { stage: "dispatching", title: "提交阿里云任务", detail: "创建一次 Mobile Agent 发布任务。" },
  { stage: "executing", title: "AI 操作云手机", detail: "通过实时画面执行平台发布流程。" },
  { stage: "review", title: "人工核验", detail: "确认平台中的帖子、文案和图片。" },
];

export function buildPublishProgressView(job: PublishProgressJob, now = Date.now()) {
  const supplied = new Map((job.progressEvents || []).map((event) => [event.stage, event]));
  const fallbackCompletedThrough = job.status === "PUBLISHED" ? 5
    : job.status === "REVIEW_REQUIRED" ? 4
      : job.status === "RUNNING" ? 3
        : job.status === "PREPARING" ? 0
          : -1;
  const fallbackCurrent = job.status === "PREPARING" ? 1
    : job.status === "RUNNING" ? 4
      : job.status === "REVIEW_REQUIRED" ? 5
        : -1;
  const failedIndex = job.status === "FAILED" ? Math.max(1, [...supplied.values()].findIndex((event) => event.status === "failed")) : -1;

  const events = stages.map((definition, index): PublishProgressEvent => {
    const actual = supplied.get(definition.stage);
    if (actual) return actual;
    if (index <= fallbackCompletedThrough) return { ...definition, status: "completed", updatedAt: job.createdAt || "" };
    if (index === fallbackCurrent) return { ...definition, status: "running", updatedAt: job.providerStartedAt || job.createdAt || "" };
    if (index === failedIndex) return { ...definition, status: "failed", detail: job.errorMessage || definition.detail, updatedAt: job.createdAt || "" };
    return { ...definition, status: "pending", updatedAt: "" };
  });
  const currentIndex = Math.max(0, events.findIndex((event) => event.status === "failed" || event.status === "running"));
  const resolvedCurrentIndex = events.some((event) => event.status === "failed" || event.status === "running") ? currentIndex : Math.max(0, events.findIndex((event) => event.status === "pending"));
  const completed = events.filter((event) => event.status === "completed").length;
  const percent = job.status === "PUBLISHED" ? 100 : Math.min(99, Math.round(((completed + (events.some((event) => event.status === "running") ? 0.5 : 0)) / events.length) * 100));
  const durationSeconds = Number(job.providerDuration);
  const startedAt = job.providerStartedAt ? Date.parse(job.providerStartedAt) : NaN;
  const elapsedSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.round(durationSeconds)
    : Number.isFinite(startedAt) ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;

  return {
    events,
    current: events[resolvedCurrentIndex] || events[0],
    currentNumber: resolvedCurrentIndex + 1,
    total: events.length,
    percent,
    elapsedSeconds,
  };
}

export function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes} 分 ${String(remainder).padStart(2, "0")} 秒` : `${remainder} 秒`;
}

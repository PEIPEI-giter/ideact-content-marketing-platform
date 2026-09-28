import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, FileText, Image as ImageIcon, Loader2, RefreshCw, Send } from "lucide-react";

type Channel = "小红书" | "公众号" | "朋友圈";
type Copy = { channel: Channel; title?: string; body: string; hashtags?: string[] };
type SavedImage = { localUrl?: string; url: string };
type ImageResult = { channel: Channel; images: SavedImage[] };
type ContentRecord = {
  id: string;
  kind: "content";
  objectName: string;
  createdAt: string;
  topic?: { title: string };
  copy?: { copies: Copy[] };
  images: ImageResult[];
};
type Device = { id: string; name: string; instanceId: string; runtimeStatus: string };
type PublishJob = {
  id: string;
  objectName: string;
  topicTitle: string;
  channel: Channel;
  deviceId: string;
  status: "SCHEDULED" | "QUEUED" | "PREPARING" | "RUNNING" | "REVIEW_REQUIRED" | "PUBLISHED" | "FAILED" | "CANCELED";
  scheduledAt: string | null;
  createdAt: string;
  publishedAt?: string;
  providerTaskId?: string;
  providerResult?: string;
  providerSteps?: string;
  providerDuration?: string;
  errorMessage?: string;
  syncWarning?: string;
  imageTransfer?: { image: number; totalImages: number; completed: number; total: number; mode?: "direct-url" };
};

const statusLabels: Record<PublishJob["status"], string> = {
  SCHEDULED: "等待定时", QUEUED: "等待执行", PREPARING: "正在准备发布", RUNNING: "云手机执行中",
  REVIEW_REQUIRED: "待人工核验", PUBLISHED: "已确认发布", FAILED: "执行失败", CANCELED: "已取消",
};

function loadContentRecords(): ContentRecord[] {
  try {
    const rows = JSON.parse(localStorage.getItem("ideact:productionRecords") || "[]") as ContentRecord[];
    return rows.filter((item) => item.kind === "content" && item.copy?.copies?.length);
  } catch { return []; }
}

function timeText(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

function localDateTimeInputMin() {
  const date = new Date(Date.now() + 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function errorText(value: unknown, fallback: string) {
  return value && typeof value === "object" && "message" in value && typeof value.message === "string" ? value.message : fallback;
}

export function summarizeProviderResult(value: string) {
  const raw = value.trim();
  if (!raw) return { summary: "阿里云未返回执行说明。", technical: "" };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const detail = [parsed.result, parsed.answer].find((item) => typeof item === "string" && item.trim()) as string | undefined;
    const firstLine = detail?.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    const stepValue = parsed.actual_steps ?? parsed.steps_executed;
    return {
      summary: (firstLine || (parsed.success === true ? "任务执行完成，等待人工核验平台结果。" : "阿里云任务已返回结果。" )).slice(0, 300),
      steps: typeof stepValue === "number" || typeof stepValue === "string" ? String(stepValue) : undefined,
      success: typeof parsed.success === "boolean" ? parsed.success : undefined,
      technical: raw,
    };
  } catch {
    return { summary: raw.slice(0, 500), technical: raw.length > 500 ? raw : "" };
  }
}

export function getPublishBlockReason(input: {
  hasCopy: boolean;
  approved: boolean;
  deviceRunning: boolean;
  selectedImageCount: number;
  imageDeliveryReady: boolean;
  mode: "now" | "scheduled";
  scheduledLocal: string;
  now?: number;
}) {
  if (!input.hasCopy) return "请先选择一条已生成的渠道文案。";
  if (!input.deviceRunning) return "目标云手机尚未处于运行中，请先检查设备状态。";
  if (!input.approved) return "请先在上方勾选审核确认，核对文案、配图、渠道和时间。";
  if (input.selectedImageCount > 0 && !input.imageDeliveryReady) return "本机图片传输服务不可用，请检查 API 服务和云手机远程命令权限后刷新。";
  if (input.mode === "scheduled" && (!input.scheduledLocal || Number.isNaN(Date.parse(input.scheduledLocal)) || Date.parse(input.scheduledLocal) < (input.now ?? Date.now()) + 60_000)) return "请选择至少晚于当前时间 1 分钟的发布时间。";
  return null;
}

export function PublishContentPage({ onSubmitted }: { onSubmitted?: (job: { id: string; deviceId: string }) => void }) {
  const [records, setRecords] = useState<ContentRecord[]>(loadContentRecords);
  const [recordId, setRecordId] = useState(() => loadContentRecords()[0]?.id || "");
  const [channel, setChannel] = useState<Channel>("小红书");
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [mode, setMode] = useState<"now" | "scheduled">("now");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [approved, setApproved] = useState(false);
  const [imageDeliveryReady, setImageDeliveryReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submittedId, setSubmittedId] = useState("");
  const submissionRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const record = records.find((item) => item.id === recordId);
  const copies = record?.copy?.copies || [];
  const copy = copies.find((item) => item.channel === channel);
  const availableImages = useMemo(() => {
    const images = new Map<string, { localPath: string; sourceUrl: string }>();
    for (const result of (record?.images || []).filter((item) => item.channel === channel)) {
      for (const image of result.images) {
        if (image.localUrl && /^\/generated-images\/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp)$/.test(image.localUrl) && /^https:\/\//.test(image.url)) {
          images.set(image.localUrl, { localPath: image.localUrl, sourceUrl: image.url });
        }
      }
    }
    return [...images.values()];
  }, [record, channel]);
  const selectedDevice = devices.find((item) => item.id === deviceId);
  const publishBlockReason = getPublishBlockReason({
    hasCopy: Boolean(copy), approved, deviceRunning: selectedDevice?.runtimeStatus === "RUNNING",
    selectedImageCount: imagePaths.length, imageDeliveryReady, mode, scheduledLocal,
  });

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refreshJobs(); }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (record && !copies.some((item) => item.channel === channel)) setChannel(copies[0]?.channel || "小红书");
  }, [recordId, records]);

  useEffect(() => {
    setImagePaths(availableImages.slice(0, 9).map((image) => image.localPath));
    setApproved(false);
  }, [recordId, channel, availableImages.map((image) => `${image.localPath}:${image.sourceUrl}`).join("|")]);

  useEffect(() => { setSubmittedId(""); setSubmitError(""); }, [recordId, channel, deviceId, mode, scheduledLocal, imagePaths.join("|")]);

  async function refresh() {
    const nextRecords = loadContentRecords();
    setRecords(nextRecords);
    setRecordId((current) => nextRecords.some((item) => item.id === current) ? current : nextRecords[0]?.id || "");
    setLoading(true);
    setError("");
    try {
      const [deviceResponse, capabilityResponse, jobResponse] = await Promise.all([
        fetch("/api/cloud-phone/devices"), fetch("/api/publishing/capabilities"), fetch("/api/publishing/jobs"),
      ]);
      const [deviceData, capabilityData, jobData] = await Promise.all([deviceResponse.json(), capabilityResponse.json(), jobResponse.json()]);
      if (!deviceResponse.ok) throw deviceData;
      if (!capabilityResponse.ok) throw capabilityData;
      if (!jobResponse.ok) throw jobData;
      const nextDevices = (deviceData.devices || []) as Device[];
      setDevices(nextDevices);
      setDeviceId((current) => nextDevices.some((item) => item.id === current) ? current : nextDevices[0]?.id || "");
      setImageDeliveryReady(Boolean(capabilityData.imageDeliveryReady));
      setJobs(jobData.jobs || []);
    } catch (caught) { setError(errorText(caught, "读取云手机或发布记录失败，请确认 API 服务已经启动。")); }
    finally { setLoading(false); }
  }

  async function refreshJobs() {
    try {
      const response = await fetch("/api/publishing/jobs");
      const payload = await response.json();
      if (response.ok) setJobs(payload.jobs || []);
    } catch { /* Keep the last visible status until manual refresh. */ }
  }

  function chooseRecord(id: string) {
    setRecordId(id);
    const next = records.find((item) => item.id === id);
    setChannel(next?.copy?.copies?.[0]?.channel || "小红书");
    setApproved(false);
  }

  async function submit() {
    if (submitting || submittedId) return;
    if (publishBlockReason || !record || !copy || !selectedDevice) { setSubmitError(publishBlockReason || "发布信息不完整，请重新选择内容和云手机。"); return; }
    const scheduledAt = mode === "scheduled" ? new Date(scheduledLocal).toISOString() : null;
    const imageSources = imagePaths.map((imagePath) => availableImages.find((image) => image.localPath === imagePath)?.sourceUrl || "");
    const draft = { sourceRecordId: record.id, objectName: record.objectName, topicTitle: record.topic?.title || copy.title || "未命名内容", deviceId, channel, copy, imagePaths, imageSources, mode, scheduledAt, approved: true };
    const fingerprint = JSON.stringify(draft);
    if (submissionRef.current?.fingerprint !== fingerprint) submissionRef.current = { fingerprint, key: crypto.randomUUID() };
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch("/api/publishing/jobs", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": submissionRef.current.key },
        body: fingerprint,
      });
      const payload = await response.json();
      if (!response.ok) throw payload;
      setSubmittedId(payload.job.id);
      setApproved(false);
      await refreshJobs();
      onSubmitted?.({ id: payload.job.id, deviceId: payload.job.deviceId });
    } catch (caught) { setSubmitError(errorText(caught, "提交状态不明，请先刷新发布记录；不要重复创建任务。")); }
    finally { setSubmitting(false); }
  }

  async function jobAction(id: string, action: "cancel" | "confirm") {
    if (action === "confirm" && !window.confirm("请先在对应平台账号核实帖子确实发布。确认后将记录为已发布，继续吗？")) return;
    setError("");
    try {
      const response = await fetch(`/api/publishing/jobs/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw payload;
      await refreshJobs();
    } catch (caught) { setError(errorText(caught, "更新发布记录失败，请刷新后重试。")); }
  }

  return (
    <section className="publish-page" aria-label="发布内容">
      <div className="module-heading">
        <div><p className="section-label">云手机发布</p><h2>发布内容</h2><p>从流水线已生成的内容选择文案和配图，审核后提交给云手机。</p></div>
        <button className="secondary-button" type="button" onClick={refresh} disabled={loading}><RefreshCw size={16} /> 刷新</button>
      </div>
      {error && <div className="error-box" role="alert"><strong>{error}</strong></div>}
      {loading && <div className="publish-notice"><Loader2 className="spin" size={17} /> 正在读取云手机和发布记录</div>}

      <div className="publish-layout">
        <div className="publish-form">
          <section className="publish-section">
            <h3>1. 选择内容</h3>
            {records.length === 0 ? <div className="publish-notice"><FileText size={18} /> 暂无已生成文案。请先在内容生产流水线生成渠道文案。</div> : (
              <label className="publish-field">创作记录
                <select value={recordId} onChange={(event) => chooseRecord(event.target.value)}>
                  {records.map((item) => <option value={item.id} key={item.id}>{item.objectName} · {item.topic?.title || item.copy?.copies[0]?.title || "内容创作"} · {timeText(item.createdAt)}</option>)}
                </select>
              </label>
            )}
            {record && <div className="publish-meta"><span>创作对象：{record.objectName}</span><span>选题：{record.topic?.title || "未命名内容"}</span></div>}
          </section>

          <section className="publish-section">
            <h3>2. 渠道与配图</h3>
            {!record ? <div className="publish-notice">选择创作记录后显示对应渠道和配图。</div> : <>
            <div className="publish-channel-list" role="group" aria-label="发布渠道">
              {copies.map((item) => <button className={`choice-chip${channel === item.channel ? " is-selected" : ""}`} type="button" key={item.channel} aria-pressed={channel === item.channel} onClick={() => setChannel(item.channel)}>{item.channel}</button>)}
            </div>
            <p className="muted-text">只显示本条记录中实际生成的渠道文案。</p>
            {availableImages.length > 0 ? <div className="publish-image-list">{availableImages.map((image) => <label className="publish-image-option" key={image.localPath}><input type="checkbox" checked={imagePaths.includes(image.localPath)} disabled={!imagePaths.includes(image.localPath) && imagePaths.length >= 9} onChange={(event) => { setImagePaths((current) => event.target.checked ? [...current, image.localPath] : current.filter((item) => item !== image.localPath)); setApproved(false); }} /><img src={image.localPath} alt="待发布配图" /><span>{imagePaths.includes(image.localPath) ? "已选择" : "未选择"}</span></label>)}</div> : <div className="publish-notice"><ImageIcon size={17} /> 此渠道暂无带有效源地址的生成图片，可仅发布文字或重新生成配图。</div>}
            {imagePaths.length > 0 && <div className="publish-notice"><ImageIcon size={17} /> 图片已保存在本机。发布时将通过阿里云 SendFile 整图直传云手机，不再拆分图片；千问临时地址过期时会明确停止并提示重新生成。</div>}
            </>}
          </section>

          <section className="publish-section">
            <h3>3. 云手机与时间</h3>
            <label className="publish-field">目标云手机
              <select value={deviceId} onChange={(event) => { setDeviceId(event.target.value); setApproved(false); }} disabled={devices.length === 0}>
                {devices.length === 0 && <option value="">暂无可用设备</option>}
                {devices.map((device) => <option value={device.id} key={device.id}>{device.name} · {device.runtimeStatus === "RUNNING" ? "运行中" : "未运行"}</option>)}
              </select>
            </label>
            <div className="publish-channel-list" role="group" aria-label="发布时间">
              <button className={`choice-chip${mode === "now" ? " is-selected" : ""}`} type="button" aria-pressed={mode === "now"} onClick={() => { setMode("now"); setApproved(false); }}><Send size={15} /> 立即发布</button>
              <button className={`choice-chip${mode === "scheduled" ? " is-selected" : ""}`} type="button" aria-pressed={mode === "scheduled"} onClick={() => { setMode("scheduled"); setApproved(false); }}><Clock3 size={15} /> 定时发布</button>
            </div>
            {mode === "scheduled" && <label className="publish-field">计划时间（本地时间）<input type="datetime-local" value={scheduledLocal} min={localDateTimeInputMin()} onChange={(event) => { setScheduledLocal(event.target.value); setApproved(false); }} /></label>}
          </section>
        </div>

        <section className="publish-section publish-review">
          <h3>4. 预览审核</h3>
          {!copy ? <div className="publish-notice">请选择一条已生成的渠道文案。</div> : <>
            <div className="publish-preview-head"><strong>{channel}</strong><span>{selectedDevice?.name || "未选择云手机"} · {mode === "now" ? "立即" : scheduledLocal ? timeText(new Date(scheduledLocal).toISOString()) : "未选时间"}</span></div>
            {copy.title && <h4>{copy.title}</h4>}
            <p className="publish-copy-body">{copy.body}</p>
            {copy.hashtags?.length ? <p className="publish-tags">{copy.hashtags.join(" ")}</p> : null}
            {imagePaths.length > 0 && <div className="publish-preview-images">{imagePaths.map((url) => <img src={url} alt="已选发布配图" key={url} />)}</div>}
            <label className="publish-approval"><input type="checkbox" checked={approved} onChange={(event) => { setApproved(event.target.checked); setSubmitError(""); }} /> <span>审核确认：已核对文案、配图、目标渠道和发布时间</span></label>
            {!submittedId && <div className={approved ? "publish-success" : "publish-notice"} role="status">{approved ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}{approved ? "预览审核已确认。" : "尚未完成预览审核。"}</div>}
            {!submittedId && (submitError || publishBlockReason) && <div className="publish-submit-status" id="publish-submit-status" role={submitError ? "alert" : "status"}>{submitError || publishBlockReason}</div>}
            <button className="primary-button full-width" type="button" aria-describedby={!submittedId && (submitError || publishBlockReason) ? "publish-submit-status" : undefined} disabled={submitting || Boolean(submittedId)} onClick={submit}>
              {submitting ? <Loader2 className="spin" size={16} /> : <Send size={16} />} {submitting ? "正在保存发布任务" : submittedId ? "已提交发布任务" : mode === "now" ? "确认并立即发布" : "确认并预约发布"}
            </button>
            {submittedId && <div className="publish-success"><CheckCircle2 size={17} /> 发布任务已保存；请在下方查看真实执行状态。</div>}
          </>}
        </section>
      </div>

      <section className="publish-section publish-history">
        <div className="panel-heading social-heading"><div><h3>发布记录</h3><p>阿里云任务完成不等于帖子已上线；待人工核验后才记为已发布。</p></div><button className="small-icon-button" type="button" aria-label="刷新发布记录" onClick={refreshJobs}><RefreshCw size={16} /></button></div>
        {jobs.length === 0 ? <div className="publish-notice">暂无发布任务。</div> : <div className="publish-job-list">{jobs.map((job) => { const feedback = job.providerResult ? summarizeProviderResult(job.providerResult) : null; return <article className="publish-job" key={job.id}>
          <div><strong>{job.objectName} · {job.topicTitle}</strong><p>{job.channel} · {statusLabels[job.status]} · {job.scheduledAt ? `计划 ${timeText(job.scheduledAt)}` : `提交 ${timeText(job.createdAt)}`}</p>{job.status === "PREPARING" && job.imageTransfer && <p>{job.imageTransfer.mode === "direct-url" ? `整图直传：已完成 ${job.imageTransfer.completed}/${job.imageTransfer.totalImages} 张` : `传入第 ${job.imageTransfer.image}/${job.imageTransfer.totalImages} 张图片：${Math.floor(job.imageTransfer.completed / job.imageTransfer.total * 100)}%`}</p>}{job.providerTaskId && <p>阿里云任务：{job.providerTaskId}</p>}{(job.providerSteps || job.providerDuration) && <p>执行进度：{job.providerSteps ? `${job.providerSteps} 步` : "步骤未返回"}{job.providerDuration ? ` · ${job.providerDuration} 秒` : ""}</p>}{feedback && <div className="provider-feedback"><p><strong>执行反馈：</strong>{feedback.summary}{feedback.steps ? ` · ${feedback.steps} 步` : ""}</p>{feedback.technical && <details><summary>查看技术详情</summary><pre>{feedback.technical}</pre></details>}</div>}{job.syncWarning && <p className="publish-job-warning">{job.syncWarning}</p>}{job.errorMessage && <p className="publish-job-error">{job.errorMessage}</p>}{job.publishedAt && <p>人工确认：{timeText(job.publishedAt)}</p>}</div>
          <div className="publish-job-actions">
            {job.status !== "CANCELED" && <button className="secondary-button" type="button" onClick={() => onSubmitted?.({ id: job.id, deviceId: job.deviceId })}>{["SCHEDULED", "QUEUED", "PREPARING", "RUNNING"].includes(job.status) ? "查看实时进度" : "查看执行详情"}</button>}
            {["SCHEDULED", "QUEUED"].includes(job.status) && <button className="secondary-button" type="button" onClick={() => jobAction(job.id, "cancel")}>取消</button>}
            {job.status === "REVIEW_REQUIRED" && <button className="secondary-button" type="button" onClick={() => jobAction(job.id, "confirm")}>已在平台核实发布</button>}
          </div>
        </article>; })}</div>}
      </section>
    </section>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PrivateInboxPage } from "./private-inbox";
import { OperationsOverview } from "./operations-overview";
import { recoverImagePrompt } from "./image-prompt-state";
import { buildPublishProgressView, formatElapsed, type PublishProgressEvent } from "./publish-progress";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Edit3,
  FileText,
  Layers3,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Loader2,
  MonitorSmartphone,
  MousePointer2,
  PackageSearch,
  Power,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Star,
  Settings2,
  Smartphone,
  Trash2,
  Upload,
  UsersRound,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  createEmptyUserObject,
  buildBriefKey,
  canConfirmBrief,
  channelOptions,
  createBriefDraft,
  fuzzyMatchProduct,
  isProductAllowedForObject,
  mergeCreationObjects,
  normalizeCreationObject,
  objectTypeLabels,
  styleOptions,
  upsertCreationObject,
  validateCreationObject,
  type CreationObject,
  type CreationSelection,
  type CreativeBrief,
  type ProductOption,
} from "./creation-objects";
import { appendImageToRecord, deleteProductionRecord } from "./production-records";
import { PublishContentPage, summarizeProviderResult } from "./publish-content";
import { readNavigationState, updateNavigationState, type AppModule, type PhoneTab, type WorkflowStep } from "./navigation-state";
import { hydrateContentWorkspace, saveContentWorkspace } from "./content-workspace";
import "./styles.css";

type ModuleKey = AppModule;

type ModuleItem = {
  key: ModuleKey;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
};

type KnowledgeBase = {
  id: string;
  name: string;
  status: "configured";
  endpoint: string;
  regionId: string;
};

type Citation = {
  sourceNumber: number;
  documentName: string;
  snippet: string;
  relevance: number;
  chunkId?: string;
  fileId?: string;
};

type AskResult = {
  answer: string;
  knowledgeBaseName: string;
  hitDocumentCount: number;
  retrievalMs: number;
  citations: Citation[];
  grounded: boolean;
};

type TopicDirection = "产品价值型" | "用户问题型" | "品牌观点型" | "热点结合型";
type GeneratedTopic = {
  id: string;
  title: string;
  direction: TopicDirection;
  reason: string;
  score: number;
  relatedProduct: boolean;
  productName?: string;
  hotspotEvidence?: {
    title: string;
    source: string;
    summary: string;
    eventTime?: string;
    fetchedAt?: string;
    expiresAt?: string;
    url?: string;
    relationReason: string;
    needsReview?: boolean;
  };
};

type TopicGroup = {
  key: string;
  objectId: string;
  objectName: string;
  productId: string | null;
  productName: string | null;
  weights: Record<string, number>;
  topics: GeneratedTopic[];
  generatedAt: string;
  hotspotStatus: string;
  hotspotMessage: string;
  warnings: string[];
};

type CopyChannel = "小红书" | "公众号" | "朋友圈";
type ChannelCopy =
  | { channel: "小红书"; versionId: "A"; title: string; body: string; hashtags: string[]; generatedAt: string }
  | { channel: "公众号"; versionId: "A"; title: string; body: string; generatedAt: string }
  | { channel: "朋友圈"; versionId: "A"; body: string; generatedAt: string };

type CopywritingResult = {
  key: string;
  objectId: string;
  topicId: string;
  briefKey: string;
  productId: string | null;
  channels: CopyChannel[];
  copies: ChannelCopy[];
  generatedAt: string;
  elapsedMs: number;
  retrievalMs: number;
  knowledgeBaseName: string;
};

type SocialImageResult = {
  key: string;
  copyKey: string;
  channel: CopyChannel;
  generatedAt: string;
  taskId: string;
  elapsedMs: number;
  prompt: string;
  directionName: string;
  size: ImageSizeOption;
  model: string;
  selected?: boolean;
  images: Array<{ url: string; localUrl?: string; actualPrompt?: string; openable?: boolean; contentType?: string }>;
};

type ProductionRecord = {
  id: string;
  kind: "topics" | "content";
  objectId: string;
  objectName: string;
  productName: string | null;
  createdAt: string;
  topicGroup?: TopicGroup;
  topic?: GeneratedTopic;
  brief?: CreativeBrief;
  copy?: CopywritingResult;
  images: SocialImageResult[];
};

type ImageSizeOption = "4:3" | "3:4" | "9:16";
type WorkflowStepNumber = WorkflowStep;
type ImageModelInfo = {
  id: string;
  name: string;
  provider: string;
  configured: boolean;
  supportsImageToImage: boolean;
  supportedSizes: string[];
};
type ModelConfigurationStatus = {
  text: { configured: boolean; model: string };
  image: { configured: boolean; model: string };
};
type VisualDirection = {
  id: string;
  name: string;
  expression: string;
  subject: string;
  scene: string;
  composition: string;
  subjectPosition: string;
  camera: string;
  light: string;
  color: string;
  background: string;
  blankSpace: string;
  productFeatures: string;
  avoid: string;
  prompt: string;
};

type CloudPhoneDeviceView = {
  id: string;
  instanceId: string;
  name: string;
  runtimeStatus: "RUNNING" | "STOPPED" | "UNKNOWN";
  occupancyStatus: "IDLE" | "OCCUPIED";
  expireTime?: string;
  lastSyncedAt?: string;
  activeConnectionId?: string;
};

type CloudPhoneConnectionView = {
  connectionId: string;
  deviceId: string;
  instanceId: string;
  status: "CONNECTED" | "CLOSED" | "EXPIRED" | "REPLACED";
  leaseExpiresAt: string;
  ticket: string;
  regionId: string;
  sdkPath: string;
  port?: number;
  persistentAppInstanceId?: string;
  appInstanceId?: string;
  appInstanceGroupId?: string;
};

type CloudPhoneTaskView = {
  id: string;
  providerTaskId?: string;
  deviceId: string;
  deviceName?: string;
  connectionId: string;
  instruction: string;
  status: "PENDING" | "RUNNING" | "PAUSING" | "PAUSED" | "CALL_FOR_USER" | "COMPLETED" | "FAILED" | "TIMEOUT" | "CANCELLING" | "CANCELED" | "STOPPED";
  result?: string;
  errorMessage?: string;
  steps?: string;
  duration?: string;
  requestId?: string;
  createdAt: string;
  updatedAt: string;
};

declare global {
  interface Window {
    __ideactRoot?: Root;
    Wuying?: {
      WebSDK?: {
        createSession: (type: "appstream", params: Record<string, unknown>) => {
          start?: () => void | Promise<void>;
          stop?: () => void;
          addHandle?: (name: string, callback: (data: unknown) => void) => void;
          setInputEnabled?: (enabled: boolean) => void;
          setTouchEnabled?: (enabled: boolean) => void;
          setClipboardEnabled?: (enabled: boolean) => void;
        };
      };
    };
  }
}


type ConnectionStatus = "unknown" | "checking" | "ok" | "failed";
type HealthState = Record<string, { status: ConnectionStatus; message?: string; checkedAt?: string }>;

const modules: ModuleItem[] = [
  { key: "overview", label: "运营概览", description: "汇总内容资产、生产、发布与账号状态", icon: LayoutDashboard },
  { key: "knowledge", label: "知识库", description: "沉淀品牌资料、行业素材与内容资产", icon: BookOpenText },
  { key: "pipeline", label: "内容生产流水线", description: "规划从选题到成稿的生产流程", icon: Layers3 },
  { key: "phone", label: "云手机发布", description: "管理移动端账号与发布任务", icon: Smartphone },
  { key: "private", label: "私域运营", description: "承接线索、社群和用户触达", icon: UsersRound },
];

type AuthUser = { username: string };

function AuthGate() {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [configured, setConfigured] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");

  async function prepareWorkspace(authenticatedUser: AuthUser) {
    setWorkspaceReady(false);
    setWorkspaceError("");
    try {
      await hydrateContentWorkspace();
      setUser(authenticatedUser);
      setWorkspaceReady(true);
    } catch (caught) {
      setUser(authenticatedUser);
      setWorkspaceError(caught instanceof Error ? caught.message : "内容工作区恢复失败，请重试。");
    }
  }

  useEffect(() => {
    void fetch("/api/auth/status")
      .then(async (response) => {
        const data = await response.json();
        setConfigured(Boolean(data.configured));
        if (data.authenticated) await prepareWorkspace(data.user);
        else setUser(null);
      })
      .catch(() => setError("无法连接后台服务，请确认 API 服务已经启动。"))
      .finally(() => setChecking(false));
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "登录失败，请稍后重试。");
      await prepareWorkspace(data.user);
      setPassword("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    setWorkspaceReady(false);
    setWorkspaceError("");
    setPassword("");
  }

  if (checking) return <div className="auth-screen"><div className="auth-status"><Loader2 className="spin" size={22} /><strong>正在检查登录状态</strong></div></div>;
  if (user && workspaceError) return <div className="auth-screen"><div className="auth-panel">
    <div className="auth-brand"><div className="brand-mark">ID</div><div><strong>Ideact</strong><span>内容营销后台</span></div></div>
    <div className="error-box" role="alert"><strong>内容数据恢复失败</strong><p>{workspaceError}</p></div>
    <button className="primary-button auth-submit" type="button" onClick={() => void prepareWorkspace(user)}><RefreshCw size={17} />重新读取</button>
    <button className="secondary-button auth-submit" type="button" onClick={() => void logout()}><LogOut size={17} />退出登录</button>
  </div></div>;
  if (user && !workspaceReady) return <div className="auth-screen"><div className="auth-status"><Loader2 className="spin" size={22} /><strong>正在恢复内容工作区</strong></div></div>;
  if (user) return <App user={user} onLogout={logout} />;

  return <div className="auth-screen">
    <form className="auth-panel" onSubmit={login}>
      <div className="auth-brand"><div className="brand-mark">ID</div><div><strong>Ideact</strong><span>内容营销后台</span></div></div>
      <div><p className="section-label">安全登录</p><h1>登录后台</h1><p>使用服务端配置的账号和密码进入系统。</p></div>
      {!configured && <div className="error-box"><strong>登录尚未配置</strong><p>请在服务端 .env 中填写 MVP_USER_EMAIL 和 MVP_USER_PASSWORD 后重启 API 服务。</p></div>}
      <label className="auth-field"><span>账号</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" disabled={!configured || submitting} /></label>
      <label className="auth-field"><span>密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" disabled={!configured || submitting} /></label>
      {error && <div className="error-box" role="alert"><strong>{error}</strong></div>}
      <button className="primary-button auth-submit" type="submit" disabled={!configured || submitting || !username.trim() || !password}>
        {submitting ? <Loader2 className="spin" size={17} /> : <LockKeyhole size={17} />}
        {submitting ? "正在登录" : "登录"}
      </button>
    </form>
  </div>;
}

function App({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [activeKey, setActiveKey] = useState<ModuleKey>(() => readNavigationState(window.location.search).module);
  const activeModule = modules.find((item) => item.key === activeKey) ?? modules[0];

  useEffect(() => {
    const restore = () => setActiveKey(readNavigationState(window.location.search).module);
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function chooseModule(key: ModuleKey) {
    setActiveKey(key);
    updateNavigationState({ module: key });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="一级导航">
        <div className="brand">
          <div className="brand-mark">ID</div>
          <div>
            <div className="brand-title">Ideact 内容营销后台</div>
            <div className="brand-subtitle">Content Marketing OS</div>
          </div>
          <button className="logout-button" type="button" aria-label={`退出登录（${user.username}）`} title={`退出登录（${user.username}）`} onClick={onLogout}>
            <LogOut size={17} />
          </button>
        </div>

        <nav className="primary-nav">
          {modules.map((item) => {
            const Icon = item.icon;
            const isActive = item.key === activeKey;
            return (
              <button
                className={`nav-item${isActive ? " is-active" : ""}`}
                key={item.key}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => chooseModule(item.key)}
              >
                <Icon size={18} strokeWidth={2.1} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        {activeKey !== "overview" && <header className="topbar">
          <div>
            <p className="section-label">当前模块</p>
            <h1>{activeModule.label}</h1>
          </div>
        </header>}

        {activeKey === "overview" && <OperationsOverview />}
        {activeKey === "knowledge" && <KnowledgePage />}
        {activeKey === "pipeline" && <SocialContentPage />}
        {activeKey === "phone" && <PhoneModule />}
        {activeKey === "private" && <PrivateInboxPage />}
      </main>
    </div>
  );
}

function PlaceholderPanel({ activeModule }: { activeModule: ModuleItem }) {
  return (
    <section className="module-panel" aria-labelledby="module-title">
      <div className="empty-state">
        <div className="empty-icon" aria-hidden="true">
          <activeModule.icon size={28} strokeWidth={1.9} />
        </div>
        <p className="empty-kicker">{activeModule.description}</p>
        <h2 id="module-title">{activeModule.label}待开发</h2>
        <p className="empty-copy">当前阶段仅完成后台框架和一级导航切换，模块功能、接口、数据库与模型能力将在后续迭代中接入。</p>
      </div>
    </section>
  );
}

function PhoneModule() {
  const [tab, setTab] = useState<PhoneTab>(() => readNavigationState(window.location.search).phoneTab);
  const [monitoredPublish, setMonitoredPublish] = useState<{ id: string; deviceId: string } | null>(() => readJson("ideact:monitoredPublish", null));
  useEffect(() => {
    const restore = () => setTab(readNavigationState(window.location.search).phoneTab);
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    if (monitoredPublish) localStorage.setItem("ideact:monitoredPublish", JSON.stringify(monitoredPublish));
    else localStorage.removeItem("ideact:monitoredPublish");
  }, [monitoredPublish]);
  function chooseTab(next: PhoneTab) {
    setTab(next);
    updateNavigationState({ module: "phone", phoneTab: next });
  }
  return (
    <div className="phone-module">
      <div className="phone-module-tabs" role="tablist" aria-label="云手机发布功能">
        <button className={`choice-chip${tab === "control" ? " is-selected" : ""}`} type="button" role="tab" aria-selected={tab === "control"} onClick={() => chooseTab("control")}>操控中心</button>
        <button className={`choice-chip${tab === "publish" ? " is-selected" : ""}`} type="button" role="tab" aria-selected={tab === "publish"} onClick={() => chooseTab("publish")}>发布内容</button>
      </div>
      <div hidden={tab !== "control"}><CloudPhoneControlCenter monitoredPublish={monitoredPublish} onStopMonitoring={() => setMonitoredPublish(null)} /></div>
      {tab === "publish" && <PublishContentPage onSubmitted={(job) => {
        setMonitoredPublish(job);
        chooseTab("control");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }} />}
    </div>
  );
}

function StatusPill({ tone, children }: { tone: "ok" | "warn" | "idle"; children: React.ReactNode }) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}

function runtimeStatusLabel(status: CloudPhoneDeviceView["runtimeStatus"]) {
  if (status === "RUNNING") return "运行中";
  if (status === "STOPPED") return "已停止";
  return "未知";
}

function sdkStatusLabel(status: "idle" | "loading" | "ready" | "connected" | "missing" | "error") {
  const labels = {
    idle: "未连接",
    loading: "加载 SDK",
    ready: "SDK 就绪",
    connected: "已连接",
    missing: "缺少 SDK",
    error: "连接失败",
  };
  return labels[status];
}

function agentTaskStatusLabel(status: CloudPhoneTaskView["status"]) {
  const labels: Record<CloudPhoneTaskView["status"], string> = {
    PENDING: "正在提交",
    RUNNING: "正在执行",
    PAUSING: "正在暂停",
    PAUSED: "人工接管",
    CALL_FOR_USER: "等待人工接管",
    COMPLETED: "执行成功",
    FAILED: "执行失败",
    TIMEOUT: "执行超时",
    CANCELLING: "正在结束",
    CANCELED: "任务结束",
    STOPPED: "任务结束",
  };
  return labels[status];
}

function isTaskTerminal(status: CloudPhoneTaskView["status"]) {
  return ["COMPLETED", "FAILED", "TIMEOUT", "CANCELED", "STOPPED"].includes(status);
}

function isAiControlling(status: CloudPhoneTaskView["status"]) {
  return ["PENDING", "RUNNING", "PAUSING", "CANCELLING"].includes(status);
}

function AgentTaskPanel({ task, onAction, onRefresh }: {
  task: CloudPhoneTaskView;
  onAction: (action: "pause" | "resume" | "cancel") => void;
  onRefresh: () => void;
}) {
  const content = (
    <div className="agent-message-thread" aria-live="polite">
      <div className="agent-user-message"><strong>用户指令</strong><p>{task.instruction}</p></div>
      <div className="agent-status-message">
        <div className="agent-status-line">
          {isAiControlling(task.status) && <Loader2 className="spin" size={16} />}
          <strong>{agentTaskStatusLabel(task.status)}</strong>
          <span>任务编号：{task.providerTaskId || task.id}</span>
        </div>
        {task.result && <p>{task.result}</p>}
        {task.errorMessage && <p>{task.errorMessage}</p>}
        <div className="agent-task-meta">
          <span>执行步数：{task.steps || "-"}</span>
          <span>耗时：{task.duration ? `${task.duration} 秒` : "-"}</span>
          <span>更新时间：{formatDateTime(task.updatedAt)}</span>
        </div>
        <div className="agent-task-actions">
          {!isTaskTerminal(task.status) && !["PAUSED", "CALL_FOR_USER"].includes(task.status) && <button className="secondary-button" type="button" onClick={() => onAction("pause")}>暂停并人工接管</button>}
          {["PAUSED", "CALL_FOR_USER"].includes(task.status) && <button className="primary-button" type="button" onClick={() => onAction("resume")}>交还 AI 继续执行</button>}
          {!isTaskTerminal(task.status) && <button className="secondary-button" type="button" onClick={() => onAction("cancel")}>结束任务</button>}
          <button className="secondary-button" type="button" onClick={onRefresh}>刷新状态</button>
        </div>
      </div>
    </div>
  );
  if (!isTaskTerminal(task.status)) return content;
  return <details className="agent-terminal-task"><summary><span>上次任务</span><strong>{agentTaskStatusLabel(task.status)}</strong><small>{formatDateTime(task.updatedAt)}</small></summary>{content}</details>;
}

function normalizeUiError(error: unknown, fallbackSuggestions: string[] = []) {
  if (error && typeof error === "object") {
    const record = error as { message?: string; suggestions?: string[]; error?: { message?: string } };
    return {
      message: record.message || record.error?.message || "请求失败，请检查服务状态后重试。",
      suggestions: Array.isArray(record.suggestions) ? record.suggestions : fallbackSuggestions,
    };
  }
  return { message: error instanceof Error ? error.message : "请求失败，请检查服务状态后重试。", suggestions: fallbackSuggestions };
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

type MonitoredPublishJob = {
  id: string;
  deviceId: string;
  channel: string;
  status: "SCHEDULED" | "QUEUED" | "PREPARING" | "RUNNING" | "REVIEW_REQUIRED" | "PUBLISHED" | "FAILED" | "CANCELED";
  scheduledAt?: string | null;
  createdAt?: string;
  imageTransfer?: { image: number; totalImages: number; completed: number; total: number; mode?: "direct-url" };
  errorMessage?: string;
  syncWarning?: string;
  providerResult?: string;
  providerTaskId?: string;
  providerStartedAt?: string;
  providerSteps?: string;
  providerDuration?: string;
  progressEvents?: PublishProgressEvent[];
};

const publishStatusText: Record<MonitoredPublishJob["status"], string> = {
  SCHEDULED: "等待定时", QUEUED: "等待执行", PREPARING: "正在准备发布", RUNNING: "云手机执行中",
  REVIEW_REQUIRED: "待人工核验", PUBLISHED: "已确认发布", FAILED: "执行失败", CANCELED: "已取消",
};

function CloudPhoneControlCenter({ monitoredPublish, onStopMonitoring }: { monitoredPublish: { id: string; deviceId: string } | null; onStopMonitoring: () => void }) {
  const [devices, setDevices] = useState<CloudPhoneDeviceView[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [connection, setConnection] = useState<CloudPhoneConnectionView | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "connecting" | "connected" | "disconnecting" | "error">("idle");
  const [error, setError] = useState<{ message: string; suggestions?: string[] } | null>(null);
  const [sdkStatus, setSdkStatus] = useState<"idle" | "loading" | "ready" | "connected" | "missing" | "error">("idle");
  const [instruction, setInstruction] = useState("");
  const [activeTask, setActiveTask] = useState<CloudPhoneTaskView | null>(() => readJson("ideact:cloudPhoneActiveTask", null));
  const [taskError, setTaskError] = useState<{ message: string; suggestions?: string[] } | null>(null);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const [publishJob, setPublishJob] = useState<MonitoredPublishJob | null>(null);
  const [publishError, setPublishError] = useState("");
  const autoConnectAttemptRef = useRef<string | null>(null);
  const sessionRef = useRef<ReturnType<NonNullable<NonNullable<Window["Wuying"]>["WebSDK"]>["createSession"]> | null>(null);
  const screenTimeoutRef = useRef<number | null>(null);
  const selectedDevice = devices.find((item) => item.id === selectedDeviceId) ?? devices[0];
  const publishingControlsPhone = Boolean(publishJob && ["QUEUED", "PREPARING", "RUNNING"].includes(publishJob.status) && publishJob.deviceId === selectedDevice?.id);
  const publishFeedback = publishJob?.providerResult ? summarizeProviderResult(publishJob.providerResult) : null;

  useEffect(() => {
    if (!monitoredPublish) { setPublishJob(null); setPublishError(""); return; }
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/publishing/jobs");
        const data = await response.json();
        if (!response.ok) throw data;
        const job = (data.jobs as MonitoredPublishJob[]).find((item) => item.id === monitoredPublish.id);
        if (!job) throw new Error("未找到刚提交的发布任务，请到发布记录核对状态。");
        if (active) { setPublishJob(job); setPublishError(""); }
      } catch (caught) {
        if (active) setPublishError(normalizeUiError(caught).message);
      }
    };
    setPublishJob(null);
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [monitoredPublish?.id]);

  useEffect(() => {
    if (!monitoredPublish || publishJob?.id !== monitoredPublish.id || devices.length === 0) return;
    if (["REVIEW_REQUIRED", "PUBLISHED", "FAILED", "CANCELED"].includes(publishJob.status)) return;
    const target = devices.find((item) => item.id === monitoredPublish.deviceId);
    if (!target) { setPublishError("目标云手机未在当前设备列表中，请刷新设备后重试连接。"); return; }
    if (connection && connection.deviceId !== target.id) {
      if (status !== "disconnecting") void disconnectDevice();
      return;
    }
    if (selectedDeviceId !== target.id) { setSelectedDeviceId(target.id); return; }
    if (!connection && ["idle", "error"].includes(status) && autoConnectAttemptRef.current !== monitoredPublish.id) {
      autoConnectAttemptRef.current = monitoredPublish.id;
      void connectDevice();
    }
  }, [monitoredPublish?.id, monitoredPublish?.deviceId, publishJob?.id, publishJob?.status, devices, selectedDeviceId, connection?.deviceId, status]);

  useEffect(() => {
    void loadDevices();
  }, []);

  useEffect(() => {
    if (!selectedDeviceId && devices[0]) setSelectedDeviceId(devices[0].id);
  }, [devices, selectedDeviceId]);

  useEffect(() => {
    if (!connection || status !== "connected") return;
    const timer = window.setInterval(() => {
      void fetch(`/api/cloud-phone/connections/${encodeURIComponent(connection.connectionId)}/heartbeat`, { method: "POST" })
        .then((response) => {
          if (!response.ok && sessionRef.current) {
            void releaseScreenConnection(connection, sessionRef.current, "本地连接已失效，请重新连接云手机。");
          }
        })
        .catch(() => {
          if (sessionRef.current) void releaseScreenConnection(connection, sessionRef.current, "无法保持云手机连接，请检查本地服务后重新连接。");
        });
    }, 10000);
    return () => window.clearInterval(timer);
  }, [connection, status]);

  useEffect(() => {
    if (activeTask) localStorage.setItem("ideact:cloudPhoneActiveTask", JSON.stringify(activeTask));
    else localStorage.removeItem("ideact:cloudPhoneActiveTask");
    const allowInput = !publishingControlsPhone && (!activeTask || !isAiControlling(activeTask.status));
    sessionRef.current?.setInputEnabled?.(allowInput);
    sessionRef.current?.setTouchEnabled?.(allowInput);
  }, [activeTask, publishingControlsPhone, status]);

  useEffect(() => {
    if (!activeTask || isTaskTerminal(activeTask.status)) return;
    const timer = window.setInterval(() => {
      void refreshTask(activeTask.id, false);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeTask?.id, activeTask?.status]);

  async function loadDevices() {
    setStatus((current) => (current === "connected" ? current : "loading"));
    setError(null);
    try {
      const response = await fetch("/api/cloud-phone/devices");
      const data = await response.json();
      if (!response.ok) throw data;
      setDevices(Array.isArray(data.devices) ? data.devices : []);
      setStatus((current) => (current === "connected" ? current : "idle"));
    } catch (err) {
      setStatus("error");
      setError(normalizeUiError(err, ["检查服务端 .env 的云手机实例 ID、地域和 AccessKey。", "确认 API 服务已启动，并且云手机实例处于运行中。"]));
    }
  }

  async function connectDevice() {
    if (!selectedDevice) return;
    setStatus("connecting");
    setSdkStatus("loading");
    setError(null);
    let nextConnection: CloudPhoneConnectionView | null = null;
    try {
      const response = await fetch(`/api/cloud-phone/devices/${encodeURIComponent(selectedDevice.id)}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
      const data = await response.json();
      if (!response.ok) throw data;
      nextConnection = data as CloudPhoneConnectionView;
      setConnection(nextConnection);
      await startWuyingSession(nextConnection);
    } catch (err) {
      clearScreenTimeout();
      const session = sessionRef.current;
      sessionRef.current = null;
      try { session?.stop?.(); } catch { /* The SDK may already have closed the session. */ }
      if (nextConnection) {
        await fetch(`/api/cloud-phone/connections/${encodeURIComponent(nextConnection.connectionId)}`, { method: "DELETE" }).catch(() => undefined);
      }
      setConnection(null);
      setStatus("error");
      const uiError = normalizeUiError(err, ["确认 public/vendor/wuying/WuyingWebSDK.js 已按官方包放置。", "确认后端已经拿到 BatchGetAcpConnectionTicket 返回的 Ticket。"]);
      if (uiError.message.includes("WuyingWebSDK")) setSdkStatus("missing");
      else setSdkStatus("error");
      setError(uiError);
    }
  }

  async function disconnectDevice() {
    setStatus("disconnecting");
    clearScreenTimeout();
    const session = sessionRef.current;
    sessionRef.current = null;
    try {
      try { session?.stop?.(); } catch { /* Continue releasing the server connection. */ }
      if (connection) {
        await fetch(`/api/cloud-phone/connections/${encodeURIComponent(connection.connectionId)}`, { method: "DELETE" });
      }
    } finally {
      sessionRef.current = null;
      setConnection(null);
      setStatus("idle");
      setSdkStatus("idle");
      void loadDevices();
    }
  }

  function clearScreenTimeout() {
    if (screenTimeoutRef.current !== null) window.clearTimeout(screenTimeoutRef.current);
    screenTimeoutRef.current = null;
  }

  async function releaseScreenConnection(
    staleConnection: CloudPhoneConnectionView,
    session: NonNullable<typeof sessionRef.current>,
    message: string,
  ) {
    if (sessionRef.current !== session) return;
    sessionRef.current = null;
    clearScreenTimeout();
    setStatus("disconnecting");
    setConnection(null);
    try { session.stop?.(); } catch { /* A disconnected SDK session may reject stop. */ }
    await fetch(`/api/cloud-phone/connections/${encodeURIComponent(staleConnection.connectionId)}`, { method: "DELETE" }).catch(() => undefined);
    setStatus("error");
    setSdkStatus("error");
    setError({ message, suggestions: ["点击“连接云手机”重新获取画面。", "若再次断开，请检查网络和阿里云节点状态。"] });
    setDevices((current) => current.map((device) => device.id === staleConnection.deviceId ? { ...device, occupancyStatus: "IDLE" } : device));
  }

  async function sendAgentInstruction(event?: React.FormEvent) {
    event?.preventDefault();
    if (!connection || publishingControlsPhone || !instruction.trim() || activeTask && !isTaskTerminal(activeTask.status)) return;
    const rawInstruction = instruction.trim();
    const idempotencyKey = `agent-${connection.connectionId}-${Date.now()}-${rawInstruction.length}`;
    const pendingTask: CloudPhoneTaskView = {
      id: idempotencyKey,
      deviceId: connection.deviceId,
      connectionId: connection.connectionId,
      instruction: rawInstruction,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setActiveTask(pendingTask);
    setIsSubmittingTask(true);
    setTaskError(null);
    try {
      const response = await fetch(`/api/cloud-phone/connections/${encodeURIComponent(connection.connectionId)}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ instruction: rawInstruction }),
      });
      const data = await response.json();
      if (!response.ok) throw data;
      setActiveTask(data.task);
      setInstruction("");
    } catch (err) {
      setActiveTask({ ...pendingTask, status: "FAILED", errorMessage: normalizeUiError(err).message, updatedAt: new Date().toISOString() });
      setTaskError(normalizeUiError(err, ["原始指令已保留在输入框中，请确认连接和权限后重试。", "不要连续重复点击发送，避免真实任务重复创建。"]));
      setInstruction(rawInstruction);
    } finally {
      setIsSubmittingTask(false);
    }
  }

  async function refreshTask(taskId = activeTask?.id, showError = true) {
    if (!taskId) return;
    try {
      const response = await fetch(`/api/cloud-phone/tasks/${encodeURIComponent(taskId)}`);
      const data = await response.json();
      if (!response.ok) throw data;
      setActiveTask(data.task);
      setTaskError(null);
    } catch (err) {
      if (showError) setTaskError(normalizeUiError(err, ["任务记录已保留，请稍后再刷新。"]));
    }
  }

  async function changeAgentTask(action: "pause" | "resume" | "cancel") {
    if (!activeTask) return;
    const endpoint = action === "pause" ? "pause" : action === "resume" ? "resume" : "cancel";
    setTaskError(null);
    try {
      const response = await fetch(`/api/cloud-phone/tasks/${encodeURIComponent(activeTask.id)}/${endpoint}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw data;
      setActiveTask(data.task);
    } catch (err) {
      setTaskError(normalizeUiError(err, ["请先刷新任务状态，再重试这个操作。"]));
    }
  }

  async function startWuyingSession(nextConnection: CloudPhoneConnectionView) {
    await loadWuyingSdk();
    const sdk = window.Wuying?.WebSDK;
    if (!sdk?.createSession) throw new Error("无影 Web SDK 未正确加载：请把官方 WuyingWebSDK.js 放到 public/vendor/wuying/。");

    const session = sdk.createSession("appstream", {
      openType: "inline",
      iframeId: "cloud-phone-frame",
      resourceType: "local",
      connectType: "app",
      regionId: nextConnection.regionId,
      sdkPath: nextConnection.sdkPath,
      userInfo: { ticket: nextConnection.ticket },
      appInfo: {
        osType: "Android",
        appId: nextConnection.persistentAppInstanceId || "android",
        appInstanceId: nextConnection.appInstanceId,
        persistentAppInstanceId: nextConnection.persistentAppInstanceId,
        appInstanceGroupId: nextConnection.appInstanceGroupId,
        productType: "AndroidCloud",
        loginRegionId: nextConnection.regionId,
        bizRegionId: nextConnection.regionId,
        connectionProperties: JSON.stringify({ authMode: "Session" }),
      },
      uiConfig: {
        toolbar: { visible: false },
        language: "zh-CN",
        backgroundColor: "#03170c",
        allowErrorDialog: false,
      },
      lyncChannelConfig: [{ lyncChannelName: "lync_adb_shell" }],
    });

    session.addHandle?.("onConnected", () => {
      if (sessionRef.current !== session) return;
      clearScreenTimeout();
      setStatus("connected");
      setSdkStatus("connected");
      setError(null);
      void loadDevices();
    });
    session.addHandle?.("onDisConnected", () => {
      void releaseScreenConnection(nextConnection, session, "云手机画面连接已断开，请重新连接。");
    });
    session.addHandle?.("onError", () => {
      void releaseScreenConnection(nextConnection, session, "云手机画面连接失败，请重新连接。");
    });
    session.setInputEnabled?.(!publishingControlsPhone && (!activeTask || !isAiControlling(activeTask.status)));
    session.setTouchEnabled?.(!publishingControlsPhone && (!activeTask || !isAiControlling(activeTask.status)));
    session.setClipboardEnabled?.(false);
    sessionRef.current = session;
    screenTimeoutRef.current = window.setTimeout(() => {
      void releaseScreenConnection(nextConnection, session, "云手机画面连接超时，请重新连接。");
    }, 20000);
    await session.start?.();
  }

  function loadWuyingSdk() {
    if (window.Wuying?.WebSDK) return Promise.resolve();
    const sdkUrl = "/vendor/wuying/WuyingWebSDK.js";
    return new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${sdkUrl}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("无法加载无影 Web SDK：/vendor/wuying/WuyingWebSDK.js 不存在或不可访问。")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = sdkUrl;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("无法加载无影 Web SDK：/vendor/wuying/WuyingWebSDK.js 不存在或不可访问。"));
      document.head.appendChild(script);
    });
  }

  return (
    <section className="cloud-phone-center" aria-labelledby="cloud-phone-title">
      <div className="module-heading">
        <div>
          <p className="section-label">云手机操控中心</p>
          <h2 id="cloud-phone-title">连接真实云手机并接管画面</h2>
          <p>左侧查看设备和连接状态，右侧显示无影 Web SDK 的实时画面，鼠标操作由云手机画面直接接收。</p>
        </div>
        <button className="secondary-button" type="button" onClick={loadDevices} disabled={status === "loading" || status === "connecting"}>
          <RefreshCw size={16} /> 刷新设备
        </button>
      </div>

      <div className="cloud-phone-layout">
        <aside className="cloud-phone-device-panel">
          <div className="panel-card">
            <div className="panel-card-head">
              <div>
                <p className="section-label">设备</p>
                <h3>可连接云手机</h3>
              </div>
              {status === "loading" && <Loader2 className="spin" size={18} />}
            </div>

            {devices.length === 0 && status !== "loading" ? (
              <div className="empty-state compact">
                <MonitorSmartphone size={24} />
                <h3>还没有读取到设备</h3>
                <p>请确认 `.env` 已配置云手机实例 ID、地域和服务端 AccessKey，然后点击刷新。</p>
              </div>
            ) : (
              <div className="cloud-device-list">
                {devices.map((device) => (
                  <button
                    key={device.id}
                    type="button"
                    className={`cloud-device-card${selectedDevice?.id === device.id ? " is-selected" : ""}`}
                    onClick={() => { if (device.id !== monitoredPublish?.deviceId) onStopMonitoring(); setSelectedDeviceId(device.id); }}
                    disabled={status === "connecting" || status === "connected"}
                  >
                    <strong>{device.name}</strong>
                    <span>{device.instanceId}</span>
                    <div className="cloud-device-badges">
                      <StatusPill tone={device.runtimeStatus === "RUNNING" ? "ok" : "warn"}>{runtimeStatusLabel(device.runtimeStatus)}</StatusPill>
                      <StatusPill tone={device.occupancyStatus === "IDLE" ? "idle" : "warn"}>{device.occupancyStatus === "IDLE" ? "空闲" : "占用中"}</StatusPill>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {selectedDevice && (
              <dl className="device-detail-list">
                <div>
                  <dt>设备名称</dt>
                  <dd>{selectedDevice.name}</dd>
                </div>
                <div>
                  <dt>实例 ID</dt>
                  <dd>{selectedDevice.instanceId}</dd>
                </div>
                <div>
                  <dt>设备状态</dt>
                  <dd>{runtimeStatusLabel(selectedDevice.runtimeStatus)} · {selectedDevice.occupancyStatus === "IDLE" ? "空闲" : "占用中"}</dd>
                </div>
                <div>
                  <dt>过期时间</dt>
                  <dd>{selectedDevice.expireTime ? formatDateTime(selectedDevice.expireTime) : "阿里云未返回"}</dd>
                </div>
              </dl>
            )}

            <div className="cloud-phone-actions">
              <button className="primary-button" type="button" onClick={connectDevice} disabled={!selectedDevice || status === "connecting" || status === "connected" || status === "disconnecting"}>
                {status === "connecting" ? <Loader2 className="spin" size={16} /> : <Power size={16} />}
                连接云手机
              </button>
              <button className="secondary-button" type="button" onClick={disconnectDevice} disabled={!connection || status === "disconnecting"}>
                断开连接
              </button>
            </div>

            {error && (
              <div className="error-box">
                <strong>{error.message}</strong>
                {error.suggestions?.map((item) => <p key={item}>{item}</p>)}
              </div>
            )}
          </div>
        </aside>

        <div className="cloud-phone-screen-panel">
          {monitoredPublish && <div className="publish-live-status" role="status" aria-live="polite">
            <div className="phone-screen-toolbar">
              <div><p className="section-label">本次发布任务</p><h3>{publishJob ? `${publishJob.channel} · ${publishStatusText[publishJob.status]}` : "正在读取发布状态"}</h3></div>
              <div className="publish-live-actions">
                {publishJob && ["QUEUED", "PREPARING", "RUNNING"].includes(publishJob.status) && <Loader2 className="spin" size={18} />}
                <button className="secondary-button" type="button" onClick={onStopMonitoring} disabled={Boolean(publishJob && ["QUEUED", "PREPARING", "RUNNING"].includes(publishJob.status))}>关闭跟踪</button>
              </div>
            </div>
            <p>任务编号：{monitoredPublish.id}</p>
            {publishJob?.status === "SCHEDULED" && <p>计划时间：{formatDateTime(publishJob.scheduledAt || undefined)}。画面仅显示当前设备，不代表已经开始发布。</p>}
            {publishJob?.status === "PREPARING" && publishJob.imageTransfer && <p>{publishJob.imageTransfer.mode === "direct-url" ? `图片整图直传：已完成 ${publishJob.imageTransfer.completed}/${publishJob.imageTransfer.totalImages} 张` : `图片传输：第 ${publishJob.imageTransfer.image}/${publishJob.imageTransfer.totalImages} 张，${Math.floor(publishJob.imageTransfer.completed / publishJob.imageTransfer.total * 100)}%`}</p>}
            {publishJob?.providerTaskId && <p>阿里云任务：{publishJob.providerTaskId}</p>}
            {publishJob?.providerSteps !== undefined && <p>已执行步骤：{publishJob.providerSteps}{publishJob.providerDuration !== undefined ? ` · 耗时 ${publishJob.providerDuration} 秒` : ""}</p>}
            {publishJob?.status === "REVIEW_REQUIRED" && <p>AI 已结束。请在平台核实帖子是否真的发布，再到“发布内容”确认记录。</p>}
            {publishFeedback && <p>{publishFeedback.summary}{publishFeedback.steps ? ` · ${publishFeedback.steps} 步` : ""}</p>}
            {publishJob && <PublishExecutionProgress job={publishJob} />}
            {publishJob?.syncWarning && <p className="publish-job-warning">{publishJob.syncWarning}</p>}
            {publishJob?.errorMessage && <p className="publish-job-error">{publishJob.errorMessage}</p>}
            {publishError && <p className="publish-job-error">{publishError} 请到“发布内容”查看记录或稍后重试刷新。</p>}
            {status === "error" && <p className="publish-job-error">实时画面连接失败，请在左侧重新连接；发布任务状态仍以本区显示的服务端记录为准。</p>}
          </div>}
          <div className="phone-screen-toolbar">
            <div>
              <p className="section-label">实时画面</p>
              <h3>{sdkStatus === "connected" ? "云手机已建立连接" : status === "connecting" ? "正在连接云手机" : "等待连接云手机"}</h3>
            </div>
            <StatusPill tone={sdkStatus === "connected" ? "ok" : sdkStatus === "missing" || sdkStatus === "error" ? "warn" : "idle"}>{sdkStatusLabel(sdkStatus)}</StatusPill>
          </div>
          <div className="cloud-phone-stage">
            <div className="phone-device-frame" aria-label="云手机实时画面容器">
              <iframe id="cloud-phone-frame" title="云手机实时画面" />
              {!connection && (
                <div className="phone-frame-placeholder">
                  <MousePointer2 size={24} />
                  <strong>连接后显示真实云手机画面</strong>
                  <p>画面保持手机原始比例，连接成功后可直接用鼠标点击、拖拽和输入。</p>
                </div>
              )}
              {connection && status === "connecting" && (
                <div className="phone-frame-placeholder">
                  <Loader2 className="spin" size={24} />
                  <strong>正在建立画面连接</strong>
                  <p>已获取短期 Ticket，正在等待无影 Web SDK 返回连接事件。</p>
                </div>
              )}
            </div>
          </div>
          <form className="agent-command-panel" onSubmit={sendAgentInstruction}>
            <div className="panel-card-head">
              <div>
                <p className="section-label">自然语言指令</p>
                <h3>让 AI 自动操作当前云手机</h3>
              </div>
              {activeTask && <StatusPill tone={isTaskTerminal(activeTask.status) ? activeTask.status === "COMPLETED" ? "ok" : "warn" : "idle"}>{agentTaskStatusLabel(activeTask.status)}</StatusPill>}
            </div>

            {activeTask && <AgentTaskPanel task={activeTask} onAction={changeAgentTask} onRefresh={() => refreshTask()} />}

            <label className="agent-command-input">
              <span>输入指令</span>
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                rows={3}
                placeholder="例如：打开小红书，找到当前帖子的前 30 条评论，并分析评论情感。"
                disabled={!connection || publishingControlsPhone || Boolean(activeTask && !isTaskTerminal(activeTask.status))}
              />
            </label>
            <div className="agent-command-footer">
              <p>{!connection ? "请先连接云手机，再发送自然语言指令。" : activeTask && !isTaskTerminal(activeTask.status) ? "当前任务结束后才能发送下一条指令。AI 操作期间会暂时关闭人工鼠标输入。" : "输入新的指令后即可开始任务；发送后会暂时关闭人工鼠标输入。"}</p>
              <button className="primary-button" type="submit" disabled={!connection || publishingControlsPhone || !instruction.trim() || isSubmittingTask || Boolean(activeTask && !isTaskTerminal(activeTask.status))}>
                {isSubmittingTask ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
                发送指令
              </button>
            </div>
            {taskError && (
              <div className="error-box">
                <strong>{taskError.message}</strong>
                {taskError.suggestions?.map((item) => <p key={item}>{item}</p>)}
              </div>
            )}
          </form>
        </div>
      </div>
    </section>
  );
}

function PublishExecutionProgress({ job }: { job: MonitoredPublishJob }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (job.status !== "RUNNING") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job.status]);
  const progress = buildPublishProgressView(job, now);
  const statusText = publishStatusText[job.status];
  const resultSteps = job.providerResult ? summarizeProviderResult(job.providerResult).steps : undefined;
  const reportedSteps = job.providerSteps || resultSteps;
  const stepText = reportedSteps ? `已执行 ${reportedSteps} 步` : job.status === "RUNNING" ? "正在等待步数" : "未返回步数";

  return <section className="publish-execution-progress" aria-label="发布任务执行进度">
    <div className="publish-progress-head">
      <div><strong>{progress.current.title}</strong><span>第 {progress.currentNumber}/{progress.total} 阶段 · {statusText}</span></div>
      <strong>{progress.percent}%</strong>
    </div>
    <div className="publish-progress-track" role="progressbar" aria-label="发布总体进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
      <span style={{ width: `${progress.percent}%` }} />
    </div>
    <div className="publish-progress-metrics">
      <span>当前：{progress.current.detail}</span><span>{stepText}</span><span>用时 {formatElapsed(progress.elapsedSeconds)}</span>
    </div>
    <ol className="publish-progress-timeline">
      {progress.events.map((event, index) => <li className={`is-${event.status}`} key={event.stage}>
        <span className="publish-progress-dot" aria-hidden="true">{event.status === "completed" ? "✓" : index + 1}</span>
        <div><strong>{event.title}</strong><p>{event.detail}</p>{event.updatedAt && <time>{formatDateTime(event.updatedAt)}</time>}</div>
      </li>)}
    </ol>
    <p className="publish-progress-note">阿里云接口实时返回任务状态和已执行步数，不返回每次点击的名称；具体操作请同时查看下方实时画面。</p>
  </section>;
}

function loadProductionRecords(): ProductionRecord[] {
  if (localStorage.getItem("ideact:productionRecords") !== null) return readJson("ideact:productionRecords", []);
  const groups = readJson<TopicGroup[]>("ideact:socialTopicGroups", []);
  const copies = readJson<CopywritingResult[]>("ideact:socialCopyResults", []);
  const briefs = readJson<CreativeBrief[]>("ideact:creativeBriefs", []);
  const images = readJson<SocialImageResult[]>("ideact:socialImageResults", []);
  return [
    ...groups.map((group): ProductionRecord => ({
      id: `topics:${group.key}:${group.generatedAt}`,
      kind: "topics",
      objectId: group.objectId,
      objectName: group.objectName,
      productName: group.productName,
      createdAt: group.generatedAt,
      topicGroup: group,
      images: [],
    })),
    ...copies.map((copy): ProductionRecord => {
      const group = groups.find((item) => item.objectId === copy.objectId && item.topics.some((topic) => topic.id === copy.topicId));
      const brief = briefs.find((item) => item.key === copy.briefKey);
      return {
        id: `content:${copy.key}:${copy.generatedAt}`,
        kind: "content",
        objectId: copy.objectId,
        objectName: group?.objectName || copy.objectId,
        productName: brief?.useProduct ? brief.product?.name || null : null,
        createdAt: copy.generatedAt,
        topic: group?.topics.find((topic) => topic.id === copy.topicId),
        brief,
        copy,
        images: images.filter((item) => item.copyKey === copy.key),
      };
    }),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function SocialContentPage() {
  const [userObjects, setUserObjects] = useState<CreationObject[]>(() => readJson("ideact:userCreationObjects", []));
  const objects = useMemo(() => mergeCreationObjects(userObjects), [userObjects]);
  const [selection, setSelection] = useState<CreationSelection>(() => readJson("ideact:socialContentSelection", { objectId: "brand-cat", promoteProduct: false, product: null }));
  const selectedObject = useMemo(() => objects.find((item) => item.id === selection.objectId) ?? objects[0], [objects, selection.objectId]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [productState, setProductState] = useState<"idle" | "loading" | "success" | "empty" | "error">("idle");
  const [productError, setProductError] = useState<{ message: string; suggestions: string[] } | null>(null);
  const [editingObject, setEditingObject] = useState<CreationObject | null>(null);
  const [creationObjectBases, setCreationObjectBases] = useState<KnowledgeBase[]>([]);
  const [creationObjectBasesState, setCreationObjectBasesState] = useState<"loading" | "ready" | "error">("loading");
  const [objectNotice, setObjectNotice] = useState("");
  const [topicGroups, setTopicGroups] = useState<TopicGroup[]>(() => readJson("ideact:socialTopicGroups", []));
  const [favorites, setFavorites] = useState<GeneratedTopic[]>(() => readJson("ideact:socialTopicFavorites", []));
  const [selectedTopicId, setSelectedTopicId] = useState(() => localStorage.getItem("ideact:selectedTopicId") || "");
  const [showFavorites, setShowFavorites] = useState(false);
  const [isGeneratingTopics, setIsGeneratingTopics] = useState(false);
  const [topicError, setTopicError] = useState<{ message: string; suggestions: string[] } | null>(null);
  const [briefs, setBriefs] = useState<CreativeBrief[]>(() => readJson("ideact:creativeBriefs", []));
  const [copyResults, setCopyResults] = useState<CopywritingResult[]>(() => readJson("ideact:socialCopyResults", []));
  const [activeCopyKey, setActiveCopyKey] = useState(() => localStorage.getItem("ideact:activeCopyKey") || "");
  const [activeCopyChannel, setActiveCopyChannel] = useState<CopyChannel>(() => (localStorage.getItem("ideact:activeCopyChannel") as CopyChannel) || "小红书");
  const [isGeneratingCopy, setIsGeneratingCopy] = useState(false);
  const [copyError, setCopyError] = useState<{ message: string; suggestions: string[] } | null>(null);
  const [imageResults, setImageResults] = useState<SocialImageResult[]>(() => readJson("ideact:socialImageResults", []));
  const [productionRecords, setProductionRecords] = useState<ProductionRecord[]>(loadProductionRecords);
  const [generatingImageKey, setGeneratingImageKey] = useState("");
  const [imageBatchProgress, setImageBatchProgress] = useState<{ completed: number; failed: number; total: number } | null>(null);
  const [imageError, setImageError] = useState<{ message: string; suggestions: string[] } | null>(null);
  const [imageModels, setImageModels] = useState<ImageModelInfo[]>([]);
  const [visualDirections, setVisualDirections] = useState<Record<string, VisualDirection[]>>(() => readJson("ideact:visualDirections", {}));
  const [imagePrompts, setImagePrompts] = useState<Record<string, string>>(() => readJson("ideact:imagePrompts", {}));
  const [selectedDirectionId, setSelectedDirectionId] = useState("");
  const [selectedImageSizes, setSelectedImageSizes] = useState<ImageSizeOption[]>(["3:4"]);
  const [imageModelId, setImageModelId] = useState("");
  const [isGeneratingDirections, setIsGeneratingDirections] = useState(false);
  const [directionError, setDirectionError] = useState<{ message: string; suggestions: string[] } | null>(null);
  const [activeWorkflowStep, setActiveWorkflowStep] = useState<WorkflowStepNumber>(() => readNavigationState(window.location.search).step);
  const [confirmedStepOneKey, setConfirmedStepOneKey] = useState(() => localStorage.getItem("ideact:confirmedStepOneKey") || "");
  const [confirmedCopyKey, setConfirmedCopyKey] = useState(() => localStorage.getItem("ideact:confirmedCopyKey") || "");
  const [modelStatus, setModelStatus] = useState<ModelConfigurationStatus | null>(null);
  const [modelStatusState, setModelStatusState] = useState<"loading" | "ready" | "error">("loading");
  const [workspaceSaveError, setWorkspaceSaveError] = useState("");
  const activeTopicRequestKey = useRef("");
  const activeCopyRequestKey = useRef("");

  useEffect(() => {
    const restore = () => setActiveWorkflowStep(readNavigationState(window.location.search).step);
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function chooseWorkflowStep(step: WorkflowStepNumber, mode: "push" | "replace" = "push") {
    setActiveWorkflowStep(step);
    updateNavigationState({ module: "pipeline", step }, mode);
  }

  useEffect(() => {
    localStorage.setItem("ideact:userCreationObjects", JSON.stringify(userObjects));
  }, [userObjects]);

  useEffect(() => {
    localStorage.setItem("ideact:socialContentSelection", JSON.stringify(selection));
  }, [selection]);

  useEffect(() => {
    localStorage.setItem("ideact:socialTopicGroups", JSON.stringify(topicGroups));
  }, [topicGroups]);

  useEffect(() => {
    localStorage.setItem("ideact:socialTopicFavorites", JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem("ideact:creativeBriefs", JSON.stringify(briefs));
  }, [briefs]);

  useEffect(() => {
    localStorage.setItem("ideact:socialCopyResults", JSON.stringify(copyResults));
  }, [copyResults]);

  useEffect(() => {
    localStorage.setItem("ideact:socialImageResults", JSON.stringify(imageResults));
  }, [imageResults]);

  useEffect(() => {
    localStorage.setItem("ideact:productionRecords", JSON.stringify(productionRecords));
  }, [productionRecords]);

  useEffect(() => {
    localStorage.setItem("ideact:visualDirections", JSON.stringify(visualDirections));
  }, [visualDirections]);

  useEffect(() => {
    localStorage.setItem("ideact:imagePrompts", JSON.stringify(imagePrompts));
  }, [imagePrompts]);

  useEffect(() => {
    if (selectedTopicId) localStorage.setItem("ideact:selectedTopicId", selectedTopicId);
    else localStorage.removeItem("ideact:selectedTopicId");
    if (activeCopyKey) localStorage.setItem("ideact:activeCopyKey", activeCopyKey);
    else localStorage.removeItem("ideact:activeCopyKey");
    localStorage.setItem("ideact:activeCopyChannel", activeCopyChannel);
    if (confirmedStepOneKey) localStorage.setItem("ideact:confirmedStepOneKey", confirmedStepOneKey);
    else localStorage.removeItem("ideact:confirmedStepOneKey");
    if (confirmedCopyKey) localStorage.setItem("ideact:confirmedCopyKey", confirmedCopyKey);
    else localStorage.removeItem("ideact:confirmedCopyKey");

    const timer = window.setTimeout(() => {
      void saveContentWorkspace()
        .then(() => setWorkspaceSaveError(""))
        .catch((caught) => setWorkspaceSaveError(caught instanceof Error ? caught.message : "内容自动保存失败。"));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    userObjects,
    selection,
    topicGroups,
    favorites,
    briefs,
    copyResults,
    imageResults,
    productionRecords,
    visualDirections,
    imagePrompts,
    selectedTopicId,
    activeCopyKey,
    activeCopyChannel,
    confirmedStepOneKey,
    confirmedCopyKey,
  ]);

  useEffect(() => {
    fetch("/api/social/image-models")
      .then((response) => response.json())
      .then((payload) => {
        const models = payload.models ?? [];
        setImageModels(models);
        setImageModelId((current) => current || models[0]?.id || "");
      })
      .catch(() => setImageModels([]));
  }, []);

  useEffect(() => {
    let ignore = false;
    setCreationObjectBasesState("loading");
    fetch("/api/knowledge/bases")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw payload;
        if (ignore) return;
        setCreationObjectBases(payload.bases ?? []);
        setCreationObjectBasesState("ready");
      })
      .catch(() => {
        if (!ignore) setCreationObjectBasesState("error");
      });
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    setModelStatusState("loading");
    fetch("/api/social/model-status")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw payload;
        setModelStatus(payload);
        setModelStatusState("ready");
      })
      .catch(() => {
        setModelStatus(null);
        setModelStatusState("error");
      });
  }, []);

  useEffect(() => {
    if (activeCopyKey) localStorage.setItem("ideact:activeCopyKey", activeCopyKey);
  }, [activeCopyKey]);

  useEffect(() => {
    localStorage.setItem("ideact:activeCopyChannel", activeCopyChannel);
  }, [activeCopyChannel]);

  useEffect(() => {
    if (!selectedObject) return;
    if (selection.product && !isProductAllowedForObject(selection.product, selectedObject)) {
      setSelection((current) => ({ ...current, promoteProduct: false, product: null }));
    }
    setProducts([]);
    setProductQuery("");
    setProductError(null);
    loadProducts(selectedObject);
  }, [selectedObject?.id]);

  async function loadProducts(object: CreationObject) {
    setProductState("loading");
    try {
      const response = await fetch(`/api/knowledge/bases/${encodeURIComponent(object.knowledgeBaseId)}/products`);
      const payload = await response.json();
      if (!response.ok) throw payload;
      const scopedProducts = (payload.products ?? []).filter((product: ProductOption) => product.knowledgeBaseId === object.knowledgeBaseId);
      setProducts(scopedProducts);
      setProductState(scopedProducts.length > 0 ? "success" : "empty");
    } catch (caught) {
      setProductState("error");
      setProductError(readApiError(caught, "产品读取失败。"));
    }
  }

  function chooseObject(object: CreationObject) {
    activeCopyRequestKey.current = "";
    setSelection({ objectId: object.id, promoteProduct: false, product: null });
    localStorage.removeItem("ideact:topicDraftState");
  }

  function chooseNoProduct() {
    activeCopyRequestKey.current = "";
    setSelection((current) => ({ ...current, promoteProduct: false, product: null }));
  }

  function chooseProduct(product: ProductOption) {
    if (!isProductAllowedForObject(product, selectedObject)) return;
    activeCopyRequestKey.current = "";
    setSelection((current) => ({ ...current, promoteProduct: true, product }));
  }

  function saveObject(nextObject: CreationObject) {
    const normalized = normalizeCreationObject(nextObject);
    setUserObjects((current) => upsertCreationObject(current, normalized));
    setSelection({ objectId: normalized.id, promoteProduct: false, product: null });
    setEditingObject(null);
    setObjectNotice(`已保存创作对象“${normalized.name}”。`);
  }

  function deleteObject(objectId: string) {
    const target = userObjects.find((item) => item.id === objectId);
    if (!target || !window.confirm(`将删除创作对象“${target.name}”，删除后无法恢复。是否继续？`)) return;
    setUserObjects((current) => current.filter((item) => item.id !== objectId));
    if (selection.objectId === objectId) setSelection({ objectId: "brand-cat", promoteProduct: false, product: null });
    setObjectNotice(`已删除创作对象“${target.name}”。`);
  }

  const filteredProducts = products.filter((product) => fuzzyMatchProduct(product, productQuery));
  const resultKey = selectedObject ? buildTopicGroupKey(selectedObject.id, selection.promoteProduct ? selection.product?.id || null : null, selectedObject.topicWeights) : "";
  const currentTopicGroup = topicGroups.find((group) => group.key === resultKey);
  const selectedTopic = currentTopicGroup?.topics.find((topic) => topic.id === selectedTopicId);
  const briefKey = selectedObject && selectedTopic ? buildBriefKey(selectedObject.id, selectedTopic.id, selection.promoteProduct ? selection.product?.id || null : null) : "";
  const currentBrief = briefs.find((brief) => brief.key === briefKey);
  const currentCopyResult = activeCopyKey ? copyResults.find((result) => result.key === activeCopyKey) : undefined;
  const currentVisualDirections = currentCopyResult ? visualDirections[currentCopyResult.key] ?? [] : [];
  const stepOneKey = selectedObject ? JSON.stringify({
    object: {
      id: selectedObject.id,
      name: selectedObject.name,
      type: selectedObject.type,
      positioning: selectedObject.positioning,
      contentStyle: selectedObject.contentStyle,
      knowledgeBaseId: selectedObject.knowledgeBaseId,
      topicWeights: selectedObject.topicWeights,
    },
    promoteProduct: selection.promoteProduct,
    productId: selection.promoteProduct ? selection.product?.id || null : null,
  }) : "";
  const stepOneComplete = Boolean(stepOneKey && (confirmedStepOneKey === stepOneKey || currentTopicGroup));
  const stepFourComplete = Boolean(currentCopyResult && confirmedCopyKey === currentCopyResult.key);
  const textGenerationDisabledReason = modelStatusState === "loading"
    ? "正在检查文字模型配置"
    : modelStatusState === "error"
      ? "文字模型配置状态读取失败"
      : !modelStatus?.text.configured ? "文字模型未配置" : undefined;

  useEffect(() => {
    activeTopicRequestKey.current = resultKey;
  }, [resultKey]);

  useEffect(() => {
    const copyKey = currentCopyResult?.key;
    if (!copyKey) return;
    const recovered = recoverImagePrompt(imagePrompts[copyKey], currentVisualDirections, selectedDirectionId);
    if (!recovered.prompt) return;
    setSelectedDirectionId(recovered.directionId);
    setImagePrompts((current) => current[copyKey]?.trim() ? current : { ...current, [copyKey]: recovered.prompt });
  }, [currentCopyResult?.key, currentVisualDirections]);

  function confirmStepOne() {
    if (!stepOneKey) return;
    setConfirmedStepOneKey(stepOneKey);
    localStorage.setItem("ideact:confirmedStepOneKey", stepOneKey);
    chooseWorkflowStep(2);
  }

  function confirmCopyAndContinue() {
    if (!currentCopyResult) return;
    setConfirmedCopyKey(currentCopyResult.key);
    localStorage.setItem("ideact:confirmedCopyKey", currentCopyResult.key);
    chooseWorkflowStep(5);
  }

  async function generateTopics(force = false) {
    if (!selectedObject || isGeneratingTopics) return;
    if (!modelStatus?.text.configured) {
      setTopicError({ message: "文字模型尚未配置，暂时不能生成选题。", suggestions: ["请在服务端 .env 中填写 DASHSCOPE_API_KEY 并重启 API 服务。"] });
      return;
    }
    if (!force && currentTopicGroup) return;
    const requestKey = resultKey;
    activeTopicRequestKey.current = requestKey;
    setIsGeneratingTopics(true);
    setTopicError(null);
    try {
      const response = await fetch("/api/social/topics/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object: selectedObject,
          product: selection.promoteProduct ? selection.product : null,
          historyTitles: topicGroups.filter((group) => group.objectId === selectedObject.id).flatMap((group) => group.topics.map((topic) => topic.title)),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw payload;
      if (activeTopicRequestKey.current !== requestKey) return;
      const nextGroup: TopicGroup = {
        key: requestKey,
        objectId: selectedObject.id,
        objectName: selectedObject.name,
        productId: selection.promoteProduct ? selection.product?.id || null : null,
        productName: selection.promoteProduct ? selection.product?.name || null : null,
        weights: selectedObject.topicWeights,
        topics: payload.topics ?? [],
        generatedAt: payload.generatedAt,
        hotspotStatus: payload.hotspotStatus,
        hotspotMessage: payload.hotspotMessage,
        warnings: payload.warnings ?? [],
      };
      setTopicGroups((current) => [nextGroup, ...current.filter((group) => group.key !== requestKey)]);
      setProductionRecords((current) => [{
        id: crypto.randomUUID(), kind: "topics", objectId: nextGroup.objectId,
        objectName: nextGroup.objectName, productName: nextGroup.productName,
        createdAt: nextGroup.generatedAt, topicGroup: nextGroup, images: [],
      }, ...current]);
      chooseWorkflowStep(2, "replace");
    } catch (caught) {
      setTopicError(readApiError(caught, "选题生成失败。"));
    } finally {
      setIsGeneratingTopics(false);
    }
  }

  function toggleFavorite(topic: GeneratedTopic) {
    const scopedTopic = { ...topic, id: `${selectedObject?.id || "object"}-${topic.id}` };
    setFavorites((current) => (current.some((item) => item.id === scopedTopic.id) ? current.filter((item) => item.id !== scopedTopic.id) : [scopedTopic, ...current]));
  }

  function startBrief(topic: GeneratedTopic) {
    setSelectedTopicId(topic.id);
    localStorage.setItem("ideact:selectedTopicId", topic.id);
    const key = buildBriefKey(selectedObject?.id || "", topic.id, selection.promoteProduct ? selection.product?.id || null : null);
    const existing = briefs.find((brief) => brief.key === key);
    if (!existing && selectedObject) {
      setBriefs((current) => [
        createBriefDraft(key, selectedObject, selection, topic),
        ...current,
      ]);
    }
    localStorage.setItem("ideact:creativeBriefContext", JSON.stringify({ object: selectedObject, selection, topic, generatedAt: currentTopicGroup?.generatedAt, hotspotStatus: currentTopicGroup?.hotspotStatus }));
    chooseWorkflowStep(3);
  }

  function updateBrief(nextBrief: CreativeBrief) {
    setBriefs((current) => current.some((brief) => brief.key === nextBrief.key) ? current.map((brief) => brief.key === nextBrief.key ? nextBrief : brief) : [nextBrief, ...current]);
  }

  async function generateCopyFromBrief(brief: CreativeBrief) {
    if (!selectedObject || !selectedTopic || isGeneratingCopy) return;
    if (!modelStatus?.text.configured) {
      setCopyError({ message: "文字模型尚未配置，暂时不能生成渠道文案。", suggestions: ["请在服务端 .env 中填写 DASHSCOPE_API_KEY 并重启 API 服务。"] });
      return;
    }
    const requestKey = buildCopyResultKey(selectedObject.id, selectedTopic.id, brief.key, brief.useProduct ? brief.product?.id || null : null, brief.channels);
    activeCopyRequestKey.current = requestKey;
    const confirmed = { ...brief, confirmed: true };
    updateBrief(confirmed);
    localStorage.setItem("ideact:textGenerationContext", JSON.stringify({ object: selectedObject, topic: selectedTopic, brief: confirmed }));
    setIsGeneratingCopy(true);
    setCopyError(null);
    try {
      const response = await fetch("/api/social/copy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { object: selectedObject, topic: selectedTopic, brief: confirmed } }),
      });
      const payload = await response.json();
      if (!response.ok) throw payload;
      if (activeCopyRequestKey.current !== requestKey) return;
      const nextResult: CopywritingResult = {
        key: requestKey,
        objectId: selectedObject.id,
        topicId: selectedTopic.id,
        briefKey: brief.key,
        productId: confirmed.useProduct ? confirmed.product?.id || null : null,
        channels: confirmed.channels as CopyChannel[],
        copies: payload.copies ?? [],
        generatedAt: payload.generatedAt,
        elapsedMs: payload.elapsedMs,
        retrievalMs: payload.retrievalMs,
        knowledgeBaseName: payload.knowledgeBaseName,
      };
      setCopyResults((current) => [nextResult, ...current.filter((item) => item.key !== requestKey)]);
      setProductionRecords((current) => [{
        id: crypto.randomUUID(), kind: "content", objectId: selectedObject.id,
        objectName: selectedObject.name, productName: confirmed.useProduct ? confirmed.product?.name || null : null,
        createdAt: nextResult.generatedAt, topic: selectedTopic, brief: confirmed,
        copy: nextResult, images: [],
      }, ...current]);
      setActiveCopyKey(requestKey);
      setActiveCopyChannel(nextResult.channels[0] || "小红书");
      chooseWorkflowStep(4);
    } catch (caught) {
      setCopyError(readApiError(caught, "文字内容生成失败。"));
    } finally {
      setIsGeneratingCopy(false);
    }
  }

  async function generateVisualDirections() {
    if (!selectedObject || !selectedTopic || !currentBrief || !currentCopyResult || isGeneratingDirections) return;
    if (!modelStatus?.text.configured) {
      setDirectionError({ message: "文字模型尚未配置，暂时不能生成视觉方向。", suggestions: ["请在服务端 .env 中填写 DASHSCOPE_API_KEY 并重启 API 服务。"] });
      return;
    }
    setIsGeneratingDirections(true);
    setDirectionError(null);
    try {
      const response = await fetch("/api/social/images/directions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { object: selectedObject, topic: selectedTopic, brief: currentBrief }, copies: currentCopyResult.copies }),
      });
      const payload = await response.json();
      if (!response.ok) throw payload;
      const directions = payload.directions ?? [];
      setVisualDirections((current) => ({ ...current, [currentCopyResult.key]: directions }));
      if (directions[0]) {
        setSelectedDirectionId(directions[0].id);
        setImagePrompts((current) => ({ ...current, [currentCopyResult.key]: directions[0].prompt }));
      }
    } catch (caught) {
      setDirectionError(readApiError(caught, "视觉方向生成失败。"));
    } finally {
      setIsGeneratingDirections(false);
    }
  }

  async function generateImagesFromCopy(copy: ChannelCopy, prompt: string, sizes: ImageSizeOption[], directionName: string, count: number) {
    if (!selectedObject || !selectedTopic || !currentBrief || !activeCopyKey || generatingImageKey || sizes.length === 0) return;
    if (!modelStatus?.image.configured) {
      setImageError({ message: "图片模型尚未配置，暂时不能生成图片。", suggestions: ["请在服务端 .env 中填写 DASHSCOPE_API_KEY 并重启 API 服务。"] });
      return;
    }
    const total = Math.max(1, Math.min(9, count));
    const batchId = crypto.randomUUID();
    const requests = Array.from({ length: total }, (_, index) => ({ index, size: sizes[index % sizes.length] }));
    const recordCopy = currentCopyResult;
    let cursor = 0;
    let completed = 0;
    const failures: string[] = [];
    setGeneratingImageKey(batchId);
    setImageBatchProgress({ completed: 0, failed: 0, total });
    setImageError(null);
    try {
      const worker = async () => {
        while (cursor < requests.length) {
          const request = requests[cursor];
          cursor += 1;
          try {
            const response = await fetch("/api/social/images/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                context: { object: selectedObject, topic: selectedTopic, brief: currentBrief },
                copy,
                prompt,
                directionName,
                size: imageSizeToPixels(request.size),
              }),
            });
            const payload = await response.json();
            if (!response.ok) throw payload;
            const imageKey = buildImageResultKey(activeCopyKey, copy.channel, request.size, `${batchId}-${request.index + 1}`);
            const nextResult: SocialImageResult = {
              key: imageKey,
              copyKey: activeCopyKey,
              channel: copy.channel,
              generatedAt: payload.generatedAt,
              taskId: payload.taskId,
              elapsedMs: payload.elapsedMs,
              prompt,
              directionName,
              size: request.size,
              model: imageModelId || "qwen-image-plus",
              images: payload.images ?? [],
            };
            setImageResults((current) => [nextResult, ...current]);
            if (recordCopy) setProductionRecords((current) => appendImageToRecord(current, recordCopy.key, recordCopy.generatedAt, nextResult));
          } catch (caught) {
            failures.push(readApiError(caught, `第 ${request.index + 1} 张图片生成失败。`).message);
          } finally {
            completed += 1;
            setImageBatchProgress({ completed, failed: failures.length, total });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
      if (failures.length > 0) {
        setImageError({
          message: `${total} 张图片中有 ${failures.length} 张生成失败，已保留其余成功图片。`,
          suggestions: [failures[0], "如需补齐，请手动再次生成；系统不会自动重试扣费。"],
        });
      }
    } finally {
      setGeneratingImageKey("");
    }
  }

  return (
    <section className="social-layout" aria-label="社媒内容选择创作对象">
      <main className="social-main">
        <WorkflowOutline
          activeStep={activeWorkflowStep}
          completedSteps={{
            1: stepOneComplete,
            2: Boolean(selectedTopic && currentBrief),
            3: Boolean(currentCopyResult),
            4: stepFourComplete,
            5: imageResults.some((item) => item.copyKey === activeCopyKey),
          }}
          availableSteps={{
            1: true,
            2: stepOneComplete,
            3: Boolean(selectedTopic && currentBrief),
            4: Boolean(currentCopyResult),
            5: stepFourComplete,
          }}
          onStepChange={(step) => chooseWorkflowStep(step)}
        />

        <ModelStatusPanel status={modelStatus} state={modelStatusState} />

        {workspaceSaveError && <div className="model-status-panel is-error" role="alert">
          <AlertTriangle size={18} />
          <div><strong>内容自动保存失败</strong><p>{workspaceSaveError} 当前页面内容仍保留在本机，请确认 API 服务正常后继续编辑。</p></div>
        </div>}

        {activeWorkflowStep === 1 && (
          <>
            <div className="panel-heading social-heading">
              <div>
                <h2>社媒内容 · 选择创作对象</h2>
                <p>先确定这次代表谁发声，再进入后续选题与内容生成。</p>
              </div>
              <button className="secondary-button" type="button" onClick={() => setEditingObject(createEmptyUserObject())}>
                <Plus size={16} /> 新建对象
              </button>
            </div>

            {objectNotice && <div className="inline-success" role="status"><CheckCircle2 size={16} />{objectNotice}</div>}

            <div className="object-grid">
              {objects.map((object) => (
                <CreationObjectCard
                  key={object.id}
                  object={object}
                  selected={object.id === selectedObject?.id}
                  onSelect={() => chooseObject(object)}
                  onEdit={() => setEditingObject(object)}
                  onDelete={!object.builtIn ? () => deleteObject(object.id) : undefined}
                />
              ))}
            </div>

            {selectedObject ? (
              <section className="product-picker" aria-labelledby="product-picker-title">
                <div className="panel-heading">
                  <div>
                    <h2 id="product-picker-title">本次重点推广产品（可选）</h2>
                    <p>只读取“{selectedObject.name}”关联的 {selectedObject.knowledgeBaseName}，更换对象会清除旧产品。</p>
                  </div>
                  <button className="small-icon-button" type="button" aria-label="重新读取产品" onClick={() => loadProducts(selectedObject)}>
                    <RefreshCw size={15} />
                  </button>
                </div>

                <button className={`no-product-option${!selection.promoteProduct ? " is-selected" : ""}`} type="button" onClick={chooseNoProduct}>
                  <CheckCircle2 size={17} />
                  <span>
                    <strong>不指定具体产品</strong>
                    <small>按品牌或账号日常内容生成</small>
                  </span>
                </button>

                <label className="search-field">
                  <Search size={16} />
                  <input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="搜索商品名称，支持模糊匹配" />
                </label>

                {productState === "loading" && <StateBlock icon={Loader2} title="正在读取关联知识库产品" text="仅查询当前创作对象绑定的知识库。" tone="loading" />}
                {productState === "error" && productError && <ErrorBlock message={productError.message} suggestions={productError.suggestions} actionLabel="重试读取产品" onAction={() => loadProducts(selectedObject)} />}
                {productState === "empty" && <StateBlock icon={PackageSearch} title="没有识别到可选产品" text="可以先选择不指定具体产品，或在知识库中补充包含“商品名称”的资料。" tone="empty" />}
                {productState === "success" && (
                  <div className="product-list">
                    {filteredProducts.length === 0 ? (
                      <p className="muted-text">没有匹配的商品名称，请换一个关键词。</p>
                    ) : (
                      filteredProducts.map((product) => (
                        <button className={`product-option${selection.product?.id === product.id ? " is-selected" : ""}`} key={product.id} type="button" onClick={() => chooseProduct(product)}>
                          <PackageSearch size={16} />
                          <span>{product.name}</span>
                          <small>{product.sourceNumber ? `来源 [${product.sourceNumber}]` : selectedObject.knowledgeBaseName}</small>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </section>
            ) : (
              <StateBlock icon={AlertTriangle} title="暂无创作对象" text="请先新建一个创作对象。" tone="warning" />
            )}

            <StepAdvanceBar
              title={stepOneComplete ? "第 1 步已完成" : "确认本次创作配置"}
              text={selectedObject ? `创作对象：${selectedObject.name} · ${selection.promoteProduct && selection.product ? `推广产品：${selection.product.name}` : "不指定具体产品"}` : "请选择或新建一个创作对象。"}
              actionLabel="确认配置，进入生成选题"
              onAction={confirmStepOne}
              ready={Boolean(selectedObject && (!selection.promoteProduct || selection.product))}
              blockedText="请选择创作对象，并确认是否推广具体产品。"
            />
          </>
        )}

        {activeWorkflowStep === 2 && selectedObject && (
          <TopicGeneratorPanel
            object={selectedObject}
            selection={selection}
            group={currentTopicGroup}
            favorites={favorites}
            isGenerating={isGeneratingTopics}
            error={topicError}
            onGenerate={() => generateTopics(false)}
            onRegenerate={() => generateTopics(true)}
            onToggleFavorite={toggleFavorite}
            onStart={startBrief}
            selectedTopicId={selectedTopicId}
            disabledReason={textGenerationDisabledReason}
          />
        )}
        {activeWorkflowStep === 2 && !selectedObject && <StateBlock icon={AlertTriangle} title="请先选择创作对象" text="第 2 步生成选题需要先完成第 1 步。" tone="warning" />}

        {activeWorkflowStep === 3 && selectedObject && selectedTopic && currentBrief && (
          <CreativeBriefPanel
            object={selectedObject}
            topic={selectedTopic}
            brief={currentBrief}
            products={products}
            productState={productState}
            productError={productError}
            onBriefChange={updateBrief}
            onGenerateCopy={generateCopyFromBrief}
            isGeneratingCopy={isGeneratingCopy}
            copyError={copyError}
            onBack={() => {
              setSelectedTopicId("");
              localStorage.removeItem("ideact:selectedTopicId");
              chooseWorkflowStep(2);
            }}
            onReloadProducts={() => loadProducts(selectedObject)}
            generationDisabledReason={textGenerationDisabledReason}
          />
        )}
        {activeWorkflowStep === 3 && (!selectedObject || !selectedTopic || !currentBrief) && <StateBlock icon={FileText} title="请先选择一个选题" text="第 3 步创作简报需要从选题卡点击“开始创作”。" tone="empty" />}

        {(activeWorkflowStep === 4 || activeWorkflowStep === 5) && selectedObject && selectedTopic && currentCopyResult && (
          <CopyFinalizationPanel
            object={selectedObject}
            topic={selectedTopic}
            result={currentCopyResult}
            showImageProduction={activeWorkflowStep === 5}
            activeChannel={activeCopyChannel}
            imageResults={imageResults}
            imageModels={imageModels}
            visualDirections={currentVisualDirections}
            promptDraft={imagePrompts[currentCopyResult.key] || ""}
            selectedDirectionId={selectedDirectionId}
            selectedImageSizes={selectedImageSizes}
            imageModelId={imageModelId}
            isGeneratingDirections={isGeneratingDirections}
            directionError={directionError}
            generatingImageKey={generatingImageKey}
            imageBatchProgress={imageBatchProgress}
            imageError={imageError}
            onChannelChange={setActiveCopyChannel}
            onGenerateDirections={generateVisualDirections}
            onSelectDirection={(direction) => {
              if (imagePrompts[currentCopyResult.key] && imagePrompts[currentCopyResult.key] !== direction.prompt && !window.confirm("切换视觉方向会替换当前Prompt，是否继续？")) return;
              setSelectedDirectionId(direction.id);
              setImagePrompts((current) => ({ ...current, [currentCopyResult.key]: direction.prompt }));
            }}
            onPromptChange={(prompt) => setImagePrompts((current) => ({ ...current, [currentCopyResult.key]: prompt }))}
            onSizesChange={setSelectedImageSizes}
            onModelChange={setImageModelId}
            onGenerateImage={generateImagesFromCopy}
            textModelConfigured={Boolean(modelStatus?.text.configured)}
            onContinueToImages={confirmCopyAndContinue}
            onBackToBrief={() => {
              setActiveCopyKey("");
              localStorage.removeItem("ideact:activeCopyKey");
              chooseWorkflowStep(3);
            }}
          />
        )}
        {activeWorkflowStep === 4 && (!selectedObject || !selectedTopic || !currentCopyResult) && <StateBlock icon={FileText} title="还没有文字定稿" text="请先在第 3 步创作简报中生成所选渠道文字内容。" tone="empty" />}
        {activeWorkflowStep === 5 && (!selectedObject || !selectedTopic || !currentCopyResult) && <StateBlock icon={Sparkles} title="还不能制作图片" text="图片制作需要先完成第 4 步文字定稿，并读取最终渠道文案。" tone="empty" />}

        <ProductionRecordsPanel records={productionRecords} onDelete={(record) => {
          const label = record.topic?.title || `${record.objectName}${record.kind === "topics" ? "选题" : "内容"}`;
          if (!window.confirm(`将删除创作记录“${label}”，删除后无法恢复。是否继续？`)) return;
          setProductionRecords((current) => deleteProductionRecord(current, record.id));
        }} />
      </main>

      <aside className="social-side">
        <div className="panel-heading">
          <div>
            <h2>当前选择</h2>
            <p>下一步生成选题会读取这些信息</p>
          </div>
          <button className="small-icon-button" type="button" aria-label="编辑当前创作对象" onClick={() => selectedObject && setEditingObject(selectedObject)} disabled={!selectedObject}>
            <Settings2 size={15} />
          </button>
        </div>
        {selectedObject && (
          <>
            <InfoRow label="创作对象" value={selectedObject.name} />
            <InfoRow label="对象类型" value={objectTypeLabels[selectedObject.type]} />
            <InfoRow label="关联知识库" value={selectedObject.knowledgeBaseName} />
            <InfoRow label="推广产品" value={selection.promoteProduct && selection.product ? selection.product.name : "不指定具体产品"} />
            <InfoRow label="已保存选题" value={currentTopicGroup ? `${currentTopicGroup.topics.length} 个` : "未生成"} />
            <div className="detail-block">
              <strong>定位</strong>
              <p>{selectedObject.positioning}</p>
            </div>
            <div className="detail-block">
              <strong>内容风格</strong>
              <p>{selectedObject.contentStyle}</p>
            </div>
            <div className="weights-list">
              {Object.entries(selectedObject.topicWeights).map(([key, value]) => (
                <div className="weight-row" key={key}>
                  <span>{weightLabel(key)}</span>
                  <meter min="0" max="100" value={value} />
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </>
        )}

        <button className="secondary-button full-width" type="button" onClick={() => setShowFavorites((value) => !value)}>
          <Star size={16} /> 我的收藏（{favorites.length}）
        </button>
        {showFavorites && (
          <div className="favorite-list">
            {favorites.length === 0 ? <p className="muted-text">还没有收藏选题。</p> : favorites.map((topic) => <p key={topic.id}>{topic.title}</p>)}
          </div>
        )}
      </aside>

      {editingObject && (
        <ObjectEditor
          object={editingObject}
          knowledgeBases={creationObjectBases}
          knowledgeBasesState={creationObjectBasesState}
          onCancel={() => setEditingObject(null)}
          onSave={saveObject}
        />
      )}
    </section>
  );
}

function CreationObjectCard({ object, selected, onSelect, onEdit, onDelete }: { object: CreationObject; selected: boolean; onSelect: () => void; onEdit: () => void; onDelete?: () => void }) {
  return (
    <article className={`object-card${selected ? " is-selected" : ""}`}>
      <button className="object-card-main" type="button" onClick={onSelect} aria-pressed={selected}>
        <span className="object-card-top">
          <strong>{object.name}</strong>
          <span>{objectTypeLabels[object.type]}</span>
        </span>
        <p>{object.positioning}</p>
        <p><b>风格：</b>{object.contentStyle}</p>
        <p><b>知识库：</b>{object.knowledgeBaseName}</p>
        {selected && <span className="selected-note"><CheckCircle2 size={15} /> 当前选中</span>}
      </button>
      <div className="object-actions">
        <button className="small-icon-button" type="button" aria-label={`编辑 ${object.name}`} onClick={onEdit}><Edit3 size={14} /></button>
        {onDelete && <button className="small-icon-button danger" type="button" aria-label={`删除 ${object.name}`} onClick={onDelete}><Trash2 size={14} /></button>}
      </div>
    </article>
  );
}

function WorkflowOutline({ activeStep, completedSteps, availableSteps, onStepChange }: {
  activeStep: WorkflowStepNumber;
  completedSteps: Record<number, boolean>;
  availableSteps: Record<number, boolean>;
  onStepChange: (step: WorkflowStepNumber) => void;
}) {
  const steps = [
    { number: 1, title: "选择创作对象", text: "确定这次为谁发声" },
    { number: 2, title: "生成选题", text: "产出可收藏的内容方向" },
    { number: 3, title: "创作简报", text: "确认观点、风格和渠道" },
    { number: 4, title: "文字定稿", text: "生成各平台首版文案" },
    { number: 5, title: "图片制作", text: "生成视觉方向和配图" },
  ];

  return (
    <section className="workflow-outline" aria-label="社媒内容生产流程">
      <div className="workflow-heading">
        <h2>社媒内容生产流程</h2>
        <p>按 1-5 顺序完成，从创作对象一路流转到图片制作。</p>
      </div>
      <div className="workflow-track" role="tablist" aria-label="社媒内容生产步骤">
        {steps.map((step, index) => {
          const isActive = step.number === activeStep;
          const isDone = completedSteps[step.number];
          const isAvailable = availableSteps[step.number] || isActive;
          const statusLabel = isDone ? "已完成" : isActive ? "进行中" : isAvailable ? "待开始" : "未解锁";
          return (
            <React.Fragment key={step.number}>
              <button
                className={`workflow-step${isActive ? " is-active" : ""}${isDone ? " is-done" : ""}${!isAvailable ? " is-locked" : ""}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-disabled={!isAvailable}
                disabled={!isAvailable}
                onClick={() => onStepChange(step.number as WorkflowStepNumber)}
              >
                <span className="workflow-step-number">{step.number}</span>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
                <span className="workflow-step-status">
                  {isDone ? <CheckCircle2 size={13} /> : !isAvailable ? <LockKeyhole size={13} /> : null}
                  {statusLabel}
                </span>
              </button>
              {index < steps.length - 1 && <div className="workflow-arrow" aria-hidden="true">→</div>}
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
}

function StepAdvanceBar({ title, text, actionLabel, onAction, ready = true, blockedText }: {
  title: string;
  text: string;
  actionLabel: string;
  onAction: () => void;
  ready?: boolean;
  blockedText?: string;
}) {
  return (
    <section className={`step-advance-bar${ready ? " is-ready" : ""}`} aria-label="下一步操作">
      <div>
        <span>下一步</span>
        <strong>{title}</strong>
        <p>{ready ? text : blockedText || text}</p>
      </div>
      <button className="primary-button" type="button" onClick={onAction} disabled={!ready}>
        {actionLabel} <ArrowRight size={16} />
      </button>
    </section>
  );
}

function ModelStatusPanel({ status, state }: { status: ModelConfigurationStatus | null; state: "loading" | "ready" | "error" }) {
  if (state === "loading") return <div className="model-status-panel is-loading" role="status"><Loader2 className="spin" size={16} /> 正在检查内容模型配置</div>;
  if (state === "error" || !status) return <div className="model-status-panel is-error" role="alert"><AlertTriangle size={16} /><span><strong>模型配置状态读取失败</strong>请确认本地 API 服务已经启动后刷新页面。</span></div>;
  const ready = status.text.configured && status.image.configured;
  return (
    <div className={`model-status-panel${ready ? " is-ready" : " is-warning"}`} role="status">
      {ready ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      <span>
        <strong>{ready ? "内容模型已就绪" : "部分内容模型未配置"}</strong>
        文字模型 {status.text.configured ? `已配置（${status.text.model}）` : "未配置"} · 图片模型 {status.image.configured ? `已配置（${status.image.model}）` : "未配置"}。
        {!ready && " 请在服务端 .env 中填写 DASHSCOPE_API_KEY 并重启 API 服务。"}
      </span>
    </div>
  );
}

function ObjectEditor({ object, knowledgeBases, knowledgeBasesState, onSave, onCancel }: {
  object: CreationObject;
  knowledgeBases: KnowledgeBase[];
  knowledgeBasesState: "loading" | "ready" | "error";
  onSave: (object: CreationObject) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(object);
  const [styleSamplesText, setStyleSamplesText] = useState(object.styleSamples.join("\n"));
  const [bannedExpressionsText, setBannedExpressionsText] = useState(object.bannedExpressions.join("、"));
  const [errors, setErrors] = useState<ReturnType<typeof validateCreationObject>>({});
  const updateWeight = (key: keyof CreationObject["topicWeights"], value: string) => {
    setDraft((current) => ({ ...current, topicWeights: { ...current.topicWeights, [key]: Math.max(0, Math.min(100, Number(value) || 0)) } }));
  };
  const knowledgeBaseOptions = knowledgeBases.some((base) => base.id === draft.knowledgeBaseId)
    ? knowledgeBases
    : [{ id: draft.knowledgeBaseId, name: draft.knowledgeBaseName, status: "configured" as const, endpoint: "", regionId: "" }, ...knowledgeBases].filter((base) => base.id);
  const totalWeight = Object.values(draft.topicWeights).reduce((sum, value) => sum + value, 0);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = {
      ...draft,
      styleSamples: styleSamplesText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      bannedExpressions: bannedExpressionsText.split(/[、,，\r\n]+/).map((item) => item.trim()).filter(Boolean),
    };
    const nextErrors = validateCreationObject(next);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSave(next);
  }

  return (
    <div className="object-editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="object-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="object-editor-title">
        <div className="object-editor-heading">
          <div><span>创作对象管理</span><h2 id="object-editor-title">{object.name ? "编辑创作对象" : "新建创作对象"}</h2></div>
          <button className="small-icon-button" type="button" aria-label="关闭编辑器" onClick={onCancel}><X size={17} /></button>
        </div>
        <form className="object-editor" onSubmit={submit} noValidate>
          <label>对象名称 <b>*</b><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-invalid={Boolean(errors.name)} />{errors.name && <small className="field-error">{errors.name}</small>}</label>
          <label>对象类型 <b>*</b><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as CreationObject["type"] })}>{Object.entries(objectTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>定位 <b>*</b><textarea value={draft.positioning} onChange={(event) => setDraft({ ...draft, positioning: event.target.value })} rows={3} aria-invalid={Boolean(errors.positioning)} />{errors.positioning && <small className="field-error">{errors.positioning}</small>}</label>
          <label>内容风格 <b>*</b><textarea value={draft.contentStyle} onChange={(event) => setDraft({ ...draft, contentStyle: event.target.value })} rows={3} aria-invalid={Boolean(errors.contentStyle)} />{errors.contentStyle && <small className="field-error">{errors.contentStyle}</small>}</label>
          <label>关联知识库 <b>*</b>
            <select value={draft.knowledgeBaseId} disabled={knowledgeBasesState === "loading"} onChange={(event) => {
              const base = knowledgeBaseOptions.find((item) => item.id === event.target.value);
              setDraft({ ...draft, knowledgeBaseId: event.target.value, knowledgeBaseName: base?.name || event.target.value });
            }} aria-invalid={Boolean(errors.knowledgeBaseId)}>
              <option value="">请选择知识库</option>
              {knowledgeBaseOptions.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}
            </select>
            {knowledgeBasesState === "loading" && <small>正在读取已配置知识库…</small>}
            {knowledgeBasesState === "error" && <small className="field-error">知识库列表读取失败，已保留当前关联；请检查服务后再重试。</small>}
            {errors.knowledgeBaseId && <small className="field-error">{errors.knowledgeBaseId}</small>}
          </label>
          <label>认可的风格样本<textarea value={styleSamplesText} onChange={(event) => setStyleSamplesText(event.target.value)} rows={3} placeholder="每行一条，仅用于学习表达风格" /></label>
          <label>禁止使用的表达<textarea value={bannedExpressionsText} onChange={(event) => setBannedExpressionsText(event.target.value)} rows={2} placeholder="使用顿号、逗号或换行分隔" /></label>
          <fieldset className="editor-weight-fieldset">
            <legend>选题五项权重 <span className={totalWeight === 100 ? "weight-total is-valid" : "weight-total"}>合计 {totalWeight}</span></legend>
            <div className="editor-weights">
              {Object.entries(draft.topicWeights).map(([key, value]) => (
                <label key={key}>{weightLabel(key)}<input type="number" min="0" max="100" value={value} onChange={(event) => updateWeight(key as keyof CreationObject["topicWeights"], event.target.value)} /></label>
              ))}
            </div>
            {errors.topicWeights && <small className="field-error">{errors.topicWeights}</small>}
          </fieldset>
          <div className="question-actions object-editor-actions">
            <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
            <button className="primary-button" type="submit"><Save size={16} /> 保存对象</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function TopicGeneratorPanel({
  object,
  selection,
  group,
  favorites,
  isGenerating,
  error,
  onGenerate,
  onRegenerate,
  onToggleFavorite,
  onStart,
  selectedTopicId,
  disabledReason,
}: {
  object: CreationObject;
  selection: CreationSelection;
  group?: TopicGroup;
  favorites: GeneratedTopic[];
  isGenerating: boolean;
  error: { message: string; suggestions: string[] } | null;
  onGenerate: () => void;
  onRegenerate: () => void;
  onToggleFavorite: (topic: GeneratedTopic) => void;
  onStart: (topic: GeneratedTopic) => void;
  selectedTopicId: string;
  disabledReason?: string;
}) {
  return (
    <section className="topic-panel" aria-labelledby="topic-panel-title">
      <div className="panel-heading social-heading">
        <div>
          <h2 id="topic-panel-title">生成选题</h2>
          <p>{object.name} · {selection.promoteProduct && selection.product ? selection.product.name : "不指定具体产品"}</p>
        </div>
        <div className="topic-actions">
          {group ? (
            <button className="primary-button" type="button" onClick={onRegenerate} disabled={isGenerating || Boolean(disabledReason)} title={disabledReason}>
              {isGenerating ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} 重新生成
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={onGenerate} disabled={isGenerating || Boolean(disabledReason)} title={disabledReason}>
              {isGenerating ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />} 生成选题
            </button>
          )}
        </div>
      </div>

      {disabledReason && <div className="inline-error" role="alert"><AlertTriangle size={16} /><span>{disabledReason}。请检查服务端模型配置后刷新页面。</span></div>}

      <div className="weights-inline">
        {Object.entries(object.topicWeights).map(([key, value]) => <span key={key}>{weightLabel(key)} {value}</span>)}
      </div>

      {isGenerating && <StateBlock icon={Loader2} title="正在生成选题" text="正在读取当前对象、商品选择、知识库资料和热点状态，请勿重复提交。" tone="loading" />}
      {error && <ErrorBlock message={error.message} suggestions={error.suggestions} actionLabel="重试生成" onAction={onRegenerate} />}
      {!group && !isGenerating && !error && <StateBlock icon={Sparkles} title="还没有匹配当前条件的选题" text="点击生成选题后，结果会按当前对象、产品和权重保存；刷新不会自动重新生成。" tone="empty" />}

      {group && (
        <>
          <div className="topic-summary">
            <span>生成时间：{formatTime(group.generatedAt)}</span>
            <span>热点状态：{hotspotLabel(group.hotspotStatus)}</span>
            {group.hotspotMessage && <span>{group.hotspotMessage}</span>}
          </div>
          {group.warnings.map((warning) => <div className="inline-error" key={warning}><AlertTriangle size={16} /><span>{warning}</span></div>)}
          <div className="topic-list">
            {group.topics.map((topic) => (
              <TopicCard
                key={topic.id}
                topic={topic}
                selected={selectedTopicId === topic.id}
                favorite={favorites.some((item) => item.id.endsWith(topic.id))}
                onFavorite={() => onToggleFavorite(topic)}
                onStart={() => onStart(topic)}
              />
            ))}
          </div>
          <div className="step-next-hint"><ArrowRight size={16} /><span>下一步：选择一个选题，点击卡片上的“开始创作”进入创作简报。</span></div>
        </>
      )}
    </section>
  );
}

function TopicCard({ topic, selected, favorite, onFavorite, onStart }: { topic: GeneratedTopic; selected: boolean; favorite: boolean; onFavorite: () => void; onStart: () => void }) {
  const [open, setOpen] = useState(false);
  const needsReview = topic.hotspotEvidence?.expiresAt ? new Date(topic.hotspotEvidence.expiresAt).getTime() < Date.now() : false;
  return (
    <article className={`topic-card${selected ? " is-selected" : ""}`}>
      <div className="topic-card-head">
        <span className="direction-pill">{topic.direction}</span>
        <span className="topic-score">评分 {topic.score}</span>
      </div>
      <h3>{topic.title}</h3>
      <p>{topic.reason}</p>
      <div className="topic-meta">
        <span>{topic.relatedProduct ? `关联产品：${topic.productName || "已指定产品"}` : "不绑定具体产品"}</span>
        {needsReview && <span className="review-needed">时效需复核</span>}
      </div>
      {topic.hotspotEvidence && (
        <div className="hotspot-box">
          <button className="reference-toggle" type="button" onClick={() => setOpen((value) => !value)}>
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />} 热点依据
          </button>
          {open && (
            <div className="hotspot-detail">
              <strong>{topic.hotspotEvidence.title}</strong>
              <p>{topic.hotspotEvidence.summary}</p>
              <p>{topic.hotspotEvidence.relationReason}</p>
              <small>{topic.hotspotEvidence.source} · 事件时间 {topic.hotspotEvidence.eventTime || "无"} · 抓取时间 {topic.hotspotEvidence.fetchedAt || "无"}</small>
              {topic.hotspotEvidence.url && <a href={topic.hotspotEvidence.url} target="_blank" rel="noreferrer">打开来源</a>}
            </div>
          )}
        </div>
      )}
      <div className="topic-card-actions">
        <button className="secondary-button" type="button" onClick={onFavorite}><Star size={16} /> {favorite ? "取消收藏" : "收藏"}</button>
        <button className="primary-button" type="button" onClick={onStart}>开始创作</button>
      </div>
    </article>
  );
}

function CreativeBriefPanel({
  object,
  topic,
  brief,
  products,
  productState,
  productError,
  onBriefChange,
  onGenerateCopy,
  isGeneratingCopy,
  copyError,
  onBack,
  onReloadProducts,
  generationDisabledReason,
}: {
  object: CreationObject;
  topic: GeneratedTopic;
  brief: CreativeBrief;
  products: ProductOption[];
  productState: "idle" | "loading" | "success" | "empty" | "error";
  productError: { message: string; suggestions: string[] } | null;
  onBriefChange: (brief: CreativeBrief) => void;
  onGenerateCopy: (brief: CreativeBrief) => void;
  isGeneratingCopy: boolean;
  copyError: { message: string; suggestions: string[] } | null;
  onBack: () => void;
  onReloadProducts: () => void;
  generationDisabledReason?: string;
}) {
  const [productSearch, setProductSearch] = useState("");
  const filteredProducts = products.filter((product) => fuzzyMatchProduct(product, productSearch));
  const canContinue = canConfirmBrief(brief);

  function patchBrief(patch: Partial<CreativeBrief>) {
    onBriefChange({ ...brief, ...patch, confirmed: patch.confirmed ?? false });
  }

  function toggleStyle(style: string) {
    patchBrief({ styles: brief.styles.includes(style) ? brief.styles.filter((item) => item !== style) : [...brief.styles, style] });
  }

  function toggleChannel(channel: string) {
    patchBrief({ channels: brief.channels.includes(channel) ? brief.channels.filter((item) => item !== channel) : [...brief.channels, channel] });
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const nextFiles = [...fileList].map((file) => ({ id: `${Date.now()}-${file.name}`, name: file.name, type: file.type || file.name.split(".").pop() || "未知类型", status: "已关联" as const }));
    patchBrief({ files: [...brief.files, ...nextFiles] });
  }

  return (
    <section className="brief-panel" aria-labelledby="brief-title">
      <div className="panel-heading social-heading">
        <div>
          <h2 id="brief-title">创作简报</h2>
          <p>{object.name} · {topic.title}</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBack}>返回选题池</button>
      </div>

      <div className="brief-overview">
        <InfoRow label="当前创作对象" value={object.name} />
        <InfoRow label="已选择选题" value={topic.title} />
        <InfoRow label="选题产品关系" value={topic.relatedProduct ? `关联 ${topic.productName || "具体产品"}` : "不要求绑定产品"} />
      </div>

      <div className="brief-grid">
        <section className="brief-section">
          <h3>创作要求</h3>
          <label className="brief-field">
            我的观点与内容要求
            <textarea value={brief.viewpoint} onChange={(event) => patchBrief({ viewpoint: event.target.value })} rows={7} />
          </label>

          <div className="brief-block">
            <strong>表达风格</strong>
            <div className="choice-list">
              {styleOptions.map((style) => <button className={`choice-chip${brief.styles.includes(style) ? " is-selected" : ""}`} type="button" key={style} onClick={() => toggleStyle(style)}>{style}</button>)}
            </div>
            <p className="muted-text">默认参考对象风格：{object.contentStyle}</p>
          </div>

          <div className="brief-block">
            <strong>发布渠道</strong>
            <div className="choice-list">
              {channelOptions.map((channel) => <button className={`choice-chip${brief.channels.includes(channel) ? " is-selected" : ""}`} type="button" key={channel} onClick={() => toggleChannel(channel)}>{channel}</button>)}
            </div>
            {brief.channels.length === 0 && <p className="field-warning">至少选择一个渠道后才能进入文字生成。</p>}
          </div>
        </section>

        <section className="brief-section">
          <h3>创作资料</h3>
          <InfoRow label="关联知识库" value={object.knowledgeBaseName} />
          <div className="brief-block">
            <strong>本次推广产品</strong>
            <button className={`no-product-option${!brief.useProduct ? " is-selected" : ""}`} type="button" onClick={() => patchBrief({ useProduct: false, product: null })}>
              <CheckCircle2 size={17} />
              <span><strong>不植入具体产品</strong><small>后续文字生成不得擅自重新关联商品</small></span>
            </button>
            <label className="search-field">
              <Search size={16} />
              <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="从当前知识库搜索商品" />
            </label>
            {productState === "loading" && <StateBlock icon={Loader2} title="正在读取商品" tone="loading" />}
            {productState === "error" && productError && <ErrorBlock message={productError.message} suggestions={productError.suggestions} actionLabel="重试读取商品" onAction={onReloadProducts} />}
            {productState === "success" && (
              <div className="product-list compact">
                {filteredProducts.map((product) => (
                  <button className={`product-option${brief.product?.id === product.id ? " is-selected" : ""}`} key={product.id} type="button" onClick={() => isProductAllowedForObject(product, object) && patchBrief({ useProduct: true, product })}>
                    <PackageSearch size={16} /><span>{product.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="brief-block">
            <strong>补充资料上传</strong>
            <label className="upload-box">
              <Upload size={18} />
              <span>选择 PDF、Word、TXT、Markdown、图片或视频</span>
              <input type="file" multiple accept=".pdf,.doc,.docx,.txt,.md,image/*,video/*" onChange={(event) => addFiles(event.target.files)} />
            </label>
            <div className="file-list">
              {brief.files.length === 0 ? <p className="muted-text">暂无补充资料。</p> : brief.files.map((file) => (
                <div className="file-row" key={file.id}>
                  <FileText size={16} />
                  <span>{file.name}</span>
                  <small>{file.type} · {file.status}</small>
                  <button className="small-icon-button danger" type="button" aria-label={`删除 ${file.name}`} onClick={() => patchBrief({ files: brief.files.filter((item) => item.id !== file.id) })}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>

          {copyError && <ErrorBlock message={copyError.message} suggestions={copyError.suggestions} actionLabel="重试生成文字" onAction={() => onGenerateCopy(brief)} />}
          {isGeneratingCopy && <StateBlock icon={Loader2} title="正在生成文字内容" text={`正在为 ${brief.channels.join("、")} 生成首次文案，请勿重复提交。`} tone="loading" />}
          {generationDisabledReason && <p className="field-warning">{generationDisabledReason}，配置完成后才能生成文字内容。</p>}
          <button className="primary-button full-width" type="button" disabled={!canContinue || isGeneratingCopy || Boolean(generationDisabledReason)} title={generationDisabledReason} onClick={() => onGenerateCopy(brief)}>
            {isGeneratingCopy ? <Loader2 className="spin" size={16} /> : <FileText size={16} />} 生成并进入文字定稿
          </button>
          {brief.confirmed && !isGeneratingCopy && <p className="success-note">简报已确认，文字生成会读取完整创作要求。</p>}
        </section>
      </div>
    </section>
  );
}

function CopyFinalizationPanel({
  object,
  topic,
  result,
  showImageProduction,
  activeChannel,
  imageResults,
  imageModels,
  visualDirections,
  promptDraft,
  selectedDirectionId,
  selectedImageSizes,
  imageModelId,
  isGeneratingDirections,
  directionError,
  generatingImageKey,
  imageBatchProgress,
  imageError,
  onChannelChange,
  onGenerateDirections,
  onSelectDirection,
  onPromptChange,
  onSizesChange,
  onModelChange,
  onGenerateImage,
  onBackToBrief,
  onContinueToImages,
  textModelConfigured,
}: {
  object: CreationObject;
  topic: GeneratedTopic;
  result: CopywritingResult;
  showImageProduction: boolean;
  activeChannel: CopyChannel;
  imageResults: SocialImageResult[];
  imageModels: ImageModelInfo[];
  visualDirections: VisualDirection[];
  promptDraft: string;
  selectedDirectionId: string;
  selectedImageSizes: ImageSizeOption[];
  imageModelId: string;
  isGeneratingDirections: boolean;
  directionError: { message: string; suggestions: string[] } | null;
  generatingImageKey: string;
  imageBatchProgress: { completed: number; failed: number; total: number } | null;
  imageError: { message: string; suggestions: string[] } | null;
  onChannelChange: (channel: CopyChannel) => void;
  onGenerateDirections: () => void;
  onSelectDirection: (direction: VisualDirection) => void;
  onPromptChange: (prompt: string) => void;
  onSizesChange: (sizes: ImageSizeOption[]) => void;
  onModelChange: (modelId: string) => void;
  onGenerateImage: (copy: ChannelCopy, prompt: string, sizes: ImageSizeOption[], directionName: string, count: number) => void;
  onBackToBrief: () => void;
  onContinueToImages: () => void;
  textModelConfigured: boolean;
}) {
  const availableChannels = result.copies.map((copy) => copy.channel) as CopyChannel[];
  const visibleChannel = availableChannels.includes(activeChannel) ? activeChannel : availableChannels[0];
  const activeCopy = result.copies.find((copy) => copy.channel === visibleChannel);

  return (
    <section className="copy-panel" aria-labelledby="copy-title">
      <div className="panel-heading social-heading">
        <div>
          <h2 id="copy-title">文字定稿 · AI首次生成</h2>
          <p>{object.name} · {topic.title}</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBackToBrief}>返回创作简报</button>
      </div>

      <div className="copy-meta">
        <span>生成时间：{formatTime(result.generatedAt)}</span>
        <span>知识库：{result.knowledgeBaseName}</span>
        <span>检索耗时：{result.retrievalMs}ms</span>
        <span>生成耗时：{result.elapsedMs}ms</span>
      </div>

      <div className="copy-tabs" role="tablist" aria-label="已生成渠道">
        {availableChannels.map((channel) => (
          <button
            className={`choice-chip${channel === visibleChannel ? " is-selected" : ""}`}
            type="button"
            role="tab"
            aria-selected={channel === visibleChannel}
            key={channel}
            onClick={() => onChannelChange(channel)}
          >
            {channel}
          </button>
        ))}
      </div>

      {activeCopy ? <CopyPreview copy={activeCopy} /> : <StateBlock icon={FileText} title="暂无可展示文案" text="当前结果没有返回合格的渠道内容，请回到创作简报重试。" tone="empty" />}

      {activeCopy && !showImageProduction && (
        <StepAdvanceBar
          title="确认当前文字内容"
          text={`已生成 ${availableChannels.length} 个渠道版本，确认后进入图片制作。`}
          actionLabel="确认文字，进入图片制作"
          onAction={onContinueToImages}
        />
      )}

      {activeCopy && showImageProduction && (
        <ImageProductionPanel
          object={object}
          topic={topic}
          copy={activeCopy}
          copyKey={result.key}
          imageResults={imageResults.filter((item) => item.copyKey === result.key)}
          imageModels={imageModels}
          visualDirections={visualDirections}
          promptDraft={promptDraft}
          selectedDirectionId={selectedDirectionId}
          selectedImageSizes={selectedImageSizes}
          imageModelId={imageModelId}
          isGeneratingDirections={isGeneratingDirections}
          directionError={directionError}
          generatingImageKey={generatingImageKey}
          imageBatchProgress={imageBatchProgress}
          imageError={imageError}
          onGenerateDirections={onGenerateDirections}
          onSelectDirection={onSelectDirection}
          onPromptChange={onPromptChange}
          onSizesChange={onSizesChange}
          onModelChange={onModelChange}
          onGenerateImage={onGenerateImage}
          textModelConfigured={textModelConfigured}
        />
      )}
    </section>
  );
}

function ProductionRecordsPanel({ records, onDelete }: { records: ProductionRecord[]; onDelete: (record: ProductionRecord) => void }) {
  return (
    <section className="production-records" aria-labelledby="production-records-title">
      <div className="panel-heading social-heading">
        <div>
          <h2 id="production-records-title">创作记录</h2>
          <p>选题、文案和生成图片会自动留存。删除记录后无法恢复。</p>
        </div>
      </div>
      {records.length === 0 ? <StateBlock icon={FileText} title="还没有创作记录" text="生成选题或渠道文案后，结果会自动出现在这里。" tone="empty" /> : (
        <div className="production-record-list">
          {records.map((record) => (
            <article className="production-record" key={record.id}>
              <div className="production-record-head">
                <div>
                  <span className="section-label">{record.kind === "topics" ? "选题记录" : "内容记录"} · {formatTime(record.createdAt)}</span>
                  <h3>{record.kind === "topics" ? `${record.objectName} · ${record.topicGroup?.topics.length || 0} 个选题` : record.topic?.title || `${record.objectName}的文案`}</h3>
                  <p>{record.objectName} · {record.productName || "不指定具体产品"}{record.copy ? ` · ${record.copy.channels.join("、")}` : ""}</p>
                </div>
                <button className="small-icon-button danger" type="button" aria-label={`删除 ${record.objectName} ${record.kind === "topics" ? "选题" : "内容"}记录`} title="删除记录" onClick={() => onDelete(record)}><Trash2 size={16} /></button>
              </div>
              <details className="production-record-details">
                <summary>查看完整内容 <ChevronDown size={16} /></summary>
                {record.topicGroup && (
                  <div className="production-record-section">
                    <h4>生成选题</h4>
                    <p>生成时间：{formatTime(record.topicGroup.generatedAt)} · 推广产品：{record.topicGroup.productName || "不指定具体产品"}</p>
                    <ol className="production-topic-list">
                      {record.topicGroup.topics.map((topic) => <li key={topic.id}><strong>{topic.title}</strong><span>{topic.direction} · 评分 {topic.score}</span><p>{topic.reason}</p>{topic.hotspotEvidence && <p>热点依据：{topic.hotspotEvidence.title} · {topic.hotspotEvidence.source}</p>}</li>)}
                    </ol>
                  </div>
                )}
                {record.topic && <div className="production-record-section"><h4>当前选题</h4><strong>{record.topic.title}</strong><p>{record.topic.direction} · {record.topic.reason}</p></div>}
                {record.brief && <div className="production-record-section"><h4>创作简报</h4><p className="production-preserve-lines">{record.brief.viewpoint || "未填写观点与要求"}</p><p>表达风格：{record.brief.styles.join("、") || "未选择"} · 发布渠道：{record.brief.channels.join("、") || "未选择"}</p><p>最终产品：{record.brief.useProduct ? record.brief.product?.name || "未指定" : "不植入具体产品"}</p>{record.brief.files.length > 0 && <p>参考资料名称：{record.brief.files.map((file) => file.name).join("、")}（仅保留文件信息）</p>}</div>}
                {record.copy && <div className="production-record-section"><h4>渠道文案</h4><div className="production-copy-list">{record.copy.copies.map((copy) => <CopyPreview copy={copy} key={copy.channel} />)}</div></div>}
                {record.kind === "content" && <div className="production-record-section"><h4>生成图片（{record.images.flatMap((item) => item.images).length}）</h4>{record.images.length === 0 ? <p>暂无生成图片。</p> : <div className="image-result-grid">{record.images.flatMap((result) => result.images.map((image, index) => <article className="image-result-card" key={`${result.taskId}-${index}`}><a href={image.localUrl || image.url} target="_blank" rel="noreferrer"><img src={image.localUrl || image.url} alt={`${result.directionName} ${result.size}`} /></a><strong>{result.directionName}</strong><span>{result.channel} · {result.size} · {result.model}</span><small>{formatTime(result.generatedAt)}</small><a className="secondary-button" href={image.localUrl || image.url} download>下载图片</a></article>))}</div>}</div>}
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CopyPreview({ copy }: { copy: ChannelCopy }) {
  return (
    <article className="copy-preview">
      <div className="copy-preview-head">
        <span>{copy.channel}</span>
        <strong>版本 {copy.versionId}</strong>
      </div>
      {"title" in copy && (
        <div className="copy-title-block">
          <small>标题</small>
          <h3>{copy.title}</h3>
        </div>
      )}
      <div className="copy-body-block">
        <small>正文</small>
        <p>{copy.body}</p>
      </div>
      {"hashtags" in copy && (
        <div className="copy-hashtags">
          {copy.hashtags.map((tag) => <span key={tag}>{tag.startsWith("#") ? tag : `#${tag}`}</span>)}
        </div>
      )}
    </article>
  );
}

function ImageProductionPanel({
  object,
  topic,
  copy,
  copyKey,
  imageResults,
  imageModels,
  visualDirections,
  promptDraft,
  selectedDirectionId,
  selectedImageSizes,
  imageModelId,
  isGeneratingDirections,
  directionError,
  generatingImageKey,
  imageBatchProgress,
  imageError,
  onGenerateDirections,
  onSelectDirection,
  onPromptChange,
  onSizesChange,
  onModelChange,
  onGenerateImage,
  textModelConfigured,
}: {
  object: CreationObject;
  topic: GeneratedTopic;
  copy: ChannelCopy;
  copyKey: string;
  imageResults: SocialImageResult[];
  imageModels: ImageModelInfo[];
  visualDirections: VisualDirection[];
  promptDraft: string;
  selectedDirectionId: string;
  selectedImageSizes: ImageSizeOption[];
  imageModelId: string;
  isGeneratingDirections: boolean;
  directionError: { message: string; suggestions: string[] } | null;
  generatingImageKey: string;
  imageBatchProgress: { completed: number; failed: number; total: number } | null;
  imageError: { message: string; suggestions: string[] } | null;
  onGenerateDirections: () => void;
  onSelectDirection: (direction: VisualDirection) => void;
  onPromptChange: (prompt: string) => void;
  onSizesChange: (sizes: ImageSizeOption[]) => void;
  onModelChange: (modelId: string) => void;
  onGenerateImage: (copy: ChannelCopy, prompt: string, sizes: ImageSizeOption[], directionName: string, count: number) => void;
  textModelConfigured: boolean;
}) {
  const [generationCount, setGenerationCount] = useState(1);
  const selectedDirection = visualDirections.find((direction) => direction.id === selectedDirectionId) ?? visualDirections[0];
  const activeModel = imageModels.find((model) => model.id === imageModelId);
  const canGenerate = Boolean(promptDraft.trim() && activeModel?.configured && !generatingImageKey);
  const generationDisabledReason = generatingImageKey
    ? "图片正在生成，请等待当前批次完成。"
    : !activeModel
      ? "请先选择一个生图模型。"
      : !activeModel.configured
        ? "当前生图模型未配置。"
        : !promptDraft.trim()
          ? "请先生成视觉方向，或在 Prompt 编辑器中填写画面要求。"
          : selectedImageSizes.length === 0
            ? "请至少选择一个图片尺寸。"
            : "";
  const productName = topic.relatedProduct && topic.productName ? topic.productName : "未锁定具体商品";

  function toggleSize(size: ImageSizeOption) {
    onSizesChange(selectedImageSizes.includes(size) ? selectedImageSizes.filter((item) => item !== size) : [...selectedImageSizes, size]);
  }

  function runGenerate() {
    if (!canGenerate || selectedImageSizes.length === 0) return;
    onGenerateImage(copy, promptDraft, selectedImageSizes, selectedDirection?.name || "自定义Prompt", generationCount);
  }

  return (
    <section className="image-panel" aria-labelledby="image-title">
      <div className="panel-heading social-heading sticky-step">
        <div>
          <p className="section-label">STEP 05</p>
          <h2 id="image-title">图片制作</h2>
          <p>{object.name} · {topic.title} · {productName}</p>
        </div>
        <button className="primary-button" type="button" disabled={imageResults.length === 0}>确认图片</button>
      </div>

      <div className="image-grid">
        <section className="brief-section">
          <h3>视觉创作依据</h3>
          <InfoRow label="创作对象" value={object.name} />
          <InfoRow label="内容风格" value={object.contentStyle} />
          <InfoRow label="当前渠道" value={copy.channel} />
          <InfoRow label="商品关系" value={productName} />
          <div className="asset-tabs">
            {["知识库商品图", "AI生成图片", "用户上传图片", "素材中心图片"].map((tab) => <span key={tab}>{tab}</span>)}
          </div>
          <StateBlock icon={PackageSearch} title="商品原图待确认" text="当前知识库接口尚未返回可访问商品原图。关联具体商品时，请在后续上传商品原图后再使用图生图模型；本次不会用相邻商品图片冒充。" tone="warning" />
        </section>

        <section className="brief-section">
          <h3>视觉方向建议</h3>
          <button className="secondary-button full-width" type="button" onClick={onGenerateDirections} disabled={isGeneratingDirections || !textModelConfigured} title={!textModelConfigured ? "文字模型未配置" : undefined}>
            {isGeneratingDirections ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />} 生成视觉方向
          </button>
          {!textModelConfigured && <p className="field-warning">文字模型未配置，暂时不能生成视觉方向。</p>}
          {directionError && <ErrorBlock message={directionError.message} suggestions={directionError.suggestions} actionLabel="重试方向生成" onAction={onGenerateDirections} />}
          {visualDirections.length === 0 && !isGeneratingDirections && <p className="muted-text">还没有视觉方向。生成前会读取当前定稿文案和创作对象。</p>}
          <div className="direction-list">
            {visualDirections.map((direction) => (
              <button className={`direction-card${direction.id === selectedDirectionId ? " is-selected" : ""}`} type="button" key={direction.id} onClick={() => onSelectDirection(direction)}>
                <strong>{direction.name}</strong>
                <span>{direction.expression}</span>
                <small>主体：{direction.subject || "未说明"} · 场景：{direction.scene || "未说明"}</small>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="image-grid">
        <section className="brief-section">
          <h3>生图Prompt编辑器</h3>
          <p className="muted-text">当前方向：{selectedDirection?.name || "自定义"}</p>
          <textarea className="prompt-editor" value={promptDraft} onChange={(event) => onPromptChange(event.target.value)} rows={10} placeholder="先生成视觉方向，或直接输入最终生图Prompt。" />
        </section>

        <section className="brief-section">
          <h3>模型与尺寸</h3>
          <div className="model-list">
            {imageModels.length === 0 ? <p className="muted-text">暂未读取到后端生图模型配置。</p> : imageModels.map((model) => (
              <button className={`model-option${model.id === imageModelId ? " is-selected" : ""}`} type="button" key={model.id} onClick={() => onModelChange(model.id)}>
                <strong>{model.name}</strong>
                <span>{model.provider} · {model.configured ? "已配置" : "未配置"} · {model.supportsImageToImage ? "支持图生图" : "不支持图生图"}</span>
              </button>
            ))}
          </div>
          <div className="choice-list">
            {(["4:3", "3:4", "9:16"] as ImageSizeOption[]).map((size) => <button className={`choice-chip${selectedImageSizes.includes(size) ? " is-selected" : ""}`} type="button" key={size} onClick={() => toggleSize(size)}>{size}</button>)}
          </div>
          <div className="brief-block">
            <strong>本次生成数量</strong>
            <div className="choice-list" role="group" aria-label="本次生成图片数量">
              {[1, 3, 6, 9].map((count) => <button className={`choice-chip${generationCount === count ? " is-selected" : ""}`} type="button" key={count} aria-pressed={generationCount === count} disabled={Boolean(generatingImageKey)} onClick={() => setGenerationCount(count)}>{count} 张</button>)}
            </div>
            <p className="muted-text">千问单任务只返回 1 张图；选择 9 张会一次提交 9 个独立任务，最多同时执行 3 个，不会自动重试失败任务。</p>
          </div>
          {imageError && <ErrorBlock message={imageError.message} suggestions={imageError.suggestions} actionLabel="重试生图" onAction={runGenerate} />}
          {generationDisabledReason && !generatingImageKey && <p className="field-warning" id="image-generation-disabled-reason" role="status">{generationDisabledReason}</p>}
          <button className="primary-button full-width" type="button" title={generationDisabledReason || undefined} aria-describedby={generationDisabledReason ? "image-generation-disabled-reason" : undefined} disabled={!canGenerate || selectedImageSizes.length === 0} onClick={runGenerate}>
            {generatingImageKey ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />} {generatingImageKey ? `正在生成 ${imageBatchProgress?.completed || 0}/${imageBatchProgress?.total || generationCount}` : `一次生成 ${generationCount} 张配图`}
          </button>
          {generatingImageKey && <p className="muted-text">成功图片会逐张保存到本机。当前失败 {imageBatchProgress?.failed || 0} 张，失败项不会自动重试。</p>}
        </section>
      </div>

      <section className="brief-section">
        <h3>图片生成结果</h3>
        {imageResults.length === 0 ? <p className="muted-text">暂无生成图片。</p> : (
          <div className="image-result-grid">
            {imageResults.map((result) => result.images.map((image) => (
              <article className="image-result-card" key={`${result.key}-${image.localUrl || image.url}`}>
                <a href={image.localUrl || image.url} target="_blank" rel="noreferrer"><img src={image.localUrl || image.url} alt={`${result.directionName} ${result.size}`} /></a>
                <strong>{result.directionName}</strong>
                <span>{result.channel} · {result.size} · {result.model}</span>
                <small>生成时间：{formatTime(result.generatedAt)} · 耗时 {result.elapsedMs}ms</small>
                <a className="secondary-button" href={image.localUrl || image.url} download>下载图片</a>
              </article>
            )))}
          </div>
        )}
      </section>

      <section className="brief-section">
        <h3>渠道内容预览</h3>
        <CopyPreview copy={copy} />
      </section>
    </section>
  );
}

function KnowledgePage() {
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem("ideact:selectedKnowledgeBase") || "");
  const [health, setHealth] = useState<HealthState>({});
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<{ message: string; suggestions: string[] } | null>(null);
  const [isLoadingBases, setIsLoadingBases] = useState(true);
  const [isAsking, setIsAsking] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(true);

  const selectedBase = useMemo(() => bases.find((base) => base.id === selectedId) ?? bases[0], [bases, selectedId]);

  useEffect(() => {
    let ignore = false;
    async function loadBases() {
      setIsLoadingBases(true);
      setError(null);
      try {
        const response = await fetch("/api/knowledge/bases");
        const payload = await response.json();
        if (!response.ok) throw payload;
        if (ignore) return;
        const nextBases = payload.bases ?? [];
        setBases(nextBases);
        const nextId = nextBases.some((base: KnowledgeBase) => base.id === selectedId) ? selectedId : nextBases[0]?.id ?? "";
        setSelectedId(nextId);
        if (nextId) localStorage.setItem("ideact:selectedKnowledgeBase", nextId);
      } catch (caught) {
        if (!ignore) setError(readApiError(caught, "知识库配置读取失败。"));
      } finally {
        if (!ignore) setIsLoadingBases(false);
      }
    }
    loadBases();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (selectedId) localStorage.setItem("ideact:selectedKnowledgeBase", selectedId);
  }, [selectedId]);

  async function checkConnection(baseId = selectedBase?.id) {
    if (!baseId) return;
    setHealth((current) => ({ ...current, [baseId]: { status: "checking" } }));
    try {
      const response = await fetch(`/api/knowledge/bases/${encodeURIComponent(baseId)}/health`);
      const payload = await response.json();
      if (!response.ok) throw payload;
      setHealth((current) => ({ ...current, [baseId]: { status: "ok", checkedAt: payload.checkedAt } }));
    } catch (caught) {
      const apiError = readApiError(caught, "连接检测失败。");
      setHealth((current) => ({ ...current, [baseId]: { status: "failed", message: apiError.message } }));
    }
  }

  async function askQuestion(event?: React.FormEvent) {
    event?.preventDefault();
    if (!selectedBase || !question.trim()) return;

    setIsAsking(true);
    setResult(null);
    setError(null);
    setReferencesOpen(true);
    try {
      const response = await fetch("/api/knowledge/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knowledgeBaseId: selectedBase.id, question: question.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw payload;
      setResult(payload);
    } catch (caught) {
      setError(readApiError(caught, "知识库问答请求失败。"));
    } finally {
      setIsAsking(false);
    }
  }

  function resetQuestion() {
    setQuestion("");
    setResult(null);
    setError(null);
  }

  return (
    <section className="knowledge-layout" aria-label="知识库问答">
      <aside className="kb-sidebar">
        <div className="panel-heading">
          <div>
            <h2>知识库列表</h2>
            <p>仅检索当前选中的知识库</p>
          </div>
          <button className="small-icon-button" type="button" aria-label="刷新知识库连接" onClick={() => selectedBase && checkConnection(selectedBase.id)}>
            <RefreshCw size={15} />
          </button>
        </div>

        {isLoadingBases ? (
          <StateBlock icon={Loader2} title="正在读取知识库配置" tone="loading" />
        ) : bases.length === 0 ? (
          <StateBlock icon={AlertTriangle} title="尚未配置知识库" text="请在服务端环境变量中配置 KB_1 和 KB_2 后重启 API 服务。" tone="warning" />
        ) : (
          <div className="kb-list">
            {bases.map((base) => {
              const state = health[base.id]?.status ?? "unknown";
              return (
                <button className={`kb-card${base.id === selectedBase?.id ? " is-selected" : ""}`} key={base.id} type="button" onClick={() => setSelectedId(base.id)}>
                  <span className="kb-name">{base.name}</span>
                  <span className={`status-pill ${state}`}>{connectionLabel(state)}</span>
                  <span className="kb-meta">{base.regionId} · {base.endpoint}</span>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      <main className="qa-panel">
        <form className="question-box" onSubmit={askQuestion}>
          <label htmlFor="knowledge-question">输入问题</label>
          <textarea id="knowledge-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="请输入要从当前知识库中检索的问题" rows={4} />
          <div className="question-actions">
            <button className="secondary-button" type="button" onClick={resetQuestion} disabled={isAsking}>
              <Trash2 size={16} /> 清空
            </button>
            <button className="primary-button" type="submit" disabled={!question.trim() || !selectedBase || isAsking}>
              {isAsking ? <Loader2 className="spin" size={16} /> : <Send size={16} />} {isAsking ? "正在检索并生成回答" : "提问"}
            </button>
          </div>
        </form>

        {isAsking && <StateBlock icon={Loader2} title="正在检索当前知识库" text="已锁定当前知识库，正在召回资料片段并生成基于资料的回答。" tone="loading" />}
        {!isAsking && error && <ErrorBlock message={error.message} suggestions={error.suggestions} />}
        {!isAsking && !error && !result && <StateBlock icon={BookOpenText} title="等待提问" text="选择左侧知识库并输入问题后，系统会先检索资料，再根据命中片段生成回答。" tone="empty" />}
        {!isAsking && result && <AnswerBlock result={result} referencesOpen={referencesOpen} onToggle={() => setReferencesOpen((value) => !value)} />}
      </main>

      <aside className="evidence-panel">
        <div className="panel-heading">
          <div>
            <h2>检索信息</h2>
            <p>本次回答依据</p>
          </div>
        </div>
        <InfoRow label="当前知识库" value={selectedBase?.name || "未选择"} />
        <InfoRow label="命中文档数量" value={result ? String(result.hitDocumentCount) : "-"} />
        <InfoRow label="检索耗时" value={result ? `${result.retrievalMs} ms` : "-"} />
        <InfoRow label="连接检测" value={selectedBase ? connectionLabel(health[selectedBase.id]?.status ?? "unknown") : "-"} />
        <button className="secondary-button full-width" type="button" disabled={!selectedBase || health[selectedBase.id]?.status === "checking"} onClick={() => checkConnection()}>
          {health[selectedBase?.id || ""]?.status === "checking" ? <Loader2 className="spin" size={16} /> : <Wifi size={16} />} 检测当前连接
        </button>

        {selectedBase && health[selectedBase.id]?.status === "failed" && (
          <div className="inline-error">
            <WifiOff size={16} />
            <span>{health[selectedBase.id]?.message}</span>
          </div>
        )}
      </aside>
    </section>
  );
}

function AnswerBlock({ result, referencesOpen, onToggle }: { result: AskResult; referencesOpen: boolean; onToggle: () => void }) {
  return (
    <article className={`answer-card${result.grounded ? "" : " is-ungrounded"}`}>
      <div className="answer-meta">
        <span><CheckCircle2 size={15} /> {result.knowledgeBaseName}</span>
        <span><Clock3 size={15} /> {result.retrievalMs} ms</span>
      </div>
      <h2>完整回答</h2>
      <p className="answer-text">{result.answer}</p>
      <button className="reference-toggle" type="button" onClick={onToggle}>
        {referencesOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {referencesOpen ? "收起参考资料" : "展开参考资料"}
      </button>
      {referencesOpen && (
        <div className="references">
          {result.citations.length === 0 ? (
            <p className="muted-text">本次没有命中可引用资料。</p>
          ) : (
            result.citations.map((citation) => (
              <div className="reference-item" key={`${citation.sourceNumber}-${citation.chunkId || citation.documentName}`}>
                <div className="reference-head">
                  <span className="source-number">[{citation.sourceNumber}]</span>
                  <strong>{citation.documentName}</strong>
                  <span>相关度 {formatRelevance(citation.relevance)}</span>
                </div>
                <p>{citation.snippet}</p>
                {(citation.fileId || citation.chunkId) && <small>{[citation.fileId, citation.chunkId].filter(Boolean).join(" · ")}</small>}
              </div>
            ))
          )}
        </div>
      )}
    </article>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StateBlock({ icon: Icon, title, text, tone }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; text?: string; tone: "empty" | "loading" | "warning" }) {
  return (
    <div className={`state-block ${tone}`}>
      <Icon className={tone === "loading" ? "spin" : undefined} size={22} />
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </div>
  );
}

function ErrorBlock({ message, suggestions, actionLabel, onAction }: { message: string; suggestions: string[]; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="error-block">
      <div className="error-title">
        <AlertTriangle size={18} />
        <h2>请求失败</h2>
      </div>
      <p>{message}</p>
      <div>
        <strong>建议处理：</strong>
        <ul>
          {suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      </div>
      {actionLabel && onAction && <button className="secondary-button" type="button" onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function weightLabel(key: string) {
  const labels: Record<string, string> = {
    trend: "趋势热点",
    painPoint: "用户痛点",
    product: "产品卖点",
    trust: "信任背书",
    conversion: "转化引导",
  };
  return labels[key] || key;
}

function buildTopicGroupKey(objectId: string, productId: string | null, weights: Record<string, number>) {
  return JSON.stringify({ objectId, productId: productId || "none", weights });
}

function buildCopyResultKey(objectId: string, topicId: string, briefKey: string, productId: string | null, channels: string[]) {
  return JSON.stringify({ objectId, topicId, briefKey, productId: productId || "none", channels });
}

function buildImageResultKey(copyKey: string, channel: string, size: ImageSizeOption, variant?: string) {
  return JSON.stringify({ copyKey, channel, size, variant: variant || "default" });
}

function imageSizeToPixels(size: ImageSizeOption) {
  const map: Record<ImageSizeOption, string> = {
    "4:3": "1472*1104",
    "3:4": "1104*1472",
    "9:16": "928*1664",
  };
  return map[size];
}

function formatTime(value: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function hotspotLabel(status: string) {
  const labels: Record<string, string> = {
    available: "有有效热点",
    not_configured: "未配置，已降级",
    failed: "读取失败，已降级",
    expired: "已过期，已降级",
  };
  return labels[status] || status || "未知";
}

function readApiError(caught: unknown, fallback: string) {
  const payload = caught as { message?: string; suggestions?: string[] };
  return {
    message: payload?.message || fallback,
    suggestions: Array.isArray(payload?.suggestions) && payload.suggestions.length > 0 ? payload.suggestions : ["检查 API 服务是否启动，并确认服务端环境变量配置完整。"],
  };
}

function connectionLabel(status: ConnectionStatus) {
  switch (status) {
    case "checking":
      return "检测中";
    case "ok":
      return "已连接";
    case "failed":
      return "异常";
    default:
      return "未检测";
  }
}

function formatRelevance(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return value > 1 ? value.toFixed(2) : `${Math.round(value * 100)}%`;
}

const rootElement = document.getElementById("root")!;
const appRoot = window.__ideactRoot ?? createRoot(rootElement);
window.__ideactRoot = appRoot;
appRoot.render(<AuthGate />);

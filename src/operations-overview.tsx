import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpenText, CheckCircle2, FileText, Layers3, Loader2, RefreshCw, Send, UsersRound } from "lucide-react";
import { objectTypeLabels } from "./creation-objects";
import {
  buildOperationsOverview,
  readOverviewLocalData,
  type OverviewAccount,
  type OverviewConversation,
  type OverviewKnowledgeBase,
  type OverviewPublishJob,
} from "./operations-overview-data";

type RemoteOverview = {
  knowledgeBases: OverviewKnowledgeBase[];
  jobs: OverviewPublishJob[];
  accounts: OverviewAccount[];
  conversations: OverviewConversation[];
};

const emptyRemote: RemoteOverview = { knowledgeBases: [], jobs: [], accounts: [], conversations: [] };

async function readJsonResponse(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || "服务端返回异常");
  return payload;
}

function localTime(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未同步";
}

export function OperationsOverview() {
  const [localData, setLocalData] = useState(() => readOverviewLocalData(window.localStorage));
  const [remote, setRemote] = useState<RemoteOverview>(emptyRemote);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLocalData(readOverviewLocalData(window.localStorage));
    const requests = [
      { label: "知识库", path: "/api/knowledge/bases" },
      { label: "发布记录", path: "/api/publishing/jobs" },
      { label: "私域账号", path: "/api/private-inbox" },
    ] as const;
    const results = await Promise.allSettled(requests.map(async (request) => ({ request, payload: await readJsonResponse(await fetch(request.path)) })));
    const next = { ...emptyRemote };
    const nextErrors: string[] = [];
    results.forEach((result, index) => {
      const request = requests[index];
      if (result.status === "rejected") {
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        nextErrors.push(`${request.label}读取失败：${message}`);
        return;
      }
      const payload = result.value.payload;
      if (request.label === "知识库") next.knowledgeBases = Array.isArray(payload.bases) ? payload.bases : [];
      if (request.label === "发布记录") next.jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      if (request.label === "私域账号") {
        next.accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
        next.conversations = Array.isArray(payload.conversations) ? payload.conversations : [];
      }
    });
    setRemote(next);
    setErrors(nextErrors);
    setUpdatedAt(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const snapshot = useMemo(() => buildOperationsOverview({ ...localData, ...remote }), [localData, remote]);
  const activeAccounts = remote.accounts.filter((account) => account.active);

  return (
    <section className="operations-overview" aria-labelledby="operations-overview-title">
      <div className="overview-heading">
        <div>
          <p className="overview-kicker">系统真实数据汇总</p>
          <h1 id="operations-overview-title">运营概览</h1>
          <p>快速查看内容资产、生产进度、发布结果和账号关联情况。</p>
        </div>
        <div className="overview-refresh">
          <span>{updatedAt ? `更新于 ${localTime(updatedAt)}` : "正在汇总"}</span>
          <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} 刷新数据
          </button>
        </div>
      </div>

      {errors.length > 0 && <div className="overview-error" role="alert">
        <AlertTriangle size={18} />
        <div><strong>部分数据暂未读取成功</strong>{errors.map((error) => <p key={error}>{error}</p>)}</div>
      </div>}

      <div className="overview-metrics" aria-label="关键运营指标">
        <article><BookOpenText size={20} /><span>知识库</span><strong>{remote.knowledgeBases.length}</strong><small>服务端已配置</small></article>
        <article><UsersRound size={20} /><span>创作对象</span><strong>{snapshot.objects.length}</strong><small>{activeAccounts.length} 个有效运营账号</small></article>
        <article><Layers3 size={20} /><span>内容生产</span><strong>{snapshot.totalTopics}</strong><small>{snapshot.totalBriefs} 份简报，其中 {snapshot.confirmedBriefs} 份已确认</small></article>
        <article><Send size={20} /><span>已发布内容</span><strong>{snapshot.publishedCount}</strong><small>{snapshot.pendingPublishCount} 个处理中 · {snapshot.failedPublishCount} 个失败</small></article>
      </div>

      <section className="overview-section" aria-labelledby="object-breakdown-title">
        <div className="overview-section-heading"><div><h3 id="object-breakdown-title">创作对象明细</h3><p>选题和简报按创作对象归属统计。</p></div><span>{snapshot.objects.length} 个对象</span></div>
        <div className="overview-table-wrap">
          <table className="overview-table">
            <thead><tr><th>创作对象</th><th>类型</th><th>关联知识库</th><th>选题</th><th>简报</th><th>已确认简报</th></tr></thead>
            <tbody>{snapshot.objects.map((object) => <tr key={object.id}>
              <td><strong>{object.name}</strong></td><td>{objectTypeLabels[object.type]}</td><td>{object.knowledgeBaseName || "未关联"}</td><td>{object.topicCount}</td><td>{object.briefCount}</td><td>{object.confirmedBriefCount}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <div className="overview-detail-grid">
        <section className="overview-section" aria-labelledby="knowledge-summary-title">
          <div className="overview-section-heading"><div><h3 id="knowledge-summary-title">知识库</h3><p>来自当前服务端配置。</p></div><BookOpenText size={19} /></div>
          {remote.knowledgeBases.length ? <div className="overview-list">{remote.knowledgeBases.map((base) => <div className="overview-list-row" key={base.id}><span><strong>{base.name}</strong><small>{base.id}</small></span><em><CheckCircle2 size={14} /> 已配置</em></div>)}</div> : <p className="overview-empty">{loading ? "正在读取知识库…" : "暂未读取到已配置知识库。"}</p>}
        </section>

        <section className="overview-section" aria-labelledby="channel-summary-title">
          <div className="overview-section-heading"><div><h3 id="channel-summary-title">渠道</h3><p>按简报选择和发布记录汇总。</p></div><Send size={19} /></div>
          {snapshot.channels.length ? <div className="overview-list">{snapshot.channels.map((channel) => <div className="overview-list-row" key={channel.name}><span><strong>{channel.name}</strong><small>{channel.selectedBriefCount} 份简报选择 · {channel.totalJobCount} 个发布任务</small></span><em>{channel.publishedCount} 已发布</em></div>)}</div> : <p className="overview-empty">尚未选择渠道或提交发布任务。</p>}
        </section>

        <section className="overview-section overview-account-section" aria-labelledby="account-summary-title">
          <div className="overview-section-heading"><div><h3 id="account-summary-title">关联账号</h3><p>小红书账号与私信同步状态。</p></div><UsersRound size={19} /></div>
          {remote.accounts.length ? <div className="overview-list">{remote.accounts.map((account) => <div className="overview-list-row" key={account.id}><span><strong>{account.name}</strong><small>设备 {account.deviceId} · {account.scanError ? `同步异常：${account.scanError}` : `最近同步 ${localTime(account.lastScanAt)}`}</small></span><em className={account.active ? "is-active" : ""}>{account.active ? "当前使用" : "历史账号"}</em></div>)}</div> : <p className="overview-empty">{loading ? "正在读取账号…" : "尚未关联小红书账号。"}</p>}
          <div className="overview-account-summary"><span>有效账号 <strong>{snapshot.activeAccountCount}</strong></span><span>有未读的会话 <strong>{snapshot.unreadConversationCount}</strong></span></div>
        </section>
      </div>

      <p className="overview-source-note"><FileText size={15} /> 创作对象、选题和简报由服务端内容工作区持久保存并缓存到当前浏览器；知识库、发布记录和私域账号来自当前服务端。</p>
    </section>
  );
}

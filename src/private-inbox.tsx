import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Smartphone, UsersRound } from "lucide-react";

type Device = { id: string; name: string; runtimeStatus: string };
type Account = { id: string; deviceId: string; name: string; active: boolean; lastScanAt?: string; scanError?: string; notificationBaselineReady?: boolean };
type Message = { id: string; sender: "customer" | "account"; replyOrigin: "unknown" | "human" | "ai"; text: string; timeLabel?: string; observedAt: string; sendStatus: "received" | "observed" };
type Conversation = { id: string; accountId: string; customerName: string; lastPreview: string; lastMessageAt: string; unread: number; status: "PENDING" | "CLOSED" | "AI_HANDLED"; messages: Message[] };
type Inbox = { accounts: Account[]; conversations: Conversation[] };

export function filterInboxConversations(inbox: Inbox, filter: string) {
  return inbox.conversations.filter((item) => filter === "all" || item.accountId === filter || inbox.accounts.some((account) => account.id === item.accountId && account.deviceId === filter)).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

const statuses: Record<Conversation["status"], string> = { PENDING: "待处理", CLOSED: "已关闭", AI_HANDLED: "AI 已处理" };
function localTime(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未同步"; }
async function readResponse(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || "请求失败，请稍后重试。");
  return payload;
}

export function PrivateInboxPage() {
  const [inbox, setInbox] = useState<Inbox>({ accounts: [], conversations: [] });
  const [devices, setDevices] = useState<Device[]>([]);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [linkDeviceId, setLinkDeviceId] = useState("");
  const [linkName, setLinkName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const filtered = useMemo(() => filterInboxConversations(inbox, filter), [inbox, filter]);
  const selected = filtered.find((item) => item.id === selectedId);
  const activeAccounts = inbox.accounts.filter((item) => item.active);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => { void refresh(false); }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  async function refresh(showLoading: boolean) {
    if (showLoading) setLoading(true);
    try {
      const [inboxResponse, devicesResponse] = await Promise.all([fetch("/api/private-inbox"), fetch("/api/cloud-phone/devices")]);
      const nextInbox = await readResponse(inboxResponse) as Inbox;
      setInbox(nextInbox);
      const deviceData = await readResponse(devicesResponse);
      setDevices(deviceData.devices || []);
      setLinkDeviceId((current) => current || deviceData.devices?.[0]?.id || "");
      setAccountId((current) => nextInbox.accounts.some((item) => item.id === current && item.active) ? current : nextInbox.accounts.find((item) => item.active)?.id || "");
      setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "读取私信工作台失败。"); }
    finally { if (showLoading) setLoading(false); }
  }

  async function action(name: string, url: string, body?: unknown) {
    if (busy) return;
    setBusy(name); setError(""); setNotice("");
    try {
      const result = await readResponse(await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }));
      await refresh(false);
      return result;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败，请重试。"); return null; }
    finally { setBusy(""); }
  }

  async function linkAccount() {
    const result = await action("link", "/api/private-inbox/accounts", { deviceId: linkDeviceId, name: linkName });
    if (result) { setAccountId(result.account.id); setLinkName(""); const failed = result.baseline?.results?.find((item: { accountId: string; error?: string }) => item.accountId === result.account.id)?.error; setNotice(result.baseline?.busy ? "账号已关联；通知采集正在进行，基线状态请稍后刷新查看。" : failed ? `账号已关联，但通知基线采集失败：${failed}。请检查远程命令权限后重试采集。` : "账号已关联，旧通知已建立基线；已有聊天请打开聊天页后手动同步。"); }
  }

  async function scan() {
    const result = await action("scan", "/api/private-inbox/scan");
    if (result) setNotice(result.busy ? "通知采集正在进行，请稍后刷新。" : `通知采集完成：新增 ${result.results.reduce((sum: number, item: { added: number }) => sum + item.added, 0)} 条私信线索。${result.results.some((item: { error?: string }) => item.error) ? "部分设备失败，请查看左侧同步状态。" : ""}`);
  }

  async function sync() {
    const targetAccount = selected?.accountId || accountId;
    const targetCustomer = selected?.customerName || customerName.trim();
    const result = await action("sync", "/api/private-inbox/sync", { accountId: targetAccount, customerName: targetCustomer });
    if (result) { await openConversation(result.conversation); setNotice(`聊天页同步完成，新增 ${result.added} 条消息。`); }
  }

  async function openConversation(conversation: Conversation) {
    setSelectedId(conversation.id);
    setAccountId(conversation.accountId);
    if (!conversation.unread) return;
    try {
      await readResponse(await fetch(`/api/private-inbox/conversations/${encodeURIComponent(conversation.id)}/read`, { method: "POST" }));
      setInbox((current) => ({ ...current, conversations: current.conversations.map((item) => item.id === conversation.id ? { ...item, unread: 0 } : item) }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "清除未读失败，请重试。"); }
  }

  return <section className="private-inbox-page" aria-label="私域获客私信聚合">
    <div className="module-heading"><div><p className="section-label">私域运营 / 私域获客</p><h2>私信聚合</h2><p>按小红书账号与客户整理会话。通知用于发现私信，聊天内容以云手机当前页面同步为准。</p></div><button className="secondary-button" type="button" onClick={() => void refresh(true)} disabled={loading || Boolean(busy)}><RefreshCw size={16} /> 刷新</button></div>
    {error && <div className="error-box" role="alert"><AlertTriangle size={17} /><span>{error} 请确认云手机在线、已打开对应聊天页，并检查远程命令权限。</span></div>}
    {notice && <div className="publish-success" role="status"><CheckCircle2 size={17} />{notice}</div>}
    {loading && <div className="publish-notice" role="status"><Loader2 size={17} className="spin" /> 正在读取设备与会话</div>}
    <div className="private-inbox-layout">
      <section className="private-inbox-column" aria-label="设备与账号">
        <div className="private-inbox-column-head"><h3>设备 / 账号</h3><button className="small-icon-button" type="button" aria-label="采集新通知" title="采集新通知" disabled={Boolean(busy) || !activeAccounts.length} onClick={() => void scan()}>{busy === "scan" ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}</button></div>
        <button className={`private-inbox-list-button${filter === "all" ? " is-selected" : ""}`} type="button" onClick={() => setFilter("all")}><UsersRound size={17} /> 全部会话 <span className="private-inbox-count">{inbox.conversations.length}</span></button>
        {devices.length === 0 && <p className="muted-text">没有可用云手机。请检查服务端实例 ID 配置。</p>}
        {devices.map((device) => <div className="private-inbox-device" key={device.id}>
          <button className={`private-inbox-list-button${filter === device.id ? " is-selected" : ""}`} type="button" onClick={() => { setFilter(device.id); setAccountId(inbox.accounts.find((item) => item.deviceId === device.id && item.active)?.id || ""); }}><Smartphone size={17} /> <span>{device.name}</span></button>
          {inbox.accounts.filter((item) => item.deviceId === device.id).map((account) => <button className={`private-inbox-account${filter === account.id ? " is-selected" : ""}`} type="button" key={account.id} onClick={() => { setFilter(account.id); setAccountId(account.id); }}><strong>{account.name}{!account.active ? "（未激活）" : ""}</strong><small>{account.scanError ? `采集失败：${account.scanError}` : !account.notificationBaselineReady ? "待建立通知基线" : `已同步 · ${localTime(account.lastScanAt)}`}</small></button>)}
        </div>)}
        <div className="private-inbox-link"><h4>关联当前登录账号</h4><label>云手机<select value={linkDeviceId} onChange={(event) => setLinkDeviceId(event.target.value)}>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><label>小红书账号名称<input value={linkName} onChange={(event) => setLinkName(event.target.value)} placeholder="以手机当前登录账号为准" /></label><button className="secondary-button" type="button" disabled={!linkDeviceId || !linkName.trim() || Boolean(busy)} onClick={() => void linkAccount()}>{busy === "link" ? "正在关联" : "确认关联"}</button><p>切换手机里的小红书账号后，请在此重新关联；未确认账号不会自动归属私信。</p></div>
      </section>
      <section className="private-inbox-column" aria-label="会话列表"><div className="private-inbox-column-head"><h3>会话</h3><span>{filtered.length} 条</span></div>
        {filtered.length === 0 ? <div className="private-inbox-empty">暂无匹配会话。新关联账号首次采集只建立通知基线；之后收到私信或手动同步聊天页才会出现。</div> : filtered.map((conversation) => { const account = inbox.accounts.find((item) => item.id === conversation.accountId); return <button className={`private-inbox-conversation${selectedId === conversation.id ? " is-selected" : ""}`} key={conversation.id} type="button" onClick={() => void openConversation(conversation)}><span className="private-inbox-conversation-top"><strong>{conversation.customerName}</strong><small>{localTime(conversation.lastMessageAt)}</small></span><span className="private-inbox-summary">{conversation.lastPreview || "暂无聊天记录"}</span><span className="private-inbox-conversation-meta"><span>{account?.name || "账号已移除"} · {conversation.messages.length} 条消息</span><span>{statuses[conversation.status]}{conversation.unread ? ` · 未读 ${conversation.unread}` : ""}</span></span></button>; })}
      </section>
      <section className="private-inbox-column private-inbox-chat" aria-label="聊天记录"><div className="private-inbox-column-head"><h3>{selected ? selected.customerName : "聊天记录"}</h3>{selected && <span>{inbox.accounts.find((item) => item.id === selected.accountId)?.name}</span>}</div>
        {selected ? <><div className="private-inbox-timeline">{selected.messages.length ? selected.messages.map((message) => <div className={`private-inbox-message ${message.sender === "account" ? "is-account" : "is-customer"}`} key={message.id}><div className="private-inbox-message-meta">{message.sender === "customer" ? "客户消息" : message.replyOrigin === "ai" ? "AI 回复" : message.replyOrigin === "human" ? "人工回复" : "账号发出（来源未核验）"} · {message.timeLabel || `采集于 ${localTime(message.observedAt)}`} · {message.sendStatus === "received" ? "已接收" : "已在聊天页看到"}</div><p>{message.text}</p></div>) : <div className="private-inbox-empty">只有私信通知线索，尚无完整聊天记录。请在云手机中打开该客户聊天页，点击下方同步。</div>}</div><div className="private-inbox-chat-actions"><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void sync()}>{busy === "sync" ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} 同步当前聊天页</button><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void action("status", `/api/private-inbox/conversations/${encodeURIComponent(selected.id)}/status`, { status: selected.status === "CLOSED" ? "PENDING" : "CLOSED" })}>{selected.status === "CLOSED" ? "重新待处理" : "关闭会话"}</button></div></> : <><div className="private-inbox-empty">选择左侧会话查看时间线。小红书在前台没有通知时，也可打开聊天页后从这里手动同步。</div><div className="private-inbox-link"><h4>同步新客户聊天页</h4><label>当前账号<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{activeAccounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label><label>客户名称<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="与聊天页顶部名称一致" /></label><button className="secondary-button" type="button" disabled={!accountId || !customerName.trim() || Boolean(busy)} onClick={() => void sync()}>{busy === "sync" ? "正在同步" : "同步消息"}</button></div></>}
      </section>
    </div>
  </section>;
}

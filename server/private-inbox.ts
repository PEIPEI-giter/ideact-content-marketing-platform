import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseStringPromise } from "xml2js";

export type InboxAccount = { id: string; deviceId: string; name: string; active: boolean; linkedAt: string; lastScanAt?: string; scanError?: string; notificationBaselineReady?: boolean; knownNotificationKeys?: string[] };
export type InboxMessage = { id: string; conversationId: string; sender: "customer" | "account"; replyOrigin: "unknown" | "human" | "ai"; text: string; timeLabel?: string; observedAt: string; sendStatus: "received" | "observed" };
export type InboxConversation = { id: string; accountId: string; customerName: string; customerKey: string; lastPreview: string; lastMessageAt: string; unread: number; status: "PENDING" | "CLOSED" | "AI_HANDLED"; notificationKeys: string[]; messages: InboxMessage[] };
export type InboxState = { accounts: InboxAccount[]; conversations: InboxConversation[] };
export type PrivateNotification = { key: string; legacyKey?: string; customerName: string; preview: string; observedAt: string };
export type VisibleMessage = Pick<InboxMessage, "sender" | "text" | "timeLabel">;
export type ParsedXhsChatPage = { customerName: string; messages: VisibleMessage[] };

const emptyState = (): InboxState => ({ accounts: [], conversations: [] });
export const normalizeCustomer = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
const compactIdentity = (value: string) => normalizeCustomer(value).replace(/[\s·•._-]+/g, "");
const controlText = /^(发送|返回|更多|私信|消息|聊天|已读|已阅|未读|送达|表情|图片|语音|输入消息|说点什么|对方正在输入(?:中)?[.…]*|关注|已关注)$/;
const timeText = /^(?:(?:今天|昨天|前天|\d{1,2}月\d{1,2}日)(?:\s+))?(?:凌晨|早上|上午|中午|下午|晚上)?\s*\d{1,2}:\d{2}$/;

export function isPrivateInboxNoise(value: string, customerName = "", accountName = "") {
  const text = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!text || controlText.test(text) || timeText.test(text)) return true;
  const identity = compactIdentity(text);
  return Boolean(identity && [customerName, accountName].some((name) => name && identity === compactIdentity(name)));
}

function cleanVisibleMessages(messages: VisibleMessage[], customerName: string, accountName = "") {
  const seen = new Set<string>();
  return messages.flatMap((item) => {
    const text = item.text.normalize("NFKC").trim();
    if (isPrivateInboxNoise(text, customerName, accountName)) return [];
    const key = [item.sender, normalizeCustomer(text), item.timeLabel || ""].join("|");
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...item, text }];
  });
}

export function sanitizeInboxState(input: InboxState) {
  const accounts = Array.isArray(input.accounts) ? input.accounts : [];
  const accountNames = new Map(accounts.map((item) => [item.id, item.name]));
  const conversations = (Array.isArray(input.conversations) ? input.conversations : []).map((conversation) => {
    const seen = new Set<string>();
    const accountName = accountNames.get(conversation.accountId) || "";
    const messages = (Array.isArray(conversation.messages) ? conversation.messages : []).filter((message) => {
      if (isPrivateInboxNoise(message.text, conversation.customerName, accountName)) return false;
      const key = [message.sender, normalizeCustomer(message.text), message.timeLabel || "", message.observedAt].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const lastMessage = messages.at(-1);
    const lastPreview = lastMessage?.text
      || (isPrivateInboxNoise(conversation.lastPreview || "", conversation.customerName, accountName) ? "收到私信通知，待同步聊天记录" : conversation.lastPreview);
    return { ...conversation, messages, lastPreview };
  });
  return { accounts, conversations };
}

export function detectXhsLoggedOut(output: string) {
  const normalized = output.normalize("NFKC");
  const matched = ["账号下线通知", "重新登录", "登录小红书", "登录后继续"].find((text) => normalized.includes(text));
  return matched ? `检测到小红书登录失效（${matched}）。请连接云手机重新登录小红书后再重试。` : null;
}

function notificationField(block: string, field: string) {
  const escaped = field.replace(/[.]/g, "\\.");
  return block.match(new RegExp(`${escaped}=String \\(([^\\r\\n)]*)\\)`))?.[1]?.trim()
    || block.match(new RegExp(`${escaped}=([^\\r\\n]+)`))?.[1]?.trim() || "";
}

export function parseXhsNotifications(output: string, observedAt = new Date().toISOString()): PrivateNotification[] {
  const blocks = output.split(/(?=NotificationRecord\()/);
  const parsed: PrivateNotification[] = [];
  for (const block of blocks) {
    if (!/pkg=com\.xingin\.xhs(?:\s|\b)/.test(block)) continue;
    const title = notificationField(block, "android.title");
    const match = title.match(/^(.{1,60}?)\s+私信你$/);
    if (!match) continue;
    const customerName = match[1].trim();
    if (!customerName || /^(系统|小红书|活动|推荐)$/.test(customerName)) continue;
    const preview = notificationField(block, "android.text").slice(0, 300);
    const androidKey = block.match(/\bkey=([^\s,)]+)/)?.[1] || "";
    const postTime = block.match(/\b(?:postTime|when)=(\d{10,13})\b/)?.[1] || "";
    const legacyKey = fingerprint([androidKey, postTime, customerName, preview].join("|"));
    const key = androidKey && postTime ? fingerprint([androidKey, postTime].join("|")) : legacyKey;
    parsed.push({ key, legacyKey, customerName, preview, observedAt });
  }
  return parsed;
}

type UiNode = { text: string; desc: string; resourceId: string; className: string; bounds: [number, number, number, number]; packageName: string };
function boundsOf(value: string): UiNode["bounds"] {
  const numbers = [...value.matchAll(/\d+/g)].map((match) => Number(match[0]));
  return numbers.length === 4 ? numbers as UiNode["bounds"] : [0, 0, 0, 0];
}
function flattenUi(value: unknown, nodes: UiNode[]) {
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  if (row.$ && typeof row.$ === "object") {
    const attrs = row.$ as Record<string, string>;
    nodes.push({ text: attrs.text || "", desc: attrs["content-desc"] || "", resourceId: attrs["resource-id"] || "", className: attrs.class || "", bounds: boundsOf(attrs.bounds || ""), packageName: attrs.package || "" });
  }
  for (const [key, child] of Object.entries(row)) if (key !== "$" && key !== "_") (Array.isArray(child) ? child : [child]).forEach((item) => flattenUi(item, nodes));
}

function chatHeading(nodes: UiNode[], width: number, height: number) {
  const excluded = /^(返回|更多|私信|消息|聊天|搜索|发送|关注|已关注|在线|离线)$/;
  const candidates = nodes
    .filter((node) => {
      const text = (node.text || node.desc).normalize("NFKC").trim();
      const center = (node.bounds[0] + node.bounds[2]) / 2;
      return Boolean(text)
        && /TextView/.test(node.className)
        && node.bounds[1] < height * 0.2
        && center > width * 0.2
        && center < width * 0.8
        && text.length <= 80
        && !excluded.test(text)
        && !/^\d{1,2}:\d{2}$/.test(text);
    })
    .sort((a, b) => {
      const score = (node: UiNode) => (/name|nick|title/i.test(node.resourceId) ? 4 : 0) + ((node.bounds[0] + node.bounds[2]) / 2 > width * 0.35 && (node.bounds[0] + node.bounds[2]) / 2 < width * 0.65 ? 2 : 0);
      return score(b) - score(a) || a.bounds[1] - b.bounds[1];
    });
  return (candidates[0]?.text || candidates[0]?.desc || "").normalize("NFKC").trim();
}

export async function parseXhsChatPage(output: string, expectedCustomer = "", accountName = ""): Promise<ParsedXhsChatPage> {
  const loggedOut = detectXhsLoggedOut(output);
  if (loggedOut) throw new Error(loggedOut);
  const start = output.indexOf("<hierarchy");
  const end = output.lastIndexOf("</hierarchy>");
  if (start < 0 || end < start) throw new Error("云手机没有返回可解析的聊天控件树；请打开具体私信聊天页后重试。");
  let tree: unknown;
  try { tree = await parseStringPromise(output.slice(start, end + "</hierarchy>".length), { explicitArray: false }); }
  catch { throw new Error("聊天控件树格式不完整；请保持聊天页打开并重新同步。"); }
  const nodes: UiNode[] = [];
  flattenUi(tree, nodes);
  const xhs = nodes.filter((node) => node.packageName === "com.xingin.xhs");
  if (xhs.length < 5) throw new Error("当前前台不是可读取的小红书页面；请在云手机中打开小红书私信聊天页。");
  const height = Math.max(...xhs.map((node) => node.bounds[3]));
  const width = Math.max(...xhs.map((node) => node.bounds[2]));
  const hasInput = xhs.some((node) => /EditText/.test(node.className) && node.bounds[1] > height * 0.65);
  if (!hasInput) throw new Error("没有识别到小红书聊天输入框。请进入具体客户的私信聊天页，不要停留在消息列表或首页。");
  const detectedCustomer = chatHeading(xhs, width, height);
  if (!detectedCustomer) throw new Error("无法识别当前聊天页顶部的客户名称。请保持具体私信聊天页打开后重试。");
  const cleanExpected = expectedCustomer.normalize("NFKC").trim();
  if (cleanExpected && normalizeCustomer(detectedCustomer) !== normalizeCustomer(cleanExpected)) {
    throw new Error(`当前打开的是“${detectedCustomer}”聊天页，与填写的客户“${cleanExpected}”不一致。请确认后重试。`);
  }
  const customerName = cleanExpected || detectedCustomer;
  const visible: VisibleMessage[] = [];
  let timeLabel = "";
  for (const node of xhs) {
    const text = node.text.trim();
    const [left, top, right, bottom] = node.bounds;
    if (!text || !/TextView/.test(node.className) || top < height * 0.18 || bottom > height * 0.87) continue;
    if (timeText.test(text) && text.length < 25) { timeLabel = text; continue; }
    if (isPrivateInboxNoise(text, customerName, accountName) || text.length > 2000) continue;
    const sender = right <= width * 0.57 ? "customer" : left >= width * 0.43 ? "account" : null;
    if (!sender) continue;
    visible.push({ sender, text, timeLabel: timeLabel || undefined });
  }
  const messages = cleanVisibleMessages(visible, customerName, accountName);
  if (!messages.length) throw new Error("已进入聊天页，但没有识别到有效聊天内容；控件文字和重复内容已自动忽略。");
  return { customerName, messages };
}

export async function parseXhsChatHierarchy(output: string, expectedCustomer: string): Promise<VisibleMessage[]> {
  return (await parseXhsChatPage(output, expectedCustomer)).messages;
}

function sameMessage(a: VisibleMessage, b: VisibleMessage) { return a.sender === b.sender && a.text === b.text && (a.timeLabel || "") === (b.timeLabel || ""); }
export function findNewVisibleMessages(existing: InboxMessage[], visible: VisibleMessage[]) {
  if (!existing.length) return visible;
  if (existing.some((_, start) => visible.every((item, index) => existing[start + index] && sameMessage(item, existing[start + index])))) return [];
  for (let size = Math.min(existing.length, visible.length); size > 0; size -= 1) {
    for (let offset = 0; offset <= visible.length - size; offset += 1) {
      if (existing.slice(-size).every((item, index) => sameMessage(item, visible[offset + index]))) return visible.slice(offset + size);
    }
  }
  throw new Error("当前可见聊天记录与已保存记录没有重叠。请滚动到最近消息后重试，避免重复保存。");
}

export class PrivateInboxStore {
  private state: InboxState | null = null;
  private loading: Promise<void> | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly filePath: string) {}
  async read(): Promise<InboxState> {
    if (!this.state) {
      this.loading ??= this.load();
      await this.loading;
    }
    return structuredClone(this.state!);
  }
  private async load() {
    let raw: InboxState;
    try { raw = JSON.parse(await fs.readFile(this.filePath, "utf8")) as InboxState; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; raw = emptyState(); }
    const cleaned = sanitizeInboxState(raw);
    this.state = cleaned;
    if (JSON.stringify(raw) !== JSON.stringify(cleaned)) await this.persist(cleaned);
  }
  private async persist(state: InboxState) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(temp, this.filePath);
  }
  private async mutate<T>(change: (state: InboxState) => T): Promise<T> {
    let result!: T;
    const operation = this.pending.then(async () => {
      const state = await this.read();
      result = change(state);
      await this.persist(state);
      this.state = state;
    });
    this.pending = operation.catch(() => undefined);
    await operation;
    return result;
  }
  async linkAccount(deviceId: string, name: string) {
    const cleanName = name.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!deviceId || !cleanName || cleanName.length > 80) throw new Error("请选择设备并填写当前已登录的小红书账号名称。");
    return this.mutate((state) => {
      const existing = state.accounts.find((row) => row.deviceId === deviceId && normalizeCustomer(row.name) === normalizeCustomer(cleanName));
      for (const row of state.accounts) if (row.deviceId === deviceId) row.active = false;
      if (existing) { existing.active = true; return existing; }
      const account: InboxAccount = { id: randomUUID(), deviceId, name: cleanName, active: true, linkedAt: new Date().toISOString() };
      state.accounts.push(account);
      return account;
    });
  }
  async setScanStatus(accountId: string, error?: string) {
    return this.mutate((state) => { const account = state.accounts.find((row) => row.id === accountId); if (account) { account.lastScanAt = new Date().toISOString(); account.scanError = error; } });
  }
  async ingestNotifications(accountId: string, notifications: PrivateNotification[]) {
    return this.mutate((state) => {
      const account = state.accounts.find((row) => row.id === accountId && row.active);
      if (!account) throw new Error("小红书账号未关联到当前云手机，通知不会进入会话。");
      if (!account.notificationBaselineReady) {
        account.knownNotificationKeys = notifications.map((item) => item.key);
        account.notificationBaselineReady = true;
        return 0;
      }
      let added = 0;
      for (const item of notifications) {
        if (account.knownNotificationKeys?.includes(item.key)) continue;
        if (item.legacyKey && account.knownNotificationKeys?.includes(item.legacyKey)) {
          account.knownNotificationKeys = [...(account.knownNotificationKeys || []), item.key].slice(-2000);
          continue;
        }
        account.knownNotificationKeys = [...(account.knownNotificationKeys || []), item.key].slice(-2000);
        const customerKey = normalizeCustomer(item.customerName);
        if (!customerKey) continue;
        let conversation = state.conversations.find((row) => row.accountId === accountId && row.customerKey === customerKey);
        if (!conversation) {
          conversation = { id: randomUUID(), accountId, customerName: item.customerName, customerKey, lastPreview: "", lastMessageAt: item.observedAt, unread: 0, status: "PENDING", notificationKeys: [], messages: [] };
          state.conversations.push(conversation);
        }
        if (conversation.notificationKeys.includes(item.key)) continue;
        conversation.notificationKeys.push(item.key);
        conversation.unread += 1;
        conversation.status = "PENDING";
        conversation.lastPreview = item.preview ? `通知摘要：${item.preview}` : "收到私信通知，待同步聊天记录";
        conversation.lastMessageAt = item.observedAt;
        added += 1;
      }
      return added;
    });
  }
  async syncMessages(accountId: string, customerName: string, visible: VisibleMessage[]) {
    return this.mutate((state) => {
      const account = state.accounts.find((row) => row.id === accountId && row.active);
      if (!account) throw new Error("当前云手机的小红书账号关联已变更，请重新选择账号。");
      const customerKey = normalizeCustomer(customerName);
      let conversation = state.conversations.find((row) => row.accountId === accountId && row.customerKey === customerKey);
      if (!conversation) {
        conversation = { id: randomUUID(), accountId, customerName, customerKey, lastPreview: "", lastMessageAt: new Date().toISOString(), unread: 0, status: "PENDING", notificationKeys: [], messages: [] };
        state.conversations.push(conversation);
      }
      const cleanedVisible = cleanVisibleMessages(visible, customerName, account.name);
      if (!cleanedVisible.length) throw new Error("当前聊天页没有可保存的有效消息；控件文字和重复内容已自动忽略。");
      const novel = findNewVisibleMessages(conversation.messages, cleanedVisible);
      const now = new Date().toISOString();
      for (const item of novel) conversation.messages.push({ id: randomUUID(), conversationId: conversation.id, sender: item.sender, replyOrigin: "unknown", text: item.text, timeLabel: item.timeLabel, observedAt: now, sendStatus: item.sender === "customer" ? "received" : "observed" });
      if (novel.length) {
        conversation.lastPreview = novel.at(-1)!.text;
        conversation.lastMessageAt = now;
        if (novel.some((item) => item.sender === "customer")) { conversation.status = "PENDING"; conversation.unread = Math.max(conversation.unread, novel.filter((item) => item.sender === "customer").length); }
      }
      return { conversation, added: novel.length };
    });
  }
  async markRead(id: string) { return this.mutate((state) => { const row = state.conversations.find((item) => item.id === id); if (row) row.unread = 0; return row; }); }
  async setStatus(id: string, status: InboxConversation["status"]) { return this.mutate((state) => { const row = state.conversations.find((item) => item.id === id); if (row) row.status = status; return row; }); }
}

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

const emptyState = (): InboxState => ({ accounts: [], conversations: [] });
export const normalizeCustomer = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

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

export async function parseXhsChatHierarchy(output: string, expectedCustomer: string): Promise<VisibleMessage[]> {
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
  const customerKey = normalizeCustomer(expectedCustomer);
  const hasHeading = xhs.some((node) => normalizeCustomer(node.text || node.desc) === customerKey && node.bounds[1] < height * 0.2);
  const hasInput = xhs.some((node) => /EditText/.test(node.className) && node.bounds[1] > height * 0.65);
  if (!hasHeading || !hasInput) throw new Error("聊天页客户与当前会话不一致，或没有识别到输入框。请打开该客户的聊天页后重试。");
  const visible: VisibleMessage[] = [];
  let timeLabel = "";
  const excluded = /^(发送|返回|更多|私信|消息|聊天|已读|未读|表情|图片|语音)$/;
  for (const node of xhs) {
    const text = node.text.trim();
    const [left, top, right, bottom] = node.bounds;
    if (!text || !/TextView/.test(node.className) || top < height * 0.18 || bottom > height * 0.87) continue;
    if (/^(今天|昨天|前天|\d{1,2}:\d{2}|\d{1,2}月\d{1,2}日)/.test(text) && text.length < 25) { timeLabel = text; continue; }
    if (excluded.test(text) || text === expectedCustomer || text.length > 2000) continue;
    const sender = right <= width * 0.57 ? "customer" : left >= width * 0.43 ? "account" : null;
    if (!sender) continue;
    visible.push({ sender, text, timeLabel: timeLabel || undefined });
  }
  if (!visible.length) throw new Error("已进入聊天页，但无法可靠识别消息气泡；本次未写入任何聊天记录。");
  return visible;
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
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly filePath: string) {}
  async read(): Promise<InboxState> {
    if (!this.state) {
      try { this.state = JSON.parse(await fs.readFile(this.filePath, "utf8")) as InboxState; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; this.state = emptyState(); }
    }
    return structuredClone(this.state);
  }
  private async mutate<T>(change: (state: InboxState) => T): Promise<T> {
    let result!: T;
    const operation = this.pending.then(async () => {
      const state = await this.read();
      result = change(state);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
      await fs.rename(temp, this.filePath);
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
      const novel = findNewVisibleMessages(conversation.messages, visible);
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

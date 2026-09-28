import path from "node:path";
import type express from "express";
import { PrivateInboxStore, parseXhsChatPage, parseXhsNotifications, type InboxAccount, type InboxConversation } from "./private-inbox";
import type { AliyunCloudPhoneProvider } from "./cloud-phone/providers/aliyun-cloud-phone-provider";
import type { CloudPhoneDevice } from "./cloud-phone/domain/types";

const NOTIFICATION_COMMAND = "dumpsys notification --noredact";
const CHAT_COMMAND = "uiautomator dump --compressed /proc/self/fd/1";

export function registerPrivateInboxRoutes(app: express.Express, dependencies: {
  getProvider: () => AliyunCloudPhoneProvider;
  safeError: (error: unknown) => string;
}) {
  const store = new PrivateInboxStore(path.join(process.cwd(), "data", "private-inbox.json"));
  let scanning = false;
  app.use("/api/private-inbox", (req, res, next) => {
    const pageOrigin = req.get("origin") || "";
    if (!pageOrigin) { next(); return; }
    try {
      const origin = new URL(pageOrigin);
      const configuredOrigin = process.env.WEB_ORIGIN ? new URL(process.env.WEB_ORIGIN).origin : "";
      if (origin.host === req.get("host") || origin.origin === configuredOrigin) { next(); return; }
    } catch { /* Reject malformed origins below. */ }
    res.status(403).json({ message: "当前页面来源不受信任，请从本系统登录页进入。" });
  });

  async function resolvedDevice(provider: AliyunCloudPhoneProvider, account: InboxAccount): Promise<CloudPhoneDevice> {
    const device = (await provider.describeDevices()).find((item) => item.id === account.deviceId);
    if (!device) throw new Error("已关联云手机不在当前实例列表中，请检查服务端实例 ID 配置。");
    if (device.runtimeStatus !== "RUNNING") throw new Error("云手机未运行，无法采集私信。请先在云手机控制台开机。");
    return device;
  }

  async function scan() {
    if (scanning) return { busy: true, results: [] };
    scanning = true;
    const results: Array<{ accountId: string; added: number; error?: string }> = [];
    try {
      const { accounts } = await store.read();
      if (!accounts.some((item) => item.active)) return { busy: false, results };
      const provider = dependencies.getProvider();
      let devices: CloudPhoneDevice[];
      try { devices = await provider.describeDevices(); }
      catch (error) {
        const message = dependencies.safeError(error);
        for (const account of accounts.filter((item) => item.active)) { await store.setScanStatus(account.id, message); results.push({ accountId: account.id, added: 0, error: message }); }
        return { busy: false, results };
      }
      for (const account of accounts.filter((item) => item.active)) {
        try {
          const device = devices.find((item) => item.id === account.deviceId);
          if (!device || device.runtimeStatus !== "RUNNING") throw new Error("云手机不可用，请确认设备在线且实例 ID 已配置。");
          const output = await provider.runReadOnlyCommand(device, NOTIFICATION_COMMAND);
          if (!output.trim()) throw new Error("云手机未返回通知数据，请确认远程命令权限和通知访问状态。");
          const notifications = parseXhsNotifications(output);
          const added = await store.ingestNotifications(account.id, notifications);
          await store.setScanStatus(account.id);
          results.push({ accountId: account.id, added });
        } catch (error) {
          const message = dependencies.safeError(error);
          await store.setScanStatus(account.id, message);
          results.push({ accountId: account.id, added: 0, error: message });
        }
      }
      return { busy: false, results };
    } finally { scanning = false; }
  }

  app.get("/api/private-inbox", async (_req, res) => {
    try {
      const state = await store.read();
      res.json({ ...state, conversations: state.conversations.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)) });
    } catch (error) { res.status(500).json({ message: dependencies.safeError(error) }); }
  });

  app.post("/api/private-inbox/accounts", async (req, res) => {
    try {
      const deviceId = String(req.body?.deviceId || "");
      const device = (await dependencies.getProvider().describeDevices()).find((item) => item.id === deviceId);
      if (!device) { res.status(404).json({ message: "请选择当前可用的云手机。" }); return; }
      const account = await store.linkAccount(deviceId, String(req.body?.name || ""));
      const baseline = await scan();
      res.status(201).json({ account, baseline });
    } catch (error) { res.status(422).json({ message: dependencies.safeError(error) }); }
  });

  app.post("/api/private-inbox/scan", async (_req, res) => {
    try { res.json(await scan()); }
    catch (error) { res.status(502).json({ message: dependencies.safeError(error) }); }
  });

  app.post("/api/private-inbox/sync", async (req, res) => {
    try {
      const accountId = String(req.body?.accountId || "");
      const customerName = String(req.body?.customerName || "").normalize("NFKC").trim();
      if (customerName.length > 80) { res.status(422).json({ message: "客户名称最多 80 个字符。" }); return; }
      const account = (await store.read()).accounts.find((item) => item.id === accountId && item.active);
      if (!account) { res.status(409).json({ message: "账号未关联当前设备，请先在左侧确认账号。" }); return; }
      const provider = dependencies.getProvider();
      const device = await resolvedDevice(provider, account);
      const output = await provider.runReadOnlyCommand(device, CHAT_COMMAND);
      const page = await parseXhsChatPage(output, customerName, account.name);
      res.json(await store.syncMessages(accountId, page.customerName, page.messages));
    } catch (error) { res.status(502).json({ message: dependencies.safeError(error) }); }
  });

  app.post("/api/private-inbox/conversations/:id/read", async (req, res) => {
    try { const row = await store.markRead(req.params.id); if (!row) { res.status(404).json({ message: "会话不存在。" }); return; } res.json({ conversation: row }); }
    catch (error) { res.status(500).json({ message: dependencies.safeError(error) }); }
  });
  app.post("/api/private-inbox/conversations/:id/status", async (req, res) => {
    const status = req.body?.status as InboxConversation["status"];
    if (!["PENDING", "CLOSED", "AI_HANDLED"].includes(status)) { res.status(422).json({ message: "无效的会话状态。" }); return; }
    try { const row = await store.setStatus(req.params.id, status); if (!row) { res.status(404).json({ message: "会话不存在。" }); return; } res.json({ conversation: row }); }
    catch (error) { res.status(500).json({ message: dependencies.safeError(error) }); }
  });

  const timer = setInterval(() => { void scan().catch(() => undefined); }, 30_000);
  timer.unref();
}

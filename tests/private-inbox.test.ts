import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectXhsLoggedOut, isPrivateInboxNoise, PrivateInboxStore, parseXhsChatHierarchy, parseXhsChatPage, parseXhsNotifications } from "../server/private-inbox";
import { canSyncCurrentChat, filterInboxConversations } from "../src/private-inbox";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });
async function store() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ideact-private-")); dirs.push(dir); return { file: path.join(dir, "inbox.json"), value: new PrivateInboxStore(path.join(dir, "inbox.json")) }; }
const notification = (title: string, key: string, preview = "你好") => `NotificationRecord(0x123: pkg=com.xingin.xhs user=UserHandle{0} key=${key} postTime=1720000000000\n  android.title=String (${title})\n  android.text=String (${preview})\n)`;

describe("private inbox notification intake", () => {
  it("accepts only exact XHS private-message titles and cleans customer name", () => {
    const output = [notification("小橘 私信你", "one"), notification("小橘 评论了你", "two"), notification("推荐你关注", "three"), notification("小橘 私信你", "four", "另一条")].join("\n");
    expect(parseXhsNotifications(output)).toMatchObject([{ customerName: "小橘", preview: "你好" }, { customerName: "小橘", preview: "另一条" }]);
    expect(parseXhsNotifications("NotificationRecord(pkg=com.other.app android.title=String (小橘 私信你))")).toEqual([]);
  });

  it("baselines old notifications, deduplicates repeats and keeps same-name customers separate by account", async () => {
    const { file, value } = await store();
    const accountA = await value.linkAccount("phone-a", "账号A");
    const accountB = await value.linkAccount("phone-b", "账号B");
    const old = parseXhsNotifications(notification("小橘 私信你", "old"));
    const fresh = parseXhsNotifications(notification("小橘 私信你", "fresh", "新消息"));
    expect(await value.ingestNotifications(accountA.id, old)).toBe(0);
    expect(await value.ingestNotifications(accountA.id, [...old, ...fresh])).toBe(1);
    expect(await value.ingestNotifications(accountA.id, [...old, ...fresh])).toBe(0);
    expect(await value.ingestNotifications(accountB.id, [])).toBe(0);
    expect(await value.ingestNotifications(accountB.id, fresh)).toBe(1);
    const persisted = await new PrivateInboxStore(file).read();
    expect(persisted.conversations).toHaveLength(2);
    expect(persisted.conversations.every((row) => row.customerName === "小橘" && row.unread === 1 && row.messages.length === 0)).toBe(true);
  });

  it("does not count a changed preview of the same Android notification twice", async () => {
    const { value } = await store();
    const account = await value.linkAccount("phone-a", "账号A");
    await value.ingestNotifications(account.id, []);
    expect(await value.ingestNotifications(account.id, parseXhsNotifications(notification("小橘 私信你", "same", "第一条摘要")))).toBe(1);
    expect(await value.ingestNotifications(account.id, parseXhsNotifications(notification("小橘 私信你", "same", "更新后的摘要")))).toBe(0);
    expect((await value.read()).conversations[0].unread).toBe(1);
  });

  it("recognizes notification fingerprints saved before the stable-key change", async () => {
    const { value } = await store();
    const account = await value.linkAccount("phone-a", "账号A");
    const old = parseXhsNotifications(notification("小橘 私信你", "same", "原摘要"))[0];
    await value.ingestNotifications(account.id, [{ ...old, key: old.legacyKey! }]);
    expect(await value.ingestNotifications(account.id, [old])).toBe(0);
    expect((await value.read()).conversations).toHaveLength(0);
  });

  it("reopens closed conversations when a new notification arrives", async () => {
    const { value } = await store();
    const account = await value.linkAccount("phone-a", "账号A");
    await value.ingestNotifications(account.id, []);
    await value.ingestNotifications(account.id, parseXhsNotifications(notification("小橘 私信你", "first")));
    const conversation = (await value.read()).conversations[0];
    await value.markRead(conversation.id);
    await value.setStatus(conversation.id, "CLOSED");
    await value.ingestNotifications(account.id, parseXhsNotifications(notification("小橘 私信你", "second", "又来了")));
    expect((await value.read()).conversations[0]).toMatchObject({ status: "PENDING", unread: 1 });
  });

  it("does not count a notification and its synced message as two unread messages", async () => {
    const { value } = await store();
    const account = await value.linkAccount("phone-a", "账号A");
    await value.ingestNotifications(account.id, []);
    await value.ingestNotifications(account.id, parseXhsNotifications(notification("小橘 私信你", "fresh")));
    await value.syncMessages(account.id, "小橘", [{ sender: "customer", text: "你好" }]);
    expect((await value.read()).conversations[0]).toMatchObject({ unread: 1, messages: [{ text: "你好" }] });
  });
});

describe("private inbox device and account filters", () => {
  it("does not keep another account's conversation visible after switching devices", () => {
    const inbox = {
      accounts: [
        { id: "account-a", deviceId: "phone-a", name: "账号A", active: true },
        { id: "account-b", deviceId: "phone-b", name: "账号B", active: true },
      ],
      conversations: [
        { id: "conversation-a", accountId: "account-a", customerName: "小橘", lastPreview: "A", lastMessageAt: "2026-09-13T01:00:00Z", unread: 0, status: "PENDING" as const, messages: [] },
        { id: "conversation-b", accountId: "account-b", customerName: "小橘", lastPreview: "B", lastMessageAt: "2026-09-13T02:00:00Z", unread: 0, status: "PENDING" as const, messages: [] },
      ],
    };
    expect(filterInboxConversations(inbox, "phone-b").map((item) => item.id)).toEqual(["conversation-b"]);
    expect(filterInboxConversations(inbox, "account-a").map((item) => item.id)).toEqual(["conversation-a"]);
    expect(filterInboxConversations(inbox, "all").map((item) => item.id)).toEqual(["conversation-b", "conversation-a"]);
  });

  it("allows current-page sync without requiring a manually entered customer name", () => {
    expect(canSyncCurrentChat("account-a", "")).toBe(true);
    expect(canSyncCurrentChat("", "")).toBe(false);
    expect(canSyncCurrentChat("account-a", "sync")).toBe(false);
  });
});

describe("private inbox chat sync", () => {
  const xml = `<hierarchy><node package="com.xingin.xhs" class="android.widget.FrameLayout" bounds="[0,0][1080,1920]"><node package="com.xingin.xhs" class="android.widget.TextView" text="返回" bounds="[0,50][90,130]"/><node package="com.xingin.xhs" class="android.widget.TextView" text="小橘" bounds="[400,50][600,130]"/><node package="com.xingin.xhs" class="android.widget.TextView" text="今天 10:00" bounds="[450,400][650,450]"/><node package="com.xingin.xhs" class="android.widget.TextView" text="你好" bounds="[40,500][300,560]"/><node package="com.xingin.xhs" class="android.widget.TextView" text="你好呀" bounds="[760,610][1040,670]"/><node package="com.xingin.xhs" class="android.widget.EditText" text="" bounds="[100,1760][850,1840]"/></node></hierarchy>`;
  it("extracts visible sender directions and rejects the wrong chat", async () => {
    expect(await parseXhsChatHierarchy(`UI dump\n${xml}`, "小橘")).toMatchObject([{ sender: "customer", text: "你好" }, { sender: "account", text: "你好呀" }]);
    expect(await parseXhsChatPage(`UI dump\n${xml}`)).toMatchObject({ customerName: "小橘", messages: [{ sender: "customer", text: "你好" }, { sender: "account", text: "你好呀" }] });
    await expect(parseXhsChatHierarchy(xml, "另一位客户")).rejects.toThrow(/不一致/);
    await expect(parseXhsChatHierarchy("not xml", "小橘")).rejects.toThrow(/控件树/);
  });

  it("stops chat sync when the Android control tree shows a logged-out account", async () => {
    const loggedOut = `<hierarchy><node package="com.xingin.xhs" text="账号下线通知"/><node package="com.xingin.xhs" text="重新登录"/></hierarchy>`;
    expect(detectXhsLoggedOut(loggedOut)).toMatch(/重新登录小红书/);
    await expect(parseXhsChatHierarchy(loggedOut, "小橘")).rejects.toThrow(/登录失效/);
  });

  it("filters controls, account names, time labels and duplicate visible messages", async () => {
    const noisy = `<hierarchy><node package="com.xingin.xhs" class="android.widget.FrameLayout" bounds="[0,0][1080,1920]">
      <node package="com.xingin.xhs" class="android.widget.TextView" text="返回" bounds="[0,50][90,130]"/>
      <node package="com.xingin.xhs" class="android.widget.TextView" text="小橘" bounds="[400,50][600,130]"/>
      <node package="com.xingin.xhs" class="android.widget.TextView" text="下午9:05" bounds="[450,400][650,450]"/>
      <node package="com.xingin.xhs" class="android.widget.TextView" text="已阅" bounds="[40,480][200,520]"/>
      <node package="com.xingin.xhs" class="android.widget.TextView" text="账号 A" bounds="[40,530][300,580]"/>
      <node package="com.xingin.xhs" class="android.widget.TextView" text="在吗" bounds="[40,600][300,660]"/>
      <node package="com.xingin.xhs" class="android.widget.TextView" text="在吗" bounds="[40,680][300,740]"/>
      <node package="com.xingin.xhs" class="android.widget.EditText" text="" bounds="[100,1760][850,1840]"/>
    </node></hierarchy>`;
    expect(isPrivateInboxNoise("已阅")).toBe(true);
    expect(isPrivateInboxNoise("下午9:05")).toBe(true);
    expect((await parseXhsChatPage(noisy, "小橘", "账号A")).messages).toEqual([{ sender: "customer", text: "在吗", timeLabel: "下午9:05" }]);
  });

  it("does not duplicate a repeated page and persists the timeline", async () => {
    const { file, value } = await store();
    const account = await value.linkAccount("phone-a", "账号A");
    const visible = await parseXhsChatHierarchy(xml, "小橘");
    expect((await value.syncMessages(account.id, "小橘", visible)).added).toBe(2);
    expect((await value.syncMessages(account.id, "小橘", visible)).added).toBe(0);
    const persisted = await new PrivateInboxStore(file).read();
    expect(persisted.conversations[0].messages.map((item) => item.sender)).toEqual(["customer", "account"]);
    expect(persisted.conversations[0].messages[1].replyOrigin).toBe("unknown");
    const appended = [...visible.slice(1), { sender: "customer" as const, text: "还在吗", timeLabel: "今天 10:00" }];
    expect((await value.syncMessages(account.id, "小橘", appended)).added).toBe(1);
    expect((await value.read()).conversations[0].messages).toHaveLength(3);
    const conversationId = (await value.read()).conversations[0].id;
    await value.setStatus(conversationId, "AI_HANDLED");
    await value.syncMessages(account.id, "小橘", [...appended.slice(1), { sender: "customer", text: "新问题", timeLabel: "今天 10:00" }]);
    expect((await value.read()).conversations[0].status).toBe("PENDING");
  });

  it("automatically cleans historical control text and duplicate rows", async () => {
    const { file } = await store();
    const observedAt = "2026-09-27T13:00:00.000Z";
    const state = {
      accounts: [{ id: "account-a", deviceId: "phone-a", name: "账号A", active: true, linkedAt: observedAt }],
      conversations: [{
        id: "conversation-a", accountId: "account-a", customerName: "小橘", customerKey: "小橘", lastPreview: "已阅", lastMessageAt: observedAt, unread: 1, status: "PENDING" as const, notificationKeys: [],
        messages: [
          { id: "1", conversationId: "conversation-a", sender: "customer" as const, replyOrigin: "unknown" as const, text: "已阅", observedAt, sendStatus: "received" as const },
          { id: "2", conversationId: "conversation-a", sender: "customer" as const, replyOrigin: "unknown" as const, text: "在吗", observedAt, sendStatus: "received" as const },
          { id: "3", conversationId: "conversation-a", sender: "customer" as const, replyOrigin: "unknown" as const, text: "在吗", observedAt, sendStatus: "received" as const },
          { id: "4", conversationId: "conversation-a", sender: "account" as const, replyOrigin: "unknown" as const, text: "账号 A", observedAt, sendStatus: "observed" as const },
        ],
      }],
    };
    await fs.writeFile(file, JSON.stringify(state), "utf8");
    const cleaned = await new PrivateInboxStore(file).read();
    expect(cleaned.conversations[0].messages.map((item) => item.text)).toEqual(["在吗"]);
    expect(cleaned.conversations[0].lastPreview).toBe("在吗");
    expect((await new PrivateInboxStore(file).read()).conversations[0].messages).toHaveLength(1);
  });
});

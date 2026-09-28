import { describe, expect, it } from "vitest";
import { buildOperationsOverview, parseStoredArray } from "../src/operations-overview-data";
import type { CreationObject, CreativeBrief } from "../src/creation-objects";

const objects: CreationObject[] = [
  {
    id: "brand-a",
    name: "品牌 A",
    type: "brand",
    positioning: "测试品牌",
    contentStyle: "自然",
    knowledgeBaseId: "kb-a",
    knowledgeBaseName: "品牌 A 知识库",
    topicWeights: { trend: 20, painPoint: 20, product: 20, trust: 20, conversion: 20 },
    styleSamples: [],
    bannedExpressions: [],
  },
  {
    id: "account-b",
    name: "账号 B",
    type: "personal",
    positioning: "测试账号",
    contentStyle: "专业",
    knowledgeBaseId: "kb-b",
    knowledgeBaseName: "账号 B 知识库",
    topicWeights: { trend: 20, painPoint: 20, product: 20, trust: 20, conversion: 20 },
    styleSamples: [],
    bannedExpressions: [],
  },
];

function brief(objectId: string, channels: string[], confirmed: boolean): CreativeBrief {
  return {
    key: `${objectId}-${channels.join("-")}`,
    objectId,
    topicId: "topic-1",
    viewpoint: "测试观点",
    styles: ["自然松弛"],
    channels,
    useProduct: false,
    product: null,
    files: [],
    confirmed,
  };
}

describe("operations overview", () => {
  it("counts topics and briefs by creation object", () => {
    const overview = buildOperationsOverview({
      creationObjects: objects,
      topicGroups: [
        { objectId: "brand-a", topics: [{}, {}, {}] },
        { objectId: "brand-a", topics: [{}, {}] },
        { objectId: "account-b", topics: [{}] },
      ],
      briefs: [brief("brand-a", ["小红书"], true), brief("brand-a", ["公众号"], false), brief("account-b", ["朋友圈"], true)],
      jobs: [],
      accounts: [],
      conversations: [],
    });

    expect(overview.totalTopics).toBe(6);
    expect(overview.totalBriefs).toBe(3);
    expect(overview.confirmedBriefs).toBe(2);
    expect(overview.objects[0]).toMatchObject({ topicCount: 5, briefCount: 2, confirmedBriefCount: 1 });
  });

  it("only treats manually confirmed publish jobs as published", () => {
    const overview = buildOperationsOverview({
      creationObjects: objects,
      topicGroups: [],
      briefs: [brief("brand-a", ["小红书", "公众号"], true)],
      jobs: [
        { channel: "小红书", status: "PUBLISHED" },
        { channel: "小红书", status: "REVIEW_REQUIRED" },
        { channel: "公众号", status: "FAILED" },
      ],
      accounts: [{ id: "a", deviceId: "d", name: "运营账号", active: true }],
      conversations: [{ accountId: "a", unread: 2 }],
    });

    expect(overview.publishedCount).toBe(1);
    expect(overview.pendingPublishCount).toBe(1);
    expect(overview.failedPublishCount).toBe(1);
    expect(overview.channels.find((channel) => channel.name === "小红书")).toMatchObject({ publishedCount: 1, totalJobCount: 2 });
    expect(overview.activeAccountCount).toBe(1);
    expect(overview.unreadConversationCount).toBe(1);
  });

  it("returns an empty array for damaged browser storage", () => {
    expect(parseStoredArray({ getItem: () => "not-json" }, "key")).toEqual([]);
  });
});

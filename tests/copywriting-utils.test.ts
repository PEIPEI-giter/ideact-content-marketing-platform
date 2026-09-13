import { describe, expect, it } from "vitest";
import {
  buildCopyRequestKey,
  normalizeChannels,
  parseCopywritingJson,
  validateCopywritingContext,
  type CopywritingContext,
} from "../server/copywriting-utils";

const context: CopywritingContext = {
  object: {
    id: "brand-cat",
    name: "猫品牌",
    positioning: "面向养猫家庭的宠物用品品牌。",
    contentStyle: "轻松、有画面感、带使用场景。",
    knowledgeBaseId: "cat",
    knowledgeBaseName: "猫知识库",
    styleSamples: ["用养猫人的日常痛点开头。"],
    bannedExpressions: ["永久不坏"],
  },
  topic: {
    id: "topic-1",
    title: "猫为什么总爱抓沙发？",
    direction: "用户问题型",
    reason: "回应养猫家庭的磨爪困扰。",
    relatedProduct: false,
  },
  brief: {
    key: "brief-1",
    viewpoint: "从客厅沙发边的磨爪场景切入。",
    styles: ["有画面感", "真实口语"],
    channels: ["小红书", "朋友圈"],
    useProduct: false,
    product: null,
    files: [],
  },
};

describe("copywriting utils", () => {
  it("keeps only supported requested channels", () => {
    expect(normalizeChannels(["小红书", "微博", "朋友圈"])).toEqual(["小红书", "朋友圈"]);
  });

  it("parses independent channel copies and trims xiaohongshu title", () => {
    const copies = parseCopywritingJson(
      JSON.stringify({
        copies: [
          { channel: "小红书", versionId: "B", title: "这个标题确实已经超过二十个字符需要被安全截断", body: "小红书正文", hashtags: ["养猫", "#猫抓板"] },
          { channel: "朋友圈", title: "不应该保存", body: "朋友圈短文案" },
          { channel: "公众号", title: "未请求渠道", body: "不应出现" },
        ],
      }),
      ["小红书", "朋友圈"],
      "2026-09-12T00:00:00.000Z",
    );

    expect(copies).toHaveLength(2);
    expect(copies[0]).toMatchObject({ channel: "小红书", versionId: "A", body: "小红书正文" });
    expect([...(copies[0] as { title: string }).title]).toHaveLength(20);
    expect(copies[1]).toEqual({ channel: "朋友圈", versionId: "A", body: "朋友圈短文案", generatedAt: "2026-09-12T00:00:00.000Z" });
    expect("title" in copies[1]).toBe(false);
  });

  it("rejects missing channels and cross-knowledge-base products", () => {
    expect(() => validateCopywritingContext({ ...context, brief: { ...context.brief, channels: [] } })).toThrow("至少选择一个");
    expect(() =>
      validateCopywritingContext({
        ...context,
        brief: { ...context.brief, channels: ["小红书"], useProduct: true, product: { id: "other-1", name: "其他商品", knowledgeBaseId: "other" } },
      }),
    ).toThrow("不属于当前创作对象");
  });

  it("builds a stable key from object, topic, brief, product and channels", () => {
    expect(buildCopyRequestKey(context)).toBe(JSON.stringify({ objectId: "brand-cat", topicId: "topic-1", briefKey: "brief-1", productId: "none", channels: ["小红书", "朋友圈"] }));
  });
});

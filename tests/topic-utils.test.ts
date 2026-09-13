import { describe, expect, it } from "vitest";
import { buildResultKey, buildTopicPrompt, getHotspots, parseTopicJson } from "../server/topic-utils";

const context = {
  object: {
    id: "brand-cat",
    name: "猫品牌",
    positioning: "面向养猫家庭的宠物用品品牌",
    contentStyle: "生活化、有趣、有画面",
    knowledgeBaseId: "cat",
    knowledgeBaseName: "猫知识库",
    topicWeights: { trend: 24, painPoint: 24, product: 30, trust: 10, conversion: 12 },
    styleSamples: ["用养猫人的日常痛点开头"],
    bannedExpressions: ["永久不坏"],
  },
  product: { id: "cat-1", name: "阳光椰果猫树猫抓窝", knowledgeBaseId: "cat" },
  historyTitles: ["猫抓板怎么选"],
};

describe("topic utils", () => {
  it("reports missing hotspot module as explicit degradation", () => {
    const hotspots = getHotspots();
    expect(hotspots.status).toBe("not_configured");
    expect(hotspots.items).toEqual([]);
    expect(hotspots.message).toContain("尚未发现");
  });

  it("builds prompt with object, product, weights and hotspot status", () => {
    const messages = buildTopicPrompt(context, ["[1] 商品名称：阳光椰果猫树猫抓窝"], getHotspots());
    const body = messages[1].content;
    expect(body).toContain("猫品牌");
    expect(body).toContain("阳光椰果猫树猫抓窝");
    expect(body).toContain("not_configured");
    expect(body).toContain("不要生成热点结合型");
  });

  it("parses valid topics and removes duplicate titles", () => {
    const topics = parseTopicJson(JSON.stringify({
      topics: [
        { title: "猫为什么总爱抓沙发？", direction: "用户问题型", reason: "回应养猫家庭磨爪痛点。", score: 86, relatedProduct: true, productName: "阳光椰果猫树猫抓窝" },
        { title: "猫为什么总爱抓沙发？", direction: "用户问题型", reason: "重复", score: 60, relatedProduct: false },
        { title: "", direction: "用户问题型", reason: "无效", score: 60, relatedProduct: false },
      ],
    }));
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ title: "猫为什么总爱抓沙发？", score: 86 });
  });

  it("builds stable result key from current conditions", () => {
    expect(buildResultKey("brand-cat", "cat-1", context.object.topicWeights)).toContain("cat-1");
    expect(buildResultKey("brand-cat", null, context.object.topicWeights)).not.toBe(buildResultKey("brand-cat", "cat-1", context.object.topicWeights));
  });
});

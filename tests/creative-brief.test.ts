import { describe, expect, it } from "vitest";
import { buildBriefKey, builtInCreationObjects, canConfirmBrief, createBriefDraft } from "../src/creation-objects";

describe("creative brief", () => {
  const object = builtInCreationObjects.find((item) => item.id === "brand-cat")!;
  const topic = {
    id: "topic-1",
    title: "猫为什么总爱抓沙发？",
    reason: "回应养猫家庭的磨爪困扰，可以从真实客厅场景切入。",
    relatedProduct: true,
    productName: "阳光椰果猫树猫抓窝",
  };

  it("creates a brief draft from selected object, topic and product", () => {
    const product = { id: "cat-1", name: "阳光椰果猫树猫抓窝", knowledgeBaseId: "cat" };
    const key = buildBriefKey(object.id, topic.id, product.id);
    const brief = createBriefDraft(key, object, { objectId: object.id, promoteProduct: true, product }, topic);

    expect(brief).toMatchObject({
      key,
      objectId: object.id,
      topicId: topic.id,
      useProduct: true,
      product,
      channels: ["小红书"],
      confirmed: false,
    });
    expect(brief.viewpoint).toContain("真实使用场景");
    expect(brief.viewpoint).toContain("不要一开头就介绍商品");
  });

  it("keeps no-product decision explicit", () => {
    const brief = createBriefDraft(buildBriefKey(object.id, topic.id, null), object, { objectId: object.id, promoteProduct: false, product: null }, { ...topic, relatedProduct: false });
    expect(brief.useProduct).toBe(false);
    expect(brief.product).toBeNull();
    expect(brief.viewpoint).toContain("不主动植入具体商品");
  });

  it("requires viewpoint and at least one channel before confirmation", () => {
    expect(canConfirmBrief({ viewpoint: "从客厅场景切入", channels: ["小红书"] })).toBe(true);
    expect(canConfirmBrief({ viewpoint: "", channels: ["小红书"] })).toBe(false);
    expect(canConfirmBrief({ viewpoint: "从客厅场景切入", channels: [] })).toBe(false);
  });
});

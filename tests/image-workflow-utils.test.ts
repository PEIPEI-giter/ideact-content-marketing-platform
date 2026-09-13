import { describe, expect, it } from "vitest";
import { buildSocialImagePrompt, parseVisualDirectionsJson, validateSocialImageRequest, type SocialImageRequest } from "../server/image-workflow-utils";

const request: SocialImageRequest = {
  context: {
    object: {
      id: "brand-cat",
      name: "猫品牌",
      positioning: "面向养猫家庭的宠物用品品牌。",
      contentStyle: "轻松、有画面感、带使用场景。",
      knowledgeBaseId: "cat",
      knowledgeBaseName: "猫知识库",
      styleSamples: [],
      bannedExpressions: [],
    },
    topic: {
      id: "topic-1",
      title: "猫为什么总爱抓沙发？",
      reason: "回应养猫家庭的磨爪困扰。",
      relatedProduct: false,
    },
    brief: {
      key: "brief-1",
      viewpoint: "从猫咪在沙发边磨爪的场景切入。",
      styles: ["有画面感"],
      channels: ["小红书"],
      useProduct: false,
      product: null,
      files: [],
    },
  },
  copy: { channel: "小红书", title: "猫抓沙发怎么办", body: "正文" },
};

describe("image workflow utils", () => {
  it("builds a social image prompt without forcing product or people", () => {
    const prompt = buildSocialImagePrompt(request);
    expect(prompt).toContain("不要突出或虚构任何具体商品");
    expect(prompt).toContain("猫品牌");
    expect(prompt).not.toContain("人物手持");
  });

  it("uses edited prompt first", () => {
    expect(buildSocialImagePrompt({ ...request, prompt: "用户最终确认的Prompt" })).toBe("用户最终确认的Prompt");
  });

  it("rejects cross-knowledge-base product image generation", () => {
    expect(() =>
      validateSocialImageRequest({
        ...request,
        context: {
          ...request.context,
          brief: { ...request.context.brief, useProduct: true, product: { id: "other", name: "其他商品", knowledgeBaseId: "other" } },
        },
      }),
    ).toThrow("不属于创作对象");
  });

  it("parses visual directions", () => {
    const directions = parseVisualDirectionsJson(JSON.stringify({ directions: [{ name: "猫咪视角", subject: "猫", prompt: "一只猫在客厅观察猫抓板" }] }));
    expect(directions).toHaveLength(1);
    expect(directions[0]).toMatchObject({ name: "猫咪视角", subject: "猫" });
  });
});

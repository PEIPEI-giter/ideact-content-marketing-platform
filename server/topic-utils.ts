import type { ChatMessage } from "./model-clients";

export type TopicDirection = "产品价值型" | "用户问题型" | "品牌观点型" | "热点结合型";

export type TopicWeights = {
  trend: number;
  painPoint: number;
  product: number;
  trust: number;
  conversion: number;
};

export type TopicRequestContext = {
  object: {
    id: string;
    name: string;
    positioning: string;
    contentStyle: string;
    knowledgeBaseId: string;
    knowledgeBaseName: string;
    topicWeights: TopicWeights;
    styleSamples: string[];
    bannedExpressions: string[];
  };
  product: { id: string; name: string; knowledgeBaseId: string } | null;
  historyTitles: string[];
};

export type HotspotStatus = "available" | "not_configured" | "failed" | "expired";

export type HotspotItem = {
  title: string;
  source: string;
  summary: string;
  eventTime?: string;
  fetchedAt?: string;
  expiresAt?: string;
  url?: string;
};

export type GeneratedTopic = {
  id: string;
  title: string;
  direction: TopicDirection;
  reason: string;
  score: number;
  relatedProduct: boolean;
  productName?: string;
  hotspotEvidence?: {
    title: string;
    source: string;
    summary: string;
    eventTime?: string;
    fetchedAt?: string;
    expiresAt?: string;
    url?: string;
    relationReason: string;
    needsReview?: boolean;
  };
};

export function getHotspots(): { status: HotspotStatus; message: string; items: HotspotItem[] } {
  return {
    status: "not_configured",
    message: "项目中尚未发现可复用的热点模块接口或缓存，本次按无热点数据降级生成。",
    items: [],
  };
}

export function buildTopicPrompt(context: TopicRequestContext, knowledgeSnippets: string[], hotspots: ReturnType<typeof getHotspots>): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是社媒内容选题策划助手。必须只基于提供的创作对象、知识库资料、商品资料、风格样本、历史选题和热点数据生成选题。不得编造热点来源、链接、产品事实或用户反馈。返回严格 JSON。",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task: "生成10个不重复的社媒内容选题",
          output_schema: {
            topics: [
              {
                title: "普通用户一眼能看懂的标题",
                direction: "产品价值型 | 用户问题型 | 品牌观点型 | 热点结合型",
                reason: "简洁说明回应的需求、适合对象的原因、可展开角度",
                score: "0-100，按权重和实际评估计算",
                relatedProduct: "boolean",
                productName: "如关联具体产品则填写",
                hotspotEvidence: "仅热点结合型填写，必须来自提供的 hotspots.items",
              },
            ],
          },
          rules: [
            "正常返回10个选题，不足时不要复制凑数。",
            "不指定产品时 relatedProduct 必须为 false。",
            "指定产品时只能使用 product 中的商品，不能混入其他商品。",
            "热点状态不是 available 或没有自然相关热点时，不要生成热点结合型。",
            "知识库商品事实用于约束事实，风格样本只用于学习表达，不能套用旧事实。",
            "避免照抄历史选题和知识库案例。",
          ],
          object: context.object,
          product: context.product,
          weights: context.object.topicWeights,
          knowledgeSnippets,
          hotspots,
          historyTitles: context.historyTitles,
        },
        null,
        2,
      ),
    },
  ];
}

export function parseTopicJson(text: string): GeneratedTopic[] {
  const jsonText = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const payload = JSON.parse(jsonText) as { topics?: Array<Partial<GeneratedTopic>> };
  const topics = Array.isArray(payload.topics) ? payload.topics : [];
  const seen = new Set<string>();

  return topics
    .map((topic, index): GeneratedTopic | null => {
      const title = String(topic.title || "").trim();
      const direction = String(topic.direction || "").trim() as TopicDirection;
      const reason = String(topic.reason || "").trim();
      const score = Math.max(0, Math.min(100, Number(topic.score) || 0));
      if (!title || !reason || !["产品价值型", "用户问题型", "品牌观点型", "热点结合型"].includes(direction)) return null;
      if (seen.has(title)) return null;
      seen.add(title);
      const parsed: GeneratedTopic = {
        id: `topic-${Date.now()}-${index}`,
        title,
        direction,
        reason,
        score,
        relatedProduct: Boolean(topic.relatedProduct),
        productName: topic.productName,
        hotspotEvidence: topic.hotspotEvidence,
      };
      return parsed;
    })
    .filter((topic): topic is GeneratedTopic => Boolean(topic));
}

export function buildResultKey(objectId: string, productId: string | null, weights: TopicWeights) {
  return JSON.stringify({ objectId, productId: productId || "none", weights });
}

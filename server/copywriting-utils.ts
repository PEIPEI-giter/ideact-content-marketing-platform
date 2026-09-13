import type { ChatMessage } from "./model-clients";
import type { Citation } from "./knowledge-utils";

export type CopyChannel = "小红书" | "公众号" | "朋友圈";

export type CopywritingContext = {
  object: {
    id: string;
    name: string;
    positioning: string;
    contentStyle: string;
    knowledgeBaseId: string;
    knowledgeBaseName: string;
    styleSamples?: string[];
    bannedExpressions?: string[];
  };
  topic: {
    id: string;
    title: string;
    direction?: string;
    reason: string;
    relatedProduct: boolean;
    productName?: string;
  };
  brief: {
    key: string;
    viewpoint: string;
    styles: string[];
    channels: CopyChannel[];
    useProduct: boolean;
    product: { id: string; name: string; knowledgeBaseId: string } | null;
    files?: Array<{ name: string; type: string; status: string }>;
  };
};

export type XiaohongshuCopy = {
  channel: "小红书";
  versionId: "A";
  title: string;
  body: string;
  hashtags: string[];
  generatedAt: string;
};

export type WechatCopy = {
  channel: "公众号";
  versionId: "A";
  title: string;
  body: string;
  generatedAt: string;
};

export type MomentsCopy = {
  channel: "朋友圈";
  versionId: "A";
  body: string;
  generatedAt: string;
};

export type ChannelCopy = XiaohongshuCopy | WechatCopy | MomentsCopy;

const validChannels: CopyChannel[] = ["小红书", "公众号", "朋友圈"];

export function normalizeChannels(channels: unknown): CopyChannel[] {
  if (!Array.isArray(channels)) return [];
  return channels.filter((channel): channel is CopyChannel => validChannels.includes(channel as CopyChannel));
}

export function buildCopyRequestKey(context: CopywritingContext) {
  return JSON.stringify({
    objectId: context.object.id,
    topicId: context.topic.id,
    briefKey: context.brief.key,
    productId: context.brief.useProduct ? context.brief.product?.id || null : "none",
    channels: normalizeChannels(context.brief.channels),
  });
}

export function validateCopywritingContext(context: CopywritingContext) {
  if (!context.object?.id || !context.object?.knowledgeBaseId) {
    throw new Error("缺少创作对象或关联知识库，无法生成文字内容。");
  }
  if (!context.topic?.id || !context.topic?.title) {
    throw new Error("缺少已选择的选题，无法生成文字内容。");
  }
  if (!context.brief?.viewpoint?.trim()) {
    throw new Error("请先填写创作简报中的观点与内容要求。");
  }
  const channels = normalizeChannels(context.brief.channels);
  if (channels.length === 0) {
    throw new Error("请至少选择一个发布渠道。");
  }
  if (context.brief.useProduct) {
    if (!context.brief.product) throw new Error("已选择关联产品，但缺少具体商品。");
    if (context.brief.product.knowledgeBaseId !== context.object.knowledgeBaseId) {
      throw new Error("选中的商品不属于当前创作对象关联的知识库，已拒绝生成。");
    }
  }
}

export function buildCopywritingPrompt(context: CopywritingContext, citations: Citation[]): ChatMessage[] {
  const channels = normalizeChannels(context.brief.channels);
  const knowledgeSnippets = citations
    .slice(0, 10)
    .map((item) => `[${item.sourceNumber}] ${item.documentName}\n${item.snippet}`)
    .join("\n\n");

  return [
    {
      role: "system",
      content:
        "你是社媒内容文案创作者。必须严格基于用户简报、已选选题、当前知识库资料和创作对象风格生成文案。商品和品牌客观事实只能来自提供的知识库片段；资料没有写到的尺寸、材质、成分、价格、效果、用户反馈、销量和活动不得补充。历史风格样本只用于学习语气和结构，不能照抄标题、长句、经历或旧事实。返回严格 JSON，不要输出解释。",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task: "根据同一个主题，为用户选择的渠道生成首次文案定稿",
          output_schema: {
            copies: [
              {
                channel: "小红书 | 公众号 | 朋友圈",
                versionId: "A",
                title: "小红书和公众号必填；朋友圈不得返回 title。小红书标题最多20个字符。",
                body: "完整正文",
                hashtags: "仅小红书返回字符串数组",
              },
            ],
          },
          priority: [
            "用户本次填写的观点和创作要求",
            "用户确认的选题",
            "知识库中的品牌和商品事实",
            "当前创作对象的账号风格",
            "用户认可的历史风格样本",
            "各平台的内容格式要求",
          ],
          rules: [
            "只生成 requestedChannels 中列出的渠道，不要生成备用渠道。",
            "所有渠道围绕同一个选题和核心观点，但结构、语气和展开方式必须明显不同。",
            "小红书只生成版本A，标题最多20个字符，包含 title、body、hashtags。",
            "公众号只生成版本A，包含 title、body，有清晰开头、层次和结尾。",
            "朋友圈只生成版本A，只返回 body，不返回 title，不堆砌话题标签。",
            context.brief.useProduct ? "可以使用 selectedProduct，但产品事实必须来自 knowledgeSnippets。" : "用户选择不植入具体产品，不得主动绑定或暗示任何具体商品。",
            "不得虚构亲身经历、用户评价、销售数据、实验数据、使用效果或知识库没有提供的商品参数。",
            "不得照抄 styleSamples、知识库案例或旧活动内容。",
          ],
          requestedChannels: channels,
          object: context.object,
          topic: context.topic,
          brief: {
            viewpoint: context.brief.viewpoint,
            styles: context.brief.styles,
            useProduct: context.brief.useProduct,
            selectedProduct: context.brief.useProduct ? context.brief.product : null,
            uploadedFiles: context.brief.files?.map((file) => ({ name: file.name, type: file.type, status: file.status })) ?? [],
          },
          styleSamples: context.object.styleSamples ?? [],
          bannedExpressions: context.object.bannedExpressions ?? [],
          knowledgeSnippets,
        },
        null,
        2,
      ),
    },
  ];
}

export function parseCopywritingJson(text: string, requestedChannels: CopyChannel[], generatedAt = new Date().toISOString()): ChannelCopy[] {
  const jsonText = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const payload = JSON.parse(jsonText) as { copies?: Array<Record<string, unknown>> };
  const copies = Array.isArray(payload.copies) ? payload.copies : [];
  const requested = new Set(requestedChannels);
  const seen = new Set<CopyChannel>();

  return copies
    .map((copy): ChannelCopy | null => {
      const channel = String(copy.channel || "").trim() as CopyChannel;
      if (!requested.has(channel) || seen.has(channel)) return null;
      const body = String(copy.body || "").trim();
      if (!body) return null;
      seen.add(channel);

      if (channel === "小红书") {
        const title = trimXiaohongshuTitle(String(copy.title || "").trim());
        const hashtags = Array.isArray(copy.hashtags)
          ? copy.hashtags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 8)
          : [];
        if (!title || hashtags.length === 0) return null;
        return { channel, versionId: "A", title, body, hashtags, generatedAt };
      }

      if (channel === "公众号") {
        const title = String(copy.title || "").trim();
        if (!title) return null;
        return { channel, versionId: "A", title, body, generatedAt };
      }

      return { channel: "朋友圈", versionId: "A", body, generatedAt };
    })
    .filter((copy): copy is ChannelCopy => Boolean(copy));
}

export function assertCompleteCopies(copies: ChannelCopy[], requestedChannels: CopyChannel[]) {
  const generated = new Set(copies.map((copy) => copy.channel));
  const missing = requestedChannels.filter((channel) => !generated.has(channel));
  if (missing.length > 0) {
    throw new Error(`模型未返回以下渠道的合格文案：${missing.join("、")}。`);
  }
}

function trimXiaohongshuTitle(title: string) {
  return [...title].slice(0, 20).join("");
}

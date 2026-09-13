import type { ImageSize } from "./model-clients";
import type { CopywritingContext } from "./copywriting-utils";

export type ImageChannelCopy = {
  channel: string;
  title?: string;
  body: string;
};

export type SocialImageRequest = {
  context: CopywritingContext;
  copy: ImageChannelCopy;
  size?: ImageSize;
  prompt?: string;
  directionName?: string;
};

export function validateSocialImageRequest(request: SocialImageRequest) {
  if (!request.context?.object?.id || !request.context.object.knowledgeBaseId) {
    throw new Error("缺少创作对象或关联知识库，无法生成图片。");
  }
  if (!request.context?.topic?.title) {
    throw new Error("缺少选题信息，无法生成图片。");
  }
  if (!request.copy?.body?.trim()) {
    throw new Error("缺少当前渠道文案，无法生成图片。");
  }
  if (request.context.brief.useProduct) {
    const product = request.context.brief.product;
    if (!product) throw new Error("当前简报要求关联产品，但缺少具体商品。");
    if (product.knowledgeBaseId !== request.context.object.knowledgeBaseId) {
      throw new Error("当前商品不属于创作对象关联知识库，已拒绝生成图片。");
    }
  }
}

export function buildSocialImagePrompt(request: SocialImageRequest) {
  if (request.prompt?.trim()) return request.prompt.trim();
  const { context, copy } = request;
  const productLine = context.brief.useProduct && context.brief.product
    ? `可以自然呈现产品“${context.brief.product.name}”的使用场景，但不要生成包装上不存在的文字、参数、价格或夸大效果。`
    : "不要突出或虚构任何具体商品，以品牌主题和生活场景为主。";

  return [
    `为内容营销平台生成一张适合“${copy.channel}”文案配图的社媒视觉。`,
    `创作对象：${context.object.name}。定位：${context.object.positioning}`,
    `选题：${context.topic.title}。推荐理由：${context.topic.reason}`,
    `用户简报：${context.brief.viewpoint}`,
    `表达风格：${context.brief.styles.join("、") || context.object.contentStyle}`,
    productLine,
    "画面要求：真实生活场景，有清晰主体，构图干净，适合社媒封面或配图；不要生成大段文字、二维码、水印、品牌 logo、价格标签、虚假截图或夸张前后对比。",
    `参考文案：${[copy.title, copy.body].filter(Boolean).join("\n").slice(0, 900)}`,
  ].join("\n");
}

export function buildVisualDirectionsPrompt(context: CopywritingContext, copies: ImageChannelCopy[]) {
  return [
    {
      role: "system" as const,
      content:
        "你是社媒图片视觉策划。根据创作对象、选题、定稿文案和商品关系生成2到3个不同的视觉方向。必须动态判断画面主体，猫品牌不要默认加入人物。返回严格 JSON。",
    },
    {
      role: "user" as const,
      content: JSON.stringify(
        {
          task: "生成图片制作模块的视觉方向和完整生图Prompt",
          output_schema: {
            directions: [
              {
                id: "短id",
                name: "方向名称",
                expression: "这张图主要表达什么",
                subject: "画面主体",
                scene: "使用场景",
                composition: "构图方式",
                subjectPosition: "主体位置",
                camera: "镜头和景别",
                light: "光线",
                color: "色彩",
                background: "背景与道具",
                blankSpace: "留白位置",
                productFeatures: "需要保持的商品特征",
                avoid: "需要避免的内容",
                prompt: "完整生图Prompt，不要写图片尺寸",
              },
            ],
          },
          rules: [
            "不同方向必须明显不同，不能只是替换形容词。",
            "如果是猫品牌，先判断猫、产品和环境谁是主体，不能套用人物手持产品模板。",
            "商品图用于产品身份，风格参考图只用于构图、光线、色彩和节奏。",
            "不得要求生成logo、水印、二维码、价格、虚假文字或知识库没有提供的产品细节。",
          ],
          object: context.object,
          topic: context.topic,
          brief: context.brief,
          copies,
        },
        null,
        2,
      ),
    },
  ];
}

export type VisualDirection = {
  id: string;
  name: string;
  expression: string;
  subject: string;
  scene: string;
  composition: string;
  subjectPosition: string;
  camera: string;
  light: string;
  color: string;
  background: string;
  blankSpace: string;
  productFeatures: string;
  avoid: string;
  prompt: string;
};

export function parseVisualDirectionsJson(text: string): VisualDirection[] {
  const jsonText = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const payload = JSON.parse(jsonText) as { directions?: Array<Partial<VisualDirection>> };
  return (Array.isArray(payload.directions) ? payload.directions : [])
    .map((item, index): VisualDirection | null => {
      const name = String(item.name || "").trim();
      const prompt = String(item.prompt || "").trim();
      if (!name || !prompt) return null;
      return {
        id: String(item.id || `direction-${index + 1}`).trim(),
        name,
        expression: String(item.expression || "").trim(),
        subject: String(item.subject || "").trim(),
        scene: String(item.scene || "").trim(),
        composition: String(item.composition || "").trim(),
        subjectPosition: String(item.subjectPosition || "").trim(),
        camera: String(item.camera || "").trim(),
        light: String(item.light || "").trim(),
        color: String(item.color || "").trim(),
        background: String(item.background || "").trim(),
        blankSpace: String(item.blankSpace || "").trim(),
        productFeatures: String(item.productFeatures || "").trim(),
        avoid: String(item.avoid || "").trim(),
        prompt,
      };
    })
    .filter((item): item is VisualDirection => Boolean(item))
    .slice(0, 3);
}

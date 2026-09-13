export type CreationObjectType = "brand" | "product" | "personal" | "course";

export type TopicWeights = {
  trend: number;
  painPoint: number;
  product: number;
  trust: number;
  conversion: number;
};

export type CreationObject = {
  id: string;
  name: string;
  type: CreationObjectType;
  positioning: string;
  contentStyle: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  topicWeights: TopicWeights;
  styleSamples: string[];
  bannedExpressions: string[];
  builtIn?: boolean;
};

export type ProductOption = {
  id: string;
  name: string;
  knowledgeBaseId: string;
  sourceNumber?: number;
};

export type CreationSelection = {
  objectId: string;
  promoteProduct: boolean;
  product: ProductOption | null;
};

export type BriefFile = { id: string; name: string; type: string; status: "已关联" | "失败" };

export type BriefTopic = {
  id: string;
  title: string;
  reason: string;
  relatedProduct: boolean;
  productName?: string;
};

export type CreativeBrief = {
  key: string;
  objectId: string;
  topicId: string;
  viewpoint: string;
  styles: string[];
  channels: string[];
  useProduct: boolean;
  product: ProductOption | null;
  files: BriefFile[];
  confirmed: boolean;
};

export const objectTypeLabels: Record<CreationObjectType, string> = {
  brand: "品牌",
  product: "产品业务",
  personal: "个人账号",
  course: "课程项目",
};

export const defaultTopicWeights: TopicWeights = {
  trend: 20,
  painPoint: 25,
  product: 20,
  trust: 20,
  conversion: 15,
};

export const styleOptions = ["有画面感", "自然松弛", "真实口语", "专业可信", "轻种草", "观点鲜明", "不硬广"];
export const channelOptions = ["小红书", "公众号", "朋友圈"];

export const builtInCreationObjects: CreationObject[] = [
  {
    id: "course-ip-growth",
    name: "个人IP增长课",
    type: "course",
    positioning: "面向希望系统打造个人影响力的知识型创业者，强调方法、案例和可执行训练。",
    contentStyle: "清晰、直接、带步骤感，少喊口号，多给判断标准。",
    knowledgeBaseId: "ip-course",
    knowledgeBaseName: "个人IP增长课知识库",
    topicWeights: { trend: 18, painPoint: 28, product: 14, trust: 25, conversion: 15 },
    styleSamples: ["先指出误区，再给可操作框架。", "用真实场景解释抽象增长问题。"],
    bannedExpressions: ["躺赚", "割韭菜", "百分百成功"],
    builtIn: true,
  },
  {
    id: "account-zhixing",
    name: "知行账号",
    type: "personal",
    positioning: "围绕认知升级、行动复盘和个人成长，建立可信、克制、有思考密度的账号形象。",
    contentStyle: "理性、克制、观察型表达，适合长短结合的社媒内容。",
    knowledgeBaseId: "zhixing",
    knowledgeBaseName: "知行账号知识库",
    topicWeights: { trend: 22, painPoint: 24, product: 8, trust: 32, conversion: 14 },
    styleSamples: ["从一个具体观察切入，再落到方法。", "避免宏大叙事，用小结论推动读者行动。"],
    bannedExpressions: ["颠覆认知", "遥遥领先", "封神"],
    builtIn: true,
  },
  {
    id: "brand-guanxia",
    name: "观夏",
    type: "brand",
    positioning: "东方气质生活方式品牌，重视感官、季节、空间和细腻审美表达。",
    contentStyle: "诗性但不空泛，画面感强，语言留白，强调场景与感受。",
    knowledgeBaseId: "guanxia",
    knowledgeBaseName: "观夏知识库",
    topicWeights: { trend: 12, painPoint: 12, product: 28, trust: 30, conversion: 18 },
    styleSamples: ["用季节、气味、空间来承接产品。", "少用硬促销，多用生活场景召回记忆。"],
    bannedExpressions: ["全网最低", "必买爆款", "闭眼入"],
    builtIn: true,
  },
  {
    id: "brand-cat",
    name: "猫品牌",
    type: "brand",
    positioning: "面向养猫家庭的宠物用品品牌，强调好看、耐用、人宠共居和小红书传播感。",
    contentStyle: "轻松、有画面感、带使用场景，适合种草、测评和生活方式内容。",
    knowledgeBaseId: "cat",
    knowledgeBaseName: "猫知识库",
    topicWeights: { trend: 24, painPoint: 24, product: 30, trust: 10, conversion: 12 },
    styleSamples: ["用养猫人的日常痛点开头，转入产品细节。", "标题要有场景钩子，正文避免硬广腔。"],
    bannedExpressions: ["智商税", "吊打同行", "永久不坏"],
    builtIn: true,
  },
];

export function mergeCreationObjects(userObjects: CreationObject[]) {
  const userById = new Map(userObjects.map((item) => [item.id, item]));
  return [...builtInCreationObjects.map((item) => userById.get(item.id) || item), ...userObjects.filter((item) => !builtInCreationObjects.some((builtIn) => builtIn.id === item.id))];
}

export function fuzzyMatchProduct(product: ProductOption, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const normalizedName = product.name.toLowerCase();
  return normalizedName.includes(normalizedQuery) || normalizedQuery.split(/\s+/).every((part) => normalizedName.includes(part));
}

export function isProductAllowedForObject(product: ProductOption | null, object: CreationObject | undefined) {
  if (!product || !object) return false;
  return product.knowledgeBaseId === object.knowledgeBaseId;
}

export function createEmptyUserObject(): CreationObject {
  return {
    id: `user-${Date.now()}`,
    name: "",
    type: "brand",
    positioning: "",
    contentStyle: "",
    knowledgeBaseId: "cat",
    knowledgeBaseName: "猫知识库",
    topicWeights: defaultTopicWeights,
    styleSamples: [],
    bannedExpressions: [],
  };
}

export function buildBriefKey(objectId: string, topicId: string, productId: string | null) {
  return JSON.stringify({ objectId, topicId, productId: productId || "none" });
}

export function createBriefDraft(key: string, object: CreationObject, selection: CreationSelection, topic: BriefTopic): CreativeBrief {
  const inferredStyles = styleOptions.filter((style) => object.contentStyle.includes(style.replace("真实", "").replace("自然", "")));
  const product = selection.promoteProduct && selection.product ? selection.product : null;
  return {
    key,
    objectId: object.id,
    topicId: topic.id,
    viewpoint: buildInitialBriefSuggestion(object, topic, product),
    styles: inferredStyles.length > 0 ? inferredStyles : ["有画面感", "真实口语", "不硬广"],
    channels: ["小红书"],
    useProduct: Boolean(product || topic.relatedProduct),
    product,
    files: [],
    confirmed: false,
  };
}

export function buildInitialBriefSuggestion(object: CreationObject, topic: BriefTopic, product: ProductOption | null) {
  const productLine = product ? `如果提到${product.name}，先讲使用场景，再自然带出它能解决的问题，不要一开头就介绍商品。` : "不主动植入具体商品，先把生活场景和用户问题讲清楚。";
  return `从“${topic.title}”背后的真实使用场景切入，表达${object.name}对这个问题的观察：${topic.reason}${productLine}语气贴近${object.contentStyle}，避免空泛判断和夸张承诺，结尾留下一个能引发评论的具体问题。`;
}

export function canConfirmBrief(brief: Pick<CreativeBrief, "channels" | "viewpoint">) {
  return brief.channels.length > 0 && brief.viewpoint.trim().length > 0;
}

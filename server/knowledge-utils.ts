export type KnowledgeBaseConfig = {
  id: string;
  name: string;
  workspaceId: string;
  indexId: string;
  endpoint: string;
  regionId: string;
};

export type Citation = {
  sourceNumber: number;
  documentName: string;
  snippet: string;
  relevance: number;
  chunkId?: string;
  fileId?: string;
};

export type KnowledgeProduct = {
  id: string;
  name: string;
  knowledgeBaseId: string;
  sourceNumber?: number;
};

export function loadKnowledgeBases(env: NodeJS.ProcessEnv): KnowledgeBaseConfig[] {
  const bases: KnowledgeBaseConfig[] = [];
  const indexes = [...new Set(
    Object.keys(env)
      .map((key) => key.match(/^KB_(\d+)_/)?.[1])
      .filter((value): value is string => Boolean(value))
      .map(Number),
  )].sort((a, b) => a - b);

  for (const index of indexes) {
    const prefix = `KB_${index}_`;
    const id = env[`${prefix}ID`]?.trim();
    const name = env[`${prefix}NAME`]?.trim();
    const workspaceId = env[`${prefix}WORKSPACE_ID`]?.trim();
    const indexId = env[`${prefix}INDEX_ID`]?.trim();

    if (!id && !name && !workspaceId && !indexId) {
      continue;
    }

    if (!id || !name || !workspaceId || !indexId) {
      throw new Error(`知识库 ${index} 配置不完整，请检查 ${prefix}ID、${prefix}NAME、${prefix}WORKSPACE_ID、${prefix}INDEX_ID。`);
    }

    bases.push({
      id,
      name,
      workspaceId,
      indexId,
      endpoint: env[`${prefix}ENDPOINT`]?.trim() || "bailian.cn-beijing.aliyuncs.com",
      regionId: env[`${prefix}REGION_ID`]?.trim() || "cn-beijing",
    });
  }

  return bases;
}

export function publicKnowledgeBase(base: KnowledgeBaseConfig) {
  return {
    id: base.id,
    name: base.name,
    status: "configured" as const,
    endpoint: base.endpoint,
    regionId: base.regionId,
  };
}

export function hasKnowledgeBaseIndex(indices: Array<{ id?: string }> | undefined, indexId: string) {
  return Boolean(indices?.some((index) => index.id === indexId));
}

export function toSafeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(ALIBABA_CLOUD_ACCESS_KEY_ID=)[^\s]+/g, "$1***")
    .replace(/(ALIBABA_CLOUD_ACCESS_KEY_SECRET=)[^\s]+/g, "$1***")
    .replace(/(DASHSCOPE_API_KEY=)[^\s]+/g, "$1***")
    .replace(/access[_-]?key[_-]?secret[^,\s]*/gi, "AccessKeySecret")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
}

export function normalizeRetrieveNodes(data: unknown): Citation[] {
  const root = data as Record<string, unknown> | undefined;
  const candidates =
    (Array.isArray(root?.nodes) && root.nodes) ||
    (Array.isArray(root?.Nodes) && root.Nodes) ||
    (Array.isArray(root?.chunks) && root.chunks) ||
    (Array.isArray(root?.Chunks) && root.Chunks) ||
    [];

  return candidates
    .map((item, index) => normalizeNode(item, index + 1))
    .filter((item): item is Citation => Boolean(item && item.snippet.trim()));
}

export function extractProductsFromCitations(citations: Citation[], knowledgeBaseId: string): KnowledgeProduct[] {
  const productNames = new Map<string, KnowledgeProduct>();
  const patterns = [/商品名称[：:]\s*([^\n#，,。；;]{2,40})/g, /标题[：:]\s*([^\n#。；;]{4,48})/g];

  citations.forEach((citation) => {
    patterns.forEach((pattern) => {
      for (const match of citation.snippet.matchAll(pattern)) {
        const name = cleanupProductName(match[1]);
        if (name && !productNames.has(name)) {
          productNames.set(name, {
            id: `${knowledgeBaseId}-${productNames.size + 1}`,
            name,
            knowledgeBaseId,
            sourceNumber: citation.sourceNumber,
          });
        }
      }
    });
  });

  return [...productNames.values()].slice(0, 30);
}

function cleanupProductName(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/^商品\d+/, "")
    .replace(/^[:：]/, "")
    .split(/工艺|材质|尺寸|产品图|正文|#|\[empty\]/)[0]
    .trim()
    .slice(0, 40);
}

function normalizeNode(item: unknown, sourceNumber: number): Citation | null {
  const node = item as Record<string, unknown> | undefined;
  if (!node) return null;

  const metadata = objectValue(node.metadata) || objectValue(node.Metadata) || {};
  const documentName =
    stringValue(node.documentName) ||
    stringValue(node.DocumentName) ||
    stringValue(node.fileName) ||
    stringValue(node.FileName) ||
    stringValue(metadata.document_name) ||
    stringValue(metadata.file_name) ||
    `来源 ${sourceNumber}`;

  const snippet =
    stringValue(node.text) ||
    stringValue(node.Text) ||
    stringValue(node.content) ||
    stringValue(node.Content) ||
    stringValue(node.chunk) ||
    stringValue(node.Chunk) ||
    "";

  return {
    sourceNumber,
    documentName,
    snippet,
    relevance: numberValue(node.score) ?? numberValue(node.Score) ?? numberValue(node.similarity) ?? 0,
    chunkId: stringValue(node.chunkId) || stringValue(node.ChunkId) || stringValue(node.id) || stringValue(node.Id),
    fileId: stringValue(node.fileId) || stringValue(node.FileId) || stringValue(metadata.file_id),
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function buildGroundedPrompt(question: string, citations: Citation[]) {
  const context = citations
    .map((citation) => `[${citation.sourceNumber}] ${citation.documentName}\n${citation.snippet}`)
    .join("\n\n");

  return [
    {
      role: "system" as const,
      content:
        "你是知识库问答助手。只能根据用户提供的参考资料回答，不得使用外部知识补充。若资料不足，必须回答：当前知识库没有找到足够资料，暂时无法可靠回答这个问题。回答中需要用 [1]、[2] 标注依据。",
    },
    {
      role: "user" as const,
      content: `用户问题：${question}\n\n参考资料：\n${context}`,
    },
  ];
}

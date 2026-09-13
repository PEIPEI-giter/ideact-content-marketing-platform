import { describe, expect, it } from "vitest";
import { buildGroundedPrompt, loadKnowledgeBases, normalizeRetrieveNodes, toSafeError } from "../server/knowledge-utils";

describe("knowledge utils", () => {
  it("loads two knowledge bases without exposing secrets", () => {
    const bases = loadKnowledgeBases({
      KB_1_ID: "brand",
      KB_1_NAME: "品牌知识库",
      KB_1_WORKSPACE_ID: "workspace-a",
      KB_1_INDEX_ID: "index-a",
      KB_2_ID: "product",
      KB_2_NAME: "产品知识库",
      KB_2_WORKSPACE_ID: "workspace-b",
      KB_2_INDEX_ID: "index-b",
      KB_2_ENDPOINT: "bailian-vpc.cn-beijing.aliyuncs.com",
    });

    expect(bases).toHaveLength(2);
    expect(bases[0]).toMatchObject({ id: "brand", workspaceId: "workspace-a", indexId: "index-a" });
    expect(bases[1]).toMatchObject({ id: "product", workspaceId: "workspace-b", endpoint: "bailian-vpc.cn-beijing.aliyuncs.com" });
  });

  it("rejects partial knowledge base config", () => {
    expect(() => loadKnowledgeBases({ KB_1_ID: "brand", KB_1_NAME: "品牌知识库" })).toThrow("配置不完整");
  });

  it("normalizes retrieve nodes into numbered citations", () => {
    const citations = normalizeRetrieveNodes({
      Nodes: [
        { Text: "命中片段 A", FileName: "品牌手册.md", Score: "0.87", ChunkId: "chunk-a" },
        { content: "命中片段 B", metadata: { file_name: "产品文档.md" }, similarity: 0.73 },
      ],
    });

    expect(citations).toEqual([
      expect.objectContaining({ sourceNumber: 1, documentName: "品牌手册.md", snippet: "命中片段 A", relevance: 0.87, chunkId: "chunk-a" }),
      expect.objectContaining({ sourceNumber: 2, documentName: "产品文档.md", snippet: "命中片段 B", relevance: 0.73 }),
    ]);
  });

  it("builds a grounded-only prompt", () => {
    const messages = buildGroundedPrompt("怎么介绍品牌？", [
      { sourceNumber: 1, documentName: "品牌.md", snippet: "品牌定位是专业可信。", relevance: 0.9 },
    ]);

    expect(messages[0].content).toContain("只能根据用户提供的参考资料回答");
    expect(messages[1].content).toContain("[1] 品牌.md");
  });

  it("masks likely secret values in errors", () => {
    const message = toSafeError(new Error("DASHSCOPE_API_KEY=sk-abc123 ALIBABA_CLOUD_ACCESS_KEY_SECRET=very-secret"));
    expect(message).not.toContain("very-secret");
    expect(message).not.toContain("sk-abc123");
  });
});

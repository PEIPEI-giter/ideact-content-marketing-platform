import { describe, expect, it } from "vitest";
import { extractProductsFromCitations } from "../server/knowledge-utils";
import { builtInCreationObjects, fuzzyMatchProduct, isProductAllowedForObject, mergeCreationObjects } from "../src/creation-objects";

describe("creation object selection", () => {
  it("keeps built-in creation objects without user storage", () => {
    const objects = mergeCreationObjects([]);
    expect(objects.map((item) => item.name)).toEqual(expect.arrayContaining(["个人IP增长课", "知行账号", "观夏", "猫品牌"]));
    expect(objects.every((item) => item.knowledgeBaseId)).toBe(true);
  });

  it("allows user object overrides without losing built-ins", () => {
    const objects = mergeCreationObjects([{ ...builtInCreationObjects[0], positioning: "用户修改后的定位", builtIn: false }]);
    expect(objects).toHaveLength(builtInCreationObjects.length);
    expect(objects[0].positioning).toBe("用户修改后的定位");
  });

  it("supports fuzzy product search", () => {
    const product = { id: "p1", name: "阳光椰果猫树猫抓窝", knowledgeBaseId: "cat" };
    expect(fuzzyMatchProduct(product, "椰果")).toBe(true);
    expect(fuzzyMatchProduct(product, "猫抓")).toBe(true);
    expect(fuzzyMatchProduct(product, "狗窝")).toBe(false);
  });

  it("prevents selecting products from another knowledge base", () => {
    const object = builtInCreationObjects.find((item) => item.id === "brand-cat");
    expect(isProductAllowedForObject({ id: "p1", name: "猫抓窝", knowledgeBaseId: "cat" }, object)).toBe(true);
    expect(isProductAllowedForObject({ id: "p2", name: "香氛", knowledgeBaseId: "guanxia" }, object)).toBe(false);
  });

  it("extracts products scoped to the current knowledge base", () => {
    const products = extractProductsFromCitations(
      [
        { sourceNumber: 1, documentName: "产品.md", snippet: "商品名称：阳光椰果猫树猫抓窝\n商品名称：红苹果猫抓柱", relevance: 0.8 },
      ],
      "cat",
    );

    expect(products).toEqual([
      expect.objectContaining({ name: "阳光椰果猫树猫抓窝", knowledgeBaseId: "cat" }),
      expect.objectContaining({ name: "红苹果猫抓柱", knowledgeBaseId: "cat" }),
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { extractProductsFromCitations } from "../server/knowledge-utils";
import {
  builtInCreationObjects,
  fuzzyMatchProduct,
  isProductAllowedForObject,
  mergeCreationObjects,
  normalizeCreationObject,
  upsertCreationObject,
  validateCreationObject,
} from "../src/creation-objects";

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

  it("creates and updates a persistent user object without duplicates", () => {
    const created = { ...builtInCreationObjects[0], id: "user-demo", name: "  新对象  ", builtIn: undefined };
    const stored = upsertCreationObject([], created);
    const updated = upsertCreationObject(stored, { ...created, name: "更新后的对象" });

    expect(stored[0].name).toBe("新对象");
    expect(updated).toHaveLength(1);
    expect(updated[0].name).toBe("更新后的对象");
  });

  it("validates required fields and requires weights to total 100", () => {
    const invalid = normalizeCreationObject({
      ...builtInCreationObjects[0],
      name: " ",
      positioning: " ",
      contentStyle: " ",
      knowledgeBaseId: " ",
      topicWeights: { trend: 10, painPoint: 10, product: 10, trust: 10, conversion: 10 },
    });

    expect(validateCreationObject(invalid)).toEqual(expect.objectContaining({
      name: expect.any(String),
      positioning: expect.any(String),
      contentStyle: expect.any(String),
      knowledgeBaseId: expect.any(String),
      topicWeights: expect.any(String),
    }));
    expect(validateCreationObject(builtInCreationObjects[0])).toEqual({});
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

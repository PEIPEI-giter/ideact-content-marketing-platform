import { describe, expect, it } from "vitest";
import { appendImageToRecord, deleteProductionRecord } from "../src/production-records";

describe("production records", () => {
  const records = [
    { id: "new", copy: { key: "same-topic", generatedAt: "2026-09-13T10:00:00Z" }, images: ["first"] },
    { id: "old", copy: { key: "same-topic", generatedAt: "2026-09-12T10:00:00Z" }, images: ["old-image"] },
  ];

  it("archives an image only with its exact copy generation", () => {
    const updated = appendImageToRecord(records, "same-topic", "2026-09-13T10:00:00Z", "second");
    expect(updated[0].images).toEqual(["second", "first"]);
    expect(updated[1].images).toEqual(["old-image"]);
    expect(records[0].images).toEqual(["first"]);
  });

  it("does not resurrect a deleted record when an image finishes later", () => {
    const remaining = deleteProductionRecord(records, "new");
    expect(appendImageToRecord(remaining, "same-topic", "2026-09-13T10:00:00Z", "late")).toEqual(remaining);
  });

  it("deletes only the chosen record", () => {
    expect(deleteProductionRecord(records, "old").map((record) => record.id)).toEqual(["new"]);
  });
});

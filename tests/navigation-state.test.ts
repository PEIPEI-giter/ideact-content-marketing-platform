import { describe, expect, it } from "vitest";
import { readNavigationState } from "../src/navigation-state";

describe("navigation state", () => {
  it("restores valid module, workflow step and phone tab", () => {
    expect(readNavigationState("?module=pipeline&step=5&phoneTab=publish")).toEqual({
      module: "pipeline",
      step: 5,
      phoneTab: "publish",
    });
  });

  it("accepts the operations overview module", () => {
    expect(readNavigationState("?module=overview").module).toBe("overview");
  });

  it("falls back safely for invalid URL values", () => {
    expect(readNavigationState("?module=unknown&step=9&phoneTab=other")).toEqual({
      module: "knowledge",
      step: 1,
      phoneTab: "control",
    });
  });
});

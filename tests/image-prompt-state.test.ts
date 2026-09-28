import { describe, expect, it } from "vitest";
import { recoverImagePrompt } from "../src/image-prompt-state";

describe("image prompt recovery", () => {
  const directions = [
    { id: "scene", prompt: "用真实工作桌场景表达主题" },
    { id: "detail", prompt: "用产品细节表达主题" },
  ];

  it("restores the saved direction prompt when a reloaded page lost its draft", () => {
    expect(recoverImagePrompt("", directions, "detail")).toEqual({ directionId: "detail", prompt: "用产品细节表达主题" });
  });

  it("keeps a user's edited prompt instead of replacing it", () => {
    expect(recoverImagePrompt("我修改过的 Prompt", directions, "scene")).toEqual({ directionId: "scene", prompt: "我修改过的 Prompt" });
  });
});

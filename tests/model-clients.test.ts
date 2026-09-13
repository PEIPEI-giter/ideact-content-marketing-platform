import { describe, expect, it } from "vitest";
import {
  buildImageGenerationRequest,
  buildTextGenerationRequest,
  parseImageTaskResult,
  parseImageTaskSubmitResponse,
  parseTextGenerationResponse,
  safeModelError,
} from "../server/model-clients";

describe("model clients", () => {
  it("builds text generation request without secrets", () => {
    const request = buildTextGenerationRequest(
      {
        messages: [{ role: "user", content: "写一句短文案" }],
        temperature: 0.7,
        maxTokens: 80,
      },
      { DASHSCOPE_TEXT_MODEL: "qwen3.7-plus" },
    );

    expect(request.endpoint).toContain("/compatible-mode/v1/chat/completions");
    expect(request.body).toMatchObject({
      model: "qwen3.7-plus",
      stream: false,
      temperature: 0.7,
      max_tokens: 80,
    });
    expect(JSON.stringify(request.body)).not.toContain("DASHSCOPE_API_KEY");
  });

  it("parses text generation response", () => {
    const result = parseTextGenerationResponse(
      {
        id: "chatcmpl-test",
        model: "qwen3.7-plus",
        choices: [{ message: { content: "  生成成功  " } }],
        usage: { total_tokens: 12 },
      },
      "fallback-model",
    );

    expect(result).toMatchObject({ text: "生成成功", model: "qwen3.7-plus", requestId: "chatcmpl-test" });
  });

  it("builds async image generation request with one image", () => {
    const request = buildImageGenerationRequest(
      {
        prompt: "猫咪海报",
        negativePrompt: "模糊",
        size: "1328*1328",
        promptExtend: false,
        watermark: false,
        seed: 123,
      },
      { DASHSCOPE_IMAGE_MODEL: "qwen-image-plus" },
    );

    expect(request.endpoint).toContain("/api/v1/services/aigc/text2image/image-synthesis");
    expect(request.body).toMatchObject({
      model: "qwen-image-plus",
      input: { prompt: "猫咪海报" },
      parameters: {
        negative_prompt: "模糊",
        size: "1328*1328",
        n: 1,
        prompt_extend: false,
        watermark: false,
        seed: 123,
      },
    });
  });

  it("parses async image task responses", () => {
    expect(parseImageTaskSubmitResponse({ output: { task_id: "task-1", task_status: "PENDING" } })).toBe("task-1");
    expect(parseImageTaskResult({ output: { task_id: "task-1", task_status: "RUNNING" } })).toBeNull();
    expect(
      parseImageTaskResult({
        request_id: "request-1",
        output: {
          task_id: "task-1",
          task_status: "SUCCEEDED",
          results: [{ url: "https://example.com/image.png", orig_prompt: "猫", actual_prompt: "高清猫" }],
        },
        usage: { image_count: 1 },
      }),
    ).toEqual({
      images: [{ url: "https://example.com/image.png", origPrompt: "猫", actualPrompt: "高清猫" }],
      requestId: "request-1",
      usage: { image_count: 1 },
    });
  });

  it("masks model secrets in errors", () => {
    const message = safeModelError(new Error("Authorization: Bearer sk-ws-secret DASHSCOPE_API_KEY=sk-test"));
    expect(message).not.toContain("sk-ws-secret");
    expect(message).not.toContain("sk-test");
  });
});

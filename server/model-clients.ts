export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type TextGenerationOptions = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
};

export type TextGenerationResult = {
  text: string;
  model: string;
  requestId?: string;
  usage?: unknown;
  elapsedMs: number;
};

export type ImageSize = "1664*928" | "1472*1104" | "1328*1328" | "1104*1472" | "928*1664";

export type ImageGenerationOptions = {
  prompt: string;
  negativePrompt?: string;
  model?: "qwen-image-plus" | "qwen-image";
  size?: ImageSize;
  promptExtend?: boolean;
  watermark?: boolean;
  enableThinking?: boolean;
  seed?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export type ImageGenerationResult = {
  taskId: string;
  status: "SUCCEEDED";
  images: Array<{
    url: string;
    origPrompt?: string;
    actualPrompt?: string;
    openable?: boolean;
    contentType?: string;
  }>;
  requestId?: string;
  usage?: unknown;
  elapsedMs: number;
};

type ChatCompletionPayload = {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: unknown;
};

type ImageTaskPayload = {
  request_id?: string;
  output?: {
    task_id?: string;
    task_status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "UNKNOWN";
    code?: string;
    message?: string;
    results?: Array<{ url?: string; orig_prompt?: string; actual_prompt?: string }>;
  };
  usage?: unknown;
};

const chatEndpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const imageTaskEndpoint = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis";
const taskQueryEndpoint = "https://dashscope.aliyuncs.com/api/v1/tasks";

export function getDashScopeApiKey(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("缺少 DashScope API Key，请在服务端环境变量中设置 DASHSCOPE_API_KEY。");
  }
  return apiKey;
}

export function safeModelError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(DASHSCOPE_API_KEY=)[^\s]+/g, "$1***")
    .replace(/Bearer\s+sk-[A-Za-z0-9._-]+/g, "Bearer sk-***")
    .replace(/sk-[A-Za-z0-9._-]+/g, "sk-***");
}

export function buildTextGenerationRequest(options: TextGenerationOptions, env: NodeJS.ProcessEnv = process.env) {
  const model = options.model || env.DASHSCOPE_TEXT_MODEL || env.DASHSCOPE_MODEL || "qwen3.7-plus";
  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    stream: false,
  };

  if (typeof options.temperature === "number") body.temperature = options.temperature;
  if (typeof options.topP === "number") body.top_p = options.topP;
  if (typeof options.maxTokens === "number") body.max_tokens = options.maxTokens;

  return { endpoint: chatEndpoint, body };
}

export function parseTextGenerationResponse(payload: ChatCompletionPayload, fallbackModel: string): Omit<TextGenerationResult, "elapsedMs"> {
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("大模型没有返回可展示的文本内容。");
  }
  return {
    text,
    model: payload.model || fallbackModel,
    requestId: payload.id,
    usage: payload.usage,
  };
}

export async function generateText(options: TextGenerationOptions, env: NodeJS.ProcessEnv = process.env): Promise<TextGenerationResult> {
  const apiKey = getDashScopeApiKey(env);
  const { endpoint, body } = buildTextGenerationRequest(options, env);
  const startedAt = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`文本生成失败：${response.status} ${text}`);
  }

  const result = parseTextGenerationResponse((await response.json()) as ChatCompletionPayload, String(body.model));
  return {
    ...result,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

export function buildImageGenerationRequest(options: ImageGenerationOptions, env: NodeJS.ProcessEnv = process.env) {
  const model = options.model || (env.DASHSCOPE_IMAGE_MODEL as ImageGenerationOptions["model"]) || "qwen-image-plus";
  const parameters: Record<string, unknown> = {
    size: options.size || env.DASHSCOPE_IMAGE_SIZE || "1328*1328",
    n: 1,
    prompt_extend: options.promptExtend ?? true,
    watermark: options.watermark ?? false,
  };

  if (options.negativePrompt) parameters.negative_prompt = options.negativePrompt;
  if (typeof options.enableThinking === "boolean") parameters.enable_thinking = options.enableThinking;
  if (typeof options.seed === "number") parameters.seed = options.seed;

  return {
    endpoint: imageTaskEndpoint,
    body: {
      model,
      input: {
        prompt: options.prompt,
      },
      parameters,
    },
  };
}

export function parseImageTaskSubmitResponse(payload: ImageTaskPayload) {
  const taskId = payload.output?.task_id;
  if (!taskId) {
    throw new Error("图片生成任务提交成功，但响应中没有 task_id。");
  }
  return taskId;
}

export function parseImageTaskResult(payload: ImageTaskPayload) {
  const output = payload.output;
  if (!output?.task_status) {
    throw new Error("图片生成任务查询响应缺少 task_status。");
  }

  if (output.task_status === "FAILED" || output.task_status === "CANCELED" || output.task_status === "UNKNOWN") {
    throw new Error(`图片生成任务${output.task_status}：${output.code || "Unknown"} ${output.message || ""}`.trim());
  }

  if (output.task_status !== "SUCCEEDED") {
    return null;
  }

  const images =
    output.results
      ?.map((item) => ({
        url: item.url || "",
        origPrompt: item.orig_prompt,
        actualPrompt: item.actual_prompt,
      }))
      .filter((item) => item.url) || [];

  if (images.length === 0) {
    throw new Error("图片生成任务已成功，但没有返回图片 URL。");
  }

  return {
    images,
    requestId: payload.request_id,
    usage: payload.usage,
  };
}

export async function verifyImageUrl(url: string) {
  const response = await fetch(url, { method: "HEAD" });
  const contentType = response.headers.get("content-type") || undefined;
  return {
    openable: response.ok && Boolean(contentType?.startsWith("image/")),
    contentType,
  };
}

export async function generateImage(options: ImageGenerationOptions, env: NodeJS.ProcessEnv = process.env): Promise<ImageGenerationResult> {
  const apiKey = getDashScopeApiKey(env);
  const { endpoint, body } = buildImageGenerationRequest(options, env);
  const startedAt = performance.now();
  const submitResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify(body),
  });

  if (!submitResponse.ok) {
    const text = await submitResponse.text();
    throw new Error(`图片生成任务提交失败：${submitResponse.status} ${text}`);
  }

  const taskId = parseImageTaskSubmitResponse((await submitResponse.json()) as ImageTaskPayload);
  const pollIntervalMs = options.pollIntervalMs ?? 10000;
  const timeoutMs = options.timeoutMs ?? 180000;

  while (performance.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const queryResponse = await fetch(`${taskQueryEndpoint}/${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!queryResponse.ok) {
      const text = await queryResponse.text();
      throw new Error(`图片生成任务查询失败：${queryResponse.status} ${text}`);
    }

    const result = parseImageTaskResult((await queryResponse.json()) as ImageTaskPayload);
    if (result) {
      const images = await Promise.all(
        result.images.map(async (image) => ({
          ...image,
          ...(await verifyImageUrl(image.url)),
        })),
      );

      return {
        taskId,
        status: "SUCCEEDED",
        images,
        requestId: result.requestId,
        usage: result.usage,
        elapsedMs: Math.round(performance.now() - startedAt),
      };
    }
  }

  throw new Error(`图片生成任务超时：${taskId}，请稍后使用任务查询接口确认结果。`);
}

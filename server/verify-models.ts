import "dotenv/config";
import { generateImage, generateText, safeModelError, type ImageSize } from "./model-clients";

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function verifyText() {
  const startedAt = performance.now();
  const result = await generateText({
    messages: [
      { role: "system", content: "你是内容营销后台的模型连通性验证助手，只返回简短中文。" },
      { role: "user", content: readArg("--prompt") || "用一句话介绍 Ideact 内容营销后台。" },
    ],
    maxTokens: 120,
    temperature: 0.7,
  });

  console.log(JSON.stringify(
    {
      type: "text",
      ok: true,
      model: result.model,
      elapsedMs: Math.round(performance.now() - startedAt),
      text: result.text,
    },
    null,
    2,
  ));
}

async function verifyImage() {
  const startedAt = performance.now();
  const result = await generateImage({
    prompt: readArg("--prompt") || "一张干净明亮的内容营销后台概念图，桌面上有文档、图片卡片和发布日历，现代扁平插画风格",
    negativePrompt: readArg("--negative-prompt") || "",
    size: (readArg("--size") as ImageSize | undefined) || undefined,
    promptExtend: !hasFlag("--no-prompt-extend"),
    watermark: hasFlag("--watermark"),
    pollIntervalMs: Number(readArg("--poll-interval-ms") || 10000),
    timeoutMs: Number(readArg("--timeout-ms") || 180000),
  });

  console.log(JSON.stringify(
    {
      type: "image",
      ok: true,
      taskId: result.taskId,
      elapsedMs: Math.round(performance.now() - startedAt),
      images: result.images.map((image) => ({
        url: image.url,
        openable: image.openable,
        contentType: image.contentType,
        actualPrompt: image.actualPrompt,
      })),
    },
    null,
    2,
  ));
}

async function main() {
  if (!hasFlag("--text") && !hasFlag("--image")) {
    console.log("未发起付费调用。请显式执行：npm run verify:models -- --text 或 npm run verify:models -- --image");
    return;
  }

  try {
    if (hasFlag("--text")) await verifyText();
    if (hasFlag("--image")) await verifyImage();
  } catch (error) {
    console.error(JSON.stringify(
      {
        ok: false,
        message: safeModelError(error),
        suggestions: [
          "确认 .env 中 DASHSCOPE_API_KEY 已填写，且没有提交到前端或日志。",
          "确认对应模型已开通并有可用额度。",
          "图片生成是异步任务，若超时请稍后用返回的 task_id 或调大 --timeout-ms 查询。",
        ],
      },
      null,
      2,
    ));
    process.exitCode = 1;
  }
}

void main();

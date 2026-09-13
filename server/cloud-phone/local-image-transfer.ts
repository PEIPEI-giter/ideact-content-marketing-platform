import crypto from "node:crypto";

const chunkBytes = 9 * 1024;
const maxBytes = 5 * 1024 * 1024;

export async function transferLocalImage(input: {
  image: Buffer;
  targetPath: string;
  run: (command: string) => Promise<string>;
  onProgress?: (completed: number, total: number) => Promise<void>;
}) {
  const { image, targetPath, run, onProgress } = input;
  if (!image.length || image.length > maxBytes) throw new Error("图片为空或超过 5 MB，未向云手机传输。请换一张较小的图片。");
  if (!/^\/sdcard\/Download\/ideact-[a-zA-Z0-9-]+\.(png|jpg|jpeg|webp)$/.test(targetPath)) throw new Error("云手机图片路径无效。");
  const staging = `${targetPath}.b64`;
  const total = Math.ceil(image.length / chunkBytes);
  for (let index = 0; index < total; index += 1) {
    const payload = image.subarray(index * chunkBytes, (index + 1) * chunkBytes).toString("base64");
    const redirect = index === 0 ? ">" : ">>";
    const output = await run(`printf %s ${payload} ${redirect} ${staging} && printf IDEACT_CHUNK_OK`);
    if (!output.includes("IDEACT_CHUNK_OK")) throw new Error(`图片第 ${index + 1}/${total} 块未确认写入，发布已停止。`);
    await onProgress?.(index + 1, total);
  }
  const expected = crypto.createHash("md5").update(image).digest("hex");
  const output = await run(`base64 -d ${staging} > ${targetPath} && md5sum ${targetPath}`);
  if (!output.trim().startsWith(`${expected} `)) throw new Error("图片传入云手机后校验不一致，发布已停止；本机原图仍保留。");
  await run(`rm -f ${staging}`);
  return targetPath;
}

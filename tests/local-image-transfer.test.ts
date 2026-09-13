import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { transferLocalImage } from "../server/cloud-phone/local-image-transfer";

const targetPath = "/sdcard/Download/ideact-123e4567-e89b-12d3-a456-426614174000-1.png";

describe("local image transfer", () => {
  it("sends bounded chunks and verifies the complete image before success", async () => {
    const image = Buffer.alloc(22_000, 42);
    const commands: string[] = [];
    const progress: number[] = [];
    const run = vi.fn(async (command: string) => {
      commands.push(command);
      if (command.includes("md5sum")) return `${crypto.createHash("md5").update(image).digest("hex")}  ${targetPath}\n`;
      return "IDEACT_CHUNK_OK";
    });
    await expect(transferLocalImage({ image, targetPath, run, onProgress: async (done) => { progress.push(done); } })).resolves.toBe(targetPath);
    expect(commands.filter((command) => command.includes("printf %s"))).toHaveLength(3);
    expect(commands.every((command) => command.length < 16_000)).toBe(true);
    expect(progress).toEqual([1, 2, 3]);
    expect(commands.at(-1)).toContain("rm -f");
  });

  it("stops on unconfirmed chunk without decoding or starting publication", async () => {
    const run = vi.fn(async () => "");
    await expect(transferLocalImage({ image: Buffer.from("image"), targetPath, run })).rejects.toThrow("未确认写入");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects corrupted transfer and oversize images", async () => {
    const run = vi.fn(async (command: string) => command.includes("md5sum") ? `deadbeef  ${targetPath}` : "IDEACT_CHUNK_OK");
    await expect(transferLocalImage({ image: Buffer.from("image"), targetPath, run })).rejects.toThrow("校验不一致");
    await expect(transferLocalImage({ image: Buffer.alloc(5 * 1024 * 1024 + 1), targetPath, run })).rejects.toThrow("超过 5 MB");
  });
});

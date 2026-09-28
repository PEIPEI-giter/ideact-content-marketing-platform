import fs from "node:fs/promises";
import path from "node:path";

export const contentWorkspaceKeys = [
  "ideact:userCreationObjects",
  "ideact:socialContentSelection",
  "ideact:socialTopicGroups",
  "ideact:socialTopicFavorites",
  "ideact:creativeBriefs",
  "ideact:socialCopyResults",
  "ideact:socialImageResults",
  "ideact:productionRecords",
  "ideact:visualDirections",
  "ideact:imagePrompts",
  "ideact:selectedTopicId",
  "ideact:activeCopyKey",
  "ideact:activeCopyChannel",
  "ideact:confirmedStepOneKey",
  "ideact:confirmedCopyKey",
  "ideact:creativeBriefContext",
  "ideact:textGenerationContext",
] as const;

export type ContentWorkspaceState = {
  version: 1;
  revision: number;
  updatedAt: string;
  values: Record<string, string>;
};

const emptyState = (): ContentWorkspaceState => ({ version: 1, revision: 0, updatedAt: "", values: {} });
const allowedKeys = new Set<string>(contentWorkspaceKeys);

export function validateContentWorkspaceValues(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("内容工作区数据格式无效。");
  const values: Record<string, string> = {};
  let totalLength = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) continue;
    if (typeof value !== "string") throw new Error(`内容工作区字段 ${key} 必须是字符串。`);
    totalLength += value.length;
    if (totalLength > 8 * 1024 * 1024) throw new Error("内容工作区数据超过 8MB，请先清理不再需要的历史记录。");
    values[key] = value;
  }
  return values;
}
export class ContentWorkspaceStore {
  private state: ContentWorkspaceState | null = null;
  private loading: Promise<void> | null = null;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read() {
    if (!this.state) {
      this.loading ??= this.load();
      await this.loading;
    }
    return structuredClone(this.state!);
  }

  private async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8")) as Partial<ContentWorkspaceState>;
      this.state = {
        version: 1,
        revision: Number.isInteger(parsed.revision) && Number(parsed.revision) >= 0 ? Number(parsed.revision) : 0,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
        values: validateContentWorkspaceValues(parsed.values || {}),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = emptyState();
    }
  }

  async replace(input: unknown) {
    const values = validateContentWorkspaceValues(input);
    let result!: ContentWorkspaceState;
    const operation = this.pending.then(async () => {
      const current = await this.read();
      result = { version: 1, revision: current.revision + 1, updatedAt: new Date().toISOString(), values };
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(result, null, 2), "utf8");
      await fs.rename(temp, this.filePath);
      this.state = result;
    });
    this.pending = operation.catch(() => undefined);
    await operation;
    return structuredClone(result);
  }
}

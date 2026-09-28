import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentWorkspaceStore, validateContentWorkspaceValues } from "../server/content-workspace";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

describe("content workspace persistence", () => {
  it("persists allowed browser state and survives a new store instance", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ideact-content-"));
    dirs.push(dir);
    const file = path.join(dir, "workspace.json");
    const store = new ContentWorkspaceStore(file);
    const first = await store.replace({ "ideact:userCreationObjects": "[]", "ideact:selectedTopicId": "topic-1", ignored: "value" });
    expect(first).toMatchObject({ revision: 1, values: { "ideact:userCreationObjects": "[]", "ideact:selectedTopicId": "topic-1" } });
    expect(first.values).not.toHaveProperty("ignored");
    expect(await new ContentWorkspaceStore(file).read()).toEqual(first);
  });

  it("serializes concurrent replacements and rejects invalid or oversized values", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ideact-content-"));
    dirs.push(dir);
    const store = new ContentWorkspaceStore(path.join(dir, "workspace.json"));
    await Promise.all([
      store.replace({ "ideact:selectedTopicId": "one" }),
      store.replace({ "ideact:selectedTopicId": "two" }),
    ]);
    expect((await store.read()).revision).toBe(2);
    expect(() => validateContentWorkspaceValues({ "ideact:selectedTopicId": 1 })).toThrow(/必须是字符串/);
    expect(() => validateContentWorkspaceValues({ "ideact:productionRecords": "x".repeat(8 * 1024 * 1024 + 1) })).toThrow(/超过 8MB/);
  });
});

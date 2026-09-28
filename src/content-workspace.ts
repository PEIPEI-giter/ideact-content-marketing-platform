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

type WorkspaceResponse = { revision: number; updatedAt: string; values: Record<string, string> };

function localValues() {
  const values: Record<string, string> = {};
  for (const key of contentWorkspaceKeys) {
    const value = localStorage.getItem(key);
    if (value !== null) values[key] = value;
  }
  return values;
}
async function readResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "内容工作区服务暂时不可用。");
  return payload as WorkspaceResponse;
}

export async function hydrateContentWorkspace() {
  const remote = await readResponse(await fetch("/api/content-workspace"));
  if (remote.revision === 0) {
    const existing = localValues();
    if (Object.keys(existing).length) {
      await readResponse(await fetch("/api/content-workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: existing }),
      }));
      return { migrated: true };
    }
  }
  for (const key of contentWorkspaceKeys) {
    if (Object.hasOwn(remote.values, key)) localStorage.setItem(key, remote.values[key]);
    else localStorage.removeItem(key);
  }
  return { migrated: false };
}

export async function saveContentWorkspace() {
  return readResponse(await fetch("/api/content-workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: localValues() }),
  }));
}

import { mergeCreationObjects, type CreationObject, type CreativeBrief } from "./creation-objects";

export type OverviewKnowledgeBase = { id: string; name: string; status?: string };
export type OverviewTopicGroup = { objectId: string; topics?: unknown[] };
export type OverviewPublishJob = { objectName?: string; channel?: string; status: string };
export type OverviewAccount = {
  id: string;
  deviceId: string;
  name: string;
  active: boolean;
  lastScanAt?: string;
  scanError?: string;
};
export type OverviewConversation = { accountId: string; unread?: number; status?: string };

export type OverviewObjectRow = {
  id: string;
  name: string;
  type: CreationObject["type"];
  knowledgeBaseName: string;
  topicCount: number;
  briefCount: number;
  confirmedBriefCount: number;
};

export type OverviewChannelRow = {
  name: string;
  selectedBriefCount: number;
  publishedCount: number;
  totalJobCount: number;
};

export type OperationsOverviewSnapshot = {
  objects: OverviewObjectRow[];
  channels: OverviewChannelRow[];
  totalTopics: number;
  totalBriefs: number;
  confirmedBriefs: number;
  publishedCount: number;
  pendingPublishCount: number;
  failedPublishCount: number;
  activeAccountCount: number;
  unreadConversationCount: number;
};

export function parseStoredArray<T>(storage: Pick<Storage, "getItem">, key: string): T[] {
  try {
    const value = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
}

export function readOverviewLocalData(storage: Pick<Storage, "getItem">) {
  const userObjects = parseStoredArray<CreationObject>(storage, "ideact:userCreationObjects");
  return {
    creationObjects: mergeCreationObjects(userObjects),
    topicGroups: parseStoredArray<OverviewTopicGroup>(storage, "ideact:socialTopicGroups"),
    briefs: parseStoredArray<CreativeBrief>(storage, "ideact:creativeBriefs"),
  };
}

export function buildOperationsOverview(input: {
  creationObjects: CreationObject[];
  topicGroups: OverviewTopicGroup[];
  briefs: CreativeBrief[];
  jobs: OverviewPublishJob[];
  accounts: OverviewAccount[];
  conversations: OverviewConversation[];
}): OperationsOverviewSnapshot {
  const objects = input.creationObjects.map((object) => {
    const topicCount = input.topicGroups
      .filter((group) => group.objectId === object.id)
      .reduce((total, group) => total + (Array.isArray(group.topics) ? group.topics.length : 0), 0);
    const objectBriefs = input.briefs.filter((brief) => brief.objectId === object.id);
    return {
      id: object.id,
      name: object.name,
      type: object.type,
      knowledgeBaseName: object.knowledgeBaseName,
      topicCount,
      briefCount: objectBriefs.length,
      confirmedBriefCount: objectBriefs.filter((brief) => brief.confirmed).length,
    };
  });

  const channelNames = new Set<string>();
  input.briefs.forEach((brief) => brief.channels.forEach((channel) => channelNames.add(channel)));
  input.jobs.forEach((job) => { if (job.channel) channelNames.add(job.channel); });
  const channels = [...channelNames].map((name) => ({
    name,
    selectedBriefCount: input.briefs.filter((brief) => brief.channels.includes(name)).length,
    publishedCount: input.jobs.filter((job) => job.channel === name && job.status === "PUBLISHED").length,
    totalJobCount: input.jobs.filter((job) => job.channel === name).length,
  })).sort((a, b) => b.publishedCount - a.publishedCount || a.name.localeCompare(b.name, "zh-CN"));

  return {
    objects,
    channels,
    totalTopics: objects.reduce((total, object) => total + object.topicCount, 0),
    totalBriefs: objects.reduce((total, object) => total + object.briefCount, 0),
    confirmedBriefs: objects.reduce((total, object) => total + object.confirmedBriefCount, 0),
    publishedCount: input.jobs.filter((job) => job.status === "PUBLISHED").length,
    pendingPublishCount: input.jobs.filter((job) => ["SCHEDULED", "QUEUED", "PREPARING", "RUNNING", "REVIEW_REQUIRED"].includes(job.status)).length,
    failedPublishCount: input.jobs.filter((job) => job.status === "FAILED").length,
    activeAccountCount: input.accounts.filter((account) => account.active).length,
    unreadConversationCount: input.conversations.filter((conversation) => Number(conversation.unread || 0) > 0).length,
  };
}

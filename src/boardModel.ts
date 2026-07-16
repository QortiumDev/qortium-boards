import type { QdnResource } from './types';

export const BOARD_SCHEMA = 'qortium.boards.v1';
export const BOARD_SERVICE = 'JSON';
export const BOARD_FILE_NAME = 'board.json';
export const BOARD_ROOT_NAME = 'Boards';

export const IDENTIFIERS = {
  config: 'qboards.v1.config',
  edit: 'qboards.v1.e.',
  moderation: 'qboards.v1.m.',
  post: 'qboards.v1.p.',
  reaction: 'qboards.v1.r.',
  thread: 'qboards.v1.th.',
  tip: 'qboards.v1.tip.',
  topic: 'qboards.v1.t.',
} as const;

export const REACTION_VALUES = ['like', 'insightful', 'agree', 'laugh', 'support'] as const;
export type ReactionValue = (typeof REACTION_VALUES)[number];

export type AttachmentReference = {
  filename: string;
  identifier: string;
  mimeType?: string;
  name: string;
  service: string;
  size?: number;
};

type RecordBase = {
  createdAt: number;
  id: string;
  schema: typeof BOARD_SCHEMA;
};

export type TopicRecord = RecordBase & {
  description: string;
  kind: 'topic';
  tags: string[];
  title: string;
};

export type ThreadRecord = RecordBase & {
  attachments: AttachmentReference[];
  body: string;
  kind: 'thread';
  poll?: {
    pollId?: number;
    pollName: string;
  } | null;
  title: string;
  topicId: string;
};

export type PostRecord = RecordBase & {
  attachments: AttachmentReference[];
  body: string;
  kind: 'post';
  replyToId?: string | null;
  threadId: string;
};

export type EditRecord = RecordBase & {
  body?: string;
  deleted?: boolean;
  kind: 'edit';
  tags?: string[];
  targetId: string;
  targetKind: 'post' | 'thread' | 'topic';
  title?: string;
};

export type ReactionRecord = RecordBase & {
  kind: 'reaction';
  reaction: ReactionValue | null;
  targetId: string;
  targetKind: 'post' | 'thread';
};

export type ModerationRecord = RecordBase & {
  action: 'hide' | 'lock' | 'pin' | 'show' | 'solve' | 'unlock' | 'unpin' | 'unsolve';
  kind: 'moderation';
  reason?: string;
  targetId: string;
  targetKind: 'post' | 'thread' | 'topic';
};

export type TipRecord = RecordBase & {
  amount: string;
  kind: 'tip';
  recipientAddress: string;
  recipientName?: string;
  targetId: string;
  targetKind: 'post' | 'thread';
  transactionSignature: string;
};

export type BoardConfigRecord = RecordBase & {
  admins: string[];
  kind: 'config';
  moderators: string[];
  title: string;
};

export type BoardRecord =
  | BoardConfigRecord
  | EditRecord
  | ModerationRecord
  | PostRecord
  | ReactionRecord
  | ThreadRecord
  | TipRecord
  | TopicRecord;

export type BoardResource<T extends BoardRecord = BoardRecord> = {
  blockHeight: number;
  created: number;
  identifier: string;
  ownerAddress: string;
  ownerName: string;
  payload: T;
  resource: QdnResource;
  signature: string;
};

export type ReducedTopic = TopicRecord & {
  deleted: boolean;
  hidden: boolean;
  ownerAddress: string;
  ownerName: string;
  resourceCreated: number;
  resourceUpdated: number;
};

export type ReducedThread = ThreadRecord & {
  deleted: boolean;
  hidden: boolean;
  locked: boolean;
  ownerAddress: string;
  ownerName: string;
  pinned: boolean;
  reactionCounts: Record<ReactionValue, number>;
  reactionsByAddress: Record<string, ReactionValue>;
  resourceCreated: number;
  resourceUpdated: number;
  solved: boolean;
  tipCount: number;
  tipTotal: number;
};

export type ReducedPost = PostRecord & {
  deleted: boolean;
  hidden: boolean;
  ownerAddress: string;
  ownerName: string;
  reactionCounts: Record<ReactionValue, number>;
  reactionsByAddress: Record<string, ReactionValue>;
  resourceCreated: number;
  resourceUpdated: number;
  tipCount: number;
  tipTotal: number;
};

export type ReducedBoard = {
  admins: string[];
  moderators: string[];
  posts: ReducedPost[];
  threads: ReducedThread[];
  topics: ReducedTopic[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(getString)
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeAttachments(value: unknown): AttachmentReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): AttachmentReference | null => {
      if (!isRecord(item)) {
        return null;
      }

      const filename = getString(item.filename);
      const identifier = getString(item.identifier);
      const name = getString(item.name);
      const service = getString(item.service).toUpperCase();

      if (!filename || !identifier || !name || !service) {
        return null;
      }

      return {
        filename,
        identifier,
        mimeType: getString(item.mimeType) || undefined,
        name,
        service,
        size: getNumber(item.size),
      };
    })
    .filter((item): item is AttachmentReference => item !== null)
    .slice(0, 8);
}

function parseBase(value: Record<string, unknown>) {
  const id = getString(value.id);
  const createdAt = getNumber(value.createdAt);

  if (value.schema !== BOARD_SCHEMA || !id || !createdAt) {
    return null;
  }

  return { createdAt, id, schema: BOARD_SCHEMA } as const;
}

export function normalizeBoardRecord(value: unknown): BoardRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const base = parseBase(value);
  const kind = getString(value.kind);

  if (!base) {
    return null;
  }

  if (kind === 'topic') {
    const title = getString(value.title);
    if (!title) return null;
    return {
      ...base,
      description: getString(value.description),
      kind,
      tags: stringList(value.tags, 5),
      title,
    };
  }

  if (kind === 'thread') {
    const topicId = getString(value.topicId);
    const title = getString(value.title);
    const body = getString(value.body);
    if (!topicId || !title || !body) return null;
    const pollValue = isRecord(value.poll) ? value.poll : null;
    const pollName = pollValue ? getString(pollValue.pollName) : '';
    return {
      ...base,
      attachments: normalizeAttachments(value.attachments),
      body,
      kind,
      poll: pollName
        ? {
            pollId: getNumber(pollValue?.pollId),
            pollName,
          }
        : null,
      title,
      topicId,
    };
  }

  if (kind === 'post') {
    const threadId = getString(value.threadId);
    const body = getString(value.body);
    if (!threadId || !body) return null;
    return {
      ...base,
      attachments: normalizeAttachments(value.attachments),
      body,
      kind,
      replyToId: getString(value.replyToId) || null,
      threadId,
    };
  }

  if (kind === 'edit') {
    const targetId = getString(value.targetId);
    const targetKind = getString(value.targetKind);
    if (!targetId || !['post', 'thread', 'topic'].includes(targetKind)) return null;
    return {
      ...base,
      body: typeof value.body === 'string' ? value.body.trim() : undefined,
      deleted: value.deleted === true,
      kind,
      tags: Array.isArray(value.tags) ? stringList(value.tags, 5) : undefined,
      targetId,
      targetKind: targetKind as EditRecord['targetKind'],
      title: typeof value.title === 'string' ? value.title.trim() : undefined,
    };
  }

  if (kind === 'reaction') {
    const targetId = getString(value.targetId);
    const targetKind = getString(value.targetKind);
    const reaction = value.reaction === null ? null : getString(value.reaction);
    if (
      !targetId ||
      !['post', 'thread'].includes(targetKind) ||
      (reaction !== null && !REACTION_VALUES.includes(reaction as ReactionValue))
    ) {
      return null;
    }
    return {
      ...base,
      kind,
      reaction: reaction as ReactionValue | null,
      targetId,
      targetKind: targetKind as ReactionRecord['targetKind'],
    };
  }

  if (kind === 'moderation') {
    const targetId = getString(value.targetId);
    const targetKind = getString(value.targetKind);
    const action = getString(value.action);
    const actions: ModerationRecord['action'][] = [
      'hide',
      'lock',
      'pin',
      'show',
      'solve',
      'unlock',
      'unpin',
      'unsolve',
    ];
    if (
      !targetId ||
      !['post', 'thread', 'topic'].includes(targetKind) ||
      !actions.includes(action as ModerationRecord['action'])
    ) {
      return null;
    }
    return {
      ...base,
      action: action as ModerationRecord['action'],
      kind,
      reason: getString(value.reason) || undefined,
      targetId,
      targetKind: targetKind as ModerationRecord['targetKind'],
    };
  }

  if (kind === 'tip') {
    const targetId = getString(value.targetId);
    const targetKind = getString(value.targetKind);
    const amount = getString(value.amount);
    const recipientAddress = getString(value.recipientAddress);
    const transactionSignature = getString(value.transactionSignature);
    if (
      !targetId ||
      !['post', 'thread'].includes(targetKind) ||
      !amount ||
      !recipientAddress ||
      !transactionSignature
    ) {
      return null;
    }
    return {
      ...base,
      amount,
      kind,
      recipientAddress,
      recipientName: getString(value.recipientName) || undefined,
      targetId,
      targetKind: targetKind as TipRecord['targetKind'],
      transactionSignature,
    };
  }

  if (kind === 'config') {
    return {
      ...base,
      admins: stringList(value.admins, 40),
      kind,
      moderators: stringList(value.moderators, 100),
      title: getString(value.title) || 'Qortium Boards',
    };
  }

  return null;
}

export function createBoardId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}${random}`;
}

export function buildIdentifier(kind: BoardRecord['kind'], id: string, targetId?: string) {
  if (kind === 'config') return IDENTIFIERS.config;
  if (kind === 'reaction') return `${IDENTIFIERS.reaction}${targetId ?? id}`;
  const prefix = IDENTIFIERS[kind];
  const identifier = `${prefix}${id}`;
  if (identifier.length > 64) {
    throw new Error('Board resource identifier exceeds the QDN 64-byte limit.');
  }
  return identifier;
}

function resourceOrder(a: BoardResource, b: BoardResource) {
  return a.blockHeight - b.blockHeight || a.signature.localeCompare(b.signature);
}

function emptyReactions(): Record<ReactionValue, number> {
  return { agree: 0, insightful: 0, laugh: 0, like: 0, support: 0 };
}

function reactionState(
  records: BoardResource<ReactionRecord>[],
  targetId: string,
): {
  counts: Record<ReactionValue, number>;
  byAddress: Record<string, ReactionValue>;
} {
  const latest = new Map<string, BoardResource<ReactionRecord>>();

  for (const resource of records.filter((entry) => entry.payload.targetId === targetId).sort(resourceOrder)) {
    latest.set(resource.ownerAddress, resource);
  }

  const counts = emptyReactions();
  const byAddress: Record<string, ReactionValue> = {};

  for (const [address, resource] of latest.entries()) {
    if (resource.payload.reaction) {
      counts[resource.payload.reaction] += 1;
      byAddress[address] = resource.payload.reaction;
    }
  }

  return { byAddress, counts };
}

function applyOwnerEdits<T extends TopicRecord | ThreadRecord | PostRecord>(
  base: BoardResource<T>,
  edits: BoardResource<EditRecord>[],
) {
  let payload = { ...base.payload };
  let deleted = false;
  let updated = base.created;

  for (const edit of edits
    .filter(
      (entry) =>
        entry.payload.targetId === base.payload.id &&
        entry.ownerAddress === base.ownerAddress,
    )
    .sort(resourceOrder)) {
    const patch = edit.payload;
    if (typeof patch.title === 'string' && 'title' in payload && patch.title) {
      payload = { ...payload, title: patch.title };
    }
    if (typeof patch.body === 'string' && 'body' in payload && patch.body) {
      payload = { ...payload, body: patch.body };
    }
    if (Array.isArray(patch.tags) && 'tags' in payload) {
      payload = { ...payload, tags: patch.tags };
    }
    if (patch.deleted) {
      deleted = true;
    }
    updated = Math.max(updated, edit.created);
  }

  return { deleted, payload, updated };
}

function applyModeration(
  targetId: string,
  moderation: BoardResource<ModerationRecord>[],
  authorizedAddresses: Set<string>,
) {
  const state = {
    hidden: false,
    locked: false,
    pinned: false,
    solved: false,
  };

  for (const entry of moderation
    .filter(
      (resource) =>
        resource.payload.targetId === targetId &&
        authorizedAddresses.has(resource.ownerAddress),
    )
    .sort(resourceOrder)) {
    switch (entry.payload.action) {
      case 'hide':
        state.hidden = true;
        break;
      case 'show':
        state.hidden = false;
        break;
      case 'lock':
        state.locked = true;
        break;
      case 'unlock':
        state.locked = false;
        break;
      case 'pin':
        state.pinned = true;
        break;
      case 'unpin':
        state.pinned = false;
        break;
      case 'solve':
        state.solved = true;
        break;
      case 'unsolve':
        state.solved = false;
        break;
    }
  }

  return state;
}

function tipState(records: BoardResource<TipRecord>[], targetId: string) {
  const tips = records.filter((entry) => entry.payload.targetId === targetId);
  return {
    tipCount: tips.length,
    tipTotal: tips.reduce((total, entry) => total + (Number(entry.payload.amount) || 0), 0),
  };
}

function selectCreates<T extends TopicRecord | ThreadRecord | PostRecord>(
  resources: BoardResource<T>[],
) {
  const selected = new Map<string, BoardResource<T>>();

  for (const resource of [...resources].sort(
    (a, b) =>
      resourceOrder(a, b),
  )) {
    if (!selected.has(resource.payload.id)) {
      selected.set(resource.payload.id, resource);
    }
  }

  return [...selected.values()];
}

export function reduceBoard(resources: BoardResource[], rootAddress = ''): ReducedBoard {
  const configs = resources
    .filter(
      (resource): resource is BoardResource<BoardConfigRecord> =>
        resource.payload.kind === 'config' &&
        Boolean(rootAddress) &&
        resource.ownerAddress === rootAddress,
    )
    .sort(resourceOrder);
  const config = configs.at(-1)?.payload;
  const admins = Array.from(new Set([rootAddress, ...(config?.admins ?? [])].filter(Boolean)));
  const moderators = Array.from(new Set(config?.moderators ?? []));
  const authorizedAddresses = new Set([...admins, ...moderators]);

  const edits = resources.filter(
    (resource): resource is BoardResource<EditRecord> => resource.payload.kind === 'edit',
  );
  const moderation = resources.filter(
    (resource): resource is BoardResource<ModerationRecord> =>
      resource.payload.kind === 'moderation',
  );
  const reactions = resources.filter(
    (resource): resource is BoardResource<ReactionRecord> =>
      resource.payload.kind === 'reaction',
  );
  const tips = resources.filter(
    (resource): resource is BoardResource<TipRecord> => resource.payload.kind === 'tip',
  );

  const topics = selectCreates(
    resources.filter(
      (resource): resource is BoardResource<TopicRecord> => resource.payload.kind === 'topic',
    ),
  ).map((resource): ReducedTopic => {
    const edited = applyOwnerEdits(resource, edits);
    const state = applyModeration(resource.payload.id, moderation, authorizedAddresses);
    return {
      ...(edited.payload as TopicRecord),
      deleted: edited.deleted,
      hidden: state.hidden,
      ownerAddress: resource.ownerAddress,
      ownerName: resource.ownerName,
      resourceCreated: resource.created,
      resourceUpdated: edited.updated,
    };
  });

  const threads = selectCreates(
    resources.filter(
      (resource): resource is BoardResource<ThreadRecord> => resource.payload.kind === 'thread',
    ),
  ).map((resource): ReducedThread => {
    const edited = applyOwnerEdits(resource, edits);
    const state = applyModeration(resource.payload.id, moderation, authorizedAddresses);
    const reaction = reactionState(reactions, resource.payload.id);
    return {
      ...(edited.payload as ThreadRecord),
      deleted: edited.deleted,
      hidden: state.hidden,
      locked: state.locked,
      ownerAddress: resource.ownerAddress,
      ownerName: resource.ownerName,
      pinned: state.pinned,
      reactionCounts: reaction.counts,
      reactionsByAddress: reaction.byAddress,
      resourceCreated: resource.created,
      resourceUpdated: edited.updated,
      solved: state.solved,
      ...tipState(tips, resource.payload.id),
    };
  });

  const posts = selectCreates(
    resources.filter(
      (resource): resource is BoardResource<PostRecord> => resource.payload.kind === 'post',
    ),
  ).map((resource): ReducedPost => {
    const edited = applyOwnerEdits(resource, edits);
    const state = applyModeration(resource.payload.id, moderation, authorizedAddresses);
    const reaction = reactionState(reactions, resource.payload.id);
    return {
      ...(edited.payload as PostRecord),
      deleted: edited.deleted,
      hidden: state.hidden,
      ownerAddress: resource.ownerAddress,
      ownerName: resource.ownerName,
      reactionCounts: reaction.counts,
      reactionsByAddress: reaction.byAddress,
      resourceCreated: resource.created,
      resourceUpdated: edited.updated,
      ...tipState(tips, resource.payload.id),
    };
  });

  return { admins, moderators, posts, threads, topics };
}

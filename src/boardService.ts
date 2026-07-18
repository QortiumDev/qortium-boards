import {
  BOARD_FILE_NAME,
  BOARD_ROOT_NAME,
  BOARD_SCHEMA,
  BOARD_SERVICE,
  IDENTIFIERS,
  buildIdentifier,
  createBoardId,
  normalizeBoardRecord,
  reduceBoard,
  type AttachmentReference,
  type BoardRecord,
  type BoardResource,
  type EditRecord,
  type ModerationRecord,
  type PostRecord,
  type ReactionRecord,
  type ReactionValue,
  type ReducedBoard,
  type ThreadRecord,
  type TipRecord,
  type TopicRecord,
} from './boardModel';
import { qdnRequest } from './qdnRequest';
import {
  qdnResourceTarget,
  transactionTarget,
  type QdnResourceConfirmationTarget,
  type TransactionConfirmationTarget,
} from './pendingWrite';
import type {
  PollActionResult,
  PublishActionResult,
  QdnResource,
  QdnSelectedAccount,
  SendCoinResult,
  SourceSelectionResult,
} from './types';

const MAX_RECORD_BYTES = 25_000;
const MAX_PUBLISH_BYTES = 24_000;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_PREFIX = 30;

const prefixes = [
  IDENTIFIERS.config,
  IDENTIFIERS.topic,
  IDENTIFIERS.thread,
  IDENTIFIERS.post,
  IDENTIFIERS.edit,
  IDENTIFIERS.reaction,
  IDENTIFIERS.moderation,
  IDENTIFIERS.tip,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeResource(value: unknown): QdnResource | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = getString(value.name);
  const service = getString(value.service);
  const identifier = getString(value.identifier);

  if (!name || !service || !identifier) {
    return null;
  }

  return {
    created: getNumber(value.created) ?? null,
    identifier,
    latestSignature: getString(value.latestSignature) || null,
    metadata: isRecord(value.metadata) ? value.metadata : null,
    name,
    service,
    size: getNumber(value.size) ?? null,
    status: isRecord(value.status) || typeof value.status === 'string' ? value.status : null,
    updated: getNumber(value.updated) ?? null,
  };
}

function normalizeResources(value: unknown) {
  return Array.isArray(value)
    ? value.map(normalizeResource).filter((resource): resource is QdnResource => resource !== null)
    : [];
}

function parseQdnJson(value: unknown) {
  if (typeof value === 'string') {
    return JSON.parse(value) as unknown;
  }

  return value;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return btoa(binary);
}

function jsonToBase64(value: unknown) {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(value, null, 2)));
}

function responseData<T>(value: unknown): T {
  if (isRecord(value)) {
    if (typeof value.ok === 'boolean' && !value.ok) {
      throw new Error(getString(value.body) || `Node API failed with HTTP ${String(value.status ?? 0)}.`);
    }

    if ('data' in value) {
      return value.data as T;
    }
  }

  return value as T;
}

const recordCache = new Map<string, { signature: string; value: BoardResource }>();
const transactionCache = new Map<string, ArbitraryTransaction>();

export type BoardDescriptorCounts = {
  posts: number;
  threads: number;
  topics: number;
};

export type BoardLoadProgress = {
  descriptorCounts: BoardDescriptorCounts | null;
  discoveredResourceCount: number;
  phase: 'fetching' | 'listing';
  processedResourceCount: number;
  unavailableIdentifiers: string[];
  unavailableResourceCount: number;
};

export type BoardLoadResult = {
  board: ReducedBoard;
  descriptorCounts: BoardDescriptorCounts;
  discoveredResourceCount: number;
  unavailableIdentifiers: string[];
  unavailableResourceCount: number;
};

export type BoardLoadOptions = {
  onProgress?: (progress: BoardLoadProgress) => void;
};

type ArbitraryTransaction = {
  blockHeight?: number;
  creatorAddress?: string;
  identifier?: string;
  name?: string;
  signature?: string;
  timestamp?: number;
  type?: string;
};

type PaymentTransaction = {
  amount?: number;
  blockHeight?: number;
  creatorAddress?: string;
  recipient?: string;
  signature?: string;
  type?: string;
};

function cacheKey(resource: QdnResource) {
  return `${resource.service}:${resource.name}:${resource.identifier}`;
}

async function fetchTransaction<T>(signature: string): Promise<T> {
  return responseData<T>(
    await qdnRequest({
      action: 'FETCH_NODE_API',
      maxBytes: 150_000,
      path: `/transactions/signature/${encodeURIComponent(signature)}`,
    }),
  );
}

async function retryOnce<T>(operation: (retrying: boolean) => Promise<T>): Promise<T> {
  try {
    return await operation(false);
  } catch {
    return operation(true);
  }
}

async function validateTipReceipt(payload: TipRecord, publisherAddress: string) {
  const transaction = await fetchTransaction<PaymentTransaction>(payload.transactionSignature);
  const expectedAmount = Number(payload.amount);

  return (
    transaction.type === 'PAYMENT' &&
    typeof transaction.blockHeight === 'number' &&
    transaction.blockHeight > 0 &&
    transaction.creatorAddress === publisherAddress &&
    transaction.recipient === payload.recipientAddress &&
    Number.isFinite(expectedAmount) &&
    Math.abs((transaction.amount ?? Number.NaN) - expectedAmount) < 0.00000001
  );
}

type BoardResourceFetchResult =
  | { status: 'ignored' }
  | { status: 'loaded'; value: BoardResource }
  | { status: 'unavailable' };

async function fetchBoardResource(resource: QdnResource): Promise<BoardResourceFetchResult> {
  if (!resource.identifier) {
    return { status: 'ignored' };
  }

  const key = cacheKey(resource);
  const signature = resource.latestSignature ?? '';
  const cached = signature ? recordCache.get(key) : undefined;

  if (cached && cached.signature === signature) {
    return { status: 'loaded', value: cached.value };
  }

  try {
    if (!signature) {
      return { status: 'ignored' };
    }

    let transaction = transactionCache.get(signature);
    if (!transaction) {
      transaction = await retryOnce(() => fetchTransaction<ArbitraryTransaction>(signature));
      transactionCache.set(signature, transaction);
    }

    if (
      transaction.type !== 'ARBITRARY' ||
      typeof transaction.blockHeight !== 'number' ||
      transaction.blockHeight <= 0 ||
      !transaction.creatorAddress ||
      transaction.name !== resource.name ||
      transaction.identifier !== resource.identifier ||
      transaction.signature !== signature
    ) {
      return { status: 'ignored' };
    }

    const value = await retryOnce((retrying) =>
      qdnRequest<unknown>({
        action: 'FETCH_QDN_RESOURCE',
        identifier: resource.identifier,
        maxBytes: MAX_RECORD_BYTES,
        name: resource.name,
        rebuild: retrying,
        service: resource.service,
      }),
    );
    const payload = normalizeBoardRecord(parseQdnJson(value));

    if (!payload) {
      return { status: 'ignored' };
    }

    if (payload.kind === 'tip' && !(await validateTipReceipt(payload, transaction.creatorAddress))) {
      return { status: 'ignored' };
    }

    const normalized: BoardResource = {
      blockHeight: transaction.blockHeight,
      created: transaction.timestamp ?? resource.created ?? payload.createdAt,
      identifier: resource.identifier,
      ownerAddress: transaction.creatorAddress,
      ownerName: resource.name,
      payload,
      resource,
      signature,
    };

    if (signature) {
      recordCache.set(key, { signature, value: normalized });
    }

    return { status: 'loaded', value: normalized };
  } catch {
    return { status: 'unavailable' };
  }
}

async function searchPrefix(identifier: string) {
  const found = new Map<string, QdnResource>();

  for (let page = 0; page < MAX_PAGES_PER_PREFIX; page += 1) {
    const value = await qdnRequest<unknown>({
      action: 'SEARCH_QDN_RESOURCES',
      identifier,
      includeMetadata: true,
      includeStatus: true,
      limit: PAGE_SIZE,
      mode: 'ALL',
      offset: page * PAGE_SIZE,
      prefix: true,
      reverse: true,
      service: BOARD_SERVICE,
    });
    const batch = normalizeResources(value);
    const before = found.size;

    for (const resource of batch) {
      found.set(cacheKey(resource), resource);
    }

    if (batch.length < PAGE_SIZE || found.size === before) {
      break;
    }
  }

  return [...found.values()];
}

export function summarizeBoardDescriptors(resources: readonly QdnResource[]): BoardDescriptorCounts {
  return resources.reduce<BoardDescriptorCounts>(
    (counts, resource) => {
      const identifier = resource.identifier ?? '';

      if (identifier.startsWith(IDENTIFIERS.topic)) counts.topics += 1;
      if (identifier.startsWith(IDENTIFIERS.thread)) counts.threads += 1;
      if (identifier.startsWith(IDENTIFIERS.post)) counts.posts += 1;
      return counts;
    },
    { posts: 0, threads: 0, topics: 0 },
  );
}

export async function loadBoard(options: BoardLoadOptions = {}): Promise<BoardLoadResult> {
  options.onProgress?.({
    descriptorCounts: null,
    discoveredResourceCount: 0,
    phase: 'listing',
    processedResourceCount: 0,
    unavailableIdentifiers: [],
    unavailableResourceCount: 0,
  });

  const [resourceGroups, rootAddress] = await Promise.all([
    Promise.all(prefixes.map(searchPrefix)),
    loadRootAddress(),
  ]);
  const resources = resourceGroups.flat();
  const descriptorCounts = summarizeBoardDescriptors(resources);
  let processedResourceCount = 0;
  const unavailableIdentifiers: string[] = [];
  let unavailableResourceCount = 0;

  options.onProgress?.({
    descriptorCounts,
    discoveredResourceCount: resources.length,
    phase: 'fetching',
    processedResourceCount,
    unavailableIdentifiers: [],
    unavailableResourceCount,
  });

  const outcomes = await Promise.all(
    resources.map(async (resource) => {
      const outcome = await fetchBoardResource(resource);
      processedResourceCount += 1;
      if (outcome.status === 'unavailable') {
        unavailableResourceCount += 1;
        if (resource.identifier) unavailableIdentifiers.push(resource.identifier);
      }
      options.onProgress?.({
        descriptorCounts,
        discoveredResourceCount: resources.length,
        phase: 'fetching',
        processedResourceCount,
        unavailableIdentifiers: [...unavailableIdentifiers],
        unavailableResourceCount,
      });
      return outcome;
    }),
  );
  const liveKeys = new Set(resources.map(cacheKey));

  for (const key of recordCache.keys()) {
    if (!liveKeys.has(key)) {
      recordCache.delete(key);
    }
  }

  return {
    board: reduceBoard(
      outcomes.flatMap((outcome) => outcome.status === 'loaded' ? [outcome.value] : []),
      rootAddress,
    ),
    descriptorCounts,
    discoveredResourceCount: resources.length,
    unavailableIdentifiers,
    unavailableResourceCount,
  };
}

async function loadRootAddress() {
  try {
    const resources = normalizeResources(
      await qdnRequest<unknown>({
        action: 'LIST_QDN_RESOURCES',
        exactMatchNames: true,
        identifier: BOARD_ROOT_NAME,
        limit: 10,
        name: BOARD_ROOT_NAME,
        reverse: true,
        service: 'APP',
      }),
    );
    const signature = resources[0]?.latestSignature;

    if (signature) {
      const transaction = await fetchTransaction<ArbitraryTransaction>(signature);
      if (
        transaction.type === 'ARBITRARY' &&
        typeof transaction.blockHeight === 'number' &&
        transaction.blockHeight > 0 &&
        transaction.name === BOARD_ROOT_NAME &&
        transaction.identifier === BOARD_ROOT_NAME &&
        transaction.creatorAddress
      ) {
        return transaction.creatorAddress;
      }
    }
  } catch {
    // The app may be running before its first publication.
  }

  try {
    const name = responseData<{ owner?: string }>(
      await qdnRequest({
        action: 'FETCH_NODE_API',
        maxBytes: 50_000,
        path: `/names/${encodeURIComponent(BOARD_ROOT_NAME)}`,
      }),
    );
    return getString(name.owner);
  } catch {
    return '';
  }
}

function normalizeNames(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (isRecord(item)) return getString(item.name);
      return '';
    })
    .filter(Boolean);
}

export type AccountContext = {
  account: QdnSelectedAccount | null;
  writableNames: string[];
};

export async function loadAccountContext(): Promise<AccountContext> {
  const account = await qdnRequest<QdnSelectedAccount>({ action: 'GET_SELECTED_ACCOUNT' });
  let accountNames: unknown = [];

  if (account.address) {
    try {
      accountNames = await qdnRequest<unknown>({
        action: 'GET_ACCOUNT_NAMES',
        address: account.address,
      });
    } catch {
      // The selected account's primary name is still useful.
    }
  }

  const names = [account.name ?? '', ...normalizeNames(accountNames)].filter(Boolean);
  return {
    account,
    writableNames: Array.from(new Map(names.map((name) => [name.toLowerCase(), name])).values()),
  };
}

function metadataFor(record: BoardRecord) {
  switch (record.kind) {
    case 'topic':
      return {
        description: record.description.slice(0, 240),
        tags: ['qortium-boards', 'topic', ...record.tags].slice(0, 5),
        title: record.title.slice(0, 80),
      };
    case 'thread':
      return {
        description: record.body.slice(0, 240),
        tags: ['qortium-boards', 'thread', record.poll ? 'poll' : 'discussion'].slice(0, 5),
        title: record.title.slice(0, 80),
      };
    case 'post':
      return {
        description: record.body.slice(0, 240),
        tags: ['qortium-boards', 'post', 'reply'],
        title: `Reply ${record.threadId}`.slice(0, 80),
      };
    default:
      return {
        description: `${record.kind} record for Qortium Boards`,
        tags: ['qortium-boards', record.kind, 'v1'].slice(0, 5),
        title: `Boards ${record.kind}`.slice(0, 80),
      };
  }
}

export async function publishRecord(
  name: string,
  record: BoardRecord,
): Promise<PublishActionResult> {
  const metadata = metadataFor(record);
  const encoded = new TextEncoder().encode(JSON.stringify(record, null, 2));

  if (encoded.byteLength > MAX_PUBLISH_BYTES) {
    throw new Error(
      `This record is ${encoded.byteLength.toLocaleString()} bytes; QDN JSON records are limited to ${MAX_PUBLISH_BYTES.toLocaleString()} bytes.`,
    );
  }

  return qdnRequest<PublishActionResult>({
    action: 'PUBLISH_QDN_RESOURCE',
    base64: bytesToBase64(encoded),
    description: metadata.description,
    filename: BOARD_FILE_NAME,
    identifier: buildIdentifier(record.kind, record.id, 'targetId' in record ? record.targetId : undefined),
    name,
    service: BOARD_SERVICE,
    tags: metadata.tags,
    title: metadata.title,
  });
}

export function recordConfirmationTarget(
  name: string,
  record: BoardRecord,
): QdnResourceConfirmationTarget {
  return {
    identifier: buildIdentifier(record.kind, record.id, 'targetId' in record ? record.targetId : undefined),
    name,
    service: BOARD_SERVICE,
    type: 'qdn-resource',
  };
}

export function publishedResourceConfirmationTarget(
  result: PublishActionResult,
): QdnResourceConfirmationTarget | null {
  return qdnResourceTarget(result);
}

export function transactionConfirmationTarget(
  result: PollActionResult | SendCoinResult,
): TransactionConfirmationTarget | null {
  return transactionTarget(result);
}

export function createTopic(title: string, description: string, tags: string[]): TopicRecord {
  return {
    createdAt: Date.now(),
    description: description.trim(),
    id: createBoardId(),
    kind: 'topic',
    schema: BOARD_SCHEMA,
    tags: tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 5),
    title: title.trim(),
  };
}

export function createThread(input: {
  attachments?: AttachmentReference[];
  body: string;
  id?: string;
  poll?: ThreadRecord['poll'];
  title: string;
  topicId: string;
}): ThreadRecord {
  return {
    attachments: input.attachments ?? [],
    body: input.body.trim(),
    createdAt: Date.now(),
    id: input.id ?? createBoardId(),
    kind: 'thread',
    poll: input.poll ?? null,
    schema: BOARD_SCHEMA,
    title: input.title.trim(),
    topicId: input.topicId,
  };
}

export function createPost(input: {
  attachments?: AttachmentReference[];
  body: string;
  replyToId?: string | null;
  threadId: string;
}): PostRecord {
  return {
    attachments: input.attachments ?? [],
    body: input.body.trim(),
    createdAt: Date.now(),
    id: createBoardId(),
    kind: 'post',
    replyToId: input.replyToId ?? null,
    schema: BOARD_SCHEMA,
    threadId: input.threadId,
  };
}

export function createEdit(input: {
  body?: string;
  deleted?: boolean;
  tags?: string[];
  targetId: string;
  targetKind: EditRecord['targetKind'];
  title?: string;
}): EditRecord {
  return {
    body: input.body?.trim(),
    createdAt: Date.now(),
    deleted: input.deleted,
    id: createBoardId(),
    kind: 'edit',
    schema: BOARD_SCHEMA,
    tags: input.tags,
    targetId: input.targetId,
    targetKind: input.targetKind,
    title: input.title?.trim(),
  };
}

export function createReaction(
  targetKind: ReactionRecord['targetKind'],
  targetId: string,
  reaction: ReactionValue | null,
): ReactionRecord {
  return {
    createdAt: Date.now(),
    id: createBoardId(),
    kind: 'reaction',
    reaction,
    schema: BOARD_SCHEMA,
    targetId,
    targetKind,
  };
}

export function createModeration(
  targetKind: ModerationRecord['targetKind'],
  targetId: string,
  action: ModerationRecord['action'],
  reason?: string,
): ModerationRecord {
  return {
    action,
    createdAt: Date.now(),
    id: createBoardId(),
    kind: 'moderation',
    reason: reason?.trim(),
    schema: BOARD_SCHEMA,
    targetId,
    targetKind,
  };
}

export type PublishedAttachment = {
  attachment: AttachmentReference;
  confirmationTarget: QdnResourceConfirmationTarget;
  publishResult: PublishActionResult;
};

export async function selectAndPublishAttachmentWithResult(
  name: string,
): Promise<PublishedAttachment | null> {
  const selected = await qdnRequest<SourceSelectionResult>({
    action: 'SELECT_QDN_PUBLISH_SOURCE',
    kind: 'file',
  });

  if (selected.canceled) {
    return null;
  }

  const id = createBoardId();
  const identifier = `qboards.v1.a.${id}`;
  const publishResult = await qdnRequest<PublishActionResult>({
    action: 'PUBLISH_QDN_RESOURCE',
    identifier,
    name,
    service: 'ATTACHMENT',
    sourceToken: selected.sourceToken,
    title: selected.fileName.slice(0, 80),
  });

  const attachment: AttachmentReference = {
    filename: selected.fileName,
    identifier,
    name,
    service: 'ATTACHMENT',
    size: selected.size,
  };

  return {
    attachment,
    confirmationTarget: {
      identifier,
      name,
      service: 'ATTACHMENT',
      type: 'qdn-resource',
    },
    publishResult,
  };
}

export async function selectAndPublishAttachment(
  name: string,
): Promise<AttachmentReference | null> {
  const published = await selectAndPublishAttachmentWithResult(name);

  return published?.attachment ?? null;
}

export function createPollName(threadId: string) {
  return `boards-${threadId}`.slice(0, 40);
}

export async function publishNativePoll(input: {
  description: string;
  endTime?: number;
  options: string[];
  pollName: string;
  startTime?: number;
}) {
  return qdnRequest<PollActionResult>({
    action: 'CREATE_POLL',
    description: input.description,
    ...(input.endTime ? { endTime: input.endTime } : {}),
    pollName: input.pollName,
    pollOptions: input.options.map((optionName) => ({ optionName })),
    ...(input.startTime ? { startTime: input.startTime } : {}),
  });
}

export type NativePoll = {
  description?: string;
  endTime?: number | null;
  owner: string;
  pollId: number;
  pollName: string;
  pollOptions: Array<{ optionName: string }>;
  startTime?: number | null;
};

export type NativePollVotes = {
  totalVoters?: number;
  voteCounts?: Array<{ optionName: string; voteCount: number }>;
  voteDetails?: Array<{
    optionIndex?: number;
    optionIndexes?: number[];
    voterAddress: string;
  }>;
};

export async function loadNativePoll(pollName: string) {
  const poll = responseData<NativePoll>(
    await qdnRequest({
      action: 'FETCH_NODE_API',
      maxBytes: 100_000,
      path: `/polls/${encodeURIComponent(pollName)}`,
    }),
  );
  const votes = responseData<NativePollVotes>(
    await qdnRequest({
      action: 'FETCH_NODE_API',
      maxBytes: 1_000_000,
      path: `/polls/votes/id/${poll.pollId}?onlyCounts=false`,
    }),
  );
  return { poll, votes };
}

export function voteNativePoll(pollId: number, optionIndexes: number[]) {
  return qdnRequest<PollActionResult>({
    action: 'VOTE_ON_POLL',
    optionIndexes,
    pollId,
  });
}

export type SendTipInput = {
  amount: string;
  name: string;
  recipientAddress: string;
  recipientName?: string;
  targetId: string;
  targetKind: TipRecord['targetKind'];
};

export async function sendTipPayment(input: SendTipInput) {
  const paymentResult = await qdnRequest<SendCoinResult>({
    action: 'SEND_COIN',
    amount: Number(input.amount),
    coin: 'QORT',
    recipient: input.recipientAddress,
  });
  const signature = paymentResult.transactionSignature;

  if (!signature) {
    throw new Error('The QORT transfer completed without a transaction signature.');
  }

  const record: TipRecord = {
    amount: input.amount,
    createdAt: Date.now(),
    id: createBoardId(),
    kind: 'tip',
    recipientAddress: input.recipientAddress,
    recipientName: input.recipientName,
    schema: BOARD_SCHEMA,
    targetId: input.targetId,
    targetKind: input.targetKind,
    transactionSignature: signature,
  };

  return {
    paymentConfirmationTarget: transactionConfirmationTarget(paymentResult),
    paymentResult,
    record,
  };
}

export async function publishTipReceipt(name: string, record: TipRecord) {
  const publishResult = await publishRecord(name, record);

  return {
    publishConfirmationTarget: recordConfirmationTarget(name, record),
    publishResult,
    record,
  };
}

export async function sendTip(input: SendTipInput) {
  const payment = await sendTipPayment(input);
  const receipt = await publishTipReceipt(input.name, payment.record);

  return {
    ...payment,
    ...receipt,
  };
}

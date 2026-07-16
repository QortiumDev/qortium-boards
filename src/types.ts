export type QdnAction = string;

export type BridgeState = {
  actions: QdnAction[];
  isHomeBridge: boolean;
  isUsingPublicNode: boolean;
  ui: string;
};

export type QdnSelectedAccount = {
  address: string;
  avatarUrl?: string | null;
  id?: string;
  isUnlocked?: boolean;
  name?: string | null;
  resourceUrl?: string;
};

export type NodeApiFetchResult<T = unknown> = {
  body: string;
  contentLength?: number;
  contentType: string;
  data: T;
  ok: boolean;
  status: number;
  statusText: string;
};

export type QdnResourceMetadata = {
  category?: string | null;
  description?: string | null;
  tags?: string[] | null;
  title?: string | null;
};

export type QdnResourceStatus = {
  description?: string;
  id?: string;
  status?: string;
  title?: string;
};

export type QdnResource = {
  created?: number | null;
  identifier?: string | null;
  latestSignature?: string | null;
  metadata?: QdnResourceMetadata | null;
  name: string;
  service: string;
  size?: number | null;
  status?: QdnResourceStatus | string | null;
  updated?: number | null;
};

export type NodeStatus = {
  height?: number;
  isSynchronizing?: boolean;
  numberOfConnections?: number;
  syncPercent?: number;
  syncPhase?: string;
  [key: string]: unknown;
};

export type PublishActionResult = {
  accepted: boolean;
  action: 'PUBLISH_QDN_RESOURCE';
  resource?: {
    identifier: string | null;
    name: string;
    service: string;
  };
  result?: unknown;
  transactionSignature?: string;
};

export type SendCoinResult = {
  accepted: boolean;
  action: 'SEND_COIN';
  amount?: number | string;
  recipient?: string;
  result?: unknown;
  transactionSignature?: string;
};

export type PollActionResult = {
  accepted: boolean;
  action: 'CREATE_POLL' | 'UPDATE_POLL' | 'VOTE_ON_POLL';
  pollId?: number;
  pollName?: string;
  result?: unknown;
  transactionSignature?: string;
};

export type SourceSelectionResult =
  | {
      canceled: true;
    }
  | {
      canceled: false;
      fileName: string;
      kind: 'directory' | 'file';
      size: number;
      sourceToken: string;
    };

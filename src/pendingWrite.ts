import { qdnRequest, type QdnRequest } from './qdnRequest';

export type PendingWriteKind =
  | 'attachment'
  | 'poll-create'
  | 'poll-vote'
  | 'qdn-resource'
  | 'tip-payment'
  | 'tip-receipt';
export type PendingWritePhase = 'signing' | 'pending' | 'confirmed' | 'timeout' | 'failed';

export type TransactionConfirmationTarget = {
  signature: string;
  type: 'transaction';
};

export type QdnResourceConfirmationTarget = {
  identifier: string;
  name: string;
  service: string;
  type: 'qdn-resource';
};

export type ConfirmationTarget = TransactionConfirmationTarget | QdnResourceConfirmationTarget;

export type ConfirmationResult =
  | {
      attempts: number;
      confirmedAt: number;
      phase: 'confirmed';
      status?: string;
    }
  | {
      attempts: number;
      lastError?: string;
      lastStatus?: string;
      phase: 'timeout';
      timedOutAt: number;
    }
  | {
      attempts: number;
      error: string;
      failedAt: number;
      phase: 'failed';
      status?: string;
    };

export type PendingWrite = {
  error?: string;
  kind: PendingWriteKind;
  lastStatus?: string;
  phase: PendingWritePhase;
  submittedAt: number;
  target?: ConfirmationTarget;
};

export type ConfirmationRequest = <T = unknown>(request: QdnRequest) => Promise<T>;

export type ConfirmationOptions = {
  now?: () => number;
  pollIntervalMs?: number;
  request?: ConfirmationRequest;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const TERMINAL_RESOURCE_STATUSES = new Set(['BLOCKED', 'BUILD_FAILED', 'DELETED', 'UNSUPPORTED']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function responseData(value: unknown): unknown {
  if (isRecord(value) && 'data' in value) {
    return value.data;
  }

  return value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function normalizedOptions(options: ConfirmationOptions) {
  return {
    now: options.now ?? Date.now,
    pollIntervalMs: Math.max(1, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS),
    request: options.request ?? qdnRequest,
    sleep: options.sleep ?? defaultSleep,
    timeoutMs: Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };
}

function transactionBlockHeight(value: unknown) {
  const data = responseData(value);

  return isRecord(data) && typeof data.blockHeight === 'number' ? data.blockHeight : null;
}

export function getQdnResourceStatus(value: unknown) {
  const data = responseData(value);

  return isRecord(data) && typeof data.status === 'string' ? data.status.trim().toUpperCase() : '';
}

export function beginPendingWrite(kind: PendingWriteKind, submittedAt = Date.now()): PendingWrite {
  return { kind, phase: 'signing', submittedAt };
}

export function markPendingWrite(
  write: PendingWrite,
  target: ConfirmationTarget,
  submittedAt = Date.now(),
): PendingWrite {
  return {
    kind: write.kind,
    phase: 'pending',
    submittedAt,
    target,
  };
}

export function failPendingWrite(write: PendingWrite, error: unknown): PendingWrite {
  return {
    ...write,
    error: errorMessage(error),
    phase: 'failed',
  };
}

export function applyConfirmationResult(
  write: PendingWrite,
  watchedSubmittedAt: number,
  result: ConfirmationResult,
): PendingWrite {
  if (write.submittedAt !== watchedSubmittedAt) {
    return write;
  }

  if (result.phase === 'confirmed') {
    return {
      ...write,
      error: undefined,
      lastStatus: result.status,
      phase: 'confirmed',
    };
  }

  if (result.phase === 'timeout') {
    return {
      ...write,
      error: result.lastError,
      lastStatus: result.lastStatus,
      phase: 'timeout',
    };
  }

  return {
    ...write,
    error: result.error,
    lastStatus: result.status,
    phase: 'failed',
  };
}

export function transactionTarget(signature: unknown): TransactionConfirmationTarget | null {
  const candidate = isRecord(signature) && 'transactionSignature' in signature
    ? signature.transactionSignature
    : signature;
  const normalized = typeof candidate === 'string' ? candidate.trim() : '';

  return normalized ? { signature: normalized, type: 'transaction' } : null;
}

export function qdnResourceTarget(value: unknown): QdnResourceConfirmationTarget | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = isRecord(value.resource) ? value.resource : value;
  const identifier = typeof candidate.identifier === 'string' ? candidate.identifier.trim() : '';
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  const service = typeof candidate.service === 'string' ? candidate.service.trim().toUpperCase() : '';

  return identifier && name && service
    ? { identifier, name, service, type: 'qdn-resource' }
    : null;
}

export async function waitForTransactionConfirmation(
  signature: string,
  options: ConfirmationOptions = {},
): Promise<ConfirmationResult> {
  const target = transactionTarget(signature);
  const polling = normalizedOptions(options);

  if (!target) {
    return {
      attempts: 0,
      error: 'A transaction signature is required to confirm this write.',
      failedAt: polling.now(),
      phase: 'failed',
    };
  }

  const startedAt = polling.now();
  let attempts = 0;
  let lastError: string | undefined;

  while (true) {
    attempts += 1;

    try {
      const transaction = await polling.request({
        action: 'FETCH_NODE_API',
        maxBytes: 100_000,
        path: `/transactions/signature/${encodeURIComponent(target.signature)}`,
      });

      if ((transactionBlockHeight(transaction) ?? 0) > 0) {
        return {
          attempts,
          confirmedAt: polling.now(),
          phase: 'confirmed',
        };
      }
    } catch (error) {
      // A transaction can be unavailable while it propagates. Preserve the
      // latest error for a useful timeout result, but keep polling.
      lastError = errorMessage(error);
    }

    const elapsed = polling.now() - startedAt;
    if (elapsed >= polling.timeoutMs) {
      return {
        attempts,
        lastError,
        phase: 'timeout',
        timedOutAt: polling.now(),
      };
    }

    await polling.sleep(Math.min(polling.pollIntervalMs, polling.timeoutMs - elapsed));
  }
}

export async function waitForQdnResourceReady(
  resource: Omit<QdnResourceConfirmationTarget, 'type'>,
  options: ConfirmationOptions = {},
): Promise<ConfirmationResult> {
  const target = qdnResourceTarget(resource);
  const polling = normalizedOptions(options);

  if (!target) {
    return {
      attempts: 0,
      error: 'A QDN service, name, and identifier are required to confirm this publication.',
      failedAt: polling.now(),
      phase: 'failed',
    };
  }

  const path =
    `/arbitrary/resource/status/${encodeURIComponent(target.service)}/${encodeURIComponent(target.name)}` +
    `/${encodeURIComponent(target.identifier)}?build=true`;
  const startedAt = polling.now();
  let attempts = 0;
  let lastError: string | undefined;
  let lastStatus = '';

  while (true) {
    attempts += 1;

    try {
      const result = await polling.request({
        action: 'FETCH_NODE_API',
        maxBytes: 32_000,
        path,
      });
      const status = getQdnResourceStatus(result);

      if (status) {
        lastStatus = status;
      }

      if (status === 'READY') {
        return {
          attempts,
          confirmedAt: polling.now(),
          phase: 'confirmed',
          status,
        };
      }

      if (TERMINAL_RESOURCE_STATUSES.has(status)) {
        return {
          attempts,
          error: `Published resource entered ${status}.`,
          failedAt: polling.now(),
          phase: 'failed',
          status,
        };
      }
    } catch (error) {
      // Missing resources and transient node errors are expected while QDN
      // propagates. Do not convert them into a false success.
      lastError = errorMessage(error);
    }

    const elapsed = polling.now() - startedAt;
    if (elapsed >= polling.timeoutMs) {
      return {
        attempts,
        lastError,
        lastStatus: lastStatus || undefined,
        phase: 'timeout',
        timedOutAt: polling.now(),
      };
    }

    await polling.sleep(Math.min(polling.pollIntervalMs, polling.timeoutMs - elapsed));
  }
}

export function waitForConfirmedWrite(
  target: ConfirmationTarget,
  options: ConfirmationOptions = {},
): Promise<ConfirmationResult> {
  if (target.type === 'transaction') {
    return waitForTransactionConfirmation(target.signature, options);
  }

  return waitForQdnResourceReady(target, options);
}

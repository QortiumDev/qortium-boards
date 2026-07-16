import { describe, expect, it, vi } from 'vitest';
import {
  applyConfirmationResult,
  beginPendingWrite,
  failPendingWrite,
  getQdnResourceStatus,
  markPendingWrite,
  qdnResourceTarget,
  transactionTarget,
  waitForConfirmedWrite,
  waitForQdnResourceReady,
  waitForTransactionConfirmation,
  type ConfirmationOptions,
} from './pendingWrite';

function pollingClock(interval = 100) {
  let now = 1_000;
  const sleep = vi.fn(async (milliseconds: number) => {
    now += milliseconds;
  });
  const options: Pick<ConfirmationOptions, 'now' | 'pollIntervalMs' | 'sleep'> = {
    now: () => now,
    pollIntervalMs: interval,
    sleep,
  };

  return { options, sleep };
}

describe('pending write state', () => {
  it('moves from signing to pending and applies a matching confirmation', () => {
    const signing = beginPendingWrite('poll-vote', 10);
    const pending = markPendingWrite(signing, { signature: 'vote-signature', type: 'transaction' }, 20);
    const confirmed = applyConfirmationResult(pending, 20, {
      attempts: 2,
      confirmedAt: 30,
      phase: 'confirmed',
    });

    expect(signing.phase).toBe('signing');
    expect(pending).toMatchObject({
      kind: 'poll-vote',
      phase: 'pending',
      submittedAt: 20,
      target: { signature: 'vote-signature', type: 'transaction' },
    });
    expect(confirmed.phase).toBe('confirmed');
  });

  it('does not let an older watcher overwrite a newer pending write', () => {
    const pending = markPendingWrite(
      beginPendingWrite('qdn-resource', 10),
      { identifier: 'new', name: 'Alice', service: 'JSON', type: 'qdn-resource' },
      20,
    );

    expect(
      applyConfirmationResult(pending, 10, {
        attempts: 1,
        confirmedAt: 30,
        phase: 'confirmed',
      }),
    ).toBe(pending);
  });

  it('preserves explicit timeout and failure states', () => {
    const pending = markPendingWrite(
      beginPendingWrite('qdn-resource', 10),
      { identifier: 'thread', name: 'Alice', service: 'JSON', type: 'qdn-resource' },
      20,
    );
    const timedOut = applyConfirmationResult(pending, 20, {
      attempts: 4,
      lastError: 'Node unavailable',
      lastStatus: 'BUILDING',
      phase: 'timeout',
      timedOutAt: 30,
    });

    expect(timedOut).toMatchObject({
      error: 'Node unavailable',
      lastStatus: 'BUILDING',
      phase: 'timeout',
    });
    expect(failPendingWrite(pending, new Error('Rejected'))).toMatchObject({
      error: 'Rejected',
      phase: 'failed',
    });
  });
});

describe('confirmation target parsing', () => {
  it('normalizes action results into transaction and QDN targets', () => {
    expect(transactionTarget(' signature ')).toEqual({
      signature: 'signature',
      type: 'transaction',
    });
    expect(transactionTarget({ transactionSignature: 'action-signature' })).toEqual({
      signature: 'action-signature',
      type: 'transaction',
    });
    expect(transactionTarget('')).toBeNull();
    expect(
      qdnResourceTarget({
        resource: { identifier: ' qboards.v1.th.1 ', name: ' Alice ', service: ' json ' },
      }),
    ).toEqual({
      identifier: 'qboards.v1.th.1',
      name: 'Alice',
      service: 'JSON',
      type: 'qdn-resource',
    });
    expect(qdnResourceTarget({ resource: { name: 'Alice', service: 'JSON' } })).toBeNull();
  });

  it('reads resource status from raw and FETCH_NODE_API envelope responses', () => {
    expect(getQdnResourceStatus({ status: 'ready' })).toBe('READY');
    expect(getQdnResourceStatus({ data: { status: 'building' } })).toBe('BUILDING');
    expect(getQdnResourceStatus({ data: null })).toBe('');
  });
});

describe('transaction confirmation', () => {
  it('confirms a poll transaction only after it has a positive block height', async () => {
    const clock = pollingClock();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: { blockHeight: 0 } })
      .mockResolvedValueOnce({ blockHeight: 90210 });

    await expect(
      waitForTransactionConfirmation('sig/with spaces', {
        ...clock.options,
        request,
        timeoutMs: 500,
      }),
    ).resolves.toMatchObject({
      attempts: 2,
      phase: 'confirmed',
    });
    expect(request).toHaveBeenLastCalledWith({
      action: 'FETCH_NODE_API',
      maxBytes: 100_000,
      path: '/transactions/signature/sig%2Fwith%20spaces',
    });
  });

  it('treats transient lookup errors as pending and can still confirm', async () => {
    const clock = pollingClock();
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('Transaction not found'))
      .mockResolvedValueOnce({ data: { blockHeight: 42 } });

    await expect(
      waitForTransactionConfirmation('sig', {
        ...clock.options,
        request,
        timeoutMs: 500,
      }),
    ).resolves.toMatchObject({
      attempts: 2,
      phase: 'confirmed',
    });
  });

  it('returns timeout rather than false success when the transaction stays unconfirmed', async () => {
    const clock = pollingClock();
    const request = vi.fn().mockResolvedValue({ data: { blockHeight: 0 } });

    await expect(
      waitForTransactionConfirmation('sig', {
        ...clock.options,
        request,
        timeoutMs: 250,
      }),
    ).resolves.toMatchObject({
      attempts: 4,
      phase: 'timeout',
      timedOutAt: 1_250,
    });
    expect(clock.sleep).toHaveBeenNthCalledWith(3, 50);
  });

  it('fails immediately when a poll action result has no signature', async () => {
    const request = vi.fn();

    await expect(waitForTransactionConfirmation('', { request })).resolves.toMatchObject({
      attempts: 0,
      phase: 'failed',
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('QDN resource readiness', () => {
  it('waits through propagation states and confirms only READY', async () => {
    const clock = pollingClock();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: 'PUBLISHED' } })
      .mockResolvedValueOnce({ status: 'MISSING_DATA' })
      .mockResolvedValueOnce({ data: { status: 'READY' } });

    await expect(
      waitForQdnResourceReady(
        { identifier: 'thread/one', name: 'Alice Smith', service: 'json' },
        { ...clock.options, request, timeoutMs: 500 },
      ),
    ).resolves.toMatchObject({
      attempts: 3,
      phase: 'confirmed',
      status: 'READY',
    });
    expect(request).toHaveBeenCalledWith({
      action: 'FETCH_NODE_API',
      maxBytes: 32_000,
      path: '/arbitrary/resource/status/JSON/Alice%20Smith/thread%2Fone?build=true',
    });
  });

  it.each(['BLOCKED', 'BUILD_FAILED', 'DELETED', 'UNSUPPORTED'])(
    'returns a failure for terminal status %s',
    async (status) => {
      const request = vi.fn().mockResolvedValue({ data: { status } });

      await expect(
        waitForQdnResourceReady(
          { identifier: 'thread', name: 'Alice', service: 'JSON' },
          { request },
        ),
      ).resolves.toMatchObject({
        attempts: 1,
        phase: 'failed',
        status,
      });
    },
  );

  it('returns timeout with the last observed status and error', async () => {
    const clock = pollingClock();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: 'BUILDING' } })
      .mockRejectedValue(new Error('Node temporarily unavailable'));

    await expect(
      waitForQdnResourceReady(
        { identifier: 'thread', name: 'Alice', service: 'JSON' },
        { ...clock.options, request, timeoutMs: 200 },
      ),
    ).resolves.toEqual({
      attempts: 3,
      lastError: 'Node temporarily unavailable',
      lastStatus: 'BUILDING',
      phase: 'timeout',
      timedOutAt: 1_200,
    });
  });

  it('fails immediately for an incomplete resource tuple', async () => {
    const request = vi.fn();

    await expect(
      waitForQdnResourceReady(
        { identifier: '', name: 'Alice', service: 'JSON' },
        { request },
      ),
    ).resolves.toMatchObject({
      attempts: 0,
      phase: 'failed',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('dispatches reusable confirmation targets to the correct watcher', async () => {
    const request = vi.fn().mockResolvedValue({ data: { blockHeight: 99 } });

    await expect(
      waitForConfirmedWrite(
        { signature: 'poll-signature', type: 'transaction' },
        { request },
      ),
    ).resolves.toMatchObject({
      phase: 'confirmed',
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/transactions/signature/poll-signature' }),
    );
  });
});

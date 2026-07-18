import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_SCHEMA, IDENTIFIERS, type TipRecord } from './boardModel';
import {
  loadBoard,
  recordConfirmationTarget,
  publishTipReceipt,
  selectAndPublishAttachmentWithResult,
  sendTip,
  sendTipPayment,
  summarizeBoardDescriptors,
  transactionConfirmationTarget,
} from './boardService';
import type { QdnRequest } from './qdnRequest';
import type { QdnResource } from './types';

function listedResource(identifier: string, signature: string): QdnResource {
  return {
    identifier,
    latestSignature: signature,
    name: 'Alice',
    service: 'JSON',
  };
}

describe('board loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports descriptor records before their payload validation finishes', async () => {
    const topic = listedResource(`${IDENTIFIERS.topic}topic-progress`, 'signature-progress');
    let releaseTransaction!: () => void;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    const onProgress = vi.fn();
    const bridge = vi.fn(async (request: QdnRequest) => {
      if (request.action === 'SEARCH_QDN_RESOURCES') {
        return request.identifier === IDENTIFIERS.topic ? [topic] : [];
      }
      if (request.action === 'LIST_QDN_RESOURCES') return [];
      if (request.action === 'FETCH_NODE_API' && String(request.path).startsWith('/names/')) {
        return { data: { owner: 'ROOT-ADDRESS' } };
      }
      if (request.action === 'FETCH_NODE_API') {
        await transactionGate;
        return {
          data: {
            blockHeight: 10,
            creatorAddress: 'ALICE-ADDRESS',
            identifier: topic.identifier,
            name: topic.name,
            signature: topic.latestSignature,
            timestamp: 100,
            type: 'ARBITRARY',
          },
        };
      }
      if (request.action === 'FETCH_QDN_RESOURCE') {
        return {
          createdAt: 100,
          description: 'Progressive loading',
          id: 'topic-progress',
          kind: 'topic',
          schema: BOARD_SCHEMA,
          tags: [],
          title: 'Progress',
        };
      }
      throw new Error(`Unexpected action ${request.action}`);
    });
    vi.stubGlobal('window', { qdnRequest: bridge });

    const loading = loadBoard({ onProgress });

    await vi.waitFor(() => {
      expect(onProgress).toHaveBeenCalledWith({
        descriptorCounts: { posts: 0, threads: 0, topics: 1 },
        discoveredResourceCount: 1,
        phase: 'fetching',
        processedResourceCount: 0,
        unavailableIdentifiers: [],
        unavailableResourceCount: 0,
      });
    });
    releaseTransaction();

    await expect(loading).resolves.toMatchObject({
      board: { topics: [{ id: 'topic-progress', title: 'Progress' }] },
      descriptorCounts: { posts: 0, threads: 0, topics: 1 },
      discoveredResourceCount: 1,
      unavailableIdentifiers: [],
      unavailableResourceCount: 0,
    });
  });

  it('keeps unavailable QDN payloads distinct from invalid or genuinely absent records', async () => {
    const topic = listedResource(`${IDENTIFIERS.topic}topic-available`, 'signature-available');
    const thread = listedResource(`${IDENTIFIERS.thread}thread-unavailable`, 'signature-unavailable');
    const bridge = vi.fn(async (request: QdnRequest) => {
      if (request.action === 'SEARCH_QDN_RESOURCES') {
        if (request.identifier === IDENTIFIERS.topic) return [topic];
        if (request.identifier === IDENTIFIERS.thread) return [thread];
        return [];
      }
      if (request.action === 'LIST_QDN_RESOURCES') return [];
      if (request.action === 'FETCH_NODE_API' && String(request.path).startsWith('/names/')) {
        return { data: { owner: 'ROOT-ADDRESS' } };
      }
      if (request.action === 'FETCH_NODE_API') {
        const isTopic = String(request.path).includes('signature-available');
        const resource = isTopic ? topic : thread;
        return {
          data: {
            blockHeight: isTopic ? 10 : 11,
            creatorAddress: 'ALICE-ADDRESS',
            identifier: resource.identifier,
            name: resource.name,
            signature: resource.latestSignature,
            timestamp: 100,
            type: 'ARBITRARY',
          },
        };
      }
      if (request.action === 'FETCH_QDN_RESOURCE' && request.identifier === thread.identifier) {
        throw new Error('QDN resource is still building');
      }
      if (request.action === 'FETCH_QDN_RESOURCE') {
        return {
          createdAt: 100,
          description: 'Available',
          id: 'topic-available',
          kind: 'topic',
          schema: BOARD_SCHEMA,
          tags: [],
          title: 'Available',
        };
      }
      throw new Error(`Unexpected action ${request.action}`);
    });
    vi.stubGlobal('window', { qdnRequest: bridge });

    const result = await loadBoard();

    expect(result.descriptorCounts).toEqual({ posts: 0, threads: 1, topics: 1 });
    expect(result.board.topics).toHaveLength(1);
    expect(result.board.threads).toHaveLength(0);
    expect(result.unavailableIdentifiers).toEqual([thread.identifier]);
    expect(result.unavailableResourceCount).toBe(1);
    expect(bridge).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FETCH_QDN_RESOURCE',
        identifier: thread.identifier,
        rebuild: true,
      }),
    );
  });

  it('summarizes only discussion descriptors, not auxiliary state records', () => {
    expect(
      summarizeBoardDescriptors([
        listedResource(`${IDENTIFIERS.topic}t1`, 't'),
        listedResource(`${IDENTIFIERS.thread}th1`, 'th'),
        listedResource(`${IDENTIFIERS.post}p1`, 'p'),
        listedResource(`${IDENTIFIERS.edit}e1`, 'e'),
      ]),
    ).toEqual({ posts: 1, threads: 1, topics: 1 });
  });
});

describe('board write confirmation descriptors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('describes the exact QDN tuple used for a board record', () => {
    expect(
      recordConfirmationTarget('Alice', {
        attachments: [],
        body: 'Opening post',
        createdAt: 1,
        id: 'thread-1',
        kind: 'thread',
        poll: null,
        schema: BOARD_SCHEMA,
        title: 'Welcome',
        topicId: 'topic-1',
      }),
    ).toEqual({
      identifier: 'qboards.v1.th.thread-1',
      name: 'Alice',
      service: 'JSON',
      type: 'qdn-resource',
    });
  });

  it('extracts the transaction target shared by poll and payment actions', () => {
    expect(
      transactionConfirmationTarget({
        accepted: true,
        action: 'VOTE_ON_POLL',
        transactionSignature: 'poll-signature',
      }),
    ).toEqual({
      signature: 'poll-signature',
      type: 'transaction',
    });
    expect(
      transactionConfirmationTarget({
        accepted: true,
        action: 'SEND_COIN',
      }),
    ).toBeNull();
  });

  it('keeps source-token attachment publishing and exposes its confirmation tuple', async () => {
    const publishResult = {
      accepted: true,
      action: 'PUBLISH_QDN_RESOURCE' as const,
      resource: {
        identifier: 'ignored-host-identifier',
        name: 'Alice',
        service: 'ATTACHMENT',
      },
      transactionSignature: 'attachment-signature',
    };
    const bridge = vi
      .fn()
      .mockResolvedValueOnce({
        canceled: false,
        fileName: 'design.pdf',
        kind: 'file',
        size: 1234,
        sourceToken: 'source-token',
      })
      .mockResolvedValueOnce(publishResult);
    vi.stubGlobal('window', { qdnRequest: bridge });

    const published = await selectAndPublishAttachmentWithResult('Alice');

    expect(published).toMatchObject({
      attachment: {
        filename: 'design.pdf',
        name: 'Alice',
        service: 'ATTACHMENT',
        size: 1234,
      },
      confirmationTarget: {
        name: 'Alice',
        service: 'ATTACHMENT',
        type: 'qdn-resource',
      },
      publishResult,
    });
    expect(published?.attachment.identifier).toBe(published?.confirmationTarget.identifier);
    expect(bridge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'PUBLISH_QDN_RESOURCE',
        name: 'Alice',
        service: 'ATTACHMENT',
        sourceToken: 'source-token',
      }),
    );
    expect(bridge.mock.calls[1][0]).not.toHaveProperty('base64');
  });

  it('separates tip payment from receipt publication to prevent double-pay retries', async () => {
    const bridge = vi
      .fn()
      .mockResolvedValue({
        accepted: true,
        action: 'SEND_COIN',
        transactionSignature: 'payment-signature',
      });
    vi.stubGlobal('window', { qdnRequest: bridge });

    const payment = await sendTipPayment({
      amount: '1.25',
      name: 'Alice',
      recipientAddress: 'Q-recipient',
      recipientName: 'Bob',
      targetId: 'post-1',
      targetKind: 'post',
    });

    expect(payment.paymentConfirmationTarget).toEqual({
      signature: 'payment-signature',
      type: 'transaction',
    });
    expect(payment.record).toMatchObject({
      amount: '1.25',
      recipientAddress: 'Q-recipient',
      transactionSignature: 'payment-signature',
    });
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(bridge).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SEND_COIN',
        amount: 1.25,
        coin: 'QORT',
        recipient: 'Q-recipient',
      }),
    );
  });

  it('publishes a confirmed payment record without sending another payment', async () => {
    const publishResult = {
      accepted: true,
      action: 'PUBLISH_QDN_RESOURCE' as const,
      resource: {
        identifier: 'tip-resource',
        name: 'Alice',
        service: 'JSON',
      },
      transactionSignature: 'receipt-signature',
    };
    const bridge = vi.fn().mockResolvedValue(publishResult);
    vi.stubGlobal('window', { qdnRequest: bridge });
    const record: TipRecord = {
      amount: '1.25',
      createdAt: 1,
      id: 'tip-1',
      kind: 'tip',
      recipientAddress: 'Q-recipient',
      schema: BOARD_SCHEMA,
      targetId: 'post-1',
      targetKind: 'post',
      transactionSignature: 'payment-signature',
    };

    const receipt = await publishTipReceipt('Alice', record);

    expect(receipt).toEqual({
      publishConfirmationTarget: {
        identifier: 'qboards.v1.tip.tip-1',
        name: 'Alice',
        service: 'JSON',
        type: 'qdn-resource',
      },
      publishResult,
      record,
    });
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(bridge).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PUBLISH_QDN_RESOURCE',
        identifier: 'qboards.v1.tip.tip-1',
      }),
    );
  });

  it('keeps the combined sendTip wrapper backward-compatible', async () => {
    const bridge = vi
      .fn()
      .mockResolvedValueOnce({
        accepted: true,
        action: 'SEND_COIN',
        transactionSignature: 'payment-signature',
      })
      .mockResolvedValueOnce({
        accepted: true,
        action: 'PUBLISH_QDN_RESOURCE',
        transactionSignature: 'receipt-signature',
      });
    vi.stubGlobal('window', { qdnRequest: bridge });

    const result = await sendTip({
      amount: '1',
      name: 'Alice',
      recipientAddress: 'Q-recipient',
      targetId: 'thread-1',
      targetKind: 'thread',
    });

    expect(result.paymentResult.transactionSignature).toBe('payment-signature');
    expect(result.publishResult.transactionSignature).toBe('receipt-signature');
    expect(result.publishConfirmationTarget.identifier).toMatch(/^qboards\.v1\.tip\./);
    expect(bridge).toHaveBeenCalledTimes(2);
  });
});

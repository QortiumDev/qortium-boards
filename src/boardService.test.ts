import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_SCHEMA, type TipRecord } from './boardModel';
import {
  recordConfirmationTarget,
  publishTipReceipt,
  selectAndPublishAttachmentWithResult,
  sendTip,
  sendTipPayment,
  transactionConfirmationTarget,
} from './boardService';

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

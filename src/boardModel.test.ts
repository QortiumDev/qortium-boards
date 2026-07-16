import { describe, expect, it } from 'vitest';
import {
  BOARD_SCHEMA,
  reduceBoard,
  type BoardResource,
  type BoardRecord,
} from './boardModel';

function resource(
  ownerName: string,
  payload: BoardRecord,
  blockHeight = payload.createdAt,
  ownerAddress = `${ownerName}-ADDRESS`,
): BoardResource {
  return {
    blockHeight,
    created: payload.createdAt,
    identifier: `${payload.kind}:${payload.id}`,
    ownerAddress,
    ownerName,
    payload,
    resource: {
      identifier: `${payload.kind}:${payload.id}`,
      name: ownerName,
      service: 'JSON',
    },
    signature: `${ownerName}:${blockHeight}`,
  };
}

describe('reduceBoard', () => {
  it('binds content edits to the original QDN publisher', () => {
    const topic = resource('Alice', {
      createdAt: 1,
      description: 'Original',
      id: 't1',
      kind: 'topic',
      schema: BOARD_SCHEMA,
      tags: [],
      title: 'Design',
    });
    const forged = resource(
      'Mallory',
      {
        createdAt: 2,
        id: 'e1',
        kind: 'edit',
        schema: BOARD_SCHEMA,
        targetId: 't1',
        targetKind: 'topic',
        title: 'Owned',
      },
      9_999_999,
    );
    const valid = resource(
      'Alice',
      {
        createdAt: 3,
        id: 'e2',
        kind: 'edit',
        schema: BOARD_SCHEMA,
        targetId: 't1',
        targetKind: 'topic',
        title: 'Architecture',
      },
      4,
    );

    expect(reduceBoard([topic, forged, valid]).topics[0].title).toBe('Architecture');
  });

  it('keeps reactions independent and one-per-address across name changes', () => {
    const thread = resource('Alice', {
      attachments: [],
      body: 'Body',
      createdAt: 1,
      id: 'th1',
      kind: 'thread',
      poll: null,
      schema: BOARD_SCHEMA,
      title: 'Thread',
      topicId: 't1',
    });
    const first = resource('Bob', {
      createdAt: 2,
      id: 'r1',
      kind: 'reaction',
      reaction: 'like',
      schema: BOARD_SCHEMA,
      targetId: 'th1',
      targetKind: 'thread',
    });
    const changed = resource(
      'Robert',
      {
        createdAt: 3,
        id: 'r2',
        kind: 'reaction',
        reaction: 'insightful',
        schema: BOARD_SCHEMA,
        targetId: 'th1',
        targetKind: 'thread',
      },
      4,
      'Bob-ADDRESS',
    );

    const reduced = reduceBoard([thread, first, changed]).threads[0];
    expect(reduced.reactionCounts.like).toBe(0);
    expect(reduced.reactionCounts.insightful).toBe(1);
  });

  it('accepts moderation only from the root or configured staff', () => {
    const thread = resource('Alice', {
      attachments: [],
      body: 'Body',
      createdAt: 1,
      id: 'th1',
      kind: 'thread',
      poll: null,
      schema: BOARD_SCHEMA,
      title: 'Thread',
      topicId: 't1',
    });
    const forgedPin = resource('Mallory', {
      action: 'pin',
      createdAt: 2,
      id: 'm1',
      kind: 'moderation',
      schema: BOARD_SCHEMA,
      targetId: 'th1',
      targetKind: 'thread',
    });
    const realPin = resource('Boards', {
      action: 'pin',
      createdAt: 3,
      id: 'm2',
      kind: 'moderation',
      schema: BOARD_SCHEMA,
      targetId: 'th1',
      targetKind: 'thread',
    });

    expect(reduceBoard([thread, forgedPin], 'Boards-ADDRESS').threads[0].pinned).toBe(false);
    expect(reduceBoard([thread, forgedPin, realPin], 'Boards-ADDRESS').threads[0].pinned).toBe(true);
  });

  it('accepts staff configuration only from the root creator address', () => {
    const thread = resource('Alice', {
      attachments: [],
      body: 'Body',
      createdAt: 1,
      id: 'th1',
      kind: 'thread',
      poll: null,
      schema: BOARD_SCHEMA,
      title: 'Thread',
      topicId: 't1',
    });
    const forgedConfig = resource('Boards', {
      admins: ['Mallory-ADDRESS'],
      createdAt: 2,
      id: 'config',
      kind: 'config',
      moderators: [],
      schema: BOARD_SCHEMA,
      title: 'Forged',
    }, 2, 'Mallory-ADDRESS');
    const forgedPin = resource('Mallory', {
      action: 'pin',
      createdAt: 3,
      id: 'm1',
      kind: 'moderation',
      schema: BOARD_SCHEMA,
      targetId: 'th1',
      targetKind: 'thread',
    }, 3, 'Mallory-ADDRESS');

    expect(
      reduceBoard([thread, forgedConfig, forgedPin], 'Boards-ADDRESS').threads[0].pinned,
    ).toBe(false);
  });

  it('uses confirmed chain order instead of payload timestamps', () => {
    const topic = resource('Alice', {
      createdAt: 50_000,
      description: 'Original',
      id: 't1',
      kind: 'topic',
      schema: BOARD_SCHEMA,
      tags: [],
      title: 'Original',
    }, 10);
    const first = resource('Alice', {
      createdAt: 9_999_999,
      id: 'e1',
      kind: 'edit',
      schema: BOARD_SCHEMA,
      targetId: 't1',
      targetKind: 'topic',
      title: 'First on chain',
    }, 11);
    const second = resource('Alice', {
      createdAt: 1,
      id: 'e2',
      kind: 'edit',
      schema: BOARD_SCHEMA,
      targetId: 't1',
      targetKind: 'topic',
      title: 'Second on chain',
    }, 12);

    expect(reduceBoard([second, topic, first]).topics[0].title).toBe('Second on chain');
  });
});

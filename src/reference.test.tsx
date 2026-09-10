import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATTACHMENT_IDENTIFIER_PREFIX,
  BOARD_FILE_NAME,
  BOARD_SCHEMA,
  BOARD_SERVICE,
  buildIdentifier,
  IDENTIFIERS,
  MAX_IDENTIFIER_BYTES,
  normalizeBoardRecord,
  REACTION_VALUES,
} from './boardModel';
import {
  createPollName,
  MAX_PAGES_PER_PREFIX,
  MAX_PUBLISH_BYTES,
  MAX_RECORD_BYTES,
  MAX_TRANSACTION_BYTES,
  PAGE_SIZE,
  publishRecord,
  selectAndPublishAttachmentWithResult,
  TIP_AMOUNT_TOLERANCE,
  voteNativePoll,
} from './boardService';
import { hasAction, type QdnRequest } from './qdnRequest';
import {
  BOARD_REFERENCE_EXAMPLES,
  BoardsReference,
  copyStatusMessage,
  TIP_AMOUNT_TOLERANCE_TEXT,
} from './Reference';
import { REFERENCE_SECTIONS } from './ReferenceNavigation';

function renderReference(onBack?: () => void) {
  return renderToStaticMarkup(<BoardsReference onBack={onBack} />);
}

/** Runs a public example verbatim with the named free variables bound; `result` is returned. */
async function runExample(source: string, scope: Record<string, unknown>, result?: string) {
  const names = Object.keys(scope);
  const execute = new Function(
    ...names,
    `return (async () => {\n${source}\n${result ? `return ${result};` : ''}\n})()`,
  ) as (...args: unknown[]) => Promise<unknown>;
  return execute(...names.map((name) => scope[name]));
}

function decodeBase64Json(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

/** Mirrors boardService's private jsonToBase64 (pretty-printed UTF-8 JSON). */
function jsonToBase64(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

describe('BoardsReference', () => {
  it('renders the live Boards v1 storage and identifier contract', () => {
    const html = renderReference();

    expect(html).toContain(BOARD_SCHEMA);
    expect(html).toContain(BOARD_SERVICE);
    expect(html).toContain(BOARD_FILE_NAME);
    expect(html).toContain(`${MAX_PUBLISH_BYTES.toLocaleString('en-US')} UTF-8 bytes`);
    expect(html).toContain(`${MAX_RECORD_BYTES.toLocaleString('en-US')} bytes per record`);
    expect(html).toContain(`limited to ${MAX_IDENTIFIER_BYTES} bytes`);
    expect(html).toContain(`in pages of ${PAGE_SIZE.toLocaleString('en-US')}`);
    expect(html).toContain(`at most ${MAX_PAGES_PER_PREFIX.toLocaleString('en-US')} pages per prefix`);
    expect(html).toContain(`${ATTACHMENT_IDENTIFIER_PREFIX}{id}`);

    for (const prefix of Object.values(IDENTIFIERS)) {
      expect(html).toContain(prefix);
    }
    for (const reaction of REACTION_VALUES) {
      expect(html).toContain(reaction);
    }
  });

  it('documents creator-address validation and confirmed chain reduction', () => {
    const html = renderReference();

    expect(html).toContain('confirmed block height');
    expect(html).toContain('transaction creator address');
    expect(html).toContain('original');
    expect(html).toContain('creator address');
    expect(html).toContain('PAYMENT');
    expect(html).toContain(`matches within ${TIP_AMOUNT_TOLERANCE_TEXT}.`);
    expect(Number(TIP_AMOUNT_TOLERANCE_TEXT)).toBe(TIP_AMOUNT_TOLERANCE);
    expect(html).toContain('/transactions/signature/');
    expect(html).toContain('?topic=');
    expect(html).toContain('?thread=');
    expect(html).toContain('&amp;post=');
    expect(html).toContain('injected render globals');
  });

  it('documents exact per-feature bridge actions and public-write semantics', () => {
    const html = renderReference();

    for (const action of [
      'SHOW_ACTIONS',
      'PUBLISH_QDN_RESOURCE',
      'SELECT_QDN_PUBLISH_SOURCE',
      'CREATE_POLL',
      'VOTE_ON_POLL',
      'SEND_COIN',
    ]) {
      expect(html).toContain(action);
    }

    expect(html).toContain('not atomic');
    expect(html).toContain('All Boards content is public');
    expect(html).toContain('do not provide privacy or physical erasure');
  });

  it('exports copyable examples and an optional integration back control', () => {
    expect(Object.keys(BOARD_REFERENCE_EXAMPLES)).toEqual([
      'capabilities',
      'publishThread',
      'verifyResource',
      'publishAttachment',
      'nativePoll',
    ]);
    expect(renderReference()).not.toContain('Back to discussions');
    expect(renderReference(() => undefined)).toContain('Back to discussions');
  });

  it('stays English and left-to-right whatever language Home selects', () => {
    const html = renderReference();

    expect(html).toContain('<article class="developer-reference" dir="ltr" lang="en">');
    expect(html).toContain('intentionally stays in English');
  });

  it('links every section through Home-safe navigation and makes each section focusable', () => {
    const html = renderReference();

    expect(html).toContain('aria-label="Developer reference sections"');
    for (const [id] of REFERENCE_SECTIONS) {
      expect(html).toContain(`href="/?view=developers#${id}"`);
      expect(html).toContain(`id="${id}" tabindex="-1"`);
    }
    expect(html).not.toContain('href="#');
  });

  it('shows a visible copy status for every example and names each copy control', () => {
    const html = renderReference();
    const statuses = html.match(/<p aria-live="polite" class="reference-copy-status" role="status">/g) ?? [];

    expect(statuses).toHaveLength(Object.keys(BOARD_REFERENCE_EXAMPLES).length);
    expect(html).toContain('Code can be selected for manual copying.');
    expect(html).toContain('aria-label="Copy Publish a thread record"');
    expect(html).not.toContain('class="sr-only"');
    expect(copyStatusMessage('copied', 'Publish a thread record')).toBe('Copied Publish a thread record.');
    expect(copyStatusMessage('unavailable', 'x')).toBe(
      'Clipboard unavailable. Select the code and copy it manually.',
    );
    expect(copyStatusMessage('idle', 'x')).toBe('Code can be selected for manual copying.');
  });
});

describe('public examples run through the real Boards implementation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('publishes a thread record the reader accepts, identical to the real publisher request', async () => {
    const calls: QdnRequest[] = [];
    const bridge = vi.fn(async (request: QdnRequest) => {
      calls.push(request);
      return { signature: 'sig' };
    });
    vi.stubGlobal('window', { qdnRequest: bridge });

    await runExample(BOARD_REFERENCE_EXAMPLES.publishThread, {
      jsonToBase64,
      qdnRequest: bridge,
      selectedWritableName: 'Alice',
    });
    const exampleRequest = calls[0]!;
    const payload = decodeBase64Json(String(exampleRequest.base64));
    const record = normalizeBoardRecord(payload);

    expect(record).not.toBeNull();
    expect(record).toEqual(payload);
    expect(record?.kind).toBe('thread');
    expect(normalizeBoardRecord({ ...payload, schema: 'unknown' })).toBeNull();
    expect(exampleRequest.identifier).toBe(buildIdentifier('thread', String(payload.id)));
    expect(String(exampleRequest.identifier).length).toBeLessThanOrEqual(MAX_IDENTIFIER_BYTES);

    calls.length = 0;
    await publishRecord('Alice', record!);
    // The normalized record serializes its keys in a different order, so compare decoded payloads.
    const realRequest = calls[0]!;
    expect(decodeBase64Json(String(realRequest.base64))).toEqual(payload);
    expect({ ...realRequest, base64: undefined }).toEqual({ ...exampleRequest, base64: undefined });
    expect(calls[0]!.service).toBe(BOARD_SERVICE);
    expect(calls[0]!.filename).toBe(BOARD_FILE_NAME);
  });

  it('derives capabilities exactly as the app does from advertised actions', async () => {
    const actions = ['publish_qdn_resource', 'VOTE_ON_POLL', 'SEND_COIN'];
    const capabilities = await runExample(
      BOARD_REFERENCE_EXAMPLES.capabilities,
      { qdnRequest: async () => actions },
      'capabilities',
    );

    expect(capabilities).toEqual({
      createPoll: hasAction(actions, 'CREATE_POLL'),
      publishAttachment: hasAction(actions, 'SELECT_QDN_PUBLISH_SOURCE') && hasAction(actions, 'PUBLISH_QDN_RESOURCE'),
      publishRecord: hasAction(actions, 'PUBLISH_QDN_RESOURCE'),
      sendTip: hasAction(actions, 'SEND_COIN'),
      voteOnPoll: hasAction(actions, 'VOTE_ON_POLL'),
    });
    expect(capabilities).toMatchObject({ publishRecord: true, publishAttachment: false, createPoll: false });
  });

  it('verifies a resource candidate with the same transaction lookup bound as the service', async () => {
    const resource = { identifier: `${IDENTIFIERS.topic}t1`, latestSignature: 'sig-1', name: 'Alice' };
    const transaction = {
      blockHeight: 12,
      creatorAddress: 'ALICE-ADDRESS',
      identifier: resource.identifier,
      name: resource.name,
      signature: resource.latestSignature,
      type: 'ARBITRARY',
    };
    const calls: QdnRequest[] = [];
    const authentic = await runExample(
      BOARD_REFERENCE_EXAMPLES.verifyResource,
      {
        qdnRequest: async (request: QdnRequest) => {
          calls.push(request);
          return transaction;
        },
        resource,
      },
      'authentic',
    );

    expect(calls[0]).toEqual({
      action: 'FETCH_NODE_API',
      maxBytes: MAX_TRANSACTION_BYTES,
      path: '/transactions/signature/sig-1',
    });
    expect(authentic).toBe(true);
    await expect(
      runExample(
        BOARD_REFERENCE_EXAMPLES.verifyResource,
        { qdnRequest: async () => ({ ...transaction, blockHeight: 0 }), resource },
        'authentic',
      ),
    ).resolves.toBe(false);
  });

  it('creates and votes on a native poll with the same names and one-based indexes as the app', async () => {
    const calls: QdnRequest[] = [];
    const bridge = vi.fn(async (request: QdnRequest) => {
      calls.push(request);
      return {};
    });
    vi.stubGlobal('window', { qdnRequest: bridge });

    await runExample(BOARD_REFERENCE_EXAMPLES.nativePoll, {
      endTime: 1_800_000_000_000,
      options: ['Yes', 'No'],
      pollId: 7,
      qdnRequest: bridge,
      selectedOptionIndex: 1,
      threadId: 'mabc1234example',
      threadTitle: 'A verifiable discussion',
    });
    expect(calls[0]).toMatchObject({
      action: 'CREATE_POLL',
      pollName: createPollName('mabc1234example'),
      pollOptions: [{ optionName: 'Yes' }, { optionName: 'No' }],
    });

    const exampleVote = calls[1]!;
    calls.length = 0;
    await voteNativePoll(7, [2]);
    expect(calls[0]).toEqual(exampleVote);
  });

  it('publishes an attachment from a source token with the identifier prefix the service uses', async () => {
    const calls: QdnRequest[] = [];
    const bridge = vi.fn(async (request: QdnRequest) => {
      calls.push(request);
      return request.action === 'SELECT_QDN_PUBLISH_SOURCE'
        ? { canceled: false, fileName: 'diagram.png', size: 1234, sourceToken: 'token-1' }
        : { signature: 'sig' };
    });
    vi.stubGlobal('window', { qdnRequest: bridge });

    await runExample(BOARD_REFERENCE_EXAMPLES.publishAttachment, {
      attachmentId: 'att1',
      qdnRequest: bridge,
      selectedWritableName: 'Alice',
    });
    const [exampleSelect, examplePublish] = calls as [QdnRequest, QdnRequest];

    calls.length = 0;
    const published = await selectAndPublishAttachmentWithResult('Alice');
    expect(calls[0]).toEqual(exampleSelect);
    expect(calls[1]).toEqual({ ...examplePublish, identifier: published?.attachment.identifier });
    expect(String(examplePublish.identifier)).toBe(`${ATTACHMENT_IDENTIFIER_PREFIX}att1`);
    expect(String(published?.attachment.identifier).startsWith(ATTACHMENT_IDENTIFIER_PREFIX)).toBe(true);
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BOARD_FILE_NAME,
  BOARD_SCHEMA,
  BOARD_SERVICE,
  IDENTIFIERS,
  REACTION_VALUES,
} from './boardModel';
import {
  BOARD_REFERENCE_EXAMPLES,
  BoardsReference,
} from './Reference';

function renderReference(onBack?: () => void) {
  return renderToStaticMarkup(<BoardsReference onBack={onBack} />);
}

describe('BoardsReference', () => {
  it('renders the live Boards v1 storage and identifier contract', () => {
    const html = renderReference();

    expect(html).toContain(BOARD_SCHEMA);
    expect(html).toContain(BOARD_SERVICE);
    expect(html).toContain(BOARD_FILE_NAME);
    expect(html).toContain('24,000');
    expect(html).toContain('25,000');
    expect(html).toContain('64 bytes');

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
    expect(html).toContain('0.00000001');
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
});

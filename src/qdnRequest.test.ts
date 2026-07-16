import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_READ_ACTIONS,
  getBridgeState,
  hasAction,
  qdnRequest,
  sanitizeNodePath,
  sanitizeReadMethod,
} from './qdnRequest';

describe('qdnRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports Home actions and public-node mode', async () => {
    const bridge = vi
      .fn()
      .mockResolvedValueOnce(['FETCH_NODE_API', 'GET_SELECTED_ACCOUNT'])
      .mockResolvedValueOnce('QORTIUM_HOME')
      .mockResolvedValueOnce(true);
    vi.stubGlobal('window', { qdnRequest: bridge });

    await expect(getBridgeState()).resolves.toEqual({
      actions: ['FETCH_NODE_API', 'GET_SELECTED_ACCOUNT'],
      isHomeBridge: true,
      isUsingPublicNode: true,
      ui: 'QORTIUM_HOME',
    });
  });

  it('keeps browser development read-only', async () => {
    vi.stubGlobal('window', {});
    await expect(qdnRequest({ action: 'GET_SELECTED_ACCOUNT' })).rejects.toThrow(
      'only available inside Qortium Home',
    );
    expect(LOCAL_READ_ACTIONS).not.toContain('GET_SELECTED_ACCOUNT');
  });

  it('sanitizes local fallback paths and methods', () => {
    expect(sanitizeNodePath('/polls/id/4?x=1')).toBe('/polls/id/4?x=1');
    expect(() => sanitizeNodePath('//example.com')).toThrow();
    expect(() => sanitizeNodePath('admin/status')).toThrow();
    expect(sanitizeReadMethod('head')).toBe('HEAD');
    expect(() => sanitizeReadMethod('POST')).toThrow();
  });

  it('checks actions case-insensitively', () => {
    expect(hasAction(['create_poll'], 'CREATE_POLL')).toBe(true);
    expect(hasAction(['FETCH_NODE_API'], 'SEND_COIN', 'PAYMENT')).toBe(false);
  });
});

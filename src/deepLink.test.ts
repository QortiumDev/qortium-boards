import { describe, expect, it } from 'vitest';
import {
  buildRouteLink,
  getAppBaseAddress,
  readRoute,
  resolvePostTarget,
  routeUrl,
  shouldReplaceHistory,
  type BoardsRoute,
} from './deepLink';

describe('Boards deep links', () => {
  it('parses routes with thread precedence and trims empty targets', () => {
    expect(readRoute('?thread=thread-1&post=post-2&topic=ignored')).toEqual({
      kind: 'thread',
      postId: 'post-2',
      threadId: 'thread-1',
    });
    expect(readRoute('?thread=thread-1&post=%20')).toEqual({
      kind: 'thread',
      postId: undefined,
      threadId: 'thread-1',
    });
    expect(readRoute('?topic=topic-1')).toEqual({ kind: 'topic', topicId: 'topic-1' });
    expect(readRoute('?view=developers')).toEqual({ kind: 'developers' });
    expect(readRoute('?search=direct%20links')).toEqual({
      kind: 'board',
      search: 'direct links',
    });
  });

  it('round-trips encoded thread and post routes through the browser path', () => {
    const route: BoardsRoute = {
      kind: 'thread',
      postId: 'post / 2',
      threadId: 'thread / 1',
    };
    const path = routeUrl(route, { pathname: '/render/APP/Boards/Boards' });

    expect(path).toBe(
      '/render/APP/Boards/Boards?thread=thread+%2F+1&post=post+%2F+2',
    );
    expect(readRoute(path.slice(path.indexOf('?')))).toEqual(route);
  });

  it('prefers Core-injected identity when building a mirror-safe link', () => {
    const host = {
      _qdnIdentifier: 'boards.mirror.v1',
      _qdnName: 'Board Operator',
      _qdnService: 'APP',
    };
    const route: BoardsRoute = {
      kind: 'thread',
      postId: 'post-2',
      threadId: 'thread-1',
    };

    expect(
      buildRouteLink(route, { pathname: '/render/APP/Boards/Boards' }, host),
    ).toBe(
      'qdn://APP/Board%20Operator/boards.mirror.v1?thread=thread-1&post=post-2',
    );
  });

  it('derives identity from a render path and falls back in local development', () => {
    expect(
      getAppBaseAddress(
        { pathname: '/render/APP/Board%20Operator/boards.mirror.v1/index.html' },
        {},
      ),
    ).toBe('qdn://APP/Board%20Operator/boards.mirror.v1');
    expect(getAppBaseAddress({ pathname: '/' }, {})).toBe('qdn://APP/Boards/Boards');
  });

  it('keeps copied topic and thread links distinct from reply links', () => {
    expect(
      buildRouteLink(
        { kind: 'topic', topicId: 'topic-1' },
        { pathname: '/' },
        {},
      ),
    ).toBe('qdn://APP/Boards/Boards?topic=topic-1');
    expect(
      buildRouteLink(
        { kind: 'thread', threadId: 'thread-1' },
        { pathname: '/' },
        {},
      ),
    ).toBe('qdn://APP/Boards/Boards?thread=thread-1');
  });

  it('rejects missing and cross-thread post targets', () => {
    const posts = [
      { id: 'post-1', threadId: 'thread-1' },
      { id: 'post-2', threadId: 'thread-2' },
    ];

    expect(
      resolvePostTarget(
        { kind: 'thread', postId: 'post-1', threadId: 'thread-1' },
        posts,
      ),
    ).toEqual({ kind: 'found', post: posts[0] });
    expect(
      resolvePostTarget(
        { kind: 'thread', postId: 'post-2', threadId: 'thread-1' },
        posts,
      ),
    ).toEqual({ kind: 'missing' });
    expect(resolvePostTarget({ kind: 'thread', threadId: 'thread-1' }, posts)).toEqual({
      kind: 'none',
    });
  });

  it('replaces history for published replies and clearing invalid targets', () => {
    expect(shouldReplaceHistory('standard')).toBe(false);
    expect(shouldReplaceHistory('published-reply')).toBe(true);
    expect(shouldReplaceHistory('clear-target')).toBe(true);
  });
});

const DEFAULT_SERVICE = 'APP';
const DEFAULT_NAME = 'Boards';
const DEFAULT_IDENTIFIER = 'Boards';

type LocationLike = {
  hash?: string;
  pathname?: string;
  search?: string;
};

type QdnHostGlobals = {
  _qdnIdentifier?: unknown;
  _qdnName?: unknown;
  _qdnService?: unknown;
};

export type BoardsRoute =
  | { kind: 'board'; search: string }
  | { kind: 'developers' }
  | { kind: 'thread'; postId?: string; threadId: string }
  | { kind: 'topic'; topicId: string };

export type NavigationIntent = 'clear-target' | 'published-reply' | 'standard';

export type DiscussionAvailability = 'found' | 'loading' | 'not-found' | 'unavailable';

const ROUTE_QUERY_KEYS = ['topic', 'thread', 'post', 'view', 'search'] as const;

function resolveLocation(location?: LocationLike): LocationLike {
  if (location) return location;
  return typeof window === 'undefined' ? {} : window.location;
}

function resolveHost(host?: QdnHostGlobals): QdnHostGlobals {
  if (host) return host;
  return typeof window === 'undefined' ? {} : (window as Window & QdnHostGlobals);
}

function cleanGlobal(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function decodeSegment(value: string | undefined): string {
  if (!value) return '';

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function applyRouteQuery(query: URLSearchParams, route: BoardsRoute): void {
  for (const key of ROUTE_QUERY_KEYS) query.delete(key);

  if (route.kind === 'topic') query.set('topic', route.topicId);
  if (route.kind === 'thread') {
    query.set('thread', route.threadId);
    if (route.postId) query.set('post', route.postId);
  }
  if (route.kind === 'developers') query.set('view', 'developers');
  if (route.kind === 'board' && route.search) query.set('search', route.search);
}

function routeQuery(route: BoardsRoute): string {
  const query = new URLSearchParams();
  applyRouteQuery(query, route);

  return query.toString();
}

export function readRoute(search?: string): BoardsRoute {
  const rawSearch = search ?? resolveLocation().search ?? '';
  const query = new URLSearchParams(rawSearch);
  const threadId = query.get('thread')?.trim();
  const topicId = query.get('topic')?.trim();
  const view = query.get('view')?.trim().toLowerCase();

  if (threadId) {
    return {
      kind: 'thread',
      postId: query.get('post')?.trim() || undefined,
      threadId,
    };
  }

  if (topicId) return { kind: 'topic', topicId };
  if (view === 'developers') return { kind: 'developers' };

  return { kind: 'board', search: query.get('search')?.trim() ?? '' };
}

export function routeUrl(route: BoardsRoute, location?: LocationLike): string {
  const resolvedLocation = resolveLocation(location);
  const pathname = resolvedLocation.pathname || '/';
  const query = new URLSearchParams(resolvedLocation.search ?? '');
  applyRouteQuery(query, route);
  const serializedQuery = query.toString();

  return `${pathname}${serializedQuery ? `?${serializedQuery}` : ''}${resolvedLocation.hash ?? ''}`;
}

export function getAppBaseAddress(location?: LocationLike, host?: QdnHostGlobals): string {
  const { pathname = '' } = resolveLocation(location);
  const resolvedHost = resolveHost(host);
  const renderMatch = pathname.match(/\/render\/([^/]+)\/([^/]+)(?:\/([^/?#]+))?/i);

  const service =
    cleanGlobal(resolvedHost._qdnService) || decodeSegment(renderMatch?.[1]) || DEFAULT_SERVICE;
  const name =
    cleanGlobal(resolvedHost._qdnName) || decodeSegment(renderMatch?.[2]) || DEFAULT_NAME;
  const identifier =
    cleanGlobal(resolvedHost._qdnIdentifier) ||
    decodeSegment(renderMatch?.[3]) ||
    DEFAULT_IDENTIFIER;

  return `qdn://${encodeURIComponent(service)}/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`;
}

export function buildRouteLink(
  route: BoardsRoute,
  location?: LocationLike,
  host?: QdnHostGlobals,
): string {
  const query = routeQuery(route);
  return `${getAppBaseAddress(location, host)}${query ? `?${query}` : ''}`;
}

export function shouldReplaceHistory(intent: NavigationIntent): boolean {
  return intent === 'clear-target' || intent === 'published-reply';
}

export function resolvePostTarget<T extends { id: string; threadId: string }>(
  route: BoardsRoute,
  posts: readonly T[],
): { kind: 'found'; post: T } | { kind: 'missing' } | { kind: 'none' } {
  if (route.kind !== 'thread' || !route.postId) return { kind: 'none' };

  const post = posts.find(
    (candidate) => candidate.id === route.postId && candidate.threadId === route.threadId,
  );
  return post ? { kind: 'found', post } : { kind: 'missing' };
}

export function resolveDiscussionAvailability(
  isLoading: boolean,
  hasDiscussion: boolean,
  targetUnavailable: boolean,
): DiscussionAvailability {
  if (isLoading) return 'loading';
  if (hasDiscussion) return 'found';
  return targetUnavailable ? 'unavailable' : 'not-found';
}

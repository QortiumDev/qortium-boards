import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readRoute } from './deepLink';
import {
  canonicalizeDevelopersLocation,
  isReferenceSectionId,
  REFERENCE_SECTIONS,
  ReferenceNavigation,
  referenceSectionUrl,
  revealHashSection,
} from './ReferenceNavigation';

function fakeWindow(url: string, sections: Record<string, unknown> = {}) {
  const location = new URL(url);
  const history = { pushState: vi.fn(), replaceState: vi.fn(), state: { from: 'test' } };
  return {
    document: { getElementById: (id: string) => (sections[id] as HTMLElement | undefined) ?? null },
    history,
    location,
  };
}

describe('Home-safe reference section navigation', () => {
  it('builds full-document links that survive Core injected base URLs and keep host parameters', () => {
    const href = referenceSectionUrl(
      'https://node.test/render/APP/Boards/Boards/?view=reference&view=developer&thread=old&post=old&qdnHomeBridge=fixture&theme=dark&future=a&future=b#old',
      'reference-identifiers',
    );
    const target = new URL(href, 'https://node.test/render/APP/Boards/Boards/');

    expect(target.pathname).toBe('/render/APP/Boards/Boards/');
    expect(target.searchParams.getAll('view')).toEqual(['developers']);
    expect(target.searchParams.has('thread')).toBe(false);
    expect(target.searchParams.has('post')).toBe(false);
    expect(target.searchParams.get('qdnHomeBridge')).toBe('fixture');
    expect(target.searchParams.get('theme')).toBe('dark');
    expect(target.searchParams.getAll('future')).toEqual(['a', 'b']);
    expect(target.hash).toBe('#reference-identifiers');
    expect(readRoute(target.search)).toEqual({ kind: 'developers' });
  });

  it('renders a real link for every section rather than a base-sensitive bare fragment', () => {
    const html = renderToStaticMarkup(<ReferenceNavigation />);

    expect(html).toContain('aria-label="Developer reference sections"');
    for (const [id, label] of REFERENCE_SECTIONS) {
      expect(html).toContain(`href="/?view=developers#${id}"`);
      expect(html).toContain(`>${label}</a>`);
    }
    expect(html).not.toContain('href="#');
  });

  it('canonicalizes alias views on mount without touching unrelated parameters or the fragment', () => {
    const host = fakeWindow('https://node.test/render/APP/Boards/Boards?view=reference&accent=clay&accent=blue&lang=ar#reference-state');

    expect(canonicalizeDevelopersLocation(host as never)).toBe(
      '/render/APP/Boards/Boards?accent=clay&accent=blue&lang=ar&view=developers#reference-state',
    );
    expect(host.history.replaceState).toHaveBeenCalledWith(
      { from: 'test' },
      '',
      '/render/APP/Boards/Boards?accent=clay&accent=blue&lang=ar&view=developers#reference-state',
    );
    expect(host.history.pushState).not.toHaveBeenCalled();
  });

  it('leaves an already canonical developers URL alone', () => {
    const host = fakeWindow('https://node.test/render/APP/Boards/Boards?theme=dark&view=developers#reference-bridge');

    canonicalizeDevelopersLocation(host as never);
    expect(host.history.replaceState).not.toHaveBeenCalled();
  });

  it('reveals only known sections, scrolling the app document and focusing without scroll', () => {
    const scrollingElement = { clientHeight: 800, scrollTop: 40 };
    const ownerDocument = {
      defaultView: { getComputedStyle: () => ({ overflowY: 'visible', scrollMarginTop: '90px' }), innerHeight: 800 },
      documentElement: scrollingElement,
      scrollingElement,
    };
    const focus = vi.fn();
    const scrollIntoView = vi.fn();
    const section = {
      closest: () => null,
      focus,
      getBoundingClientRect: () => ({ height: 200, top: 500 }),
      ownerDocument,
      parentElement: null,
      scrollIntoView,
    };
    const host = fakeWindow('https://node.test/?view=developers#reference-state', { 'reference-state': section });

    expect(revealHashSection(host as never)).toBe(true);
    expect(scrollingElement.scrollTop).toBe(40 + 500 - 90);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollIntoView).not.toHaveBeenCalled();

    const unknown = fakeWindow('https://node.test/?view=developers#boards-main', { 'boards-main': section });
    expect(revealHashSection(unknown as never)).toBe(false);
    expect(isReferenceSectionId('boards-main')).toBe(false);
    expect(focus).toHaveBeenCalledTimes(1);
  });
});

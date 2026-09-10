import { useEffect, type MouseEvent } from 'react';
import { scrollWithinApp } from './appScroll';
import { routeUrl } from './deepLink';

export const REFERENCE_SECTIONS = [
  ['reference-records', 'Records'],
  ['reference-identifiers', 'Identifiers'],
  ['reference-authenticity', 'Authenticity'],
  ['reference-state', 'State reduction'],
  ['reference-links', 'Direct links'],
  ['reference-features', 'Polls, files and tips'],
  ['reference-bridge', 'Bridge examples'],
] as const;

export type ReferenceSectionId = (typeof REFERENCE_SECTIONS)[number][0];

const DEVELOPERS_ROUTE = { kind: 'developers' } as const;
const SERVER_RENDER_HREF = '/?view=developers';

type NavigationWindow = Pick<Window, 'location'> & {
  document: Pick<Document, 'getElementById'>;
  history: Pick<History, 'pushState' | 'replaceState' | 'state'>;
};

export function isReferenceSectionId(value: string): value is ReferenceSectionId {
  return REFERENCE_SECTIONS.some(([id]) => id === value);
}

/** Builds a full-document section link so Core's injected <base> cannot re-resolve a bare
 *  fragment; the current pathname and unrelated query parameters are preserved. */
export function referenceSectionUrl(input: string, id: ReferenceSectionId): string {
  const url = new URL(input, 'http://localhost');
  url.hash = id;
  return routeUrl(DEVELOPERS_ROUTE, url);
}

/** Rewrites `view=reference` / `view=developer` aliases (and repeated Boards keys) to the
 *  canonical `?view=developers` without disturbing other parameters or the fragment. */
export function canonicalizeDevelopersLocation(host: NavigationWindow): string {
  const canonical = routeUrl(DEVELOPERS_ROUTE, host.location);
  const current = `${host.location.pathname}${host.location.search}${host.location.hash}`;

  if (canonical !== current) {
    host.history.replaceState(host.history.state, '', canonical);
  }

  return canonical;
}

/** Scrolls the section named by the current fragment within the Boards document only. */
export function revealHashSection(host: NavigationWindow): boolean {
  const id = host.location.hash.slice(1);
  if (!isReferenceSectionId(id)) return false;

  const section = host.document.getElementById(id);
  if (!section) return false;

  // Never scrollIntoView: it can scroll Home's outer Android document.
  scrollWithinApp(section, 'start');
  section.focus({ preventScroll: true });
  return true;
}

export function ReferenceNavigation() {
  useEffect(() => {
    canonicalizeDevelopersLocation(window);
    revealHashSection(window);

    const onHistory = () => {
      revealHashSection(window);
    };
    window.addEventListener('popstate', onHistory);
    window.addEventListener('hashchange', onHistory);
    return () => {
      window.removeEventListener('popstate', onHistory);
      window.removeEventListener('hashchange', onHistory);
    };
  }, []);

  function visit(event: MouseEvent<HTMLAnchorElement>, id: ReferenceSectionId) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();

    const next = referenceSectionUrl(window.location.href, id);
    if (window.location.hash !== `#${id}`) {
      window.history.pushState(window.history.state, '', next);
    }
    revealHashSection(window);
  }

  return (
    <nav aria-label="Developer reference sections" className="reference-toc">
      {REFERENCE_SECTIONS.map(([id, label]) => (
        <a
          href={referenceSectionUrl(
            typeof window === 'undefined' ? SERVER_RENDER_HREF : window.location.href,
            id,
          )}
          key={id}
          onClick={(event) => visit(event, id)}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

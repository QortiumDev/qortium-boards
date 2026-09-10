/* Bounded scrolling for Boards.
   Home renders QDN apps inside its own document on Android, and Element.scrollIntoView()
   can move that outer document instead of the app. These helpers therefore adjust only the
   scrollTop of the nearest overflow container inside the Boards root, or, because Boards has
   no scroll-contained region, the app document's own scrolling element as the fallback. */

export const APP_ROOT_SELECTOR = '.app';

export type ScrollBlock = 'center' | 'start';

function computedStyle(element: Element): CSSStyleDeclaration | null {
  const view = element.ownerDocument?.defaultView;
  return typeof view?.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
}

export function findScrollContainer(target: Element, root: Element | null): HTMLElement | null {
  let candidate = target.parentElement;

  while (candidate && candidate !== root) {
    const style = computedStyle(candidate);
    if (
      style &&
      /(auto|scroll)/.test(style.overflowY) &&
      candidate.scrollHeight > candidate.clientHeight
    ) {
      return candidate as HTMLElement;
    }
    candidate = candidate.parentElement;
  }

  return null;
}

export function scrollWithinApp(target: Element, block: ScrollBlock = 'start'): void {
  const root = typeof target.closest === 'function' ? target.closest(APP_ROOT_SELECTOR) : null;
  const rect = target.getBoundingClientRect();
  const scrollMargin = Number.parseFloat(computedStyle(target)?.scrollMarginTop ?? '') || 0;
  const container = findScrollContainer(target, root);

  if (container) {
    const containerRect = container.getBoundingClientRect();
    const offset =
      block === 'center' ? Math.max(0, (container.clientHeight - rect.height) / 2) : scrollMargin;
    container.scrollTop += rect.top - containerRect.top - offset;
    return;
  }

  const ownerDocument = target.ownerDocument;
  const scroller = ownerDocument?.scrollingElement ?? ownerDocument?.documentElement;
  if (!scroller) return;

  const viewportHeight = ownerDocument?.defaultView?.innerHeight || scroller.clientHeight;
  const offset = block === 'center' ? Math.max(0, (viewportHeight - rect.height) / 2) : scrollMargin;
  scroller.scrollTop += rect.top - offset;
}

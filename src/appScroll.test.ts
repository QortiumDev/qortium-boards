import { describe, expect, it } from 'vitest';
import { findScrollContainer, scrollWithinApp } from './appScroll';

type FakeElement = {
  className: string;
  clientHeight: number;
  closest: (selector: string) => FakeElement | null;
  getBoundingClientRect: () => { height: number; top: number };
  overflowY: string;
  ownerDocument: FakeDocument;
  parentElement: FakeElement | null;
  scrollHeight: number;
  scrollIntoView: () => never;
  scrollMarginTop: string;
  scrollTop: number;
};

type FakeDocument = {
  defaultView: { getComputedStyle: (element: FakeElement) => { overflowY: string; scrollMarginTop: string }; innerHeight: number };
  documentElement: { clientHeight: number; scrollTop: number };
  scrollingElement: { clientHeight: number; scrollTop: number } | null;
};

function makeDocument(innerHeight = 800): FakeDocument {
  return {
    defaultView: {
      getComputedStyle: (element) => ({ overflowY: element.overflowY, scrollMarginTop: element.scrollMarginTop }),
      innerHeight,
    },
    documentElement: { clientHeight: innerHeight, scrollTop: 0 },
    scrollingElement: { clientHeight: innerHeight, scrollTop: 100 },
  };
}

function makeElement(ownerDocument: FakeDocument, overrides: Partial<FakeElement> = {}): FakeElement {
  const element: FakeElement = {
    className: '',
    clientHeight: 0,
    closest: (selector) => {
      let candidate: FakeElement | null = element;
      while (candidate) {
        if (`.${candidate.className}` === selector) return candidate;
        candidate = candidate.parentElement;
      }
      return null;
    },
    getBoundingClientRect: () => ({ height: 0, top: 0 }),
    overflowY: 'visible',
    ownerDocument,
    parentElement: null,
    scrollHeight: 0,
    scrollIntoView: () => {
      throw new Error('scrollIntoView must never be used: it can scroll the Home document');
    },
    scrollMarginTop: '0px',
    scrollTop: 0,
    ...overrides,
  };
  return element;
}

const asElement = (element: FakeElement) => element as unknown as Element;

describe('bounded app scrolling', () => {
  it('scrolls the app document itself when Boards has no overflow container, honouring scroll-margin', () => {
    const doc = makeDocument();
    const app = makeElement(doc, { className: 'app' });
    const main = makeElement(doc, { parentElement: app });
    const section = makeElement(doc, {
      getBoundingClientRect: () => ({ height: 300, top: 640 }),
      parentElement: main,
      scrollMarginTop: '90px',
    });

    expect(findScrollContainer(asElement(section), asElement(app))).toBeNull();
    scrollWithinApp(asElement(section), 'start');
    expect(doc.scrollingElement?.scrollTop).toBe(100 + 640 - 90);
    expect(main.scrollTop).toBe(0);
    expect(app.scrollTop).toBe(0);
  });

  it('centres a deep-linked post within the viewport of the app document', () => {
    const doc = makeDocument(800);
    const app = makeElement(doc, { className: 'app' });
    const post = makeElement(doc, {
      getBoundingClientRect: () => ({ height: 200, top: 1000 }),
      parentElement: app,
    });

    scrollWithinApp(asElement(post), 'center');
    expect(doc.scrollingElement?.scrollTop).toBe(100 + 1000 - (800 - 200) / 2);
  });

  it('prefers the nearest overflow container inside the app root and never walks past it', () => {
    const doc = makeDocument();
    const app = makeElement(doc, { className: 'app', clientHeight: 500, overflowY: 'auto', scrollHeight: 5000 });
    const panel = makeElement(doc, {
      clientHeight: 400,
      getBoundingClientRect: () => ({ height: 400, top: 120 }),
      overflowY: 'auto',
      parentElement: app,
      scrollHeight: 3000,
      scrollTop: 50,
    });
    const decorative = makeElement(doc, { overflowY: 'auto', parentElement: panel, scrollHeight: 10, clientHeight: 10 });
    const section = makeElement(doc, {
      getBoundingClientRect: () => ({ height: 100, top: 520 }),
      parentElement: decorative,
    });

    expect(findScrollContainer(asElement(section), asElement(app))).toBe(panel);
    scrollWithinApp(asElement(section), 'start');
    expect(panel.scrollTop).toBe(50 + 520 - 120);
    expect(doc.scrollingElement?.scrollTop).toBe(100);
    expect(app.scrollTop).toBe(0);
  });
});

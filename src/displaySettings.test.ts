/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCENT_VALUES,
  applyDisplaySettings,
  createDisplaySettingsMessageListener,
  getDisplaySettingsUpdateFromMessage,
  getInitialDisplaySettings,
  normalizeAccent,
  normalizeUiStyle,
  type DisplaySettingsUpdater,
  type QdnDisplaySettings,
} from './displaySettings';

// Read from disk: vitest stubs CSS imports (even `?raw`) to an empty string.
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');


const current: QdnDisplaySettings = {
  accent: 'green',
  language: 'en',
  textSize: 'medium',
  theme: 'light',
  uiStyle: 'classic',
};

describe('display settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts all three UI families and rejects aliases', () => {
    expect(normalizeUiStyle('CLASSIC')).toBe('classic');
    expect(normalizeUiStyle('modern')).toBe('modern');
    expect(normalizeUiStyle('Fun')).toBe('fun');
    expect(normalizeUiStyle('retro')).toBeNull();
    expect(normalizeUiStyle('chibi')).toBeNull();
  });

  it('accepts the Home clay accent and styles it in both themes like every other accent', () => {
    expect(ACCENT_VALUES).toContain('clay');
    expect(normalizeAccent('Clay')).toBe('clay');
    expect(normalizeAccent('terracotta')).toBeNull();
    expect(getDisplaySettingsUpdateFromMessage({ action: 'ACCENT_CHANGED', accent: 'clay' }, current)).toEqual({
      ...current,
      accent: 'clay',
    });

    for (const accent of ACCENT_VALUES.filter((value) => value !== 'green')) {
      expect(styles).toContain(`:root[data-accent='${accent}'] {`);
      expect(styles).toContain(`:root[data-theme='dark'][data-accent='${accent}'] {`);
    }
    expect(styles).toMatch(/:root\[data-accent='clay'\] \{[^}]*--qb-accent: #[0-9a-f]{6};[^}]*--qb-accent-ring:/);
    expect(styles).toMatch(/:root\[data-theme='dark'\]\[data-accent='clay'\] \{[^}]*--qb-accent: #[0-9a-f]{6};[^}]*--qb-accent-ring:/);
  });

  it('honours an initial clay accent from the render URL', () => {
    vi.stubGlobal('window', { location: { search: '?accent=clay' } });
    expect(getInitialDisplaySettings()).toEqual({ ...current, accent: 'clay' });
  });

  it('folds rapid partial Home updates through a functional setter instead of a stale snapshot', () => {
    let state = current;
    const update = (updater: DisplaySettingsUpdater) => {
      state = updater(state);
    };
    const listener = createDisplaySettingsMessageListener(update);

    // Same tick, same listener instance: each update must build on the previous one.
    listener({ data: { action: 'THEME_CHANGED', theme: 'dark' } });
    listener({ data: { action: 'ACCENT_CHANGED', accent: 'clay' } });
    listener({ data: { requestedHandler: 'UI', action: 'TEXT_SIZE_CHANGED', textSize: 'huge' } });
    expect(state).toEqual({ ...current, accent: 'clay', textSize: 'huge', theme: 'dark' });

    const before = state;
    listener({ data: { action: 'UNRELATED' } });
    listener({ data: 'not an object' });
    expect(state).toBe(before);
  });

  it('defaults to the Home-compatible Classic family', () => {
    vi.stubGlobal('window', { location: { search: '' } });
    expect(getInitialDisplaySettings()).toEqual(current);
  });

  it('reads render URL settings before host globals', () => {
    vi.stubGlobal('window', {
      _qdnAccent: 'yellow',
      _qdnTheme: 'light',
      _qdnUiStyle: 'classic',
      location: {
        search: '?theme=dark&accent=purple&textSize=huge&lang=he&uiStyle=fun',
      },
    });

    expect(getInitialDisplaySettings()).toEqual({
      accent: 'purple',
      language: 'he',
      textSize: 'huge',
      theme: 'dark',
      uiStyle: 'fun',
    });
  });

  it('updates every family live and rejects unrelated handlers', () => {
    expect(
      getDisplaySettingsUpdateFromMessage(
        { requestedHandler: 'UI', action: 'UI_STYLE_CHANGED', uiStyle: 'modern' },
        current,
      ),
    ).toEqual({ ...current, uiStyle: 'modern' });
    expect(
      getDisplaySettingsUpdateFromMessage(
        { requestedHandler: 'UI', action: 'UI_STYLE_CHANGED', uiStyle: 'fun' },
        current,
      ),
    ).toEqual({ ...current, uiStyle: 'fun' });
    expect(
      getDisplaySettingsUpdateFromMessage(
        { requestedHandler: 'OTHER', action: 'UI_STYLE_CHANGED', uiStyle: 'fun' },
        current,
      ),
    ).toBeNull();
  });

  it('applies root attributes before React renders', () => {
    const root = {
      dataset: {} as Record<string, string>,
      dir: '',
      lang: '',
      style: {} as Record<string, string>,
    };
    vi.stubGlobal('document', { documentElement: root });

    applyDisplaySettings({
      accent: 'cyan',
      language: 'ar',
      textSize: 'large',
      theme: 'dark',
      uiStyle: 'fun',
    });

    expect(root.dataset).toMatchObject({
      accent: 'cyan',
      language: 'ar',
      textSize: 'large',
      theme: 'dark',
      ui: 'fun',
    });
    expect(root.dir).toBe('rtl');
    expect(root.style.colorScheme).toBe('dark');
  });
});

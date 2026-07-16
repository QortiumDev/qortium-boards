import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyDisplaySettings,
  getDisplaySettingsUpdateFromMessage,
  getInitialDisplaySettings,
  normalizeUiStyle,
  type QdnDisplaySettings,
} from './displaySettings';

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

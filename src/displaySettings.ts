export const ACCENT_VALUES = ['green', 'blue', 'orange', 'purple', 'red', 'teal', 'cyan', 'pink', 'yellow'] as const;
export const TEXT_SIZE_VALUES = ['extra-small', 'small', 'medium', 'large', 'extra-large', 'huge'] as const;
export const UI_STYLE_VALUES = ['classic', 'modern', 'fun'] as const;

export type QdnAccent = (typeof ACCENT_VALUES)[number];
export type QdnTheme = 'dark' | 'light';
export type QdnTextSize = (typeof TEXT_SIZE_VALUES)[number];
export type QdnUiStyle = (typeof UI_STYLE_VALUES)[number];

export const TEXT_SIZE_SCALE = {
  'extra-small': 0.88,
  small: 0.94,
  medium: 1,
  large: 1.3,
  'extra-large': 1.7,
  huge: 2.1,
} as const satisfies Record<QdnTextSize, number>;

export type QdnDisplaySettings = {
  accent: QdnAccent;
  language: string;
  textSize: QdnTextSize;
  theme: QdnTheme;
  uiStyle: QdnUiStyle;
};

type QdnHostWindow = Window & {
  _qdnAccent?: unknown;
  _qdnLang?: unknown;
  _qdnLanguage?: unknown;
  _qdnTextSize?: unknown;
  _qdnTheme?: unknown;
  _qdnUiStyle?: unknown;
  _qdnUIStyle?: unknown;
};

export const DEFAULT_DISPLAY_SETTINGS: QdnDisplaySettings = {
  accent: 'green',
  language: 'en',
  textSize: 'medium',
  theme: 'light',
  uiStyle: 'classic',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function normalizeLanguage(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized) ? normalized : null;
}

function isRtlLanguage(language: string) {
  return /^(ar|fa|he|ur)(?:-|$)/.test(language);
}

export function normalizeTheme(value: unknown): QdnTheme | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'dark' || normalized === 'light' ? normalized : null;
}

export function normalizeAccent(value: unknown): QdnAccent | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return ACCENT_VALUES.includes(normalized as QdnAccent) ? (normalized as QdnAccent) : null;
}

export function normalizeTextSize(value: unknown): QdnTextSize | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return TEXT_SIZE_VALUES.includes(normalized as QdnTextSize) ? (normalized as QdnTextSize) : null;
}

export function normalizeUiStyle(value: unknown): QdnUiStyle | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return UI_STYLE_VALUES.includes(normalized as QdnUiStyle) ? (normalized as QdnUiStyle) : null;
}

export function getInitialDisplaySettings(): QdnDisplaySettings {
  const hostWindow = typeof window === 'undefined' ? null : (window as QdnHostWindow);
  const query = typeof window === 'undefined' ? null : new URLSearchParams(window.location?.search ?? '');

  return {
    accent:
      normalizeAccent(query?.get('accent') ?? hostWindow?._qdnAccent) ??
      DEFAULT_DISPLAY_SETTINGS.accent,
    language:
      normalizeLanguage(
        query?.get('lang') ??
          query?.get('language') ??
          hostWindow?._qdnLang ??
          hostWindow?._qdnLanguage,
      ) ?? DEFAULT_DISPLAY_SETTINGS.language,
    textSize:
      normalizeTextSize(query?.get('textSize') ?? query?.get('text-size')) ??
      normalizeTextSize(hostWindow?._qdnTextSize) ??
      DEFAULT_DISPLAY_SETTINGS.textSize,
    theme:
      normalizeTheme(query?.get('theme') ?? hostWindow?._qdnTheme) ??
      DEFAULT_DISPLAY_SETTINGS.theme,
    uiStyle:
      normalizeUiStyle(
        query?.get('uiStyle') ??
          query?.get('ui-style') ??
          hostWindow?._qdnUiStyle ??
          hostWindow?._qdnUIStyle,
      ) ?? DEFAULT_DISPLAY_SETTINGS.uiStyle,
  };
}

export function applyDisplaySettings(settings: QdnDisplaySettings) {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  root.dataset.accent = settings.accent;
  root.dataset.language = settings.language;
  root.dataset.textSize = settings.textSize;
  root.dataset.theme = settings.theme;
  root.dataset.ui = settings.uiStyle;
  root.dir = isRtlLanguage(settings.language) ? 'rtl' : 'ltr';
  root.lang = settings.language;
  root.style.colorScheme = settings.theme;
}

export function getDisplaySettingsUpdateFromMessage(
  data: unknown,
  current: QdnDisplaySettings,
): QdnDisplaySettings | null {
  if (!isObject(data) || typeof data.action !== 'string') {
    return null;
  }

  if ('requestedHandler' in data && data.requestedHandler !== 'UI') {
    return null;
  }

  switch (data.action) {
    case 'ACCENT_CHANGED': {
      const accent = normalizeAccent(data.accent ?? data.qdnAccent);
      return accent ? { ...current, accent } : null;
    }
    case 'DISPLAY_SETTINGS_CHANGED':
      return {
        accent: normalizeAccent(data.accent ?? data.qdnAccent) ?? current.accent,
        language: normalizeLanguage(data.language ?? data.lang ?? data.qdnLang) ?? current.language,
        textSize: normalizeTextSize(data.textSize ?? data.qdnTextSize) ?? current.textSize,
        theme: normalizeTheme(data.theme ?? data.qdnTheme) ?? current.theme,
        uiStyle:
          normalizeUiStyle(data.uiStyle ?? data.ui ?? data.qdnUiStyle ?? data.qdnUIStyle) ??
          current.uiStyle,
      };
    case 'LANGUAGE_CHANGED': {
      const language = normalizeLanguage(data.language ?? data.lang ?? data.qdnLang);
      return language ? { ...current, language } : null;
    }
    case 'TEXT_SIZE_CHANGED': {
      const textSize = normalizeTextSize(data.textSize ?? data.qdnTextSize);
      return textSize ? { ...current, textSize } : null;
    }
    case 'THEME_CHANGED': {
      const theme = normalizeTheme(data.theme ?? data.qdnTheme);
      return theme ? { ...current, theme } : null;
    }
    case 'UI_STYLE_CHANGED': {
      const uiStyle = normalizeUiStyle(data.uiStyle ?? data.ui ?? data.qdnUiStyle ?? data.qdnUIStyle);
      return uiStyle ? { ...current, uiStyle } : null;
    }
    default:
      return null;
  }
}

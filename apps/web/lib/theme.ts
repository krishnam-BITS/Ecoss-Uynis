export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'uynis-theme';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

function getStoredTheme(): ThemeMode | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function resolveThemePreference(): ThemeMode {
  if (typeof document !== 'undefined') {
    const rootTheme = document.documentElement.getAttribute('data-theme');
    if (isThemeMode(rootTheme)) {
      return rootTheme;
    }
  }

  const stored = getStoredTheme();
  if (stored) {
    return stored;
  }

  if (typeof window !== 'undefined' && window.matchMedia(LIGHT_QUERY).matches) {
    return 'light';
  }

  return 'dark';
}

export function applyDocumentTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

export function subscribeToSystemThemeChange(onChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const media = window.matchMedia(LIGHT_QUERY);
  const handler = () => onChange();

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }

  media.addListener(handler);
  return () => media.removeListener(handler);
}
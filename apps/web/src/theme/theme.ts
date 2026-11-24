import { useSyncExternalStore } from 'react';

/**
 * The colour theme: `system` follows the device (`prefers-color-scheme`), `light` and `dark`
 * override it. The choice is kept in `localStorage` and shown as `data-theme` on `<html>` (absent
 * for `system`), which sets the page's `color-scheme`; `light-dark()` in `dark-palette.css` does
 * the rest. `public/theme-init.js` applies the stored choice before the first paint.
 */
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Also read by `public/theme-init.js`. */
export const THEME_STORAGE_KEY = 'testtix-theme';

function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

/** The stored choice; `system` when there is none or storage is blocked. */
export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

const listeners = new Set<() => void>();

/** Stores, applies and announces the choice to every `useTheme()`. */
export function setTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the choice lasts until the page is reloaded.
  }
  current = theme;
  applyTheme(theme);
  for (const listener of listeners) listener();
}

let current: Theme | undefined;

function snapshot(): Theme {
  current ??= storedTheme();
  return current;
}

function subscribe(listener: () => void): () => void {
  // A choice made in another tab: storage events only fire in the other tabs.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    current = storedTheme();
    applyTheme(current);
    listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Forgets the cached choice, for tests that change `localStorage` themselves. */
export function resetThemeForTests(): void {
  current = undefined;
  delete document.documentElement.dataset.theme;
}

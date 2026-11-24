import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../testing/render.js';
import { THEME_STORAGE_KEY } from './theme.js';

const root = document.documentElement;

async function themeRadios() {
  const group = await screen.findByRole('radiogroup', { name: 'Theme' });
  return {
    system: within(group).getByRole('radio', { name: 'System' }),
    light: within(group).getByRole('radio', { name: 'Light' }),
    dark: within(group).getByRole('radio', { name: 'Dark' }),
  };
}

describe('theme switcher', () => {
  it('follows the device setting until a theme is chosen', async () => {
    renderApp('/');
    const radios = await themeRadios();

    expect(radios.system).toBeChecked();
    expect(root).not.toHaveAttribute('data-theme');
  });

  it('applies and stores the chosen theme', async () => {
    const { user } = renderApp('/');
    const radios = await themeRadios();

    await user.click(radios.dark);
    expect(radios.dark).toBeChecked();
    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.click(radios.light);
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    await user.click(radios.system);
    expect(root).not.toHaveAttribute('data-theme');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('starts with the stored theme', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderApp('/');

    expect((await themeRadios()).dark).toBeChecked();
  });

  it('ignores a stored value that isn’t a theme', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    renderApp('/');

    expect((await themeRadios()).system).toBeChecked();
    expect(root).not.toHaveAttribute('data-theme');
  });

  it('picks up a theme chosen in another tab', async () => {
    renderApp('/');
    const radios = await themeRadios();

    // The other tab writes storage; this one only gets the event.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    });

    expect(radios.dark).toBeChecked();
    expect(root).toHaveAttribute('data-theme', 'dark');
  });

  it('can be used with the keyboard', async () => {
    const { user } = renderApp('/');
    const radios = await themeRadios();

    radios.system.focus();
    await user.keyboard('{ArrowRight}');

    expect(radios.light).toBeChecked();
    expect(root).toHaveAttribute('data-theme', 'light');
  });
});

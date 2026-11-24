import { act, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axe } from '../testing/axe.js';
import { renderApp } from '../testing/render.js';
import { THEME_STORAGE_KEY } from './theme.js';

const root = document.documentElement;

function themeButton() {
  return within(screen.getByRole('banner')).findByRole('button', { name: /^Theme: / });
}

async function openThemeMenu(user: UserEvent) {
  await user.click(await themeButton());
  return screen.findByRole('menu', { name: /^Theme: / });
}

async function chooseTheme(user: UserEvent, name: string) {
  const menu = await openThemeMenu(user);
  await user.click(within(menu).getByRole('menuitemradio', { name }));
}

describe('theme menu', () => {
  it('follows the device setting until a theme is chosen', async () => {
    const { user } = renderApp('/');

    expect(await themeButton()).toHaveAccessibleName('Theme: System');
    expect(root).not.toHaveAttribute('data-theme');

    const menu = await openThemeMenu(user);
    expect(within(menu).getByRole('menuitemradio', { name: 'System' })).toBeChecked();
    expect(within(menu).getByRole('menuitemradio', { name: 'Dark' })).not.toBeChecked();
  });

  it('applies and stores the chosen theme', async () => {
    const { user } = renderApp('/');

    await chooseTheme(user, 'Dark');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(await themeButton()).toHaveAccessibleName('Theme: Dark');
    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await chooseTheme(user, 'Light');
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    await chooseTheme(user, 'System');
    expect(root).not.toHaveAttribute('data-theme');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('starts with the stored theme', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderApp('/');

    expect(await themeButton()).toHaveAccessibleName('Theme: Dark');
  });

  it('ignores a stored value that isn’t a theme', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    renderApp('/');

    expect(await themeButton()).toHaveAccessibleName('Theme: System');
    expect(root).not.toHaveAttribute('data-theme');
  });

  it('picks up a theme chosen in another tab', async () => {
    renderApp('/');
    const button = await themeButton();

    // The other tab writes storage; this one only gets the event.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    });

    expect(button).toHaveAccessibleName('Theme: Dark');
    expect(root).toHaveAttribute('data-theme', 'dark');
  });

  it('can be used with the keyboard', async () => {
    const { user } = renderApp('/');
    (await themeButton()).focus();

    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu', { name: /^Theme: / });
    // Focus starts on the selected item (System); Light is next.
    await user.keyboard('{ArrowDown}{Enter}');

    expect(menu).not.toBeInTheDocument();
    expect(root).toHaveAttribute('data-theme', 'light');
    // React Aria returns focus to the button once the popover has gone.
    const button = await themeButton();
    await waitFor(() => {
      expect(button).toHaveFocus();
    });
  });

  it('has no axe violations with the menu open', async () => {
    const { user } = renderApp('/');
    await openThemeMenu(user);

    expect(await axe(document.body)).toHaveNoViolations();
  });
});

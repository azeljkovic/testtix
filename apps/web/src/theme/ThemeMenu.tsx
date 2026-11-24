import type { ReactNode } from 'react';
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';

import { setTheme, type Theme, THEMES, useTheme } from './theme.js';

const LABELS: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Decorative: the button and menu items say the theme in words. */
const ICONS: Record<Theme, ReactNode> = {
  system: (
    <Icon>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </Icon>
  ),
  light: (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  ),
  dark: (
    <Icon>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </Icon>
  ),
};

const ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-slate-800 outline-none data-[focused]:bg-indigo-50 data-[focused]:text-indigo-800';

/** An icon button in the header showing the current colour theme, with a menu to change it. */
export function ThemeMenu() {
  const theme = useTheme();

  return (
    <MenuTrigger>
      <Button
        // The icon shows the current choice; the name says it too.
        aria-label={`Theme: ${LABELS[theme]}`}
        className="rounded-md p-1.5 text-slate-700 hover:bg-slate-100 hover:text-indigo-700"
      >
        {ICONS[theme]}
      </Button>
      <Popover
        placement="bottom end"
        className="min-w-40 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
      >
        {/* Named by the button (React Aria's aria-labelledby). */}
        <Menu
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[theme]}
          onSelectionChange={(keys) => {
            const [selected] = keys === 'all' ? [] : [...keys];
            if (selected !== undefined) setTheme(selected as Theme);
          }}
          className="outline-none"
        >
          {THEMES.map((option) => (
            <MenuItem key={option} id={option} textValue={LABELS[option]} className={ITEM_CLASS}>
              {({ isSelected }) => (
                <>
                  {ICONS[option]}
                  <span className="flex-1">{LABELS[option]}</span>
                  <span aria-hidden="true" className={isSelected ? 'visible' : 'invisible'}>
                    ✓
                  </span>
                </>
              )}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

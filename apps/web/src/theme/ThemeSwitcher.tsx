import { Label, RadioButton, RadioField, RadioGroup } from 'react-aria-components';

import { setTheme, type Theme, THEMES, useTheme } from './theme.js';

const LABELS: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** Radio buttons for the colour theme, styled as a segmented control. */
export function ThemeSwitcher() {
  const theme = useTheme();

  return (
    <RadioGroup
      value={theme}
      onChange={(value) => {
        setTheme(value as Theme);
      }}
      orientation="horizontal"
      className="flex items-center gap-2"
    >
      <Label>Theme</Label>
      <div className="flex rounded-md border border-slate-300 bg-white p-0.5">
        {THEMES.map((option) => (
          <RadioField key={option} value={option} className="flex">
            <RadioButton className="cursor-pointer rounded px-2 py-0.5 text-slate-700 not-data-[selected]:hover:text-indigo-700 data-[selected]:bg-indigo-700 data-[selected]:text-white">
              {LABELS[option]}
            </RadioButton>
          </RadioField>
        ))}
      </div>
    </RadioGroup>
  );
}

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { darkPaletteCss, paletteHues, usedHues } from './dark-palette.js';

const require = createRequire(import.meta.url);
const themeCss = readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8');
const srcDir = join(import.meta.dirname, '..');

const GENERATED = [join('api', 'generated'), join('theme', 'dark-palette.css')];

/** Every source file of the app (tests included: a class there is harmless). */
function appSource(): string {
  return readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(tsx?|css)$/.test(file))
    .filter((file) => !GENERATED.some((generated) => file.startsWith(generated)))
    .map((file) => readFileSync(join(srcDir, file), 'utf8'))
    .join('\n');
}

describe('dark palette', () => {
  it('dark-palette.css covers every palette hue the app uses', async () => {
    const hues = usedHues(themeCss, appSource());
    expect(hues).toContain('slate');

    // Fails when the file is out of date; `vitest -u` rewrites it (see the file's header).
    await expect(darkPaletteCss(themeCss, hues)).toMatchFileSnapshot('./dark-palette.css');
  });

  it('reads the hues from Tailwind’s theme', () => {
    expect(paletteHues(themeCss)).toEqual(expect.arrayContaining(['slate', 'indigo', 'amber']));
    expect(usedHues(themeCss, 'bg-amber-50 text-white border-slate-200 bg-indigo-700/40')).toEqual([
      'amber',
      'indigo',
      'slate',
    ]);
  });
});

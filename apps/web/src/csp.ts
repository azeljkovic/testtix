import { z } from 'zod';

// Keeps the app inside the production Content-Security-Policy (apps/web/Caddyfile: no inline
// styles, no 'unsafe-eval'). Imported first by `main.tsx`, before anything renders or parses.

// Zod compiles object parsers with `new Function` when it can, and finds out by trying once; under
// the policy that try is only a reported violation. Parsing without it is just as correct.
z.config({ jitless: true });

// React Aria's press handling adds a <style id="react-aria-pressable-style"> to <head> (a
// `touch-action` rule) unless an element with that ID already exists. The policy blocks inline
// styles, so the rule is in index.css instead and this marker tells React Aria it's there.
export const PRESSABLE_STYLE_ID = 'react-aria-pressable-style';
if (document.getElementById(PRESSABLE_STYLE_ID) === null) {
  const marker = document.createElement('meta');
  marker.id = PRESSABLE_STYLE_ID;
  document.head.append(marker);
}

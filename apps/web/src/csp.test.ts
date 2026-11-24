import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PRESSABLE_STYLE_ID } from './csp.js';

// What `csp.ts` sets up before the app renders. That React Aria then leaves out its inline <style>
// can only be seen in a real browser (jsdom never triggers the injection): the containerised app's
// console shows no Content-Security-Policy violations.
describe('CSP compatibility (src/csp.ts)', () => {
  it('marks React Aria’s pressable style as present', () => {
    const marker = document.getElementById(PRESSABLE_STYLE_ID);
    expect(marker?.parentElement).toBe(document.head);
    expect(PRESSABLE_STYLE_ID).toBe('react-aria-pressable-style');
  });

  it('turns off Zod’s `new Function` probe', () => {
    expect(z.config().jitless).toBe(true);
  });
});

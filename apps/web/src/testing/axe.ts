// vitest-axe's own type augmentation targets an old Vitest (`Vi.Assertion`), so the matcher is
// registered here (setup.ts) and typed for Vitest's current `Matchers` interface.
import { configureAxe } from 'vitest-axe';

declare module 'vitest' {
  // Type parameters must match Vitest's declaration for the interfaces to merge.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    /** Passes when an axe-core run (from `axe()`) found no violations. */
    toHaveNoViolations(): R;
  }
}

/** Runs axe-core on an element that is attached to the document (usually `document.body`). */
export const axe = configureAxe({
  // jsdom doesn't render, so colour contrast can't be measured; axe only reports it as incomplete.
  rules: { 'color-contrast': { enabled: false } },
});

import { describe, expect, it } from 'vitest';

import { documentTitle } from './PageTitle.js';

describe('documentTitle', () => {
  it('appends the app name to the page title', () => {
    expect(documentTitle('Events')).toBe('Events · TestTix');
  });

  it('is just the app name without a page title', () => {
    expect(documentTitle()).toBe('TestTix');
    expect(documentTitle('')).toBe('TestTix');
  });
});

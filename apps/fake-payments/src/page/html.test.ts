import { describe, expect, it } from 'vitest';

import { attributes, markup } from './html.js';

describe('markup', () => {
  it('escapes interpolated strings', () => {
    expect(markup`<p title="${'"x" & \'y\''}">${'<script>'}</p>`.value).toBe(
      '<p title="&quot;x&quot; &amp; &#39;y&#39;">&lt;script&gt;</p>',
    );
  });

  it('keeps nested markup as is and joins arrays', () => {
    const items = ['a', '<b>'].map((item) => markup`<li>${item}</li>`);
    expect(markup`<ul>${items}</ul>`.value).toBe('<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  });

  it('renders nothing for null, undefined and false', () => {
    expect(markup`[${null}${undefined}${false}${0}]`.value).toBe('[0]');
  });
});

describe('attributes', () => {
  it('renders defined attributes in order, escaped', () => {
    expect(
      markup`<input${attributes({ id: 'a', hidden: undefined, value: '"<x>"' })} />`.value,
    ).toBe('<input id="a" value="&quot;&lt;x&gt;&quot;" />');
  });
});

/** Markup that is already safe: produced by `markup` or `attributes`. */
export class SafeHtml {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

type Interpolation =
  SafeHtml | string | number | null | undefined | false | readonly Interpolation[];

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function render(value: Interpolation): string {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(String(value));
}

/**
 * Tagged template for HTML: every interpolated value is escaped unless it is `SafeHtml`; arrays
 * are joined; `null`, `undefined` and `false` render nothing (for `cond && markup\`...\``).
 * Not named `html`: Prettier would reformat the templates as embedded HTML.
 */
export function markup(strings: TemplateStringsArray, ...values: Interpolation[]): SafeHtml {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? '');
  });
  return new SafeHtml(out);
}

/** ` name="value"` for each attribute, in order, skipping `undefined` ones. Values are escaped. */
export function attributes(attrs: Record<string, string | undefined>): SafeHtml {
  const rendered = Object.entries(attrs)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`);
  return new SafeHtml(rendered.join(''));
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Handlebars from 'handlebars';

/**
 * Template files live in `apps/api/templates/mail/`, outside `src`, so this path is the same from
 * `src/mail/` (tests) and `dist/mail/` (the built app).
 */
export const MAIL_TEMPLATES_DIR = fileURLToPath(new URL('../../templates/mail/', import.meta.url));

/** Each email, with the variables its templates use. */
export interface MailTemplateData {
  'verify-email': { name: string; verifyUrl: string; expiresIn: string };
}

export type MailTemplateName = keyof MailTemplateData;

const SUBJECTS: Readonly<Record<MailTemplateName, string>> = {
  'verify-email': 'Verify your email address',
};

const TEMPLATE_NAMES = Object.keys(SUBJECTS) as MailTemplateName[];

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

type Compiled = Handlebars.TemplateDelegate;

/**
 * Renders emails from Handlebars templates: `<name>.html.hbs` and `<name>.text.hbs`, each wrapped
 * in the matching `layout.*.hbs`. All templates are compiled when the renderer is created, so a
 * missing or broken file stops the app at startup. Templates are strict: a variable that isn't
 * passed throws instead of rendering as an empty string. HTML parts escape every `{{value}}`;
 * text parts don't escape anything.
 */
export class MailRenderer {
  private readonly html = new Map<MailTemplateName | 'layout', Compiled>();
  private readonly text = new Map<MailTemplateName | 'layout', Compiled>();

  constructor(dir: string = MAIL_TEMPLATES_DIR) {
    const handlebars = Handlebars.create();
    for (const name of ['layout', ...TEMPLATE_NAMES] as const) {
      this.html.set(name, compile(handlebars, dir, `${name}.html.hbs`, false));
      this.text.set(name, compile(handlebars, dir, `${name}.text.hbs`, true));
    }
  }

  render<K extends MailTemplateName>(name: K, data: MailTemplateData[K]): RenderedMail {
    const subject = SUBJECTS[name];
    return {
      subject,
      html: this.part(this.html, name, data, subject),
      text: this.part(this.text, name, data, subject),
    };
  }

  private part(
    templates: Map<MailTemplateName | 'layout', Compiled>,
    name: MailTemplateName,
    data: object,
    subject: string,
  ): string {
    const body = templates.get(name)?.(data);
    const layout = templates.get('layout');
    if (body === undefined || layout === undefined) throw new Error(`No mail template "${name}"`);
    return layout({ subject, body: body.trim() });
  }
}

function compile(
  handlebars: typeof Handlebars,
  dir: string,
  file: string,
  plainText: boolean,
): Compiled {
  const source = readFileSync(join(dir, file), 'utf8');
  // `compile` is lazy (it parses on the first call), so parse now to fail at startup instead.
  handlebars.parse(source);
  return handlebars.compile(source, { strict: true, noEscape: plainText });
}

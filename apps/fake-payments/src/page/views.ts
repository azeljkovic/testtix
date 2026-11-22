import { formatPrice, type PaymentFailureCode } from '@testtix/shared';

import type { CardField, CardFormErrors, CardFormValues } from '../cards/card-form.js';
import { formatCardNumber, TEST_CARDS } from '../cards/test-cards.js';
import type { SessionRecord } from '../sessions/payment-sessions.service.js';
import { attributes, markup, type SafeHtml } from './html.js';

const EMPTY_FORM: CardFormValues = { cardNumber: '', expiry: '', cvc: '', name: '' };

const EXPIRY_FORMAT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function layout(title: string, main: SafeHtml): string {
  return markup`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} – TestTix Pay</title>
    <link rel="stylesheet" href="/assets/pay.css" />
  </head>
  <body>
    <header class="brand">
      <p>TestTix Pay</p>
      <p class="test-mode">Test mode: no real money moves</p>
    </header>
    <main>
${main}
    </main>
  </body>
</html>
`.value;
}

interface FieldOptions {
  name: CardField;
  label: string;
  hint?: string;
  autocomplete: string;
  inputmode?: 'numeric';
  maxlength: number;
  value: string;
  error: string | undefined;
}

function field(options: FieldOptions): SafeHtml {
  const { name, hint, error } = options;
  const describedBy = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(' ');
  const input = attributes({
    id: name,
    name,
    type: 'text',
    value: options.value,
    autocomplete: options.autocomplete,
    inputmode: options.inputmode,
    maxlength: String(options.maxlength),
    spellcheck: 'false',
    'aria-describedby': describedBy || undefined,
    'aria-invalid': error ? 'true' : undefined,
  });
  return markup`
        <div class="${error ? 'field has-error' : 'field'}">
          <label for="${name}">${options.label}</label>
          ${hint && markup`<p class="hint" id="${name}-hint">${hint}</p>`}
          ${error && markup`<p class="error" id="${name}-error"><span class="visually-hidden">Error:</span> ${error}</p>`}
          <input${input} />
        </div>`;
}

const FIELD_ORDER: readonly CardField[] = ['cardNumber', 'expiry', 'cvc', 'name'];

function errorSummary(errors: CardFormErrors): SafeHtml | false {
  const items = FIELD_ORDER.flatMap((name) => {
    const message = errors[name];
    return message === undefined ? [] : [markup`<li><a href="#${name}">${message}</a></li>`];
  });
  if (items.length === 0) return false;
  // Focused on load, so keyboard and screen reader users land on the list of problems.
  return markup`
      <div class="error-summary" role="alert" aria-labelledby="error-summary-title" tabindex="-1" autofocus>
        <h2 id="error-summary-title">There is a problem</h2>
        <ul>${items}</ul>
      </div>`;
}

function testCardTable(): SafeHtml {
  const rows = TEST_CARDS.map(
    (card) =>
      markup`
            <tr><td>${formatCardNumber(card.number)}</td><td><strong>${card.label}.</strong> ${card.description}</td></tr>`,
  );
  return markup`
      <details>
        <summary>Test cards</summary>
        <table>
          <caption class="visually-hidden">Test card numbers and what they do</caption>
          <thead><tr><th scope="col">Card number</th><th scope="col">Result</th></tr></thead>
          <tbody>${rows}
          </tbody>
        </table>
        <p>Use any expiry date in the future, any 3-digit security code and any name.</p>
      </details>`;
}

export interface PaymentFormView {
  session: SessionRecord;
  cancelUrl: string;
  values?: CardFormValues;
  errors?: CardFormErrors;
}

export function renderPaymentForm(view: PaymentFormView): string {
  const { session } = view;
  const values = view.values ?? EMPTY_FORM;
  const errors = view.errors ?? {};
  const amount = formatPrice(session.amountCents);
  const hasErrors = Object.keys(errors).length > 0;
  const expiresAt = session.expiresAt;

  const cardNumber = field({
    name: 'cardNumber',
    label: 'Card number',
    hint: 'The long number on the front of the card',
    autocomplete: 'cc-number',
    inputmode: 'numeric',
    maxlength: 23,
    value: values.cardNumber,
    error: errors.cardNumber,
  });
  const expiry = field({
    name: 'expiry',
    label: 'Expiry date',
    hint: 'MM/YY',
    autocomplete: 'cc-exp',
    maxlength: 7,
    value: values.expiry,
    error: errors.expiry,
  });
  // The security code is never filled back in, as on a real payment page.
  const cvc = field({
    name: 'cvc',
    label: 'Security code',
    hint: '3 or 4 digits',
    autocomplete: 'cc-csc',
    inputmode: 'numeric',
    maxlength: 4,
    value: '',
    error: errors.cvc,
  });
  const name = field({
    name: 'name',
    label: 'Name on card',
    autocomplete: 'cc-name',
    maxlength: 100,
    value: values.name,
    error: errors.name,
  });

  return layout(
    `${hasErrors ? 'Error: ' : ''}Pay ${amount}`,
    markup`      <h1>Pay ${amount}</h1>
      <p class="description">${session.description}</p>${errorSummary(errors)}
      <form method="post" action="/pay/${session.id}" novalidate>${cardNumber}
        <div class="row">${expiry}${cvc}
        </div>${name}
        <button type="submit">Pay ${amount}</button>
      </form>
      <p><a href="${view.cancelUrl}">Cancel and return to the shop</a></p>
      <p class="hint">This payment link expires on <time datetime="${expiresAt.toISOString()}">${EXPIRY_FORMAT.format(expiresAt)} UTC</time>.</p>${testCardTable()}`,
  );
}

const FAILURE_TEXT: Record<PaymentFailureCode, string> = {
  CARD_DECLINED: 'Your card was declined.',
  INSUFFICIENT_FUNDS: 'Your card has insufficient funds.',
};

/** The page for a session that can no longer be paid: succeeded, failed or expired. */
export function renderClosedSession(session: SessionRecord, returnUrl: string): string {
  const link = markup`<p><a href="${returnUrl}">Return to the shop</a></p>`;
  switch (session.status) {
    case 'SUCCEEDED':
      return layout(
        'Payment complete',
        markup`      <h1>Payment complete</h1>
      <p>Your payment of ${formatPrice(session.amountCents)} was successful.</p>
      ${link}`,
      );
    case 'FAILED':
      return layout(
        'Payment failed',
        markup`      <h1>Payment failed</h1>
      <p>${session.failureCode && FAILURE_TEXT[session.failureCode]} No money was taken.</p>
      ${link}`,
      );
    case 'EXPIRED':
    case 'OPEN':
      return layout(
        'Payment link expired',
        markup`      <h1>This payment link has expired</h1>
      <p>No money was taken.</p>
      ${link}`,
      );
  }
}

export function renderNotFound(): string {
  return layout(
    'Payment not found',
    markup`      <h1>Payment not found</h1>
      <p>Check that the address is correct, or start the payment again from the shop.</p>`,
  );
}

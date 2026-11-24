import { SEEDED_ACCOUNTS, type SeededAccountEmail } from '@testtix/shared';
import { useEffect, useRef, useState } from 'react';

/** How long a copy button shows its check mark. */
export const COPIED_MS = 2000;

const ACCOUNT_LABELS: Record<SeededAccountEmail, { title: string; purpose: string }> = {
  'admin@testtix.test': { title: 'Admin', purpose: 'Admin area and admin API.' },
  'customer@testtix.test': { title: 'Customer', purpose: 'Verified email, can check out.' },
  'unverified@testtix.test': {
    title: 'Unverified customer',
    purpose: 'Can hold tickets but can’t check out until the email is verified.',
  },
};

type Field = 'email' | 'password';

interface CopyStatus {
  ok: boolean;
  message: string;
}

function CopyIcon({ done }: { done: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {done ? (
        <path d="M5 12l5 5L20 7" />
      ) : (
        <>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </>
      )}
    </svg>
  );
}

/**
 * The seeded accounts (shared with the API seed), each email and password with a copy button.
 * The outcome of a copy is announced through the panel's one `role="status"`.
 */
export function TestAccounts() {
  const [status, setStatus] = useState<CopyStatus | null>(null);
  /** The field whose button shows a check mark. */
  const [checked, setChecked] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  async function copy(key: string, value: string, what: string) {
    clearTimeout(timer.current);
    try {
      // Missing outside a secure context (plain HTTP on a host other than localhost).
      if (typeof navigator.clipboard === 'undefined') throw new Error('No clipboard');
      await navigator.clipboard.writeText(value);
      setStatus({ ok: true, message: `Copied the ${what}.` });
      setChecked(key);
      timer.current = setTimeout(() => {
        setChecked(null);
      }, COPIED_MS);
    } catch {
      setChecked(null);
      setStatus({
        ok: false,
        message: `Couldn’t copy the ${what}. Select the text and copy it instead.`,
      });
    }
  }

  return (
    <section
      aria-labelledby="test-accounts-heading"
      className="mt-10 rounded-lg border border-slate-200 bg-slate-50 p-5"
    >
      <h2 id="test-accounts-heading" className="text-lg font-semibold">
        Test accounts
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Seeded accounts for testing. Everyone using this server shares them.
      </p>
      <ul className="mt-4 flex flex-col gap-4">
        {SEEDED_ACCOUNTS.map((account) => {
          const { title, purpose } = ACCOUNT_LABELS[account.email];
          const fields: { field: Field; label: string; value: string }[] = [
            { field: 'email', label: 'Email', value: account.email },
            { field: 'password', label: 'Password', value: account.password },
          ];
          return (
            <li key={account.email}>
              <h3 className="font-medium">{title}</h3>
              <p className="text-sm text-slate-600">{purpose}</p>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 text-sm">
                {fields.map(({ field, label, value }) => {
                  const key = `${account.email}:${field}`;
                  const what = `${title.toLowerCase()} ${field}`;
                  const done = checked === key;
                  return (
                    <div key={field} className="contents">
                      <dt className="text-slate-600">{label}</dt>
                      <dd className="min-w-0">
                        <code className="font-mono break-all text-slate-900 select-all">
                          {value}
                        </code>
                      </dd>
                      <dd>
                        <button
                          type="button"
                          aria-label={`Copy ${what}`}
                          onClick={() => void copy(key, value, what)}
                          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-200 hover:text-indigo-700"
                        >
                          <CopyIcon done={done} />
                        </button>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </li>
          );
        })}
      </ul>
      <p
        role="status"
        className={`mt-4 min-h-5 text-sm ${status?.ok === false ? 'text-red-700' : 'text-slate-600'}`}
      >
        {status?.message}
      </p>
    </section>
  );
}

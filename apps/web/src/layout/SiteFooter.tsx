import { APP_NAME } from '@testtix/shared';

import { ApiStatus } from './ApiStatus.js';

export const REPOSITORY_URL = 'https://github.com/azeljkovic/testtix';

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 text-sm text-slate-600">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <p>
          {APP_NAME} is a practice target for software testing. Tickets and payments are not real.
        </p>
        <div className="flex items-center gap-4">
          <ApiStatus />
          <a href={REPOSITORY_URL} className="underline underline-offset-4 hover:text-indigo-700">
            Source code
          </a>
        </div>
      </div>
    </footer>
  );
}

import { APP_NAME } from '@testtix/shared';
import { Link, NavLink } from 'react-router';

import { AccountMenu } from './AccountMenu.js';

const NAV_ITEMS = [{ to: '/events', label: 'Events' }] as const;

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-4 py-4">
        <Link to="/" className="text-xl font-bold tracking-tight text-indigo-700">
          {APP_NAME}
          <span className="sr-only"> home</span>
        </Link>
        <nav aria-label="Main" className="mr-auto">
          <ul className="flex gap-6">
            {NAV_ITEMS.map(({ to, label }) => (
              <li key={to}>
                {/* NavLink sets aria-current="page" on the active link. */}
                <NavLink
                  to={to}
                  className="font-medium text-slate-700 hover:text-indigo-700 aria-[current=page]:text-indigo-700 aria-[current=page]:underline aria-[current=page]:underline-offset-4"
                >
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <AccountMenu />
      </div>
    </header>
  );
}

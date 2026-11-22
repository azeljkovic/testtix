import { NavLink, Outlet } from 'react-router';

const NAV_ITEMS = [
  { to: '/admin/events', label: 'Events' },
  { to: '/admin/venues', label: 'Venues' },
] as const;

/** The admin area: its own navigation above each admin page. */
export function AdminLayout() {
  return (
    <>
      <nav aria-label="Admin" className="mb-8 border-b border-slate-200 pb-3">
        <ul className="flex items-center gap-6">
          <li className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Admin</li>
          {NAV_ITEMS.map(({ to, label }) => (
            <li key={to}>
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
      <Outlet />
    </>
  );
}

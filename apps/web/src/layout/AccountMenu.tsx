import { Button, Menu, MenuItem, MenuTrigger, Popover, Separator } from 'react-aria-components';
import { Link, useLocation } from 'react-router';

import { authPagePath } from '../auth/redirect.js';
import { useLogout, useSession } from '../auth/session.js';

const ITEM_CLASS =
  'block cursor-pointer rounded px-3 py-2 text-slate-800 outline-none data-[focused]:bg-indigo-50 data-[focused]:text-indigo-800';

/** Log in / register links for visitors; a menu with the account, admin and log out for users. */
export function AccountMenu() {
  const { data: session } = useSession();
  const location = useLocation();
  const logout = useLogout();

  // Nothing while the session loads (or fails to), rather than a flash of the wrong state.
  if (session === undefined) return null;

  if (session === null) {
    return (
      <div className="flex items-center gap-4">
        <Link
          to={authPagePath('/login', location)}
          className="font-medium text-slate-700 hover:text-indigo-700"
        >
          Log in
        </Link>
        <Link
          to={authPagePath('/register', location)}
          className="rounded-md bg-indigo-700 px-3 py-1.5 font-medium text-white hover:bg-indigo-800"
        >
          Register
        </Link>
      </div>
    );
  }

  const { user } = session;
  return (
    <div className="flex items-center gap-3">
      {logout.isError && (
        <p role="alert" className="text-sm font-medium text-red-700">
          Couldn’t log out. Try again.
        </p>
      )}
      <MenuTrigger>
        <Button
          // Starts with the visible text (the name), so voice control users can say what they see.
          aria-label={`${user.name}, account menu`}
          className="flex items-center gap-1 font-medium text-slate-700 hover:text-indigo-700"
        >
          {/* Names can be 100 characters long. */}
          <span className="max-w-40 truncate sm:max-w-64">{user.name}</span>
          <span aria-hidden="true">▾</span>
        </Button>
        <Popover
          placement="bottom end"
          className="min-w-56 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
        >
          <p className="px-3 pt-2 pb-1 text-xs text-slate-600">Logged in as {user.email}</p>
          <Menu aria-label="Account" className="outline-none">
            <MenuItem href="/account" className={ITEM_CLASS}>
              Account
            </MenuItem>
            <MenuItem href="/orders" className={ITEM_CLASS}>
              Your orders
            </MenuItem>
            {user.role === 'ADMIN' && (
              <MenuItem href="/admin" className={ITEM_CLASS}>
                Admin
              </MenuItem>
            )}
            <Separator className="my-1 border-t border-slate-200" />
            <MenuItem
              onAction={() => {
                logout.mutate();
              }}
              className={ITEM_CLASS}
            >
              Log out
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
    </div>
  );
}

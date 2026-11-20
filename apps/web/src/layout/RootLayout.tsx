import { RouterProvider as AriaRouterProvider } from 'react-aria-components';
import { Outlet, useHref, useNavigate } from 'react-router';

import { SiteFooter } from './SiteFooter.js';
import { SiteHeader } from './SiteHeader.js';

export const MAIN_CONTENT_ID = 'main-content';

/** App shell: skip link, header, the current page and footer. */
export function RootLayout() {
  const navigate = useNavigate();

  return (
    // Lets React Aria links and menus navigate with React Router instead of a full page load.
    <AriaRouterProvider navigate={(to) => void navigate(to)} useHref={useHref}>
      <div className="flex min-h-screen flex-col">
        <a
          href={`#${MAIN_CONTENT_ID}`}
          onClick={(event) => {
            // Focus explicitly: not every browser moves focus to the target of an in-page link,
            // and this keeps `#main-content` out of the URL.
            event.preventDefault();
            document.getElementById(MAIN_CONTENT_ID)?.focus();
          }}
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:font-medium focus:text-indigo-700 focus:shadow"
        >
          Skip to main content
        </a>
        <SiteHeader />
        {/* tabIndex lets the skip link move focus here, not only scroll. */}
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 focus:outline-none"
        >
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </AriaRouterProvider>
  );
}

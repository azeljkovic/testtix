import { APP_NAME } from '@testtix/shared';

/** Formats a document title, e.g. "Events · TestTix". Without a page title it is just the app name. */
export function documentTitle(pageTitle?: string): string {
  return pageTitle ? `${pageTitle} · ${APP_NAME}` : APP_NAME;
}

/** Sets the document title for the current route. React hoists `<title>` into `<head>`. */
export function PageTitle({ title }: { title?: string }) {
  return <title>{documentTitle(title)}</title>;
}

import { PageTitle } from '../layout/PageTitle.js';

export function EventsPage() {
  return (
    <>
      <PageTitle title="Events" />
      <h1 className="text-3xl font-bold tracking-tight">Events</h1>
      <p className="mt-4 text-slate-600">No events are on sale yet. Check back soon.</p>
    </>
  );
}

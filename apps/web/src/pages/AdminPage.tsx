import { PageTitle } from '../layout/PageTitle.js';

/** Admin home. Behind `RequireAuth role="ADMIN"`; event management is added here later. */
export function AdminPage() {
  return (
    <>
      <PageTitle title="Admin" />
      <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
      <p className="mt-4 text-slate-600">
        Tools for managing events and ticket batches will appear here.
      </p>
    </>
  );
}

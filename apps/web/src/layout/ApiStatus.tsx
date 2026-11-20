import { useQuery } from '@tanstack/react-query';

import { fetchApiHealth } from '../api/health.js';

/** Shows whether the API answers `GET /health`. Doubles as a check that the `/api` proxy works. */
export function ApiStatus() {
  const { isPending, isSuccess } = useQuery({
    queryKey: ['api-health'],
    queryFn: ({ signal }) => fetchApiHealth(signal),
    retry: false,
  });

  const [label, dotClass] = isPending
    ? ['Checking API…', 'bg-slate-400']
    : isSuccess
      ? ['API online', 'bg-emerald-600']
      : ['API offline', 'bg-red-600'];

  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={`size-2 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

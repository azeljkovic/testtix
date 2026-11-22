import type { ReactNode } from 'react';

/** A form-level error (not tied to one field). `role="alert"` announces it when it appears. */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
    >
      {children}
    </div>
  );
}

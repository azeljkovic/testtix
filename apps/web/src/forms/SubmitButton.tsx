import type { ReactNode } from 'react';

interface SubmitButtonProps {
  children: ReactNode;
  /** While true the button ignores presses (`aria-disabled`) but stays focusable. */
  isPending?: boolean;
}

/**
 * A form's submit button. Not React Aria's `isPending`: that announces through a body-level live
 * region pointing at the button by ID, which dangles (an axe violation) for seconds after a
 * successful submit navigates away.
 */
export function SubmitButton({ children, isPending = false }: SubmitButtonProps) {
  return (
    <button
      type="submit"
      aria-disabled={isPending || undefined}
      onClick={(event) => {
        if (isPending) event.preventDefault();
      }}
      className="rounded-md bg-indigo-700 px-5 py-2.5 font-semibold text-white hover:bg-indigo-800 aria-disabled:cursor-wait aria-disabled:opacity-70"
    >
      {children}
    </button>
  );
}

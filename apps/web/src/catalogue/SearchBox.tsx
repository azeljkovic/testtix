import { CATALOGUE_SEARCH_MAX_LENGTH, SEARCH_DEBOUNCE_MS } from '@testtix/shared';
import { useEffect, useEffectEvent, useId, useState } from 'react';

interface SearchBoxProps {
  /** The search in effect (from the URL). */
  value: string;
  /** Applies a new search (trimmed). */
  onSearch: (q: string) => void;
}

/**
 * The event search. Typing searches once the visitor pauses for `SEARCH_DEBOUNCE_MS`; Enter searches
 * at once. A search changed from outside (back button, "Clear filters") replaces the text.
 */
export function SearchBox({ value, onSearch }: SearchBoxProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(value);
  // The `value` this box last saw, and a search it sent that the URL hasn't reflected yet.
  const [seenValue, setSeenValue] = useState(value);
  const [sent, setSent] = useState<string | null>(null);

  if (value !== seenValue) {
    setSeenValue(value);
    setSent(null);
    // Keep what the visitor typed since their own search went out; take anything else.
    if (value !== sent) setDraft(value);
  }

  const search = (q: string) => {
    // Already in effect, or on its way (Enter, then the debounce timer firing).
    if (q === value || q === sent) return;
    setSent(q);
    onSearch(q);
  };
  // The timer calls the latest `search`, so a re-render while it runs doesn't restart it.
  const searchAfterPause = useEffectEvent(search);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchAfterPause(draft.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft]);

  return (
    <form
      role="search"
      aria-label="Events"
      onSubmit={(event) => {
        event.preventDefault();
        search(draft.trim());
      }}
      className="flex flex-col gap-1"
    >
      <label htmlFor={inputId} className="font-medium text-slate-900">
        Search
      </label>
      <input
        id={inputId}
        type="search"
        name="q"
        value={draft}
        maxLength={CATALOGUE_SEARCH_MAX_LENGTH}
        autoComplete="off"
        placeholder="Title or performer"
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        className="rounded-md border border-slate-400 bg-white px-3 py-2 text-slate-900"
      />
    </form>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * The search box was baked into the original artwork, in the sidebar, on every
 * page -- search was always the point. Now it actually searches.
 */
export function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange?: (next: string) => void;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = (next: string) => {
    setDraft(next);
    if (onChange) onChange(next);
    else if (next.trim()) navigate(`/?q=${encodeURIComponent(next.trim())}`);
  };

  return (
    <form
      className="search-field flex w-full max-w-[180px] items-center"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        commit(draft);
      }}
    >
      <label className="sr-only" htmlFor="pt-search">
        Search the quotes
      </label>
      <input
        id="pt-search"
        type="search"
        value={draft}
        placeholder="Search&hellip;"
        autoComplete="off"
        onChange={(e) => commit(e.target.value)}
        className="min-w-0 flex-1 border-0 bg-transparent px-2 text-[13px] text-ink outline-none placeholder:text-faint"
      />
      <button type="submit" className="search-button" title="Search">
        <span className="sr-only">Search</span>
      </button>
    </form>
  );
}

export function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (next: number) => void;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav className="mt-6 flex items-center justify-between text-[13px]" aria-label="Pagination">
      <button
        type="button"
        className="cursor-pointer underline disabled:cursor-default disabled:text-faint disabled:no-underline"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        &larr; Newer
      </button>
      <span className="text-muted">
        Page {page} of {pageCount}
      </span>
      <button
        type="button"
        className="cursor-pointer underline disabled:cursor-default disabled:text-faint disabled:no-underline"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        Older &rarr;
      </button>
    </nav>
  );
}

import { Link, useParams } from 'react-router-dom';
import { PostCard } from '../components/PostCard';
import { Pagination } from '../components/Pagination';
import { Sidebar } from '../components/Sidebar';
import { POSTS_PER_PAGE, categoryBySlug, meta, speakerBySlug, tagBySlug } from '../lib/content';
import { hasFilters, useFilters } from '../lib/search';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Scope = 'all' | 'tag' | 'category' | 'speaker';

/**
 * One screen does all the browsing: the front page, every tag page, every
 * category page and every speaker page are the same filtered list. The URL
 * carries the whole state, so any view is a shareable link and the back button
 * does exactly what you'd expect.
 */
export function Archive({ scope = 'all' }: { scope?: Scope }) {
  const params = useParams();
  const slug = params.slug ?? '';

  const scoped = scope === 'all' ? undefined : ({ key: scope, slug } as const);
  const { filters, setFilter, hrefFor, results, counts } = useFilters(scoped);

  const facet =
    scope === 'tag'
      ? tagBySlug.get(slug)
      : scope === 'category'
        ? categoryBySlug.get(slug)
        : scope === 'speaker'
          ? speakerBySlug.get(slug)
          : undefined;

  const heading =
    scope === 'all'
      ? 'Possum Tales'
      : scope === 'speaker'
        ? `Things ${facet?.name ?? slug} said`
        : (facet?.name ?? slug);

  useDocumentTitle(
    scope === 'all' ? undefined : heading,
    scope === 'all'
      ? `${meta.postCount} things people actually said, collected by Joy Martinez from 2005 to 2017.`
      : `${results.length} quotes filed under ${heading}.`
  );

  const pageCount = Math.max(1, Math.ceil(results.length / POSTS_PER_PAGE));
  const page = Math.min(filters.page, pageCount);
  const shown = results.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE);

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <main className="min-w-0 flex-1">
        <h1 className="mb-1 text-[2.5em] leading-none">{heading}</h1>
        <p className="mb-5 text-[12px] leading-5 text-muted">
          {scope === 'all' && !hasFilters(filters) ? (
            <>
              {meta.postCount} things people actually said, written down between{' '}
              {meta.years[0].year} and {meta.years[meta.years.length - 1].year}.
            </>
          ) : (
            <>
              {results.length} {results.length === 1 ? 'quote' : 'quotes'}
              {filters.q ? (
                <>
                  {' '}
                  matching &ldquo;<strong>{filters.q}</strong>&rdquo;
                </>
              ) : null}
              <ActiveFilters />
            </>
          )}
        </p>

        {shown.length === 0 ? <NoResults query={filters.q} /> : null}

        <div className="space-y-5">
          {shown.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>

        <Pagination page={page} pageCount={pageCount} onPage={(next) => setFilter({ page: next })} />
      </main>

      <Sidebar filters={filters} setFilter={setFilter} hrefFor={hrefFor} counts={counts} />
    </div>
  );

  function ActiveFilters() {
    const chips = [
      filters.tag && { label: tagBySlug.get(filters.tag)?.name ?? filters.tag, key: 'tag' as const },
      filters.category && {
        label: categoryBySlug.get(filters.category)?.name ?? filters.category,
        key: 'category' as const,
      },
      filters.speaker && {
        label: speakerBySlug.get(filters.speaker)?.name ?? filters.speaker,
        key: 'speaker' as const,
      },
      filters.year && { label: filters.year, key: 'year' as const },
    ].filter(Boolean) as { label: string; key: 'tag' | 'category' | 'speaker' | 'year' }[];

    if (!chips.length && !filters.q) return null;

    return (
      <>
        {chips.map((chip) => (
          <span key={chip.key}>
            {' '}
            &middot;{' '}
            <button
              type="button"
              className="cursor-pointer underline"
              onClick={() => setFilter({ [chip.key]: '' })}
              title="Remove this filter"
            >
              {chip.label} &times;
            </button>
          </span>
        ))}{' '}
        &middot;{' '}
        <button
          type="button"
          className="cursor-pointer underline"
          onClick={() => setFilter({ q: '', tag: '', category: '', speaker: '', year: '' })}
        >
          clear all
        </button>
      </>
    );
  }
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="py-8 text-center text-[13px] leading-6">
      <p className="mb-2 text-[1.8em] leading-none">Nothing in this trash can.</p>
      <p className="text-muted">
        The possum sniffed around
        {query ? (
          <>
            {' '}
            for &ldquo;<strong>{query}</strong>&rdquo;
          </>
        ) : null}{' '}
        and came back with nothing. Try a shorter word, or{' '}
        <Link to="/">start over</Link>.
      </p>
    </div>
  );
}

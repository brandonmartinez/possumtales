import { Link } from 'react-router-dom';
import type { Facet } from '../types';
import { meta } from '../lib/content';
import type { FacetCounts, Filters, ScopeKey } from '../lib/search';
import { SearchBox } from './SearchBox';

const SPEAKERS_SHOWN = 15;
const TAGS_SHOWN = 40;

/**
 * The original sidebar had a search box, a category list and a tag cloud. Same
 * furniture, except now every item is a live filter rather than a page load.
 *
 * Every count here is contextual: it is the number of quotes you will actually
 * get if you click, given whatever is already switched on. Anything that would
 * land you on an empty page is dropped, so the sidebar can't lie to you.
 */
export function Sidebar({
  filters,
  setFilter,
  hrefFor,
  counts,
}: {
  filters: Filters;
  setFilter: (patch: Partial<Filters>) => void;
  hrefFor: (key: ScopeKey, slug: string) => string;
  counts: FacetCounts;
}) {
  const categories = live(meta.categories, counts.category, filters.category);
  const speakers = live(meta.speakers, counts.speaker, filters.speaker).slice(0, SPEAKERS_SHOWN);
  const tags = live(meta.tags, counts.tag, filters.tag).slice(0, TAGS_SHOWN);
  const years = meta.years
    .map((y) => ({ ...y, count: counts.year.get(y.year) ?? 0 }))
    .filter((y) => y.count > 0 || y.year === filters.year);

  const hiddenSpeakers = countLive(meta.speakers, counts.speaker) - speakers.length;

  return (
    <aside className="w-full shrink-0 pt-2 text-[12px] leading-6 md:w-[180px]">
      <SearchBox value={filters.q} onChange={(q) => setFilter({ q })} />

      <Section title="Categories" empty={categories.length === 0}>
        <ul>
          {categories.map((c) => (
            <Chip
              key={c.slug}
              facet={c}
              active={filters.category === c.slug}
              onClick={() => setFilter({ category: filters.category === c.slug ? '' : c.slug })}
            />
          ))}
        </ul>
      </Section>

      <Section title="Who said it" empty={speakers.length === 0}>
        <ul>
          {speakers.map((s) => (
            <Chip
              key={s.slug}
              facet={s}
              active={filters.speaker === s.slug}
              onClick={() => setFilter({ speaker: filters.speaker === s.slug ? '' : s.slug })}
            />
          ))}
        </ul>
        {hiddenSpeakers > 0 ? (
          <p className="mt-1 text-[11px] text-muted">
            &hellip;and {hiddenSpeakers} more. Search a name to find them.
          </p>
        ) : null}
      </Section>

      <Section title="Archives" empty={years.length === 0}>
        <ul className="flex flex-wrap gap-x-2">
          {years.map((y) => (
            <li key={y.year}>
              <button
                type="button"
                className={`cursor-pointer underline ${filters.year === y.year ? 'font-bold text-link-hover' : ''}`}
                onClick={() => setFilter({ year: filters.year === y.year ? '' : y.year })}
                title={`${y.count} quote${y.count === 1 ? '' : 's'}`}
              >
                {y.year}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Tags" empty={tags.length === 0}>
        {/*
          Flex, not inline text: JSX puts no whitespace between adjacent
          elements, so an inline run of tags has nowhere to line-break and
          shoots straight off the side of the notebook.
        */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {tags.map((t) =>
            filters.tag === t.slug ? (
              <button
                key={t.slug}
                type="button"
                className="cursor-pointer font-bold text-link-hover underline"
                style={{ fontSize: `${tagSize(t.count)}px` }}
                title="Remove this filter"
                onClick={() => setFilter({ tag: '' })}
              >
                {t.name}
              </button>
            ) : (
              <Link
                key={t.slug}
                to={hrefFor('tag', t.slug)}
                className="font-normal"
                style={{ fontSize: `${tagSize(t.count)}px` }}
                title={`${t.count} quote${t.count === 1 ? '' : 's'}`}
              >
                {t.name}
              </Link>
            )
          )}
        </div>
      </Section>
    </aside>
  );
}

const tagSize = (count: number) => Math.min(15, 10 + Math.round(Math.log2(count + 1)));

/**
 * Re-count a facet list against the current context, drop anything that leads
 * nowhere, and re-rank so the most useful next click is at the top. The active
 * facet is always kept, even at zero, or you'd have no way to switch it off.
 */
function live(facets: Facet[], counts: Map<string, number>, active: string): Facet[] {
  return facets
    .map((f) => ({ ...f, count: counts.get(f.slug) ?? 0 }))
    .filter((f) => f.count > 0 || f.slug === active)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const countLive = (facets: Facet[], counts: Map<string, number>) =>
  facets.reduce((n, f) => n + ((counts.get(f.slug) ?? 0) > 0 ? 1 : 0), 0);

function Section({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  if (empty) return null;
  return (
    <section className="mt-6">
      <h3 className="mb-1 text-[1.5em] leading-none">{title}</h3>
      {children}
    </section>
  );
}

function Chip({ facet, active, onClick }: { facet: Facet; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        title={active ? 'Remove this filter' : undefined}
        className={`cursor-pointer text-left underline ${active ? 'font-bold text-link-hover' : ''}`}
      >
        {facet.name} <span className="text-muted no-underline">({facet.count})</span>
      </button>
    </li>
  );
}

import Fuse from 'fuse.js';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Post } from '../types';
import { meta, posts, speakersOf } from './content';

/*
 * The whole point of the rewrite. Everything is in memory, so a query, a tag,
 * a year, a category and a speaker all compose, all filter on every keystroke,
 * and all live in the query string so any view can be shared as a link.
 */

export interface Filters {
  q: string;
  tag: string;
  category: string;
  speaker: string;
  year: string;
  page: number;
}

/** The four dimensions you can slice the archive by. */
export type Dim = 'tag' | 'category' | 'speaker' | 'year';

/** The three that also have a pretty route of their own. */
export type ScopeKey = 'tag' | 'category' | 'speaker';

const DIMS: Dim[] = ['tag', 'category', 'speaker', 'year'];

export const EMPTY_FILTERS: Filters = { q: '', tag: '', category: '', speaker: '', year: '', page: 1 };

export const hasFilters = (f: Filters): boolean =>
  Boolean(f.q || f.tag || f.category || f.speaker || f.year);

const fuse = new Fuse(posts, {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.34,
  minMatchCharLength: 2,
  keys: [
    { name: 'quote', weight: 5 },
    { name: 'title', weight: 3 },
    { name: 'speaker', weight: 3 },
    { name: 'speakers', weight: 3 },
    { name: 'context', weight: 2 },
    { name: 'tags', weight: 2 },
  ],
});

/** Which slugs a post belongs to, in a given dimension. */
const slugsIn = (post: Post, dim: Dim): string[] => {
  switch (dim) {
    case 'tag':
      return post.tags.map(tagSlug);
    case 'category':
      return post.categories.map(categorySlug);
    case 'speaker':
      return speakersOf(post).map(slugOf);
    case 'year':
      return [post.date.slice(0, 4)];
  }
};

/**
 * Apply every active filter. Pass `except` to leave one dimension out, which is
 * what makes the sidebar counts honest -- see countFacets.
 */
export function filterPosts(filters: Filters, except?: Dim): Post[] {
  const term = filters.q.trim();
  let result = term ? fuse.search(term).map((r) => r.item) : posts;

  for (const dim of DIMS) {
    if (dim === except) continue;
    const value = filters[dim];
    if (value) result = result.filter((p) => slugsIn(p, dim).includes(value));
  }

  return result;
}

export type FacetCounts = Record<Dim, Map<string, number>>;

/**
 * Count each facet against everything EXCEPT its own dimension. That is the
 * difference between a number that tells you what you'd get if you clicked and
 * a number that walks you into an empty page: with category=Videos already on,
 * "Brandon (98)" is a lie, because only the Videos he is in can still appear.
 * Leaving a dimension out of its own count is also what lets you switch sideways
 * within it, since each of these filters is single-select.
 */
export function countFacets(filters: Filters): FacetCounts {
  const counts = Object.fromEntries(DIMS.map((d) => [d, new Map<string, number>()])) as FacetCounts;

  for (const dim of DIMS) {
    const tally = counts[dim];
    for (const post of filterPosts(filters, dim)) {
      // A post tagged both "Cat" and "Cats" must only count once per slug.
      for (const slug of new Set(slugsIn(post, dim))) {
        tally.set(slug, (tally.get(slug) ?? 0) + 1);
      }
    }
  }

  return counts;
}

/*
 * Tag and category slugs are WordPress's own, so that historical /tag/<slug>/
 * URLs still resolve. They usually match what slugOf() would produce, but they
 * are not guaranteed to -- WordPress appends -2 to collisions, for one. Look
 * them up rather than recomputing them.
 */
const nameToSlug = (facets: { name: string; slug: string }[]) =>
  new Map(facets.map((f) => [f.name, f.slug]));

const tagSlugs = nameToSlug(meta.tags);
const categorySlugs = nameToSlug(meta.categories);

const tagSlug = (name: string) => tagSlugs.get(name) ?? slugOf(name);
const categorySlug = (name: string) => categorySlugs.get(name) ?? slugOf(name);

/*
 * Speakers are derived rather than stored in WordPress, so their slugs are
 * computed -- with the same algorithm the extractor uses. Cache the mapping so
 * filtering stays O(n) rather than O(n * facets).
 */
const slugCache = new Map<string, string>();
export function slugOf(name: string): string {
  const hit = slugCache.get(name);
  if (hit !== undefined) return hit;
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  slugCache.set(name, slug);
  return slug;
}

export { tagSlug, categorySlug };

/** Read the filter state out of the URL. The URL is the only state store. */
export function useFilters(scope?: { key: ScopeKey; slug: string }): {
  filters: Filters;
  setFilter: (patch: Partial<Filters>) => void;
  hrefFor: (key: ScopeKey, slug: string) => string;
  results: Post[];
  counts: FacetCounts;
} {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const scopeKey = scope?.key;
  const scopeSlug = scope?.slug;

  const filters = useMemo<Filters>(
    () => ({
      q: params.get('q') ?? '',
      tag: scopeKey === 'tag' ? scopeSlug! : (params.get('tag') ?? ''),
      category: scopeKey === 'category' ? scopeSlug! : (params.get('category') ?? ''),
      speaker: scopeKey === 'speaker' ? scopeSlug! : (params.get('speaker') ?? ''),
      year: params.get('year') ?? '',
      page: Math.max(1, Number(params.get('page') ?? 1) || 1),
    }),
    [params, scopeKey, scopeSlug]
  );

  const results = useMemo(() => filterPosts(filters), [filters]);
  const counts = useMemo(() => countFacets(filters), [filters]);

  const setFilter = (patch: Partial<Filters>) => {
    const next = new URLSearchParams(params);
    let path: string | null = null;

    for (const [key, value] of Object.entries(patch)) {
      // On /tag/possum/ the route owns the tag, so a query param would be
      // ignored. Changing that dimension has to change the route instead.
      if (key === scopeKey) {
        path = value ? `/${scopeKey}/${value}/` : '/';
        continue;
      }
      if (!value || value === 1) next.delete(key);
      else next.set(key, String(value));
    }
    // Any change to the query resets pagination, unless the page itself moved.
    if (!('page' in patch)) next.delete('page');

    const query = next.toString();
    if (path !== null) navigate(query ? `${path}?${query}` : path);
    else setParams(next, { replace: !('page' in patch) });
  };

  /**
   * Link to a scoped page while keeping every other active filter. Tags stay
   * real links so /tag/<slug>/ is still crawlable and shareable, but clicking
   * one from inside a filtered view narrows it rather than starting over.
   */
  const hrefFor = (key: ScopeKey, slug: string) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    next.delete(key); // the path carries it now
    // We're leaving the current scoped route, so demote it to a query param.
    if (scopeKey && scopeSlug && scopeKey !== key) next.set(scopeKey, scopeSlug);
    const query = next.toString();
    return query ? `/${key}/${slug}/?${query}` : `/${key}/${slug}/`;
  };

  return { filters, setFilter, hrefFor, results, counts };
}

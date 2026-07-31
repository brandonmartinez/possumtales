import postsJson from '../data/posts.json';
import aboutJson from '../data/about.json';
import metaJson from '../data/meta.json';
import type { Facet, Meta, Page, Post } from '../types';

/*
 * The entire archive is 363 quotes -- about 200 KB of JSON, ~60 KB over the
 * wire. It ships in the bundle. There is no index to fetch, no API to call and
 * therefore no loading state anywhere in this app.
 */
export const posts = postsJson as unknown as Post[];
export const about = aboutJson as unknown as Page;
export const meta = metaJson as unknown as Meta;

export const POSTS_PER_PAGE = 10; // the original's posts_per_page

const byPermalink = new Map(posts.map((p) => [p.permalink, p]));

export function findPost(year: string, month: string, day: string, slug: string): Post | undefined {
  return byPermalink.get(`/${year}/${month}/${day}/${slug}/`);
}

const index = (facets: Facet[]) => new Map(facets.map((f) => [f.slug, f]));

export const tagBySlug = index(meta.tags);
export const categoryBySlug = index(meta.categories);
export const speakerBySlug = index(meta.speakers);

/** Every speaker credited on a post, not just the primary one. */
export const speakersOf = (post: Post): string[] =>
  post.speakers ?? (post.speaker ? [post.speaker] : []);

/** Neighbours in reverse-chronological order, for prev/next links. */
export function neighbours(post: Post): { older?: Post; newer?: Post } {
  const i = posts.indexOf(post);
  return { newer: i > 0 ? posts[i - 1] : undefined, older: posts[i + 1] };
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

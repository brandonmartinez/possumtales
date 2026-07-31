#!/usr/bin/env node
/**
 * Post-build: make GitHub Pages behave like a server that knows about routes.
 *
 * 1. Every real URL gets its own index.html. The content is frozen, so there is
 *    nothing to render at request time -- and Pages answers an unknown path with
 *    404.html *and an HTTP 404*, which meant every permalink Joy ever published
 *    returned "not found" even though the app booted and drew the right page.
 *    Writing the files makes them genuine 200s, and lets each one carry its own
 *    title, description and canonical URL so a shared link previews as the quote
 *    rather than as the site.
 * 2. dist/404.html is still a copy of the shell, for paths we can't know about.
 * 3. sitemap.xml lists every real URL so the archive is crawlable again.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('postbuild: dist/index.html is missing -- did vite build run?');
  process.exit(1);
}

const shell = readFileSync(join(dist, 'index.html'), 'utf8');
writeFileSync(join(dist, '404.html'), shell);
console.log('postbuild: wrote dist/404.html (fallback for genuinely unknown paths)');

const posts = JSON.parse(readFileSync(join(root, 'src/data/posts.json'), 'utf8'));
const about = JSON.parse(readFileSync(join(root, 'src/data/about.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(root, 'src/data/meta.json'), 'utf8'));

const cname = join(root, 'public/CNAME');
const host = existsSync(cname) ? readFileSync(cname, 'utf8').trim() : 'www.possumtales.com';
const origin = `https://${host}`;

const SITE = 'Possum Tales';
const escape = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();
const clip = (s, n = 180) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}\u2026` : s);

/** Photo posts were published without titles -- same fallback the app uses. */
const displayTitle = (p) =>
  p.title || (p.categories.includes('Photos') ? 'Possum sighting' : 'Untitled');

/** Swap the shell's per-page metadata. Everything else is shared. */
function page(loc, title, description) {
  const url = `${origin}${loc}`;
  const full = title ? `${title} | ${SITE}` : SITE;
  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(full)}</title>`)
    .replace(
      /<meta\s+name="description"[\s\S]*?\/>/,
      `<meta name="description" content="${escape(description)}" />`
    )
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`)
    .replace(
      /<meta property="og:title" content="[^"]*" \/>/,
      `<meta property="og:title" content="${escape(title || SITE)}" />`
    )
    .replace(
      /<meta\s+property="og:description"[\s\S]*?\/>/,
      `<meta property="og:description" content="${escape(description)}" />`
    )
    .replace(
      /<meta property="og:url" content="[^"]*" \/>/,
      `<meta property="og:url" content="${url}" />`
    )
    .replace(
      /<meta property="og:type" content="[^"]*" \/>/,
      `<meta property="og:type" content="${loc.startsWith('/20') ? 'article' : 'website'}" />`
    );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const siteDescription =
  `${meta.postCount} things people actually said, collected by Joy Martinez ` +
  `from ${meta.years[0].year} to ${meta.years[meta.years.length - 1].year}.`;

const routes = [
  { loc: '/', priority: '1.0', description: siteDescription },
  {
    loc: '/about/',
    title: about.title,
    priority: '0.6',
    description: 'Why Possum Tales? The story behind the quote book.',
  },
];

for (const p of posts) {
  const title = displayTitle(p);
  routes.push({
    loc: p.permalink,
    title,
    lastmod: p.date.slice(0, 10),
    priority: '0.8',
    description: clip(collapse(p.quote || p.context || title)),
  });
  // Pre-2009 posts were published under an /archives/ prefix. The app redirects,
  // but only if the page is served at all.
  routes.push({ loc: `/archives${p.permalink}`, title, sitemap: false, description: title });
}

for (const c of meta.categories) {
  routes.push({
    loc: `/category/${c.slug}/`,
    title: c.name,
    priority: '0.4',
    description: `${plural(c.count, 'quote')} filed under ${c.name}.`,
  });
}
for (const t of meta.tags) {
  routes.push({
    loc: `/tag/${t.slug}/`,
    title: t.name,
    priority: '0.3',
    description: `${plural(t.count, 'quote')} tagged ${t.name}.`,
  });
}
for (const s of meta.speakers) {
  routes.push({
    loc: `/speaker/${s.slug}/`,
    title: `Things ${s.name} said`,
    priority: '0.3',
    description: `${plural(s.count, 'quote')} from ${s.name}.`,
  });
}

let written = 0;
for (const r of routes) {
  if (r.loc === '/') continue; // dist/index.html is already the front page
  const dir = join(dist, r.loc);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), page(r.loc, r.title, r.description));
  written += 1;
}
// The front page gets its metadata too, in place.
writeFileSync(join(dist, 'index.html'), page('/', undefined, siteDescription));
console.log(`postbuild: prerendered ${written + 1} pages (real 200s, per-page metadata)`);

const urls = routes.filter((r) => r.sitemap !== false);
const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(
    (u) =>
      `  <url><loc>${origin}${u.loc}</loc>` +
      (u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '') +
      `<priority>${u.priority}</priority></url>`
  ),
  '</urlset>',
  '',
].join('\n');

writeFileSync(join(dist, 'sitemap.xml'), xml);
console.log(`postbuild: wrote dist/sitemap.xml (${urls.length} urls, host ${host})`);

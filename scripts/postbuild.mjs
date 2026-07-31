#!/usr/bin/env node
/**
 * Post-build: make GitHub Pages behave like a server that knows about routes.
 *
 * 1. dist/404.html is a byte-copy of dist/index.html. Pages serves 404.html for
 *    any path it can't find, so a hard refresh on /2009/08/09/the-snuggie-inn/
 *    boots the app, which then renders the right post. Without this, every
 *    permalink Joy ever published is dead on reload.
 * 2. sitemap.xml lists every real URL so the archive is crawlable again.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('postbuild: dist/index.html is missing -- did vite build run?');
  process.exit(1);
}

const html = readFileSync(join(dist, 'index.html'));
writeFileSync(join(dist, '404.html'), html);
console.log('postbuild: wrote dist/404.html (SPA fallback for deep links)');

const posts = JSON.parse(readFileSync(join(root, 'src/data/posts.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(root, 'src/data/meta.json'), 'utf8'));

const cname = join(root, 'public/CNAME');
const host = existsSync(cname) ? readFileSync(cname, 'utf8').trim() : 'www.possumtales.com';
const origin = `https://${host}`;

const urls = [
  { loc: '/', priority: '1.0' },
  { loc: '/about/', priority: '0.6' },
  ...posts.map((p) => ({ loc: p.permalink, lastmod: p.date.slice(0, 10), priority: '0.8' })),
  ...meta.categories.map((c) => ({ loc: `/category/${c.slug}/`, priority: '0.4' })),
  ...meta.tags.map((t) => ({ loc: `/tag/${t.slug}/`, priority: '0.3' })),
  ...meta.speakers.map((s) => ({ loc: `/speaker/${s.slug}/`, priority: '0.3' })),
];

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

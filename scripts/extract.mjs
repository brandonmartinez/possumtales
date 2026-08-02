#!/usr/bin/env node
/**
 * Extract the Possum Tales content out of the WordPress multisite mysqldump.
 *
 * PRIVACY: the dump is a MULTISITE export. It contains password hashes, email
 * addresses and the full content of client sites. It lives OUTSIDE this repo
 * and must never be copied into it. This script only ever reads tables whose
 * name starts with `mm_131_` (the possumtales.com blog) -- see ALLOWED_PREFIX.
 *
 * Usage:  node scripts/extract.mjs [--dump <path>] [--uploads <path>]
 *
 * Writes: src/data/posts.json, src/data/about.json, src/data/meta.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DERIVATIVE,
  derivativesOf,
  listFiles,
  resolveDisplayFile,
  shouldShip,
} from './lib/uploads.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ALLOWED_PREFIX = 'mm_131_';

const DEFAULT_DUMP =
  '/Users/brandonmartinez/Documents/Clients/Martinez Media, LLC/D3818E4984A3B48D3188D547C5E7DAF1.sql';
const DEFAULT_UPLOADS =
  '/Users/brandonmartinez/src/_archive/_temp/martinezmedia/wp-content/uploads/possumtales';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DUMP_PATH = arg('dump', DEFAULT_DUMP);
const UPLOADS_SRC = arg('uploads', DEFAULT_UPLOADS);

const EXPECT = {
  posts: 363,
  tags: 665,
  categories: { Quotes: 285, 'Old Quotes': 35, Photos: 33, Videos: 4, Stories: 3, Uncategorized: 1 },
  peakYear: { year: '2010', count: 151 },
  // The editorial pass is an allow-list, not a filter. If a word is added or a
  // post is re-parsed into a different shape these counts move and the build
  // stops, rather than quietly censoring something nobody reviewed.
  censored: { masked: 19, rewritten: 4, noted: 1 },
};

const problems = [];
const fail = (msg) => {
  console.error(`\n\u001b[31mSTOP:\u001b[0m ${msg}\n`);
  process.exit(1);
};
const warn = (msg) => {
  problems.push(msg);
  console.warn(`  ! ${msg}`);
};

/* ------------------------------------------------------------------ *
 * 1. mysqldump tokenizer
 * ------------------------------------------------------------------ */

const BACKSLASH_ESCAPES = {
  '0': '\0',
  b: '\b',
  n: '\n',
  r: '\r',
  t: '\t',
  Z: '\u001a',
  "'": "'",
  '"': '"',
  '\\': '\\',
};

/**
 * Read one MySQL string literal starting at `i` (pointing at the opening
 * quote). Returns [value, indexAfterClosingQuote].
 */
function readString(src, i) {
  const quote = src[i];
  i += 1;
  let out = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const next = src[i + 1];
      out += next in BACKSLASH_ESCAPES ? BACKSLASH_ESCAPES[next] : next;
      i += 2;
      continue;
    }
    if (ch === quote) {
      if (src[i + 1] === quote) {
        out += quote; // doubled '' -> literal '
        i += 2;
        continue;
      }
      return [out, i + 1];
    }
    out += ch;
    i += 1;
  }
  throw new Error('Unterminated string literal');
}

/**
 * Parse the tuple list of `INSERT INTO ... VALUES (..),(..);`.
 * `i` points at the first `(`. Returns [rows, indexAfterSemicolon], or null
 * when the statement is incomplete (caller appends the next physical line).
 */
function readTuples(src, i) {
  const rows = [];
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (i >= src.length) return null;
    if (src[i] === ';') return [rows, i + 1];
    if (src[i] !== '(') {
      throw new Error(`Expected "(" but found ${JSON.stringify(src.slice(i, i + 40))}`);
    }
    i += 1;
    const row = [];
    let field = '';
    let sawString = false;
    for (;;) {
      if (i >= src.length) return null;
      const ch = src[i];
      if (ch === "'") {
        const [value, next] = readString(src, i);
        field += value;
        sawString = true;
        i = next;
        continue;
      }
      if (ch === ',' || ch === ')') {
        const raw = field.trim();
        row.push(sawString ? field : raw === 'NULL' ? null : raw);
        field = '';
        sawString = false;
        i += 1;
        if (ch === ')') break;
        continue;
      }
      field += ch;
      i += 1;
    }
    rows.push(row);
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (i >= src.length) return null;
    if (src[i] === ',') {
      i += 1;
      continue;
    }
    if (src[i] === ';') return [rows, i + 1];
    throw new Error(`Unexpected token after tuple: ${JSON.stringify(src.slice(i, i + 40))}`);
  }
  return null;
}

/**
 * Scan the dump and return { [table]: { columns, rows } } for the requested
 * tables only. Column names are read from CREATE TABLE, never assumed.
 */
function parseDump(dumpPath, wanted) {
  const want = new Set(wanted);
  for (const t of want) {
    if (!t.startsWith(ALLOWED_PREFIX)) {
      fail(`Refusing to read table "${t}": only ${ALLOWED_PREFIX}* tables may be read.`);
    }
  }

  const lines = fs.readFileSync(dumpPath, 'utf8').split('\n');
  const tables = {};
  for (const t of want) tables[t] = { columns: [], rows: [] };

  let inCreate = null;
  let pending = null;

  const flush = (p) => {
    const start = p.buffer.indexOf(' VALUES ') + ' VALUES '.length;
    let result;
    try {
      result = readTuples(p.buffer, start);
    } catch (err) {
      if (/Unterminated string/.test(err.message)) return false;
      throw err;
    }
    if (!result) return false;
    const cols = tables[p.table].columns;
    if (!cols.length) fail(`No CREATE TABLE seen for ${p.table} before its INSERT.`);
    for (const row of result[0]) {
      if (row.length !== cols.length) {
        fail(
          `Column count mismatch in ${p.table}: ${row.length} values for ${cols.length} columns. ` +
            'The tokenizer is wrong -- refusing to emit corrupt data.'
        );
      }
      const obj = {};
      for (let c = 0; c < cols.length; c += 1) obj[cols[c]] = row[c];
      tables[p.table].rows.push(obj);
    }
    return true;
  };

  for (const line of lines) {
    if (pending) {
      pending.buffer += '\n' + line;
      if (flush(pending)) pending = null;
      continue;
    }
    if (inCreate) {
      if (/^\)/.test(line)) {
        inCreate = null;
        continue;
      }
      const m = line.match(/^\s*`([^`]+)`\s+\S/);
      if (m) tables[inCreate].columns.push(m[1]);
      continue;
    }
    const create = line.match(/^CREATE TABLE `([^`]+)` \($/);
    if (create && want.has(create[1])) {
      inCreate = create[1];
      continue;
    }
    const insert = line.match(/^INSERT INTO `([^`]+)` VALUES /);
    if (insert && want.has(insert[1])) {
      pending = { table: insert[1], buffer: line };
      if (flush(pending)) pending = null;
    }
  }

  if (pending) fail(`Unterminated INSERT statement for ${pending.table}`);
  return tables;
}

/* ------------------------------------------------------------------ *
 * 2. Content helpers
 * ------------------------------------------------------------------ */

/**
 * The dump carries a handful of double-encoded UTF-8 artifacts from an old
 * migration: a literal U+00C2 ("Â") standing in front of what used to be a
 * non-breaking space. U+00C2 never appears legitimately in this content.
 */
let mojibakeFixed = 0;
const fixMojibake = (s) =>
  s
    .replace(/\u00c2\u00a0|\u00c2/g, () => (mojibakeFixed += 1, ' '))
    .replace(/\u00a0/g, ' ');

const decodeEntities = (s) =>
  fixMojibake(s)
    .replace(/&#8217;|&rsquo;/g, '\u2019')
    .replace(/&#8216;|&lsquo;/g, '\u2018')
    .replace(/&#8220;|&ldquo;/g, '\u201c')
    .replace(/&#8221;|&rdquo;/g, '\u201d')
    .replace(/&#8211;|&ndash;/g, '\u2013')
    .replace(/&#8212;|&mdash;/g, '\u2014')
    .replace(/&#8230;|&hellip;/g, '\u2026')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

const stripTags = (s) => s.replace(/<[^>]*>/g, '');
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/*
 * WordPress ran wptexturize over every post on its way to the page, so the site
 * Joy actually published showed curly quotes and real ellipses even though the
 * database stores typewriter punctuation. Reprinting the raw column would be a
 * regression, not a restoration -- 175 of the 363 quotes contain a straight
 * apostrophe, and not one contains a curly one.
 */

// Words that open with an elision rather than a quotation: 'em, 'til, 'n'.
const ELISION = "em|til|tis|twas|cause|round|bout|n";

function texturize(text) {
  // Leave URLs alone -- a bare link's own text is not prose.
  return text
    .split(/(\b(?:https?:\/\/|www\.)\S+)/g)
    .map((chunk, i) => (i % 2 ? chunk : texturizeRun(chunk)))
    .join('');
}

function texturizeRun(text) {
  return (
    text
      .replace(/---/g, '\u2014')
      .replace(/--/g, '\u2013')
      // A spaced hyphen was standing in for a dash.
      .replace(/(\s)-(\s)/g, '$1\u2013$2')
      .replace(/\.\.\./g, '\u2026')
      // The '90s -- an elided century, not an opening quote.
      .replace(/'(\d\d)s\b/g, '\u2019$1s')
      .replace(new RegExp(`'(?=(?:${ELISION})\\b)`, 'gi'), '\u2019')
      // Contractions and possessives: it's, the dogs'.
      .replace(/(\w)'(\w)/g, '$1\u2019$2')
      .replace(/(\w)'(?!\w)/g, '$1\u2019')
      // Anything still standing is opening a quotation: 'possum'.
      .replace(/'/g, '\u2018')
      // A double quote opens only when something else just ended.
      .replace(/(^|[\s([{\u2018\u201c\u2013\u2014])"/g, '$1\u201c')
      .replace(/"/g, '\u201d')
  );
}

/** Same, but leaves tags and attribute values alone. */
const texturizeHtml = (html) =>
  html.replace(/(<[^>]*>)|([^<]+)/g, (_, tag, text) => (tag ? tag : texturize(text)));

/*
 * Editorial pass.
 *
 * Joy published these quotes verbatim and the archive is meant to be faithful,
 * but a handful of them read differently on a public URL than they did on a
 * WordPress blog in 2009. There are exactly three interventions, and they are
 * all declared here so the gap between what the database holds and what the
 * site shows is never a mystery:
 *
 *   MASKED       a light asterisk on the strongest words. The word stays
 *                legible -- this is a fig leaf, not redaction.
 *   REWRITES     "Retard from school" was the byline Joy gave a classmate, and
 *                two of her setup lines used the word as well. Rewritten to
 *                "Horizons", after the special-needs classroom: the joke still
 *                lands for anyone who was there, the slur does not.
 *   EDITOR_NOTES one quote uses a racial slur as the regional name for a Brazil
 *                nut. A mask alone would tidy the surface and explain nothing,
 *                so that one is masked *and* carries a note underneath.
 *
 * Deliberately NOT censored: hell, dammit, crap, poop, butt, sexy and the rest
 * of the mild end, plus "pussywillows" (a plant) and "Don't Be Gay" (a line
 * from The Sweetest Thing, not a family member).
 *
 * Nothing here touches `post.slug`, `permalink`, or a term's WordPress slug --
 * every historical URL still resolves (AGENTS.md rule 4). Tag *display* names
 * are censored; the slugs behind them are not.
 */
const MASKED = [
  { stem: 'fuck', mask: 'f*ck', inflected: true },
  { stem: 'shit', mask: 'sh*t', inflected: true },
  { stem: 'bitch', mask: 'b*tch', inflected: true },
  { stem: 'piss', mask: 'p*ss', inflected: true },
  { stem: 'dick', mask: 'd*ck', inflected: true },
  // Masked more heavily than the rest. The others are words somebody swore
  // with; this one is a slur, and it only needs to be recognisable enough that
  // the note underneath makes sense.
  { stem: 'nigger', mask: 'n****r', inflected: true },
  // Whole word only, or it reaches into "assume", "passage", "glass".
  { stem: 'ass', mask: 'a*s', inflected: false },
];

const MASK_RE = new RegExp(
  `\\b(${MASKED.map((m) => (m.inflected ? `${m.stem}\\w*` : m.stem)).join('|')})\\b`,
  'gi'
);

const REWRITES = [
  [/Retard from school/gi, 'Horizons kid from school'],
  [/\babout retards that\b/gi, 'about the Horizons kids that'],
  [/\bretard abduction story\b/gi, 'Horizons abduction story'],
];

const TAG_RENAMES = new Map([['Retard', 'Horizons']]);

const EDITOR_NOTES = new Map([
  [
    '/2014/01/02/the-nut-and-the-snaggle-tooth/',
    '<p><em>A note from the archive:</em> the speaker is using an old regional ' +
      'name for a Brazil nut. It is a racial slur, masked here. The quote is ' +
      'kept because this site records what people actually said rather than a ' +
      'tidied-up version of it. Recording it is not endorsing it.</p>',
  ],
]);

/** Words touched by the editorial pass, for the census. */
const censored = { masked: new Set(), rewritten: new Set(), noted: new Set() };

/** Mask a run of plain prose. Returns the input unchanged when nothing hits. */
function mask(text, permalink) {
  if (!text) return text;
  return text.replace(MASK_RE, (word) => {
    const entry = MASKED.find((m) => word.toLowerCase().startsWith(m.stem));
    if (permalink) censored.masked.add(permalink);
    const masked = entry.mask + word.slice(entry.stem.length);
    return /^[A-Z]/.test(word) ? masked[0].toUpperCase() + masked.slice(1) : masked;
  });
}

/** Same, but leaves tags and attribute values alone -- hrefs carry slugs. */
const maskHtml = (html, permalink) =>
  html.replace(/(<[^>]*>)|([^<]+)/g, (_, tag, text) => (tag ? tag : mask(text, permalink)));

function rewrite(text, permalink) {
  if (!text) return text;
  let out = text;
  for (const [pattern, replacement] of REWRITES) {
    if (pattern.test(out)) {
      if (permalink) censored.rewritten.add(permalink);
      out = out.replace(pattern, replacement);
    }
    pattern.lastIndex = 0;
  }
  return out;
}

/** Both passes, for a plain-text field. */
const edit = (text, permalink) => mask(rewrite(text, permalink), permalink);

/** Both passes, for an html field. */
const editHtml = (html, permalink) => maskHtml(rewrite(html, permalink), permalink);

/** A tag's display name. Its slug is looked up from the original name. */
const editTag = (name) => TAG_RENAMES.get(name) ?? mask(name);

function permalinkFor(date, slug) {
  const [y, m, d] = date.slice(0, 10).split('-');
  return `/${y}/${m}/${d}/${slug}/`;
}

const BLOCK =
  'address|article|aside|blockquote|div|dl|figure|figcaption|footer|h[1-6]|header|hr|nav|ol|p|pre|section|table|ul|iframe|object|embed';

/** WordPress `wpautop`, so blank-line-separated editor text renders as it did. */
function wpautop(raw) {
  let text = raw.replace(/\r\n?/g, '\n');
  text = text.replace(new RegExp(`\\s*(</?(?:${BLOCK})\\b[^>]*>)\\s*`, 'gi'), '\n\n$1\n\n');
  return text
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((chunk) =>
      new RegExp(`^</?(?:${BLOCK})\\b`, 'i').test(chunk) || chunk.startsWith('<!--')
        ? chunk
        : `<p>${chunk.replace(/\n/g, '<br />')}</p>`
    )
    .join('\n');
}

/* ------------------------------------------------------------------ *
 * 3. Run
 * ------------------------------------------------------------------ */

console.log('Possum Tales extract');
console.log('====================');

if (!fs.existsSync(DUMP_PATH)) {
  fail(
    `Dump not found at ${DUMP_PATH}\n` +
      '      It is deliberately kept out of version control. Pass --dump <path>.'
  );
}
if (!fs.existsSync(UPLOADS_SRC)) fail(`Uploads archive not found at ${UPLOADS_SRC}. Pass --uploads <path>.`);

console.log(`\nReading ${path.basename(DUMP_PATH)} (${(fs.statSync(DUMP_PATH).size / 1e6).toFixed(1)} MB)`);
console.log(`Only ${ALLOWED_PREFIX}* tables will be read.\n`);

const T = {
  posts: `${ALLOWED_PREFIX}posts`,
  terms: `${ALLOWED_PREFIX}terms`,
  taxonomy: `${ALLOWED_PREFIX}term_taxonomy`,
  rel: `${ALLOWED_PREFIX}term_relationships`,
};

const tables = parseDump(DUMP_PATH, Object.values(T));
for (const [name, t] of Object.entries(tables)) {
  console.log(`  ${name.padEnd(28)} ${String(t.rows.length).padStart(5)} rows, ${t.columns.length} columns`);
}

/* -- taxonomy ------------------------------------------------------ */

const termById = new Map();
for (const r of tables[T.terms].rows) {
  termById.set(r.term_id, { name: decodeEntities(r.name), slug: r.slug });
}

const taxById = new Map();
for (const r of tables[T.taxonomy].rows) {
  const term = termById.get(r.term_id);
  if (term) taxById.set(r.term_taxonomy_id, { taxonomy: r.taxonomy, ...term });
}

const termsForPost = new Map();
for (const r of tables[T.rel].rows) {
  const t = taxById.get(r.term_taxonomy_id);
  if (!t) continue;
  if (!termsForPost.has(r.object_id)) termsForPost.set(r.object_id, []);
  termsForPost.get(r.object_id).push(t);
}

/* -- census -------------------------------------------------------- */

const allPosts = tables[T.posts].rows;
const census = {};
for (const p of allPosts) {
  const key = `${p.post_type}/${p.post_status}`;
  census[key] = (census[key] || 0) + 1;
}
console.log('\nRow census (mm_131_posts):');
for (const [k, v] of Object.entries(census).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(28)} ${String(v).padStart(5)}`);
}

const published = allPosts.filter((p) => p.post_type === 'post' && p.post_status === 'publish');
console.log(`\nPublished posts: ${published.length} (expected ${EXPECT.posts})`);
if (published.length !== EXPECT.posts) {
  fail(`Expected exactly ${EXPECT.posts} published posts, got ${published.length}.`);
}
console.log(`Attachments:     ${allPosts.filter((p) => p.post_type === 'attachment').length}`);

/* -- image inventory ----------------------------------------------- */

const uploadFiles = new Set(listFiles(UPLOADS_SRC));

const derivatives = [...uploadFiles].filter((f) => DERIVATIVE.test(f));
const shippable = [...uploadFiles].filter((f) => shouldShip(f, uploadFiles));
console.log(
  `Uploads archive: ${uploadFiles.size} files (${derivatives.length} derivatives, ` +
    `${uploadFiles.size - derivatives.length} originals; ${shippable.length} shippable)`
);

/** Resolve a referenced upload path to the file the site should serve. */
const resolveUpload = (rel) => resolveDisplayFile(rel, uploadFiles);
const widest = (rel) => derivativesOf(rel, uploadFiles)[0] || null;

/*
 * WordPress gave every uploaded file its own "attachment page", and Joy's image
 * posts link to those pages rather than to the images. Those pages do not
 * exist in a static site and never will, so map attachment id -> actual file
 * (via the attachment row's guid) and send the click straight to the picture.
 */
const attachmentFile = new Map();
for (const row of allPosts) {
  if (row.post_type !== 'attachment') continue;
  const guid = String(row.guid || '');
  const m = guid.match(/\/(?:files|wp-content\/uploads(?:\/possumtales)?)\/(.+)$/i);
  if (!m) continue;
  const big = widest(m[1]);
  const file = big ? big.file : resolveUpload(m[1]);
  if (file) attachmentFile.set(String(row.ID), file);
}
console.log(`Attachment pages mapped to files: ${attachmentFile.size}`);

/* -- HTML cleaning -------------------------------------------------- */

const missingImages = [];
const externalImages = [];
const keptOriginalRefs = new Set();
const deadLinks = [];
let archiveLinkHits = 0;
let lightboxed = 0;
let attachmentLinksFixed = 0;
let adminLinksStripped = 0;
let shortcodesStripped = 0;
let scriptsStripped = 0;

function cleanHtml(rawInput, ctx) {
  let html = fixMojibake(rawInput);

  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, () => (scriptsStripped += 1, ''));
  html = html.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');

  html = html.replace(/\[caption\b[^\]]*\]([\s\S]*?)\[\/caption\]/gi, (m, inner) => (shortcodesStripped += 1, inner));
  html = html.replace(/\[(\/?)[a-z0-9_-]+(?:\s[^\]]*)?\]/gi, () => (shortcodesStripped += 1, ''));

  html = html.replace(/https?:\/\/(?:www\.)?possumtales\.com/gi, '');
  html = html.replace(/(["'(])\/archives\/(\d{4}\/\d{2}\/\d{2}\/)/g, (m, q, rest) => {
    archiveLinkHits += 1;
    return `${q}/${rest}`;
  });

  // Upload URLs. WordPress multisite served this blog's media from
  // /wp-content/uploads/YYYY/MM/ (and, earlier, /files/), while on disk the
  // archive keeps them under .../uploads/possumtales/YYYY/MM/.
  html = html.replace(/\/wp-content\/uploads\/possumtales\//g, '/uploads/');
  html = html.replace(/\/wp-content\/uploads\//g, '/uploads/');
  html = html.replace(/\/files\//g, '/uploads/');

  // Every <img>: resolve against disk, upgrade bare originals to the widest
  // derivative, and link to the 960px version when one exists.
  html = html.replace(/(<a\b[^>]*>\s*)?<img\b([^>]*?)\/?>/gi, (whole, anchorOpen, attrs) => {
    const srcMatch = attrs.match(/\ssrc=(["'])(.*?)\1/i);
    if (!srcMatch) return whole;
    const src = srcMatch[2];
    if (/^https?:\/\//i.test(src) || src.startsWith('data:')) {
      externalImages.push({ ...ctx, src });
      return whole;
    }
    if (!src.startsWith('/uploads/')) {
      missingImages.push({ ...ctx, src, why: 'site-relative but not an upload path' });
      return whole;
    }

    const rel = resolveUpload(src.slice('/uploads/'.length));
    if (!rel) {
      missingImages.push({ ...ctx, src, why: 'no file on disk' });
      return whole;
    }
    if (!DERIVATIVE.test(rel)) keptOriginalRefs.add(rel);

    const dims = rel.match(DERIVATIVE);
    let newAttrs = attrs
      .replace(/\ssrc=(["']).*?\1/i, ` src="/uploads/${rel}"`)
      .replace(/\s(?:width|height)=(["'])?[^\s"'>]*\1?/gi, '')
      .replace(/\sstyle=(["']).*?\1/gi, '')
      .replace(/\sclass=(["']).*?\1/gi, '')
      .trimEnd();
    if (!/\salt=/i.test(newAttrs)) newAttrs += ' alt=""';
    if (dims) newAttrs += ` width="${dims[1]}" height="${dims[2]}"`;
    newAttrs += ' loading="lazy" decoding="async"';
    const img = `<img${newAttrs} />`;

    // Only 9 images have a 960px version; don't fake one for the rest.
    const big = widest(rel);
    if (big && big.w >= 960 && big.file !== rel) {
      lightboxed += 1;
      return `<a class="pt-imglink" href="/uploads/${big.file}">${img}</a>`;
    }
    return anchorOpen ? `${anchorOpen}${img}` : img;
  });

  // Anchors pointing at uploads -> the file we actually ship.
  html = html.replace(/href=(["'])\/uploads\/([^"']+)\1/gi, (m, q, rel) => {
    const resolved = resolveUpload(rel);
    if (!resolved) {
      missingImages.push({ ...ctx, src: `/uploads/${rel}`, why: 'linked file not on disk' });
      return m;
    }
    if (!DERIVATIVE.test(resolved)) keptOriginalRefs.add(resolved);
    return `href=${q}/uploads/${resolved}${q}`;
  });

  // Attachment pages don't exist any more; point at the image itself.
  html = html.replace(/<a\b([^>]*\brel=(["'])[^"']*wp-att-(\d+)[^"']*\2[^>]*)>/gi, (m, attrs, _q, id) => {
    const file = attachmentFile.get(id);
    if (!file) {
      deadLinks.push({ ...ctx, href: `wp-att-${id}`, why: 'attachment has no file on disk' });
      return m;
    }
    attachmentLinksFixed += 1;
    if (!DERIVATIVE.test(file)) keptOriginalRefs.add(file);
    const rest = attrs.replace(/\shref=(["']).*?\1/i, '').replace(/\srel=(["']).*?\1/i, '');
    return `<a class="pt-imglink" href="/uploads/${file}"${rest}>`;
  });

  // The old search form lives on: /?s=term is now /?q=term.
  html = html.replace(/href=(["'])\/\?s=([^"']*)\1/gi, (m, q, term) => `href=${q}/?q=${term}${q}`);

  // Editor links that leaked into a post body. Keep the words, drop the link.
  html = html.replace(
    /<a\b[^>]*href=(["'])\/wp-(?:admin|login)[^"']*\1[^>]*>([\s\S]*?)<\/a>/gi,
    (m, _q, text) => (adminLinksStripped += 1, text)
  );

  // Sanitize at BUILD time -- the browser gets an already-clean string.
  html = html.replace(/\son[a-z]+=(["']).*?\1/gi, '');
  html = html.replace(/(href|src)=(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');

  return html.trim();
}

/* -- quote parsing --------------------------------------------------- */

/*
 * Twelve years of hand-written posts are only *mostly* consistent. The house
 * style is:
 *
 *     "<quote text>" -<Speaker>
 *
 *     <em><context sentence></em>
 *
 * but the corpus also contains: two-line dialogues, stage directions in
 * parentheses before the dash, attributions with no dash at all, quotes with
 * no attribution, book citations whose attribution itself contains a quoted
 * title, and trailing "See <link>" notes after the italic context. Parse all
 * of those; never guess, and never silently drop a post.
 */

const DASH_CHARS = '-\u2013\u2014';
const DASH = `[${DASH_CHARS}]`;

/** Text content of an HTML fragment, entity-decoded and whitespace-collapsed. */
const textOf = (html) => collapse(decodeEntities(stripTags(html)));

/** True when every bit of visible text in the block sits inside <em>/<i>. */
function isAllItalic(block) {
  if (!/<(?:em|i)\b/i.test(block)) return false;
  const withoutItalics = block.replace(/<(em|i)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Tolerate a stray trailing period left outside the italics.
  return /^[\p{P}\s]*$/u.test(textOf(withoutItalics));
}

/**
 * Does `tail` (everything after a candidate closing quote) look like an
 * attribution? Returns the attribution text, or null.
 */
function attributionFrom(tail) {
  let t = tail.trim();
  if (!t) return '';
  // Stage direction before the dash: "..." (said in a low voice) -Brandon
  t = t.replace(/^\([^)]*\)\s*/, '').trim();
  if (!t) return '';
  const dashed = t.match(new RegExp(`^${DASH}+\\s*(.+)$`));
  if (dashed) return dashed[1].trim();
  // No dash: only accept something that reads like a bare name.
  if (/^[A-Z][A-Za-z.'\u2019-]*(?: [A-Z][A-Za-z.'\u2019-]*){0,3}$/.test(t)) return t;
  return null;
}

/** Parse one line of the quote block into { quote, attribution }. */
function parseQuoteLine(line) {
  const s = line.trim();
  if (!s) return null;
  const tidy = (q) => q.replace(/^["\u201c]+/, '').replace(/["\u201d]+$/, '').trim();

  if (s.startsWith('"') || s.startsWith('\u201c')) {
    // Try each closing-quote candidate left to right; the first one whose tail
    // reads as an attribution wins. This keeps `-Stephanie in ..., "Title"`
    // from being swallowed into the quote.
    for (let i = 1; i < s.length; i += 1) {
      if (s[i] !== '"' && s[i] !== '\u201d') continue;
      const quote = s.slice(1, i).trim();
      if (!quote) continue;
      const attribution = attributionFrom(s.slice(i + 1));
      if (attribution === null) continue;
      return { quote: tidy(quote), attribution };
    }
    // fall through: a few posts are missing their closing quote mark
  }

  // Unbalanced or absent quote marks (typos in the original posts), with a
  // trailing " -Speaker" attribution.
  const m = s.match(new RegExp(`^(.*[.!?\u2026"\u201d])\\s*${DASH}+\\s*([^${DASH_CHARS}]{1,80})$`));
  if (m) return { quote: tidy(m[1]), attribution: m[2].trim() };
  return null;
}

/**
 * Collapse a long citation to something usable as a facet:
 *   `Stephanie in Janet Evanovich's novel, "Lean Mean Thirteen"` -> `Stephanie`
 *   `Regina, "Mean Girls"`                                       -> `Regina`
 * Short, ordinary attributions are left exactly as written.
 */
function normalizeSpeaker(raw) {
  let s = raw.replace(/\s+/g, ' ').trim().replace(/[,.;:\s]+$/, '');
  s = s.replace(/^from\s+/i, '');
  // `Name, "Show Title"` -> `Name`
  const cited = s.match(/^([^,"]{1,24}),\s*["\u201c].*["\u201d]$/);
  if (cited) s = cited[1];
  if (s.length > 24) s = s.split(/\s+(?:in|from|on|of|at|via)\s+|,\s*/)[0].trim();
  s = s.replace(/^["\u201c]+|["\u201d]+$/g, '').replace(/[,.;:\s]+$/, '').trim();
  // Joy wrote every post, so "Me" is always her.
  return s.replace(/^me\b/i, 'Joy');
}

let parseFailures = 0;
const parseFailureIds = [];

function parseQuote(cleanedHtml) {
  const blocks = cleanedHtml
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const contextParts = [];
  const quoteLines = [];
  const noteBlocks = [];
  let seenContext = false;

  for (const block of blocks) {
    if (isAllItalic(block)) {
      contextParts.push(textOf(block));
      seenContext = true;
      continue;
    }
    // Anything after the italic context is a trailing note -- usually "See
    // <link to another post>". It isn't part of the quote, but Joy cross-linked
    // constantly and dropping those links would quietly delete half the fun.
    if (seenContext) {
      noteBlocks.push(block);
      continue;
    }
    const before = quoteLines.length;
    for (const line of block.split(/\n|<br\s*\/?>/i)) {
      const parsed = parseQuoteLine(textOf(line));
      if (parsed) quoteLines.push(parsed);
    }
    if (quoteLines.length === before) noteBlocks.push(block);
  }

  const context = contextParts.join(' ').trim() || null;
  // Only keep notes that actually say something. A block of bare ellipses is
  // a beat in the dialogue, and reprinting it after the quote reads as a typo.
  const note =
    noteBlocks
      .filter((b) => /[a-z0-9]/i.test(textOf(b)))
      .join('\n\n')
      .trim() || null;

  if (!quoteLines.length) {
    return { quote: null, speaker: null, speakerRaw: null, speakers: [], context, note: null };
  }

  const quote = quoteLines.map((l) => l.quote).join('\n');
  const rawSpeakers = [...new Set(quoteLines.map((l) => l.attribution).filter(Boolean))];
  const speakers = [...new Set(rawSpeakers.map(normalizeSpeaker).filter(Boolean))];

  return {
    quote,
    speaker: speakers[0] || null,
    speakerRaw: rawSpeakers[0] || null,
    speakers,
    context,
    note,
  };
}

/* -- embedded media -------------------------------------------------- */

/*
 * Four posts in the Videos category are bare URLs (or a Flash <embed>) that
 * WordPress used to auto-embed. Resolve them here so the app renders a real
 * component instead of a dead <object> or an empty iframe.
 */

const YOUTUBE = /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?[^\s]*\bv=([\w-]{6,})|youtu\.be\/([\w-]{6,}))/i;

const mediaTally = { youtube: 0, flash: 0, link: 0 };

function extractMedia(cleaned) {
  const media = [];

  // Flash embeds: the plugin content behind these is long gone.
  let html = cleaned.replace(
    /<(embed|object)\b[^>]*>([\s\S]*?<\/\1>)?/gi,
    (whole) => {
      const src = (whole.match(/(?:src|data)=["']([^"']+)["']/i) || [])[1];
      if (!src || !/shockwave-flash|mtvnservices|atom\.com/i.test(whole)) return whole;
      media.push({
        kind: 'flash',
        url: src,
        note: 'Flash is long gone, and the clip went with it.',
      });
      mediaTally.flash += 1;
      return '';
    }
  );

  // Bare URLs on a line of their own were auto-embedded by WordPress.
  html = html.replace(/^[ \t]*(https?:\/\/\S+)[ \t]*$/gim, (line, url) => {
    const clean = decodeEntities(url).replace(/&feature=related$/, '');
    const yt = clean.match(YOUTUBE);
    if (yt) {
      media.push({ kind: 'youtube', id: yt[1] || yt[2], url: clean });
      mediaTally.youtube += 1;
      return '';
    }
    if (/hulu\.com/i.test(clean)) {
      media.push({
        kind: 'link',
        url: clean,
        note: 'Hulu retired this URL years ago; it may not resolve any more.',
      });
      mediaTally.link += 1;
      return '';
    }
    return line;
  });

  return { html: html.replace(/\n{3,}/g, '\n\n').trim(), media };
}

/*
 * A handful of posts have a bare URL sitting in the text -- an Etsy listing, a
 * news story. WordPress rendered those as unclickable strings that also blow
 * out the width of a 420px card. Make them links.
 */
let linkified = 0;

function linkifyBareUrls(html) {
  const parts = html.split(/(<[^>]+>)/);
  let insideAnchor = false;
  return parts
    .map((part) => {
      if (part.startsWith('<')) {
        if (/^<a\b/i.test(part)) insideAnchor = true;
        else if (/^<\/a>/i.test(part)) insideAnchor = false;
        return part;
      }
      if (insideAnchor) return part;
      return part.replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g, (url) => {
        linkified += 1;
        return `<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`;
      });
    })
    .join('');
}

/* -- build posts ----------------------------------------------------- */

const posts = published
  .map((p) => {
    const date = p.post_date.replace(' ', 'T');
    const slug = p.post_name;
    const ctx = { id: Number(p.ID), slug };
    const cleaned = cleanHtml(p.post_content, ctx);
    const { html: withoutMedia, media } = extractMedia(cleaned);
    const html = wpautop(linkifyBareUrls(withoutMedia));
    const parsed = parseQuote(withoutMedia);
    const terms = termsForPost.get(p.ID) || [];
    const categories = terms.filter((t) => t.taxonomy === 'category').map((t) => t.name);
    // Photos / Videos / Stories are not quote posts -- no quote is expected.
    const expectsQuote = !categories.some((c) => c === 'Photos' || c === 'Videos' || c === 'Stories');
    if (!parsed.quote && expectsQuote) {
      parseFailures += 1;
      parseFailureIds.push(`${p.ID} ${slug} [${categories.join(', ')}]`);
    }
    // The editorial pass runs over display text only; `slug` and `permalink`
    // are built from the WordPress columns above and never see it.
    const permalink = permalinkFor(date, slug);
    return {
      id: Number(p.ID),
      date,
      title: edit(texturize(decodeEntities(p.post_title)), permalink),
      slug,
      permalink,
      html: editHtml(texturizeHtml(html), permalink),
      quote: parsed.quote && edit(texturize(parsed.quote), permalink),
      speaker: parsed.speaker && edit(parsed.speaker, permalink),
      speakerRaw: parsed.speakerRaw && edit(parsed.speakerRaw, permalink),
      ...(parsed.speakers.length > 1
        ? { speakers: parsed.speakers.map((s) => edit(s, permalink)) }
        : {}),
      context: parsed.context && edit(texturize(parsed.context), permalink),
      ...(parsed.quote && parsed.note
        ? { note: editHtml(texturizeHtml(wpautop(linkifyBareUrls(parsed.note))), permalink) }
        : {}),
      ...(EDITOR_NOTES.has(permalink) ? { editorNote: EDITOR_NOTES.get(permalink) } : {}),
      ...(parsed.quote ? {} : { unparsed: true }),
      categories,
      tags: terms.filter((t) => t.taxonomy === 'post_tag').map((t) => editTag(t.name)),
      images: [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]),
      ...(media.length ? { media } : {}),
    };
  })
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));

const noQuote = posts.filter((p) => !p.quote).length;
console.log(
  `\nQuote parse: ${posts.length - noQuote}/${posts.length} posts yielded a quote; ` +
    `${noQuote - parseFailures} are Photos/Videos/Stories (no quote expected); ` +
    `${parseFailures} genuine parse failure(s), kept as raw html`
);
for (const id of parseFailureIds) console.log(`   - ${id}`);
console.log(`Mojibake artifacts repaired: ${mojibakeFixed}`);

/* -- editorial census ------------------------------------------------ */

for (const p of posts) if (p.editorNote) censored.noted.add(p.permalink);

console.log(
  `\nEditorial pass: ${censored.masked.size} post(s) masked, ` +
    `${censored.rewritten.size} rewritten, ${censored.noted.size} annotated`
);
for (const link of [...censored.masked].sort()) console.log(`   masked     ${link}`);
for (const link of [...censored.rewritten].sort()) console.log(`   rewritten  ${link}`);
for (const link of [...censored.noted].sort()) console.log(`   annotated  ${link}`);
for (const [key, want] of Object.entries(EXPECT.censored)) {
  const got = censored[key].size;
  if (got !== want) {
    fail(
      `Editorial pass ${key} ${got} post(s), expected ${want}.\n` +
        '      Someone changed MASKED/REWRITES/EDITOR_NOTES or the parse moved.\n' +
        '      Review the list above, then update EXPECT.censored to match.'
    );
  }
}
console.log(
  `Embedded media: ${mediaTally.youtube} YouTube, ${mediaTally.link} outbound link(s), ${mediaTally.flash} dead Flash embed(s)`
);
console.log(`Shortcodes stripped: ${shortcodesStripped}, <script> stripped: ${scriptsStripped}`);
console.log(`Internal /archives/* links normalized: ${archiveLinkHits}`);

if (missingImages.length) {
  for (const m of missingImages) console.error(`   missing image: ${m.src} -- ${m.why} (post ${m.id} ${m.slug})`);
  fail(`${missingImages.length} image reference(s) do not resolve to a file on disk.`);
}
if (externalImages.length) {
  for (const m of externalImages) console.warn(`   hotlinked image: ${m.src} (post ${m.id} ${m.slug})`);
  warn(`${externalImages.length} image(s) are hotlinked off-site`);
}
console.log(
  `Inline images: ${posts.reduce((n, p) => n + p.images.length, 0)} across ${posts.filter((p) => p.images.length).length} posts, all resolved`
);
console.log(`  click-through to a 960px version: ${lightboxed}`);
console.log(`  served as the original (no display-size derivative exists): ${keptOriginalRefs.size}`);
for (const f of keptOriginalRefs) console.log(`    ${f}`);

const dupes = posts.map((p) => p.permalink).filter((v, i, a) => a.indexOf(v) !== i);
if (dupes.length) fail(`Duplicate permalinks: ${dupes.join(', ')}`);

console.log(`Attachment-page links rewritten to images: ${attachmentLinksFixed}`);
console.log(`Editor (/wp-admin) links unwrapped: ${adminLinksStripped}`);
console.log(`Bare URLs made clickable: ${linkified}`);

/*
 * Every internal link in a post body has to land somewhere. A dead cross-link
 * is exactly the kind of rot this rebuild exists to remove, so it's a hard
 * failure rather than a warning.
 */
const knownPermalinks = new Set(posts.map((p) => p.permalink));
knownPermalinks.add('/about/');
for (const p of posts) {
  for (const m of p.html.matchAll(/href="(\/[^"]*)"/g)) {
    const href = m[1];
    if (href.startsWith('/uploads/') || href.startsWith('/?')) continue;
    if (knownPermalinks.has(href)) continue;
    deadLinks.push({ id: p.id, slug: p.slug, href, why: 'no such page' });
  }
}
if (deadLinks.length) {
  for (const d of deadLinks) console.error(`   dead link: ${d.href} -- ${d.why} (post ${d.id} ${d.slug})`);
  fail(`${deadLinks.length} internal link(s) point at pages that do not exist.`);
}
console.log(`Internal cross-links: all resolve to a real page`);

/* -- about page ------------------------------------------------------ */

const aboutRow = allPosts.find(
  (p) => p.post_type === 'page' && p.post_status === 'publish' && p.post_name === 'about'
);
if (!aboutRow) fail('Could not find the "about" page (post_type=page, post_name=about).');

const about = {
  id: Number(aboutRow.ID),
  title: texturize(decodeEntities(aboutRow.post_title)),
  slug: aboutRow.post_name,
  date: aboutRow.post_date.replace(' ', 'T'),
  permalink: '/about/',
  html: texturizeHtml(
    wpautop(cleanHtml(aboutRow.post_content, { id: Number(aboutRow.ID), slug: 'about' }))
  ),
};
console.log(`\nAbout page: "${about.title}" (${aboutRow.post_content.length} chars raw)`);

/* -- meta ------------------------------------------------------------ */

function tally(list) {
  const m = new Map();
  for (const v of list) m.set(v, (m.get(v) || 0) + 1);
  return m;
}

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Prefer WordPress's own slugs so historical /tag/<slug>/ URLs keep working.
const slugForTerm = new Map();
for (const t of taxById.values()) {
  slugForTerm.set(t.name, t.slug);
  // A *masked* tag is the same tag with a fig leaf on it, so it keeps its
  // slug and /tag/shit/ still resolves while the sidebar reads "Sh*t".
  const shown = mask(t.name);
  if (shown !== t.name) slugForTerm.set(shown, t.slug);
}
/*
 * A *renamed* tag (TAG_RENAMES) is the one deliberate exception to rule 4. It
 * does not inherit the old slug: carrying it over would have kept the slur
 * alive in a URL, which is the thing the rename existed to remove. "Horizons"
 * misses the lookup and gets a fresh slug, so /tag/retard/ stops existing
 * rather than redirecting. That costs one inbound link on a four-post tag,
 * which is the right trade.
 */
const termSlug = (name) => slugForTerm.get(name) || slugify(name);

const facet = (key) =>
  [...tally(posts.flatMap((p) => p[key])).entries()]
    .map(([name, count]) => ({ name, slug: termSlug(name), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

const tags = facet('tags');
const categories = facet('categories');
const speakers = [...tally(posts.flatMap((p) => p.speakers || (p.speaker ? [p.speaker] : []))).entries()]
  .map(([name, count]) => ({ name, slug: slugify(name), count }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
const years = [...tally(posts.map((p) => p.date.slice(0, 4))).entries()]
  .map(([year, count]) => ({ year, count }))
  .sort((a, b) => a.year.localeCompare(b.year));

const meta = {
  generatedFrom: `${ALLOWED_PREFIX}* tables of the Martinez Media WordPress multisite dump`,
  postCount: posts.length,
  parseFailures,
  definedTagCount: [...taxById.values()].filter((t) => t.taxonomy === 'post_tag').length,
  tags,
  categories,
  speakers,
  years,
};

const definedTags = [...taxById.values()].filter((t) => t.taxonomy === 'post_tag').length;
console.log(
  `\nFacets: ${tags.length} tags used by published posts (${definedTags} defined in the DB, expected ${EXPECT.tags}), ` +
    `${categories.length} categories, ${speakers.length} speakers, ${years.length} years`
);
if (definedTags !== EXPECT.tags) warn(`defined tag count ${definedTags} != expected ${EXPECT.tags}`);
for (const [name, count] of Object.entries(EXPECT.categories)) {
  const got = categories.find((c) => c.name === name);
  if (!got) warn(`category "${name}" missing`);
  else if (got.count !== count) warn(`category "${name}" count ${got.count} != expected ${count}`);
}
const peak = years.reduce((a, b) => (b.count > a.count ? b : a));
if (peak.year !== EXPECT.peakYear.year || peak.count !== EXPECT.peakYear.count) {
  warn(`year peak ${peak.year}=${peak.count} != expected ${EXPECT.peakYear.year}=${EXPECT.peakYear.count}`);
}
console.log('  categories: ' + categories.map((c) => `${c.name} ${c.count}`).join(', '));
console.log('  years:      ' + years.map((y) => `${y.year}:${y.count}`).join(' '));
console.log(
  '  speakers:   ' +
    speakers.slice(0, 12).map((s) => `${s.name} ${s.count}`).join(', ') +
    ` (+${Math.max(0, speakers.length - 12)} more)`
);

/* -- write ------------------------------------------------------------ */

const outDir = path.join(ROOT, 'src', 'data');
fs.mkdirSync(outDir, { recursive: true });
const write = (name, data) => {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, JSON.stringify(data) + '\n');
  console.log(`  wrote ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
};

console.log('\nWriting:');
write('posts.json', posts);
write('about.json', about);
write('meta.json', meta);

if (problems.length) {
  console.log(`\n\u001b[33m${problems.length} expectation(s) did not match:\u001b[0m`);
  for (const p of problems) console.log(`  - ${p}`);
}
console.log('\nDone.\n');

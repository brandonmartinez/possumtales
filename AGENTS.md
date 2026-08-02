# AGENTS.md

Guidance for anyone — human or agent — working on possumtales.com.

## What this repository is

Possum Tales was a WordPress blog Joy Martinez wrote between 2005 and 2017: 363
posts, almost all of them a single funny thing somebody actually said, plus one
"about" page. WordPress is gone. This repository is the archive, rebuilt as a
static React SPA and deployed to GitHub Pages.

**The content is frozen.** Nobody is writing new posts. The job of this codebase
is to keep 363 quotes readable, searchable and linkable for the next twenty
years without a database, a PHP runtime, or a monthly patch cycle.

## The one architectural exception

This is a static site, and a static site generator would normally be the right
tool. React is here for exactly one reason: **real client-side faceted search**.
Twelve years of quotes only become interesting when you can filter by speaker,
tag, category, year and free text simultaneously and see results as you type.
That is genuinely interactive, and it is the whole reason anyone would visit.

Everything else stays minimal. The dependency list is:

| Package            | Why                                                       |
| ------------------ | --------------------------------------------------------- |
| `react`, `react-dom` | The interactive search UI                                |
| `react-router-dom` | Historical permalinks must keep working                    |
| `fuse.js`          | Fuzzy search over 363 quotes, in memory                    |
| `tailwindcss` v4   | Styling, via `@tailwindcss/vite`                           |
| `vite`             | Build                                                      |
| `typescript`       | Types                                                      |

**Do not add dependencies.** No state manager (the URL is the state). No
`react-helmet` (a 20-line hook sets the title). No UI kit (the theme is 2010
notebook art, not Material). No analytics — the original's UA-9271068-4 was
deliberately left behind. No pre-release versions of anything.

## Hard rules

### 1. The WordPress dump never enters this repository

The content was extracted from a mysqldump of a **WordPress multisite** install
that hosted eleven different blogs. That file lives outside the repo, at a path
passed in on the command line, and `.gitignore` blocks `*.sql` as its very first
commit.

`scripts/extract.mjs` enforces a hard allow-list:

```js
const ALLOWED_PREFIX = 'mm_131_';
```

`parseDump()` calls `fail()` if it is ever asked for a table that doesn't start
with that prefix. Only four tables are read: `mm_131_posts`, `mm_131_terms`,
`mm_131_term_taxonomy`, `mm_131_term_relationships`. **Never relax this.** The
other ten sites in that dump belong to other people.

### 2. `src/data/*.json` is generated, and committed anyway

`posts.json`, `about.json` and `meta.json` are build artefacts. They are also
the entire point of this repository, and regenerating them requires a file that
is deliberately not in version control. So they are committed. If you change the
extractor, re-run it and commit the regenerated JSON in the same change.

```sh
npm run extract     # needs --dump/--uploads if the archive has moved
npm run uploads
```

The extractor prints a census of everything it found and hard-fails on any count
that doesn't match. A silent mis-parse is not possible; if the numbers move, the
build stops.

### 3. Ship WordPress derivatives, not camera originals

The uploads archive contains 152 files: 110 WordPress `-WIDTHxHEIGHT`
derivatives and 42 bare originals, some of them multi-megabyte camera JPEGs.
`scripts/lib/uploads.mjs` is the single source of truth for which file a
reference resolves to, shared by the extractor and the copier so the two can
never disagree. `scripts/copy-uploads.mjs` hard-fails on anything over 500 KB.

Result: 113 files, 3.05 MB.

### 4. Every permalink Joy ever published still works

- Canonical: `/YYYY/MM/DD/slug/`
- Pre-2009 posts used an `/archives/` prefix; `/archives/YYYY/MM/DD/slug/`
  redirects to the canonical form. Those links are still embedded in the posts
  themselves.
- Tag and category slugs come from WordPress's own `term.slug`, so
  `/tag/<slug>/` and `/category/<slug>/` match what Google indexed. Look slugs
  up through `tagSlug()` / `categorySlug()` in `src/lib/search.ts` rather than
  re-deriving them with `slugOf()` -- WordPress disambiguates collisions with a
  `-2` suffix, and a recomputed slug would silently stop matching.
- **Every route is prerendered to a real file** by `scripts/postbuild.mjs` --
  `dist/<route>/index.html`, 1481 of them, each cloned from the built shell with
  its own `<title>`, description, canonical and `og:*` tags. This is not an
  optimisation. GitHub Pages answers an unknown path with `404.html` *and an
  HTTP 404*; the app still booted and drew the right page, so it looked fine in
  a browser while every permalink Joy ever published was formally "not found".
  `vite preview` hides the bug because its SPA fallback answers 200 -- which is
  why `verify.mjs` now asserts the *file* exists rather than trusting a live
  request. The `/archives/` variants are prerendered too, so the client-side
  redirect gets a chance to run.
- `dist/404.html` is still the unmodified shell, for paths that are genuinely
  unknown (a typo, a link to a post that never existed). **Do not delete it.**
- `scripts/extract.mjs` fails the build if any internal `<a href="/...">` in a
  post body points at a page that does not exist.

### 4a. The sidebar numbers are contextual, and that is deliberate

`countFacets()` counts each dimension against every filter **except its own**.
That has two consequences worth preserving:

- A count is a promise. "Brandon (98)" while `category=Videos` is on would be a
  lie, because none of those 98 are videos. Facets that would produce an empty
  page are dropped from the sidebar entirely.
- Excluding a dimension from its own count is what lets you switch sideways
  within it. These filters are single-select, so clicking another category
  replaces the current one; counting categories against the active category
  would show every sibling as zero.

The active facet is always rendered even at zero, otherwise a shared link like
`/?speaker=brandon&category=videos` would strand you with no way to switch it
off.

On `/tag/<slug>/`, `/category/<slug>/` and `/speaker/<slug>/` the route owns
that dimension, so `setFilter` **navigates** instead of writing a query param
that `useFilters` would ignore. Sidebar tag links keep the other active filters
in the query string, so clicking a tag narrows rather than starting over.

### 5. The 2010 look is the design

The visual design is a faithful reproduction of the original scrapbook theme:
white background tiled with scattered trash, a 740px spiral-bound leather
notebook, torn-paper post cards, the hand-drawn possum logo, `Just Another Hand`
headings. The *interaction* was modernized. The *look* was not.

The notebook is a 9-slice: a fixed-ratio cap, a vertically tiling middle and a
fixed-ratio foot, sized with `aspect-ratio` and percentage padding so the
fixed-width 2010 artwork scales down to 320px without cropping or letting text
ride onto the spiral binding. **Do not flatten the panels into rounded
rectangles.** If you need to change the layout, change the percentages.

The one place the original was overruled is the *inside* of a post card. The
2010 theme set the quote at body size under a large handwritten title and a
shouting uppercase date, so the words somebody actually said carried the least
weight on the page. The card classes in `src/index.css` (`.card-title`,
`.card-quote`, `.card-byline`, `.card-aside`, `.card-tags`) reorder that:

- the quote is the largest text in the card, with the opening quote mark hung
  into the margin via a negative `text-indent` so the letters stay flush;
- speaker and date are one citation line rather than two competing labels;
- the setup line is italic and quieter, with no full-width rule cutting the card
  in half.

Artwork, palette, handwriting and textures are untouched.

### 5a. Punctuation is restored, not modernized

WordPress ran `wptexturize` over every post on its way to the browser, so the
site Joy published showed curly quotes, real ellipses and en dashes even though
the database stores typewriter punctuation. 175 of the 363 quotes contain a
straight apostrophe and **not one** contains a curly one, so reprinting the raw
column would have been a regression.

`texturize()` in `scripts/extract.mjs` reproduces the relevant `wptexturize`
rules; `texturizeHtml()` applies them to post bodies while skipping tags, so
`href`s and attributes are never touched. Both skip URL-like runs.

Two traps if you edit it:

- `'em`, `'til` and `'n'` are elisions and need a **right** single quote, but
  `'possum'`, `'trees'` and `'3'` are quoted words and need a **left** one.
  The `ELISION` list is the only thing separating them; adding a word to it that
  is actually being quoted will flip its opening mark the wrong way.
- A `"` closes unless something else just ended before it. Four quotes are
  Janet Evanovich excerpts with dialogue inside the quote and depend on this.

### 5b. The editorial pass is an allow-list, and it is display-only

The archive is faithful, but a few 2009 quotes read differently on a public URL
than they did on a WordPress blog. `scripts/extract.mjs` has one small
**editorial pass** — declared in three tables near the other content helpers,
so the gap between what the database holds and what the site shows is always
readable in one place:

- `MASKED` — a light asterisk on the strongest words (`sh*t`, `f*ck`, `b*tch`,
  `p*ss`, `d*ck`, `a*s`). A fig leaf, not redaction; the word stays legible.
- `REWRITES` — "Retard from school" was the byline Joy gave a classmate, and
  two of her setup lines used the word too. Rewritten to "Horizons", after the
  special-needs classroom.
- `EDITOR_NOTES` — one quote uses a racial slur as the regional name for a
  Brazil nut. Masking it would tidy the surface and leave the thing itself
  alone, so the words stand and a note sits underneath. That note renders as
  `post.editorNote` with `.card-note`, kept visually distinct from `post.note`,
  which is Joy's own trailing prose. **Do not merge the two fields.**

Three things this pass must never do:

- **Touch a slug.** Not `post.slug`, not `permalink`, not a term's WordPress
  slug. `/2010/04/27/shit-with-a-little-bow/` still resolves; only the title
  displays as "Sh*t With a Little Bow". A renamed tag is re-indexed under its
  display name in `slugForTerm`, so "Horizons" resolves to `/tag/retard/`.
  (Speaker slugs are derived by this rebuild and were never WordPress URLs, so
  `/speaker/horizons-kid-from-school/` replacing the old one breaks nothing.)
- **Reach inside a tag or an attribute.** `maskHtml` skips markup the same way
  `texturizeHtml` does, because an `href` carries a slug.
- **Grow without being counted.** `EXPECT.censored` pins the pass at 18 masked
  posts, 4 rewritten and 1 annotated. Change the tables and the build stops
  until you update the count, so nothing is ever censored that nobody reviewed.

Deliberately *not* censored, and it should stay that way without a decision:
`hell`, `dammit`, `crap`, `poop`, `butt`, `sexy` and the rest of the mild end;
"pussywillows" (a plant); and "Don't Be Gay" (a line from *The Sweetest Thing*,
not a family member).

### 6. Tailwind v4, not v3

There is no `tailwind.config.js`. The entry CSS is `@import "tailwindcss";` and
theming happens in an `@theme` block in `src/index.css`. Do not follow a v3
tutorial and do not add a PostCSS config.

## Layout

```
scripts/
  extract.mjs            mysqldump -> src/data/*.json. Privacy allow-list lives here.
  lib/uploads.mjs        which image file a reference resolves to. Shared.
  copy-uploads.mjs       archive -> public/uploads/, with a size budget
  normalize-lockfile.mjs rewrites proxy registry URLs to registry.npmjs.org
  postbuild.mjs          prerenders every route + 404.html + sitemap.xml
  verify.mjs             the acceptance checklist, as code
src/
  data/*.json            generated, committed
  lib/content.ts         typed accessors and lookup maps
  lib/search.ts          fuse.js + URL-backed filter state
  components/            Layout, Panel, PostCard, PostBody, Sidebar, SearchBox, Media, Pagination
  pages/                 Archive, PostPage, About, NotFound
  index.css              the theme
```

`npm run verify` runs 23 checks covering content integrity, repo hygiene, image
budget, build output and — when `npm run preview` is running — every one of the
363 permalinks and every image reference over HTTP. It runs in CI on every push.

## The lockfile quirk

`~/.npmrc` on the maintainer's machine points npm at an internal Microsoft
proxy, and `npm install` bakes those hostnames into `package-lock.json`, which
breaks `npm ci` in GitHub Actions. After any dependency change:

```sh
npm run lockfile
```

`npm run verify` fails if a proxied URL survives into the lockfile.

## Deviations from the original brief

Things that turned out differently from the spec once the data was actually
read. All of them are deliberate.

1. **Tag count is 649, not 665.** 665 `post_tag` terms are *defined* in the
   database, but 16 of them are attached only to the draft and to revisions.
   `meta.json` records both (`definedTagCount` and `tags.length`).
2. **9 images have a `-960x` derivative, not 10.** All 9 are referenced inline
   and get a click-through to the larger version.
3. **3 bare originals are shipped**, against the derivatives-only rule:
   `2009/09/10.gif` (178×270), and two 240×320 JPEGs from 2010/03. WordPress
   never generated a medium size for them because they were already narrower
   than 350px — the original *is* what the site served. 76 KB total, all far
   under the 500 KB guard. Substituting 150×150 thumbnails would have been
   worse.
4. **3 Flash embeds in `possum-death-spree`, not 1.**
5. **`speakers[]`** is emitted alongside `speaker`/`speakerRaw` for the dialogue
   posts that have more than one attribution. The speaker facet is built from
   the union, so a two-person exchange shows up under both names.
6. **One genuine parse failure**, post 371 `tweet-tweet-follow-a-pos`. It is a
   site announcement, not a quote. It is marked `unparsed: true` and its
   original HTML renders instead. `verify.mjs` asserts this is the *only* one.
7. **`media[]`** is baked at build time rather than sniffed in the browser, so
   the app renders a real YouTube iframe or an honest "this clip is gone" note
   instead of a dead `<object>`.
8. **`note`** is emitted for the 7 posts with trailing prose after the quote
   (mostly `See <link to another post>`). Dropping it would have deleted working
   cross-links.
9. **Attachment pages are rewritten to images.** WordPress gave every upload its
   own page; 27 links pointed at those pages, which cannot exist in a static
   site. They now point straight at the picture.
10. **`scripts/lib/uploads.mjs` and `scripts/normalize-lockfile.mjs`** exist in
    addition to the scripts the brief named.
11. **Punctuation is texturized** on the way out of the extract, and the post
    card's internal typography departs from the 2010 theme. See §5 and §5a.

## Known advisory

`npm audit` reports a **high** finding against `react-router` 7.12.0–8.2.0: "RSC
Mode CSRF Bypass". This site is a purely client-side SPA on static hosting with
no React Server Components, no server actions and no server at all, so the
vulnerable code path does not exist here. Downgrading would mean pinning an
older router for no security benefit. Revisit when a patched 7.x ships.

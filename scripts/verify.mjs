#!/usr/bin/env node
/**
 * Everything in the "how you'll know it worked" checklist, as code.
 *
 * Two halves:
 *  - Static checks, which run anywhere: repo hygiene, data integrity, upload
 *    budget, no pre-release dependencies, permalink coverage in dist.
 *  - Live checks, which need `npm run preview` on http://localhost:4173 and
 *    confirm every image and permalink actually resolves over HTTP.
 *
 * Usage: node scripts/verify.mjs [--base http://localhost:4173]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:4173';

let failures = 0;
let checks = 0;

function check(name, fn) {
  checks += 1;
  try {
    const detail = fn();
    console.log(`  ok    ${name}${detail ? ` -- ${detail}` : ''}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n          ${err.message}`);
  }
}

async function checkAsync(name, fn) {
  checks += 1;
  try {
    const detail = await fn();
    console.log(`  ok    ${name}${detail ? ` -- ${detail}` : ''}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n          ${err.message}`);
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const read = (p) => readFileSync(join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

/* -- content ---------------------------------------------------------- */

console.log('\nContent');

const posts = json('src/data/posts.json');
const meta = json('src/data/meta.json');
const about = json('src/data/about.json');

check('363 posts survived the migration', () => {
  assert(posts.length === 363, `expected 363, got ${posts.length}`);
  return `${posts.length} posts`;
});

check('every quote post has a quote', () => {
  const skippable = new Set(['Photos', 'Videos', 'Stories']);
  const missing = posts.filter(
    (p) => !p.quote && !p.categories.some((c) => skippable.has(c))
  );
  // One post (id 371) is a site announcement, not a quote. See AGENTS.md.
  assert(missing.length <= 1, `${missing.length} quote posts have no quote`);
  assert(
    missing.every((p) => p.id === 371),
    `unexpected parse failure: ${missing.map((p) => p.slug).join(', ')}`
  );
  return `${posts.filter((p) => p.quote).length} parsed, 1 known exception (id 371)`;
});

check('every post has a unique, well-formed permalink', () => {
  const seen = new Set();
  for (const p of posts) {
    assert(/^\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/$/.test(p.permalink), `bad permalink ${p.permalink}`);
    assert(!seen.has(p.permalink), `duplicate permalink ${p.permalink}`);
    seen.add(p.permalink);
  }
  return `${seen.size} unique`;
});

check('the about page has content', () => {
  assert(about.html.length > 200, `about page is only ${about.html.length} chars`);
  return `${about.html.length} chars`;
});

check('no internal link points at a page that does not exist', () => {
  const known = new Set(posts.map((p) => p.permalink));
  known.add('/about/');
  const dead = [];
  for (const p of posts) {
    for (const m of p.html.matchAll(/href="(\/[^"]*)"/g)) {
      const href = m[1];
      if (href.startsWith('/uploads/') || href.startsWith('/?')) continue;
      if (!known.has(href)) dead.push(`${p.slug} -> ${href}`);
    }
  }
  assert(dead.length === 0, dead.join('; '));
});

check('post html carries no scripts, handlers or Flash', () => {
  const bad = posts.filter((p) =>
    /<script|\son[a-z]+=|<embed\b|<object\b|javascript:/i.test(p.html)
  );
  assert(bad.length === 0, `${bad.length} posts still contain unsafe markup`);
});

check('facets are populated', () => {
  assert(meta.categories.length === 6, `expected 6 categories, got ${meta.categories.length}`);
  assert(meta.tags.length > 600, `only ${meta.tags.length} tags`);
  assert(meta.speakers.length > 50, `only ${meta.speakers.length} speakers`);
  assert(meta.years.length === 11, `expected 11 years, got ${meta.years.length}`);
  return `${meta.tags.length} tags, ${meta.speakers.length} speakers, ${meta.categories.length} categories`;
});

check('search finds the things it should', () => {
  const hits = (term) =>
    posts.filter((p) =>
      `${p.quote ?? ''} ${p.title} ${p.context ?? ''} ${(p.speakers ?? [p.speaker]).join(' ')} ${p.tags.join(' ')}`
        .toLowerCase()
        .includes(term)
    ).length;
  for (const term of ['armpit', 'snuggle', 'brandon', 'mom']) {
    assert(hits(term) > 0, `no post contains "${term}"`);
  }
  return 'armpit, snuggle, brandon, mom all present';
});

/* -- repo hygiene ------------------------------------------------------ */

console.log('\nRepo hygiene');

check('no .sql file is tracked or present', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.sql') || f.endsWith('.sql.gz'));
  assert(tracked.length === 0, `tracked dump(s): ${tracked.join(', ')}`);
  const ignore = read('.gitignore');
  assert(ignore.includes('*.sql'), '.gitignore does not ignore *.sql');
});

check('nothing from another blog leaked in', () => {
  const src = read('scripts/extract.mjs');
  assert(src.includes("ALLOWED_PREFIX = 'mm_131_'"), 'extract.mjs lost its table allow-list');
  const suspicious = ['bim_', 'kcfmcs_', 'mm_11_', 'mm_141_'];
  for (const table of suspicious) {
    assert(
      !JSON.stringify(posts).includes(table),
      `post data mentions another site's table prefix ${table}`
    );
  }
});

check('no analytics', () => {
  const html = read('index.html');
  assert(!/UA-\d|gtag|googletagmanager|analytics/i.test(html), 'index.html loads analytics');
});

check('no pre-release dependencies', () => {
  const pkg = json('package.json');
  const versions = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies });
  const bad = versions.filter(([, v]) => /-(?:alpha|beta|rc|next|canary)/i.test(v));
  assert(bad.length === 0, `pre-release ranges: ${bad.map(([n, v]) => `${n}@${v}`).join(', ')}`);

  // The lockfile is the thing that actually gets installed, so check the
  // resolved versions too -- but only the version strings. Grepping the whole
  // file matches unrelated URLs like opencollective.com/parcel.
  const lock = json('package-lock.json');
  const locked = Object.entries(lock.packages ?? {})
    .filter(([path]) => path.startsWith('node_modules/'))
    .filter(([, info]) => /-(?:alpha|beta|rc|next|canary)/i.test(info.version ?? ''));
  assert(
    locked.length === 0,
    `pre-release installs: ${locked.map(([p, i]) => `${p}@${i.version}`).join(', ')}`
  );
  return `${versions.length} declared, ${Object.keys(lock.packages ?? {}).length - 1} locked`;
});

check('the lockfile resolves against the public registry', () => {
  const lock = read('package-lock.json');
  const proxied = [...lock.matchAll(/"resolved":\s*"(https?:\/\/[^/"]+)/g)]
    .map((m) => m[1])
    .filter((host) => !host.includes('registry.npmjs.org'));
  assert(
    proxied.length === 0,
    `${proxied.length} entries point at ${[...new Set(proxied)].join(', ')} -- run npm run lockfile`
  );
});

/* -- images ------------------------------------------------------------ */

console.log('\nImages');

const MAX_BYTES = 500 * 1024;

check('shipped uploads stay inside the size budget', () => {
  const dir = join(root, 'public/uploads');
  assert(existsSync(dir), 'public/uploads does not exist -- run npm run uploads');
  let count = 0;
  let bytes = 0;
  const oversize = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        const size = statSync(p).size;
        count += 1;
        bytes += size;
        if (size > MAX_BYTES) oversize.push(`${relative(dir, p)} (${Math.round(size / 1024)} KB)`);
      }
    }
  };
  walk(dir);
  assert(oversize.length === 0, `over 500 KB: ${oversize.join(', ')}`);
  return `${count} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`;
});

check('every referenced image is a file we ship', () => {
  const missing = [];
  for (const p of posts) {
    for (const m of p.html.matchAll(/(?:src|href)="(\/uploads\/[^"]+)"/g)) {
      if (!existsSync(join(root, 'public', m[1]))) missing.push(`${p.slug} -> ${m[1]}`);
    }
  }
  assert(missing.length === 0, missing.join('; '));
  const refs = new Set(
    posts.flatMap((p) => [...p.html.matchAll(/(?:src|href)="(\/uploads\/[^"]+)"/g)].map((m) => m[1]))
  );
  return `${refs.size} distinct references, 0 missing`;
});

/* -- build output ------------------------------------------------------ */

const dist = join(root, 'dist');
if (existsSync(dist)) {
  console.log('\nBuild output');

  check('dist/404.html is the SPA fallback', () => {
    assert(existsSync(join(dist, '404.html')), 'dist/404.html is missing');
    assert(
      readFileSync(join(dist, '404.html'), 'utf8') === readFileSync(join(dist, 'index.html'), 'utf8'),
      '404.html and index.html differ -- deep links will break on refresh'
    );
  });

  check('CNAME and robots survived the build', () => {
    assert(existsSync(join(dist, 'CNAME')), 'dist/CNAME is missing');
    assert(existsSync(join(dist, 'robots.txt')), 'dist/robots.txt is missing');
    return readFileSync(join(dist, 'CNAME'), 'utf8').trim();
  });

  check('the sitemap covers every post', () => {
    const xml = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
    const missing = posts.filter((p) => !xml.includes(`${p.permalink}<`));
    assert(missing.length === 0, `${missing.length} posts missing from the sitemap`);
    assert(xml.includes('/about/<'), '/about/ missing from the sitemap');
    return `${[...xml.matchAll(/<loc>/g)].length} urls`;
  });

  check('no .sql or dump artefact made it into dist', () => {
    const bad = [];
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.sql$/i.test(entry.name)) bad.push(relative(dist, p));
      }
    };
    walk(dist);
    assert(bad.length === 0, bad.join(', '));
  });
} else {
  console.log('\nBuild output -- skipped (no dist/; run npm run build)');
}

/* -- live server ------------------------------------------------------- */

const reachable = await fetch(base, { method: 'HEAD' })
  .then((r) => r.ok)
  .catch(() => false);

if (!reachable) {
  console.log(`\nLive checks -- skipped (${base} is not answering; run npm run preview)`);
} else {
  console.log(`\nLive checks against ${base}`);

  const status = async (path) => (await fetch(base + path, { redirect: 'manual' })).status;

  await checkAsync('a deep permalink survives a hard refresh', async () => {
    const path = '/2009/08/09/the-snuggie-inn/';
    const res = await fetch(base + path);
    const html = await res.text();
    assert(html.includes('<div id="root">'), `${path} did not serve the app shell`);
    return `${path} -> ${res.status}`;
  });

  await checkAsync('every one of the 363 permalinks serves the app', async () => {
    const sample = posts.map((p) => p.permalink);
    const bad = [];
    for (let i = 0; i < sample.length; i += 25) {
      const batch = sample.slice(i, i + 25);
      const codes = await Promise.all(batch.map(status));
      codes.forEach((code, j) => {
        if (code !== 200) bad.push(`${batch[j]} -> ${code}`);
      });
    }
    assert(bad.length === 0, bad.slice(0, 5).join(', '));
    return `${sample.length} permalinks, 0 failures`;
  });

  await checkAsync('no image 404s anywhere in the archive', async () => {
    const refs = [
      ...new Set(
        posts.flatMap((p) =>
          [...p.html.matchAll(/(?:src|href)="(\/uploads\/[^"]+)"/g)].map((m) => m[1])
        )
      ),
    ];
    const bad = [];
    for (let i = 0; i < refs.length; i += 25) {
      const batch = refs.slice(i, i + 25);
      const codes = await Promise.all(batch.map(status));
      codes.forEach((code, j) => {
        if (code !== 200) bad.push(`${batch[j]} -> ${code}`);
      });
    }
    assert(bad.length === 0, bad.join(', '));
    return `${refs.length} images, 0 failures`;
  });

  await checkAsync('static extras are served', async () => {
    for (const path of ['/robots.txt', '/sitemap.xml', '/favicon.png', '/og-image.png']) {
      assert((await status(path)) === 200, `${path} is not being served`);
    }
  });
}

/* -- result ------------------------------------------------------------ */

console.log(
  `\n${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks passed.\n`
);
process.exit(failures ? 1 : 0);

# Possum Tales

[possumtales.com](https://www.possumtales.com) — a quote blog Joy Martinez wrote
from 2005 to 2017. 363 funny things people actually said, kept exactly as they
were, now searchable.

The original was WordPress. This is the same content as a static React SPA on
GitHub Pages: no database, no PHP, no monthly patch cycle, and every permalink
still works.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
```

```sh
npm run build      # typecheck, bundle, 404.html fallback, sitemap
npm run preview    # serve dist/ on http://localhost:4173
npm run verify     # 23 acceptance checks (more of them if preview is running)
```

## Regenerating the content

`src/data/posts.json`, `about.json` and `meta.json` are **generated files that
are committed on purpose.** Regenerating them requires the original WordPress
mysqldump, which is deliberately not in this repository (`.gitignore` blocks
`*.sql`, and the extractor refuses to read any table belonging to another site
in that multisite install). Committing the output is what lets anyone build the
site without that file.

```sh
npm run extract -- --dump /path/to/dump.sql --uploads /path/to/wp-content/uploads/possumtales
npm run uploads
```

Both scripts print a full census and hard-fail if any count drifts.

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds, verifies and
publishes `dist/` to GitHub Pages at <https://www.possumtales.com/>.

The repo is already configured: Pages source is **GitHub Actions**, the custom
domain is `www.possumtales.com`, and HTTPS is enforced. DNS is in place --
`www` is a CNAME to `brandonmartinez.github.io`, and the apex points at the four
GitHub Pages A records so `possumtales.com` redirects to `www`. Keep
`public/CNAME` in sync with the domain, or a deploy will clear it.

## More

[AGENTS.md](AGENTS.md) covers the architecture, the privacy rules around the
dump, the image-derivative policy, the permalink contract, and every place the
implementation deviates from the original plan.

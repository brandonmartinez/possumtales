#!/usr/bin/env node
/**
 * Rewrite package-lock.json `resolved` URLs to the public npm registry.
 *
 * This machine's ~/.npmrc points npm at an internal Microsoft package proxy,
 * so a freshly generated lockfile records proxy URLs. GitHub Actions cannot
 * reach that proxy, and `npm ci` would fail there. Integrity hashes are hashes
 * of the tarball contents, so they stay valid across registries.
 *
 * Run this after any dependency change. It is a no-op on a clean lockfile.
 *
 * Usage: node scripts/normalize-lockfile.mjs [--check]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = path.join(ROOT, 'package-lock.json');
const PUBLIC = 'https://registry.npmjs.org/';
const CHECK = process.argv.includes('--check');

const before = fs.readFileSync(LOCK, 'utf8');
// Proxy tarball URLs all end with `.../registry/<pkg>/-/<file>.tgz`.
const after = before.replace(
  /"resolved": "https:\/\/[^"]*?\/registry\/((?:@[^/"]+\/)?[^/"]+\/-\/[^"]+)"/g,
  `"resolved": "${PUBLIC}$1"`
);

const hosts = [...after.matchAll(/"resolved": "https:\/\/([^/"]+)\//g)].map((m) => m[1]);
const foreign = [...new Set(hosts)].filter((h) => h !== 'registry.npmjs.org');

if (before === after) {
  console.log('package-lock.json already points at the public registry.');
} else if (CHECK) {
  console.error('package-lock.json contains non-public registry URLs. Run: npm run lockfile');
  process.exit(1);
} else {
  fs.writeFileSync(LOCK, after);
  const n = (before.match(/"resolved": "https:\/\//g) || []).length;
  console.log(`Rewrote ${n} "resolved" URLs to ${PUBLIC}`);
}

if (foreign.length) {
  console.error(`\nSTOP: lockfile still references ${foreign.join(', ')}`);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * Copy the shippable WordPress images into public/uploads/.
 *
 * Shippable = the `-WIDTHxHEIGHT` derivatives WordPress generated, plus the
 * handful of originals that were already small enough that WordPress never
 * made a display-size copy. See scripts/lib/uploads.mjs for the rule.
 *
 * The bare camera originals (~21 MB) stay in the archive and are never
 * committed.
 *
 * Usage: node scripts/copy-uploads.mjs [--uploads <path>] [--clean]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DERIVATIVE, MAX_SHIPPED_BYTES, listFiles, shouldShip } from './lib/uploads.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'public', 'uploads');

const DEFAULT_UPLOADS =
  '/Users/brandonmartinez/src/_archive/_temp/martinezmedia/wp-content/uploads/possumtales';

const argIndex = process.argv.indexOf('--uploads');
const SRC = argIndex !== -1 ? process.argv[argIndex + 1] : DEFAULT_UPLOADS;
const CLEAN = process.argv.includes('--clean');

if (!fs.existsSync(SRC)) {
  console.error(`\nSTOP: uploads archive not found at ${SRC}\n`);
  process.exit(1);
}

if (CLEAN && fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true });

const all = listFiles(SRC);
const files = new Set(all);

const shipped = all.filter((f) => shouldShip(f, files));
const skipped = all.filter((f) => !shouldShip(f, files));

let bytes = 0;
const tooBig = [];
for (const rel of shipped) {
  const from = path.join(SRC, rel);
  const size = fs.statSync(from).size;
  if (size > MAX_SHIPPED_BYTES) {
    tooBig.push({ rel, size });
    continue;
  }
  const to = path.join(DEST, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  bytes += size;
}

const keptOriginals = shipped.filter((f) => !DERIVATIVE.test(f));

console.log('Possum Tales uploads');
console.log('====================');
console.log(`Source: ${SRC}`);
console.log(`Dest:   ${path.relative(ROOT, DEST)}\n`);
console.log(
  `Copied  ${shipped.length - tooBig.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB (${bytes.toLocaleString()} bytes)`
);
console.log(`        ${shipped.length - keptOriginals.length} WordPress derivatives`);
console.log(`        ${keptOriginals.length} originals with no display-size derivative:`);
for (const f of keptOriginals) {
  console.log(`          ${f} (${(fs.statSync(path.join(SRC, f)).size / 1024).toFixed(0)} KB)`);
}
console.log(`Skipped ${skipped.length} bare camera originals (they stay in the archive)`);

const byYear = {};
for (const f of shipped) byYear[f.split('/')[0]] = (byYear[f.split('/')[0]] || 0) + 1;
console.log('  ' + Object.entries(byYear).map(([y, n]) => `${y}: ${n}`).join('   '));

if (tooBig.length) {
  console.error('\nSTOP: files over 500 KB were classified as shippable -- that cannot be right:');
  for (const t of tooBig) console.error(`  ${t.rel} (${(t.size / 1024).toFixed(0)} KB)`);
  process.exit(1);
}
console.log('');

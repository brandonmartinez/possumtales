/**
 * Shared rules for the possumtales upload archive.
 *
 * WordPress generated -50x50, -150x150, -350x... and -960x... derivatives for
 * every uploaded image that was large enough. We ship the derivatives, not the
 * bare camera originals.
 *
 * One exception, and it is WordPress's own logic rather than ours: when an
 * upload was already <= 350px wide, WordPress never generated a medium size,
 * so the ORIGINAL file is what the site actually served inline. Three images
 * are in that bucket (a 178px GIF and two 240px Facebook JPEGs, ~76 KB total).
 * Shipping those keeps the pages looking the way they did; substituting a
 * 150x150 thumbnail would not.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DERIVATIVE = /-(\d+)x(\d+)(\.[a-z0-9]+)$/i;

/** Width at or above which WordPress produced a display-size derivative. */
export const DISPLAY_WIDTH = 350;

/** Hard cap: anything bigger than this is a camera original and never ships. */
export const MAX_SHIPPED_BYTES = 500 * 1024;

/** Recursively list files under `dir` as posix-style relative paths. */
export function listFiles(dir, rel = '', out = []) {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) listFiles(path.join(dir, entry.name), r, out);
    else out.push(r);
  }
  return out;
}

/** The bare-original path a derivative belongs to. */
export function baseOf(rel) {
  const m = rel.match(DERIVATIVE);
  return m ? rel.replace(DERIVATIVE, m[3]) : rel;
}

/** Derivatives of the same base image, widest first. */
export function derivativesOf(rel, files) {
  const base = baseOf(rel);
  const dir = path.posix.dirname(base);
  const ext = path.extname(base);
  const stem = path.posix.basename(base, ext);
  const out = [];
  for (const f of files) {
    if (path.posix.dirname(f) !== dir) continue;
    const m = f.match(DERIVATIVE);
    if (!m || m[3].toLowerCase() !== ext.toLowerCase()) continue;
    if (path.posix.basename(f, m[3]).replace(/-\d+x\d+$/, '') !== stem) continue;
    out.push({ file: f, w: Number(m[1]), h: Number(m[2]) });
  }
  return out.sort((a, b) => b.w - a.w);
}

/**
 * The file the site should serve for a referenced path.
 *
 *  - An existing derivative is served as-is: the size the original site chose
 *    to display is the size we display.
 *  - A bare original is swapped for its widest derivative, unless WordPress
 *    never made a display-size copy (in which case the original IS it).
 *  - A path with no file at all resolves to whatever derivative survives, or
 *    null so the caller can fail loudly.
 */
export function resolveDisplayFile(rel, files) {
  if (files.has(rel) && DERIVATIVE.test(rel)) return rel;
  const widest = derivativesOf(rel, files)[0];
  if (widest && widest.w >= DISPLAY_WIDTH) return widest.file;
  if (files.has(baseOf(rel))) return baseOf(rel);
  return widest ? widest.file : null;
}

/** Should this archive file be committed to public/uploads/? */
export function shouldShip(rel, files) {
  if (DERIVATIVE.test(rel)) return true;
  const widest = derivativesOf(rel, files)[0];
  // No display-size derivative exists -> the original IS the display size.
  return !widest || widest.w < DISPLAY_WIDTH;
}

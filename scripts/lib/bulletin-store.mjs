// Keeps the latest radio bulletin between builds.
// .cache/bulletin/ holds info.json (plain metadata) plus <id>.bin (encrypted script JSON) and <id>.audio.bin (encrypted MP3).
// Every build copies them into dist/data/bulletin/ and puts the metadata into dist/data/meta.json, so the app can see
// whether a bulletin exists without decrypting anything. Encrypted with the site key: a new NEWS_KEY/salt invalidates them.

import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const bulletinDir = (cache) => path.join(cache, 'bulletin');

export async function readInfo(cache) {
  try {
    return JSON.parse(await readFile(path.join(bulletinDir(cache), 'info.json'), 'utf8'));
  } catch {
    return null;
  }
}

export async function writeInfo(cache, info) {
  await mkdir(bulletinDir(cache), { recursive: true });
  await writeFile(path.join(bulletinDir(cache), 'info.json'), JSON.stringify(info, null, 2));
}

// Save a new bulletin and drop older files.
export async function saveBulletin(cache, info, scriptBin, audioBin) {
  const dir = bulletinDir(cache);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${info.id}.bin`), scriptBin);
  if (audioBin) await writeFile(path.join(dir, `${info.id}.audio.bin`), audioBin);
  for (const f of await readdir(dir)) if (f.endsWith('.bin') && !f.startsWith(info.id + '.')) await rm(path.join(dir, f));
  await writeInfo(cache, info);
}

// Copy the current bulletin into the site and add its metadata to meta.json.
export async function publishBulletin(cache, dist, salt) {
  const info = await readInfo(cache);
  if (!info) return null;
  if (info.salt && salt && info.salt !== salt) return null; // encrypted with an older key
  const src = bulletinDir(cache);
  const out = path.join(dist, 'data', 'bulletin');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  if (info.id && existsSync(path.join(src, `${info.id}.bin`))) {
    for (const f of await readdir(src)) if (f.endsWith('.bin')) await cp(path.join(src, f), path.join(out, f));
  }
  const metaPath = path.join(dist, 'data', 'meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  const { salt: _s, ...pub } = info;
  meta.bulletin = pub;
  await writeFile(metaPath, JSON.stringify(meta));
  return pub;
}

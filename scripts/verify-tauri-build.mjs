import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const readJson = async (name) => JSON.parse(await readFile(join(root, name), 'utf8'));
const pkg = await readJson('package.json');
const lock = await readJson('package-lock.json');
const tauri = await readJson('src-tauri/tauri.conf.json');
const cargo = await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8');
const cargoLock = await readFile(join(root, 'src-tauri/Cargo.lock'), 'utf8');
const manifestVersion = cargo.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
const lockedVersion = cargoLock.match(/\[\[package\]\]\s+name = "eyeprotect"\s+version = "([^"]+)"/)?.[1];
for (const version of [lock.version, lock.packages[''].version, tauri.version, manifestVersion, lockedVersion]) {
  assert.equal(version, pkg.version, 'package, lockfiles and Tauri versions must match');
}
for (const path of [
  'out/web/web.html', 'out/web/dim.html', 'src-tauri/target/release/eyeprotect.exe',
  `src-tauri/target/release/bundle/nsis/EyeProtect_${pkg.version}_x64-setup.exe`
]) {
  assert.ok((await stat(join(root, path))).size > 0, `missing or empty build output: ${path}`);
}
for (const name of ['idle.gif', 'click.gif', 'fidget.gif', 'sleep.gif']) {
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const source = await readFile(join(root, 'public/assets/pets/fighter', name));
  const bundled = await readFile(join(root, 'out/web/assets/pets/fighter', name));
  assert.equal(digest(bundled), digest(source), `pet asset changed during the build: ${name}`);
}
console.log(`Tauri build contract passed for ${pkg.version}.`);

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = join(root, 'release');
await mkdir(output, { recursive: true });
const files = [
  [`src-tauri/target/release/bundle/nsis/EyeProtect_${version}_x64-setup.exe`, `EyeProtect-Setup-${version}-win-x64.exe`],
  ['src-tauri/target/release/eyeprotect.exe', `EyeProtect-${version}-win-x64.exe`]
];
const sums = [];
for (const [source, name] of files) {
  const destination = join(output, name);
  await copyFile(join(root, source), destination);
  const hash = createHash('sha256').update(await readFile(destination)).digest('hex');
  sums.push(`${hash}  ${name}`);
  console.log(`Prepared ${destination}`);
}
await writeFile(join(output, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);

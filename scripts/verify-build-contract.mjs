import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const preloadCjsPath = join(rootDir, 'out', 'preload', 'index.cjs');
const preloadMjsPath = join(rootDir, 'out', 'preload', 'index.mjs');
const mainPath = join(rootDir, 'out', 'main', 'index.js');
const failures = [];

if (!existsSync(preloadCjsPath)) {
  failures.push('missing sandbox-compatible out/preload/index.cjs');
}

if (existsSync(preloadMjsPath)) {
  failures.push('unexpected ESM preload out/preload/index.mjs');
}

if (existsSync(preloadCjsPath)) {
  const preload = readFileSync(preloadCjsPath, 'utf8');
  if (!/require\((['"])electron\1\)/.test(preload)) {
    failures.push('preload does not load Electron through CommonJS require()');
  }
}

if (!existsSync(mainPath)) {
  failures.push('missing compiled main process out/main/index.js');
} else {
  const main = readFileSync(mainPath, 'utf8');
  if (main.includes('../preload/index.mjs')) {
    failures.push('compiled windows still reference the incompatible index.mjs preload');
  }
  if (!main.includes('../preload/index.cjs')) {
    failures.push('compiled windows do not reference index.cjs');
  }
  if (!main.includes('sandbox: true')) {
    failures.push('compiled windows no longer enforce renderer sandboxing');
  }
}

if (failures.length > 0) {
  console.error(`Build contract failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Build contract passed: sandboxed windows use the CommonJS preload.');
}

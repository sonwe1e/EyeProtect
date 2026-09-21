import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

/**
 * IPC surface contract: EyeProtectApi ↔ preload ↔ main handleIpc/broadcast.
 * Emergency preload (`src/preload/emergency.ts`) is intentionally out of scope.
 * See docs/architecture.md §IPC 契约扫描.
 */
const root = resolve(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8');

const mainSource = read('src/main/index.ts');
const preloadSource = read('src/preload/index.ts');
const windowsSource = read('src/main/windows.ts');
const typesSource = read('src/shared/types.ts');

function extractHandleIpcChannels(source: string): Set<string> {
  const channels = new Set<string>();
  const pattern = /handleIpc\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) channels.add(match[1]);
  return channels;
}

function extractInvokeChannels(source: string): Set<string> {
  const channels = new Set<string>();
  const pattern = /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) channels.add(match[1]);
  return channels;
}

function extractOnChannels(source: string): Set<string> {
  const channels = new Set<string>();
  const pattern = /on<[^>]*>\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) channels.add(match[1]);
  return channels;
}

function extractMainSendChannels(source: string): Set<string> {
  const channels = new Set<string>();
  const sendTo = /sendTo\(\s*\[[^\]]*\]\s*,\s*['"]([^'"]+)['"]/g;
  const webContents = /webContents\.send\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = sendTo.exec(source)) !== null) channels.add(match[1]);
  while ((match = webContents.exec(source)) !== null) channels.add(match[1]);
  return channels;
}

function extractEyeProtectApiMethods(source: string): Set<string> {
  const start = source.indexOf('export interface EyeProtectApi');
  assert.ok(start >= 0, 'EyeProtectApi must exist in src/shared/types.ts');
  const end = source.indexOf('\nexport ', start + 1);
  const body = source.slice(start, end === -1 ? undefined : end);
  const methods = new Set<string>();
  const pattern = /^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*[:(]/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) methods.add(match[1]);
  return methods;
}

function extractPreloadApiKeys(source: string): Set<string> {
  const start = source.indexOf('const api: EyeProtectApi');
  assert.ok(start >= 0, 'preload must expose const api: EyeProtectApi');
  const body = source.slice(start);
  const keys = new Set<string>();
  const pattern = /^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) keys.add(match[1]);
  return keys;
}

function activeRendererSources(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '_legacy' || entry.name === 'node_modules') continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
  };
  walk(dir);
  return files;
}

function extractActiveApiCalls(files: string[]): Set<string> {
  const methods = new Set<string>();
  const pattern = /window\.eyeProtect\.([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) methods.add(match[1]);
  }
  return methods;
}

test('every preload invoke channel is registered by handleIpc', () => {
  const handled = extractHandleIpcChannels(mainSource);
  const invoked = extractInvokeChannels(preloadSource);
  const missing = [...invoked].filter((channel) => !handled.has(channel)).sort();
  assert.deepEqual(
    missing,
    [],
    `preload invokes channels with no handleIpc registration: ${missing.join(', ')}`
  );
});

test('every handleIpc channel is invoked by preload', () => {
  const handled = extractHandleIpcChannels(mainSource);
  const invoked = extractInvokeChannels(preloadSource);
  const orphan = [...handled].filter((channel) => !invoked.has(channel)).sort();
  assert.deepEqual(
    orphan,
    [],
    `main registers handleIpc channels preload never invokes: ${orphan.join(', ')}`
  );
});

test('every preload on() channel has a main-process sender', () => {
  const listened = extractOnChannels(preloadSource);
  const sent = extractMainSendChannels(windowsSource);
  const missing = [...listened].filter((channel) => !sent.has(channel)).sort();
  assert.deepEqual(
    missing,
    [],
    `preload listens to channels main never sends: ${missing.join(', ')}`
  );
});

test('EyeProtectApi methods and preload api keys match bidirectionally', () => {
  const apiMethods = extractEyeProtectApiMethods(typesSource);
  const preloadKeys = extractPreloadApiKeys(preloadSource);
  const missingInPreload = [...apiMethods].filter((name) => !preloadKeys.has(name)).sort();
  const missingInApi = [...preloadKeys].filter((name) => !apiMethods.has(name)).sort();
  assert.deepEqual(missingInPreload, [], `EyeProtectApi methods missing from preload: ${missingInPreload.join(', ')}`);
  assert.deepEqual(missingInApi, [], `preload api keys missing from EyeProtectApi: ${missingInApi.join(', ')}`);
});

test('active renderer only calls EyeProtectApi methods', () => {
  const apiMethods = extractEyeProtectApiMethods(typesSource);
  const rendererDir = resolve(root, 'src/renderer/src');
  assert.ok(statSync(rendererDir).isDirectory());
  const calls = extractActiveApiCalls(activeRendererSources(rendererDir));
  const unknown = [...calls].filter((name) => !apiMethods.has(name)).sort();
  assert.deepEqual(
    unknown,
    [],
    `active renderer calls window.eyeProtect methods not on EyeProtectApi: ${unknown.join(', ')}`
  );
});

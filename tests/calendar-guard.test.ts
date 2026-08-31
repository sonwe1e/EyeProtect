/**
 * Calendar-day arithmetic guard (USERPLAN 1.2 PR0, §二十一).
 *
 * The Plan timeline used to compute "tomorrow" as `today + 86_400_000`, which
 * drifts an hour across DST boundaries. Civil-time math must go through
 * src/shared/calendar.ts; this test fails if raw ±86_400_000 ms additions
 * creep back into application source. Division (UTC day-number indexing) and
 * test fixtures stay legal.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOTS = ['src'].map((root) => join(REPO_ROOT, root));

/** `+ 86_400_000`, `- 86400000`, `+ 7 * 86_400_000`, etc. — never `/` (day numbers). */
const FORBIDDEN = /[+-]\s*(?:[\w$.()\s]+\*\s*)?86_?400_?000/;

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');

const collectFiles = (root: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      found.push(...collectFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
};

test('no raw ±86_400_000 ms calendar arithmetic outside the calendar module', () => {
  const violations: string[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of collectFiles(root)) {
      if (file.endsWith(`calendar.ts`)) continue; // the sanctioned module
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (FORBIDDEN.test(line)) {
          violations.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Use src/shared/calendar.ts (addLocalDays/startOfLocalDate/…) instead of raw day-ms math:\n${violations.join('\n')}`
  );
});

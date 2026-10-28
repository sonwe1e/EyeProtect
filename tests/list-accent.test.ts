import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { LIST_ACCENT_COUNT, listAccentIndex, listAccentVar } from '../src/renderer/src/features/simple/listAccent';

/**
 * Deterministic list accent mapping (quirk-ui Round 2). The default list gets
 * NO accent (vision R2-0: 无归属 = 无色彩), and the constant is locked to the
 * real theme.css declarations by a source scan.
 */

const repository = resolve(import.meta.dirname, '..');
const themeCss = readFileSync(resolve(repository, 'src/renderer/src/styles/theme.css'), 'utf8');
const tokensCss = readFileSync(resolve(repository, 'src/renderer/src/styles/tokens.css'), 'utf8');

test('the mapping is deterministic and the default list gets no accent', () => {
  for (const id of ['p-1', '项目A', 'x'.repeat(64)]) {
    assert.equal(listAccentIndex(id), listAccentIndex(id), `same id must keep its accent: ${id}`);
  }
  assert.equal(listAccentIndex(null), null, 'the default list must not hash');
  assert.equal(listAccentVar(null), '', 'the default list must have no stripe');
});

test('every accent slot is reachable and no pick leaves the range', () => {
  const seen = new Set<number>();
  for (let n = 0; n < 200; n += 1) {
    const index = listAccentIndex(`p-${n}`);
    assert.ok(index !== null && index >= 0 && index < LIST_ACCENT_COUNT, `accent for p-${n} must stay inside the slot range`);
    seen.add(index);
  }
  assert.equal(seen.size, LIST_ACCENT_COUNT, 'all accents must be reachable, none may degenerate away');
});

test('the css var reference always matches the mapped slot', () => {
  for (let n = 0; n < 20; n += 1) {
    const id = `project-${n}`;
    const index = listAccentIndex(id) as number;
    assert.equal(listAccentVar(id), `var(--list-accent-${index + 1})`);
  }
});

test('theme.css declares exactly LIST_ACCENT_COUNT tokens in each of the three theme blocks', () => {
  const declarations = themeCss.match(/--list-accent-\d+:/g) ?? [];
  for (let slot = 1; slot <= LIST_ACCENT_COUNT; slot += 1) {
    const count = declarations.filter((name) => name === `--list-accent-${slot}:`).length;
    assert.equal(count, 3, `--list-accent-${slot} must appear once in light, dark and system blocks`);
  }
  assert.equal(declarations.length, LIST_ACCENT_COUNT * 3, 'no stray accent declarations may exist');
  assert.equal(/--list-accent-/.test(tokensCss), false, 'tokens.css must not re-declare theme-layer accents');
});

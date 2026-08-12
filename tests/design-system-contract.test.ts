import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

// These contracts protect the UI foundation refactor (USERPLAN 1.2 B1/B4/B8):
// tokens have a single owner, density changes the core work metrics, and the
// Workbench uses a workspace container rather than viewport breakpoints.

const root = resolve(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8');

const tokensCss = read('src/renderer/src/styles/tokens.css');
const themeCss = read('src/renderer/src/styles/theme.css');
const workbenchCss = read('src/renderer/src/styles/workbench.css');

function extractDefinedTokens(source: string): Map<string, string> {
  // Strip block comments so commented-out declarations are not counted.
  const cleaned = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const defined = new Map<string, string>();
  const declaration = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(cleaned)) !== null) {
    defined.set(match[1], match[2].trim());
  }
  return defined;
}

test('tokens.css owns only non-color foundation tokens', () => {
  // tokens.css must not declare any color/surface/brand semantic token — those
  // belong to theme.css. Allowing only spacing, radius, motion, hit targets,
  // control heights, and workbench layout tokens.
  const allowed = new Set([
    '--space-1', '--space-2', '--space-3', '--space-4', '--space-6',
    '--radius-small', '--radius-medium', '--radius-large',
    '--motion-fast', '--motion-standard', '--motion-slow',
    '--hit-target-min', '--control-height-sm', '--control-height-md', '--task-row-height',
    '--workbench-sidebar-width', '--workbench-toolbar-height', '--workbench-content-max',
    '--workbench-page-top', '--workbench-section-gap'
  ]);
  const defined = extractDefinedTokens(tokensCss);
  for (const name of defined.keys()) {
    assert.ok(allowed.has(name), `tokens.css must not own color token ${name}`);
  }
  // The full foundation set must be present.
  for (const name of allowed) {
    assert.ok(defined.has(name), `tokens.css is missing foundation token ${name}`);
  }
});

test('theme.css does not redeclare foundation tokens owned by tokens.css', () => {
  const foundationTokens = [
    '--space-1', '--space-2', '--space-3', '--space-4', '--space-6',
    '--radius-small', '--radius-medium', '--radius-large',
    '--motion-fast', '--motion-standard', '--motion-slow',
    '--hit-target-min', '--control-height-sm', '--control-height-md', '--task-row-height',
    '--workbench-sidebar-width', '--workbench-toolbar-height', '--workbench-content-max',
    '--workbench-page-top', '--workbench-section-gap'
  ];
  const defined = extractDefinedTokens(themeCss);
  for (const name of foundationTokens) {
    assert.ok(!defined.has(name), `theme.css must not redeclare foundation token ${name}`);
  }
});

test('compact density makes the core task row genuinely more compact', () => {
  const compactMatch = tokensCss.match(/\[data-density='compact'\]\s*\{([\s\S]*?)\}/);
  assert.ok(compactMatch, 'tokens.css must define a [data-density=compact] block');
  const compactBlock = compactMatch[1];
  const rowHeight = compactBlock.match(/--task-row-height:\s*(\d+)px/);
  assert.ok(rowHeight, 'compact block must set --task-row-height');
  const compactRow = Number(rowHeight[1]);
  const comfortableMatch = tokensCss.match(/--task-row-height:\s*(\d+)px/);
  assert.ok(comfortableMatch, 'tokens.css must set a default --task-row-height');
  const comfortableRow = Number(comfortableMatch[1]);
  assert.ok(compactRow < comfortableRow, `compact row (${compactRow}) must be smaller than comfortable (${comfortableRow})`);
  assert.ok(compactRow >= 44, `compact row (${compactRow}) must stay >= 44px hit target`);
  assert.ok(comfortableRow >= 52, `comfortable row (${comfortableRow}) must be >= 52px`);
});

test('primary navigation hitbox never shrinks below the 44px target', () => {
  const navMatch = workbenchCss.match(/\.app-nav-item\s*\{([\s\S]*?)\}/);
  assert.ok(navMatch, 'workbench.css must style .app-nav-item');
  const minHeight = navMatch[1].match(/min-height:\s*(\d+)px/);
  assert.ok(minHeight, '.app-nav-item must declare a min-height');
  assert.ok(Number(minHeight[1]) >= 44, `.app-nav-item min-height (${minHeight[1]}px) must be >= 44px`);
});

test('workbench defines a named workspace container', () => {
  assert.ok(/container-type:\s*inline-size/.test(workbenchCss), 'workspace-scroll must set container-type: inline-size');
  assert.ok(/container-name:\s*workspace/.test(workbenchCss), 'workspace-scroll must set container-name: workspace');
});

test('workbench uses at least one @container workspace query', () => {
  const containerQueries = workbenchCss.match(/@container\s+workspace/g) ?? [];
  assert.ok(containerQueries.length >= 1, 'workbench feature CSS must use @container workspace queries');
});

test('no token name is declared in both tokens.css and theme.css', () => {
  const tokenTokens = extractDefinedTokens(tokensCss);
  const themeTokens = extractDefinedTokens(themeCss);
  const shared = [...tokenTokens.keys()].filter((name) => themeTokens.has(name));
  assert.deepEqual(shared, [], `tokens must not be owned by both files: ${shared.join(', ')}`);
});

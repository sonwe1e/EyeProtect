import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

// These contracts protect the UI foundation refactor (USERPLAN 1.2 B1/B4/B8):
// tokens have a single owner, density changes the core work metrics, and the
// Workbench uses a workspace container rather than viewport breakpoints.

// NOTE: token-overlap, nav hitbox, workspace-container, legacy-selector-ban and
// raw-color checks are asserted once in scripts/verify-ui-contract.mjs (CI +
// `npm run verify:ui-contract`). Keeping them in the test file as well meant
// every contract change had to be made in two places, so they live in the
// script only. This file keeps the behavioral contracts the script cannot
// express.

const root = resolve(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8');

const tokensCss = read('src/renderer/src/styles/tokens.css');
const themeCss = read('src/renderer/src/styles/theme.css');
const workbenchCss = read('src/renderer/src/styles/workbench.css');
const legacyCss = read('src/renderer/src/styles.css');
const planCss = read('src/renderer/src/features/tasks/PlanWorkspace.module.css');
const windowsSource = read('src/main/windows.ts');

function cssFilesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? cssFilesIn(path) : entry.name.endsWith('.css') ? [path] : [];
  });
}

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

test('Workbench dimensions stay on the visual-hardening contract', () => {
  const tokens = extractDefinedTokens(tokensCss);
  const rootBlock = tokensCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.equal(tokens.get('--workbench-sidebar-width'), '208px');
  assert.equal(tokens.get('--workbench-toolbar-height'), '52px');
  assert.match(rootBlock, /--workbench-page-top:\s*32px/);
  assert.match(rootBlock, /--workbench-section-gap:\s*24px/);
  assert.equal(tokens.get('--radius-medium'), '8px');
  assert.equal(tokens.get('--radius-large'), '12px');
  assert.match(planCss, /grid-template-columns:\s*minmax\(210px,\s*0\.65fr\)\s+minmax\(430px,\s*1\.35fr\)/);
  assert.match(planCss, /@container\s+workspace\s*\(max-width:\s*600px\)/);
});

test('Workbench selection stays neutral while active navigation icons carry the brand', () => {
  assert.match(workbenchCss, /\.app-nav-item\.is-active[^}]*background:\s*var\(--surface-selected\)/);
  assert.match(workbenchCss, /\.app-nav-item\.is-active svg[^}]*color:\s*var\(--brand\)/);
  assert.match(workbenchCss, /\.task-row\.is-selected[^}]*background:\s*var\(--surface-selected\)/);
});

test('theme changes reach every live renderer window', () => {
  assert.match(
    windowsSource,
    /\[this\.workbenchWindow, this\.petWindow, this\.bubbleWindow, this\.alertWindow\][\s\S]*?'settings:changed'/,
    'settings broadcasts must include Workbench, pet, bubble, and alert renderers'
  );
});

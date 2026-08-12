import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const failures = [];
const requireMatch = (value, pattern, message) => {
  if (!pattern.test(value)) failures.push(message);
};

const theme = read('src/renderer/src/styles/theme.css');
const tokens = read('src/renderer/src/styles/tokens.css');
const primitives = read('src/renderer/src/styles/primitives.css');
const workbench = read('src/renderer/src/styles/workbench.css');
const collection = read('src/renderer/src/styles/collection.css');
const settings = read('src/renderer/src/styles/settings.css');
const plan = read('src/renderer/src/features/tasks/PlanWorkspace.module.css');
const project = read('src/renderer/src/features/tasks/ProjectWorkspace.module.css');
const focus = read('src/renderer/src/features/tasks/FocusSurface.module.css');
const health = read('src/renderer/src/components/AppHealthBanner.module.css');
const manifest = JSON.parse(read('package.json'));
const chrome = [
  read('src/renderer/src/views/WorkbenchView.tsx'),
  read('src/renderer/src/features/tasks/ProjectList.tsx'),
  read('src/renderer/src/components/Button.tsx'),
  read('src/renderer/src/components/Dialog.tsx'),
  read('src/renderer/src/components/SideSheet.tsx'),
  read('src/renderer/src/components/CommandPalette.tsx'),
  read('src/renderer/src/features/tasks/ProjectWorkspace.tsx'),
  read('src/renderer/src/features/tasks/PlanWorkspace.tsx'),
  read('src/renderer/src/features/tasks/TaskDetail.tsx'),
  read('src/renderer/src/features/tasks/FocusSurface.tsx'),
  read('src/renderer/src/components/AppHealthBanner.tsx'),
  read('src/renderer/src/components/primitives/NavItem.tsx'),
  read('src/renderer/src/components/primitives/Field.tsx'),
  read('src/renderer/src/components/primitives/StatusChip.tsx'),
  read('src/renderer/src/components/primitives/Toast.tsx')
].join('\n');

for (const token of [
  '--bg-app', '--bg-sidebar', '--surface', '--surface-hover', '--fg-primary',
  '--fg-secondary', '--brand', '--brand-subtle', '--danger'
]) {
  requireMatch(theme, new RegExp(`${token.replace('-', '\\-')}:`), `Missing semantic token ${token}`);
}

const rawColor = /#[0-9a-f]{3,8}\b|\brgba?\s*\(/i;
for (const [name, source] of [
  ['primitives.css', primitives],
  ['workbench.css', workbench],
  ['collection.css', collection],
  ['settings.css', settings],
  ['PlanWorkspace.module.css', plan],
  ['ProjectWorkspace.module.css', project],
  ['FocusSurface.module.css', focus],
  ['AppHealthBanner.module.css', health]
]) {
  if (rawColor.test(source)) failures.push(`${name} contains a raw color; use a semantic token`);
}

if (/\p{Extended_Pictographic}/u.test(chrome)) {
  failures.push('Product chrome contains an Emoji; use a Lucide icon');
}

for (const [source, label] of [
  [primitives, 'primitives.css'],
  [workbench, 'workbench.css'],
  [collection, 'collection.css'],
  [settings, 'settings.css'],
  [plan, 'PlanWorkspace.module.css'],
  [project, 'ProjectWorkspace.module.css'],
  [focus, 'FocusSurface.module.css'],
  [health, 'AppHealthBanner.module.css']
]) {
  if (/(^|})\s*svg\s*\{[^}]*\b(?:color|stroke|fill)\s*:/m.test(source)) {
    failures.push(`${label} contains a global SVG color rule`);
  }
}

const workbenchSource = read('src/renderer/src/views/WorkbenchView.tsx');
if (/workbench-shell/.test(workbenchSource)) failures.push('Workbench must not inherit the legacy shell stylesheet');
// The navigation contract is asserted against the single source of truth in
// workbench-navigation.ts (covered by tests/workbench-navigation.test.ts). The
// renderer must consume that config rather than re-declaring a nav array.
if (/\bnavItems\s*:\s*Array<\{[\s\S]*?id:\s*'(today|inbox|plan|focus|projects|review)'/.test(workbenchSource)) {
  failures.push('WorkbenchView must not re-declare a nav array; consume workbenchNavigation.ts');
}

requireMatch(workbench, /\.app-nav-item\s*\{[^}]*min-height:\s*44px/s, 'Navigation rows must be at least 44px high');
requireMatch(primitives, /\.ui-icon-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px/s, 'Icon buttons must have a 36px hitbox');
requireMatch(primitives, /\.ui-button\s*\{[^}]*min-height:\s*40px/s, 'Buttons must be at least 40px high');
requireMatch(workbench, /\.workbench-v2 \.task-row\s*\{[^}]*min-height:\s*(52px|var\(--task-row-height\))/s, 'Task rows must exceed the 44px target');
requireMatch(workbench, /@media \(forced-colors: active\)/, 'Workbench must provide a forced-colors treatment');
requireMatch(plan, /touch-action:\s*none/, 'Plan drag handles must support direct pointer manipulation');
requireMatch(primitives, /@media \(prefers-reduced-motion: reduce\)/, 'Motion primitives must honor reduced motion');

// ── Design-system ownership (USERPLAN 1.2 B1/B8) ────────────────────────
// theme.css owns semantic colors; tokens.css owns foundation. The same token
// name must not appear in both. We compare the set of --custom-property names
// each file declares at the top level (inside any selector block).
const declared = (source) => {
  const names = new Set();
  const declaration = /(--[a-z0-9-]+)\s*:/g;
  let m;
  while ((m = declaration.exec(source)) !== null) names.add(m[1]);
  return names;
};
const themeTokens = declared(theme);
const foundationTokens = declared(tokens);
const overlap = [...foundationTokens].filter((name) => themeTokens.has(name));
if (overlap.length) {
  failures.push(`Foundation tokens must not be redeclared in theme.css: ${overlap.join(', ')}`);
}

// Workbench must use a workspace container so feature layouts respond to the
// real content area, not the full window (USERPLAN 1.2 B4).
if (!/container-type:\s*inline-size/.test(workbench)) {
  failures.push('Workbench must define a container-type: inline-size workspace');
}
if (!/container-name:\s*workspace/.test(workbench)) {
  failures.push('Workbench must name its container "workspace"');
}
if (!/@container\s+workspace/.test(workbench)) {
  failures.push('Workbench must use at least one @container workspace query');
}

const iconPath = resolve(root, 'public/assets/app-icon.ico');
if (manifest.build?.win?.icon !== 'public/assets/app-icon.ico') failures.push('Windows packaging must use the branded app icon');
if (!existsSync(iconPath) || statSync(iconPath).size < 1_000) failures.push('Windows app icon is missing or invalid');

// ── Contrast is measured against the ACTUAL theme.css tokens (USERPLAN 1.2 B8).
//    Values are read from the light/dark blocks and resolved through var()
//    references, so a token change is caught here instead of in a hardcoded list.
const hexToRgb = (hex) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const luminance = (hex) => hexToRgb(hex)
  .map((channel) => channel / 255)
  .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

// Pull the declarations out of a `{ … }` block body.
const declarationsIn = (block) => {
  const map = new Map();
  const declaration = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = declaration.exec(block)) !== null) map.set(match[1], match[2].trim());
  return map;
};

// Resolve a token value to a concrete hex, following one level of var() indents.
const resolveHex = (raw, tokens, seen) => {
  const hex = raw.match(/^#([0-9a-f]{3,8})\b/i);
  if (hex) return `#${hex[1]}`;
  const ref = raw.match(/^var\((--[a-z0-9-]+)\)/);
  if (ref && tokens.has(ref[1]) && !seen.has(ref[1])) {
    seen.add(ref[1]);
    return resolveHex(tokens.get(ref[1]), tokens, seen);
  }
  return null;
};

// Each theme block is the full `selector { … }` region for its theme.
const lightBlock = theme.match(/:root,\s*:root\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const darkBlock = theme.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

const light = declarationsIn(lightBlock);
const dark = declarationsIn(darkBlock);

const lightBg = resolveHex(light.get('--bg-app'), light, new Set());
const darkBg = resolveHex(dark.get('--bg-app'), dark, new Set());
if (!lightBg) failures.push('theme.css light block must define --bg-app');
if (!darkBg) failures.push('theme.css dark block must define --bg-app');

const cases = [
  ['light primary', light, '--fg-primary', lightBg, 4.5],
  ['light secondary', light, '--fg-secondary', lightBg, 4.5],
  ['light brand graphical', light, '--brand', lightBg, 3],
  ['dark primary', dark, '--fg-primary', darkBg, 4.5],
  ['dark secondary', dark, '--fg-secondary', darkBg, 4.5],
  ['dark brand graphical', dark, '--brand', darkBg, 3]
];
for (const [label, tokens, fgToken, bg, minimum] of cases) {
  const fg = resolveHex(tokens.get(fgToken), tokens, new Set());
  if (!fg) {
    failures.push(`${label} contrast: could not resolve ${fgToken} to a hex value`);
    continue;
  }
  const ratio = contrast(fg, bg);
  if (ratio < minimum) failures.push(`${label} contrast ${ratio.toFixed(2)} is below ${minimum}:1`);
}

if (failures.length) {
  console.error('UI contract verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('UI contract verified: semantic colors, navigation, hit targets, accessibility modes, and contrast.');

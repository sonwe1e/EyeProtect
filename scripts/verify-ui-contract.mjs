import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const failures = [];
const requireMatch = (value, pattern, message) => {
  if (!pattern.test(value)) failures.push(message);
};

const theme = read('src/renderer/src/styles/theme.css');
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
const navBlock = workbenchSource.match(/const navItems:[\s\S]*?= \[([\s\S]*?)\n  \];/)?.[1] ?? '';
const navIds = navBlock.match(/\{ id: '(today|inbox|plan|focus|projects)',/g) ?? [];
if (navIds.length !== 5) failures.push(`Primary navigation must contain exactly 5 destinations; found ${navIds.length}`);

requireMatch(workbench, /\.app-nav-item\s*\{[^}]*min-height:\s*44px/s, 'Navigation rows must be at least 44px high');
requireMatch(primitives, /\.ui-icon-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px/s, 'Icon buttons must have a 36px hitbox');
requireMatch(primitives, /\.ui-button\s*\{[^}]*min-height:\s*40px/s, 'Buttons must be at least 40px high');
requireMatch(workbench, /\.workbench-v2 \.task-row\s*\{[^}]*min-height:\s*52px/s, 'Task rows must exceed the 44px target');
requireMatch(workbench, /@media \(forced-colors: active\)/, 'Workbench must provide a forced-colors treatment');
requireMatch(plan, /touch-action:\s*none/, 'Plan drag handles must support direct pointer manipulation');
requireMatch(primitives, /@media \(prefers-reduced-motion: reduce\)/, 'Motion primitives must honor reduced motion');

const iconPath = resolve(root, 'public/assets/app-icon.ico');
if (manifest.build?.win?.icon !== 'public/assets/app-icon.ico') failures.push('Windows packaging must use the branded app icon');
if (!existsSync(iconPath) || statSync(iconPath).size < 1_000) failures.push('Windows app icon is missing or invalid');

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

for (const [label, foreground, background, minimum] of [
  ['light primary', '#1b211f', '#f7f8f6', 4.5],
  ['light secondary', '#66706c', '#f7f8f6', 4.5],
  ['light brand graphical', '#2e6f61', '#f7f8f6', 3],
  ['dark primary', '#ecf1ee', '#111614', 4.5],
  ['dark secondary', '#a7b2ac', '#111614', 4.5],
  ['dark brand graphical', '#7fc1a6', '#111614', 3]
]) {
  const ratio = contrast(foreground, background);
  if (ratio < minimum) failures.push(`${label} contrast ${ratio.toFixed(2)} is below ${minimum}:1`);
}

if (failures.length) {
  console.error('UI contract verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('UI contract verified: semantic colors, navigation, hit targets, accessibility modes, and contrast.');

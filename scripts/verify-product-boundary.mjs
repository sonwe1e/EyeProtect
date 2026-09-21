import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Product-boundary lint (docs/architecture.md §产品边界 lint).
 * - No archived _legacy / scripts/legacy trees
 * - Active sources never import those paths
 * - User-visible mutations on window.eyeProtect go through run/useCommand
 */
const root = resolve(import.meta.dirname, '..');
const failures = [];

for (const banned of ['src/renderer/src/_legacy', 'scripts/legacy']) {
  if (existsSync(resolve(root, banned))) {
    failures.push(`${banned} must not exist (legacy surface deleted)`);
  }
}

const MUTATIONS = new Set([
  'createTask', 'updateTask', 'setTaskStatus', 'deleteTask', 'moveTask',
  'undoTaskOperation', 'setActiveTask', 'completeTaskTree', 'moveStep', 'createStep',
  'createProject', 'updateProject', 'deleteProject',
  'retryFailedDelivery', 'dismissFailedDelivery',
  'reminderAction', 'beginHealthRest', 'testReminder', 'triggerNow',
  'pause', 'resume', 'restartCycle', 'preAlertAction',
  'saveSettings', 'exportBackup', 'importBackup', 'resetToDefaults', 'openDataDirectory',
  'restoreLegacyTask', 'openCustomPetFolder', 'relaunchApp',
  'preparePomodoro', 'startPomodoro', 'pomodoroAction'
]);

const CHROME_OR_READ = /^(get|on|report)/;

function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '_legacy') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, acc);
    else if (/\.(ts|tsx|mjs|css)$/.test(entry.name)) acc.push(path);
  }
  return acc;
}

const activeRoots = [
  resolve(root, 'src'),
  resolve(root, 'scripts'),
  resolve(root, 'tests')
];

for (const dir of activeRoots) {
  if (!existsSync(dir)) continue;
  for (const file of sourceFiles(dir)) {
    const rel = relative(root, file).replaceAll('\\', '/');
    const source = readFileSync(file, 'utf8');
    if (/_legacy\//.test(source) || source.includes('scripts/legacy')) {
      // The verify script itself and docs/tests may mention the ban; allow those names in comments only.
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/_legacy\//.test(stripped) || /scripts\/legacy/.test(stripped)) {
        if (!rel.startsWith('scripts/verify-product-boundary') && !rel.startsWith('tests/')) {
          failures.push(`${rel} references legacy paths`);
        }
      }
    }

    if (!/\.(ts|tsx)$/.test(rel) || !rel.startsWith('src/renderer/src/')) continue;
    if (rel.endsWith('lib/commands.ts')) continue;

    const pattern = /window\.eyeProtect\.([A-Za-z_][A-Za-z0-9_]*)/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const method = match[1];
      if (CHROME_OR_READ.test(method)) continue;
      if (!MUTATIONS.has(method)) continue;
      const before = source.slice(Math.max(0, match.index - 280), match.index);
      if (!/\brun\s*\(/.test(before)) {
        failures.push(`${rel} calls window.eyeProtect.${method} outside run/useCommand`);
      }
    }
  }
}

if (failures.length) {
  console.error('Product boundary verification failed:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('Product boundary verified: no legacy trees, mutations use the command layer.');

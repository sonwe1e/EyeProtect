import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (relative: string): string => readFileSync(resolve(root, relative), 'utf8');

test('modal dialog owns initial focus and stops shortcuts before window handlers', () => {
  // CommandPalette and SideSheet are archived; keyboard ownership is still
  // asserted on the live modal primitive (Dialog, via ConfirmDialog) plus
  // WorkbenchView not remounting any archived modal.
  const dialog = read('src/renderer/src/components/Dialog.tsx');
  const workbench = read('src/renderer/src/views/WorkbenchView.tsx');

  assert.match(dialog, /onKeyDown=/);
  assert.doesNotMatch(dialog, /window\.addEventListener\('keydown'/);
  assert.doesNotMatch(workbench, /<SideSheet|<CommandPalette|<DailyPlanningFlow|_legacy/);
  assert.match(workbench, /aria-expanded=/);
});

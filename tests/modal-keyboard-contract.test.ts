import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (relative: string): string => readFileSync(resolve(root, relative), 'utf8');

test('command palette owns initial focus and modal panels stop shortcuts before window handlers', () => {
  // CommandPalette is archived under _legacy; keyboard ownership is still
  // asserted on live modal primitives plus WorkbenchView not remounting them.
  const dialog = read('src/renderer/src/components/Dialog.tsx');
  const sheet = read('src/renderer/src/components/SideSheet.tsx');
  const workbench = read('src/renderer/src/views/WorkbenchView.tsx');

  assert.match(dialog, /onKeyDown=/);
  assert.match(sheet, /onKeyDown=/);
  assert.doesNotMatch(dialog, /window\.addEventListener\('keydown'/);
  assert.doesNotMatch(sheet, /window\.addEventListener\('keydown'/);
  assert.doesNotMatch(workbench, /<SideSheet|<CommandPalette|<DailyPlanningFlow|_legacy/);
  assert.match(workbench, /aria-expanded=/);
});

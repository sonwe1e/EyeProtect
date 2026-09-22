import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PRIMARY_WORKBENCH_SECTIONS, UTILITY_WORKBENCH_SECTIONS, WORKBENCH_SECTIONS } from '../src/renderer/src/features/workbench/workbenchNavigation';
test('simplified workbench exposes only tasks, completion history and settings', () => {
  assert.deepEqual(PRIMARY_WORKBENCH_SECTIONS, ['today', 'review']);
  assert.deepEqual(UTILITY_WORKBENCH_SECTIONS, ['settings']);
  assert.deepEqual(Object.keys(WORKBENCH_SECTIONS).sort(), ['review', 'settings', 'today']);
  const source = readFileSync(new URL('../src/renderer/src/views/WorkbenchView.tsx', import.meta.url), 'utf8');
  assert.match(source, /PRIMARY_WORKBENCH_SECTIONS.map/);
  assert.doesNotMatch(source, /WorkbenchSidebar|FocusSurface|DailyPlanningFlow|PlanWorkspace|_legacy/);
});

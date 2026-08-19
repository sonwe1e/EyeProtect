import assert from 'node:assert/strict';
import test from 'node:test';
import { getWorkbenchBackgroundColor } from '../src/main/workbenchTheme';

test('explicit workbench themes ignore the operating-system preference', () => {
  assert.equal(getWorkbenchBackgroundColor('light', true), '#f7f8f6');
  assert.equal(getWorkbenchBackgroundColor('dark', false), '#111614');
});

test('system workbench theme follows the operating-system preference', () => {
  assert.equal(getWorkbenchBackgroundColor('system', false), '#f7f8f6');
  assert.equal(getWorkbenchBackgroundColor('system', true), '#111614');
});

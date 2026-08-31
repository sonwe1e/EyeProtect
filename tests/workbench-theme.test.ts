import assert from 'node:assert/strict';
import test from 'node:test';
import { getWorkbenchBackgroundColor } from '../src/main/workbenchTheme';

test('explicit workbench themes ignore the operating-system preference', () => {
  assert.equal(getWorkbenchBackgroundColor('light', true), '#f5f6f7');
  assert.equal(getWorkbenchBackgroundColor('dark', false), '#111518');
});

test('system workbench theme follows the operating-system preference', () => {
  assert.equal(getWorkbenchBackgroundColor('system', false), '#f5f6f7');
  assert.equal(getWorkbenchBackgroundColor('system', true), '#111518');
});

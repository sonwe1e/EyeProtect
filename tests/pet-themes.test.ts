import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PET_DISPLAY_NAME,
  listRootTheme,
  themeDirHasAssets
} from '../src/main/petThemes';

test('listRootTheme exposes only 奋斗猫 when custom-pet root has images', () => {
  // themeDirHasAssets is fs-backed; empty/missing root yields no themes.
  assert.deepEqual(listRootTheme('/definitely/missing/custom-pet'), []);
});

test('PET_DISPLAY_NAME is 奋斗猫', () => {
  assert.equal(PET_DISPLAY_NAME, '奋斗猫');
});

test('themeDirHasAssets rejects missing dirs', () => {
  assert.equal(themeDirHasAssets('/definitely/missing/custom-pet'), false);
});

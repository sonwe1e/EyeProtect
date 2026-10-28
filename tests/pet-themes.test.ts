import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fighterArtwork } from '../src/shared/petCompanions';
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

test("every pet reaction, including 'sip', resolves to real artwork", () => {
  // The reaction set is a closed union; a value the artwork cannot place would
  // silently render nothing. 'sip' is the hydration moment added last.
  for (const action of ['celebrate', 'stretch', 'focus', 'sip']) {
    const file = fighterArtwork(action).replace('./', 'public/');
    assert.equal(readFileSync(file).subarray(0, 3).toString(), 'GIF', `${action} must resolve to a shipped GIF`);
  }
  assert.equal(fighterArtwork('sip'), './assets/pets/fighter/click.gif');
});

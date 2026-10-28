import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PET_COMPANIONS, fighterArtwork, isPetCompanion } from '../src/shared/petCompanions';
import { sanitizeSettings } from '../src/main/settings';
import { sipWaterLevel } from '../src/renderer/src/features/characters/PixelAnimal';

test('original animated companion is available on a clean installation', () => {
  assert.equal(sanitizeSettings({}).petCompanion, 'fighter');
  for (const action of ['idle', 'react', 'stretch', 'sleep']) {
    const file = fighterArtwork(action).replace('./', 'public/');
    assert.equal(readFileSync(file).subarray(0, 3).toString(), 'GIF');
  }
  assert.equal(fighterArtwork('focus'), './assets/pets/fighter/idle.gif');
  assert.equal(fighterArtwork('gaze'), './assets/pets/fighter/sleep.gif');
});

test('companion and independent reading size sanitize defaults, bounds and bad values', () => {
  for (const companion of PET_COMPANIONS) {
    assert.ok(isPetCompanion(companion));
    assert.equal(sanitizeSettings({ petCompanion: companion }).petCompanion, companion);
  }
  assert.equal(isPetCompanion('some/path'), false);
  assert.equal(sanitizeSettings({ petCompanion: 'missing' } as never).petCompanion, 'fighter');
  assert.equal(sanitizeSettings({ restReadingScale: 9 }).restReadingScale, 1.5);
  assert.equal(sanitizeSettings({ restReadingScale: .1 }).restReadingScale, .9);
  for (const value of [undefined, null, '', false, Number.NaN]) {
    assert.equal(sanitizeSettings({ restReadingScale: value } as never).restReadingScale, 1);
  }
});

test('a sip degrades to the generic click reaction for the GIF companion', () => {
  // The animated GIF set has no glass, so the moment borrows the click clip
  // instead of falling back to a motionless idle frame (B2 degradation rule).
  assert.equal(fighterArtwork('sip'), './assets/pets/fighter/click.gif');
});

test('the sip glass empties in three steps and falls back outside the frame range', () => {
  // 12 frames × 216ms ≈ the 2.6s the main process allows for the sip.
  assert.deepEqual(
    [...Array(12).keys()].map((frame) => sipWaterLevel(frame)),
    [3, 3, 3, 3, 2, 2, 2, 1, 1, 1, 0, 0]
  );
  // `motion: false` holds frame 0, i.e. a full glass held still.
  assert.equal(sipWaterLevel(0), 3);
  for (const frame of [-1, 12, 99, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(sipWaterLevel(frame), 0, `frame ${frame} must not invent a level`);
  }
});

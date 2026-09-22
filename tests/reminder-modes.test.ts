import assert from 'node:assert/strict';
import test from 'node:test';
import { REMINDER_MODES } from '../src/shared/types';
import type { ReminderMode } from '../src/shared/types';
import {
  reminderDimsDesktopForMode,
  reminderEnforcesRestWait,
  reminderSurfaceForMode
} from '../src/shared/reminderModes';
import { sanitizeSettings } from '../src/main/settings';

// ── F06: the three reminder modes advertised in Settings are real, distinct
// runtime policies — not decorative options. The mappings below are what the
// window layer (AppWindows) and the reminder scheduler actually execute, so a
// mode without an entry here would be an option that silently does nothing.

test('every advertised reminder mode has a distinct surface policy', () => {
  assert.deepEqual([...REMINDER_MODES].sort(), ['focused', 'gentle', 'guided']);

  const surfaces = REMINDER_MODES.map((mode) => reminderSurfaceForMode(mode));
  assert.deepEqual(surfaces, ['bubble', 'alert', 'alert'], 'gentle lives in the bubble; guided/focused in the alert window');
  assert.equal(new Set(surfaces).size >= 2, true, 'the modes do not all collapse onto one surface');

  // Dimming is exclusive to the immersive mask.
  assert.equal(reminderDimsDesktopForMode('focused'), true);
  assert.equal(reminderDimsDesktopForMode('guided'), false);
  assert.equal(reminderDimsDesktopForMode('gentle'), false);

  // The rest wait is exclusive to the immersive mask too.
  assert.equal(reminderEnforcesRestWait('focused'), true);
  assert.equal(reminderEnforcesRestWait('guided'), false);
  assert.equal(reminderEnforcesRestWait('gentle'), false);
});

test('the enforced-wait policy matches the scheduler unlock behaviour', () => {
  for (const mode of REMINDER_MODES) {
    assert.equal(
      reminderEnforcesRestWait(mode),
      mode === 'focused',
      `${mode}: only focused keeps the wait`
    );
  }
});

// ── old-field read compatibility ─────────────────────────────────────────────

test('reminderMode survives sanitizing for every advertised value', () => {
  for (const mode of REMINDER_MODES) {
    assert.equal(sanitizeSettings({ reminderMode: mode }).reminderMode, mode);
  }
});

test('an unknown or missing reminderMode falls back instead of breaking the load', () => {
  assert.equal(sanitizeSettings({}).reminderMode, 'focused', 'default');
  assert.equal(sanitizeSettings({ reminderMode: 'nonsense' as ReminderMode }).reminderMode, 'focused');
  assert.equal(sanitizeSettings({ reminderMode: undefined }).reminderMode, 'focused');
});

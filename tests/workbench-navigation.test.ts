import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRIMARY_WORKBENCH_SECTIONS,
  UTILITY_WORKBENCH_SECTIONS,
  PRIMARY_SECTION_ORDER,
  UTILITY_SECTION_ORDER,
  WORKBENCH_SECTIONS,
  WORKBENCH_SHORTCUTS,
  isPrimarySection,
  isUtilitySection,
  type WorkbenchSectionId
} from '../src/renderer/src/features/workbench/workbenchNavigation';

test('workbench primary IA is intentionally limited to five destinations', () => {
  assert.deepEqual(PRIMARY_WORKBENCH_SECTIONS, [
    'today', 'inbox', 'plan', 'focus', 'projects'
  ]);
  assert.equal(new Set(PRIMARY_WORKBENCH_SECTIONS).size, 5);
});

test('primary order matches the canonical primary array exactly', () => {
  assert.deepEqual(PRIMARY_SECTION_ORDER, PRIMARY_WORKBENCH_SECTIONS);
});

test('review is a utility/secondary destination, not a primary work surface', () => {
  assert.ok(!PRIMARY_WORKBENCH_SECTIONS.includes('review' as never));
  assert.ok(UTILITY_WORKBENCH_SECTIONS.includes('review'));
  assert.equal(WORKBENCH_SECTIONS.review.tier, 'utility');
});

test('every primary and utility section has complete metadata', () => {
  const all = [...PRIMARY_WORKBENCH_SECTIONS, ...UTILITY_WORKBENCH_SECTIONS];
  assert.equal(new Set(all).size, all.length, 'section IDs must be unique');
  for (const id of all) {
    const meta = WORKBENCH_SECTIONS[id as WorkbenchSectionId];
    assert.ok(meta, `missing metadata for ${id}`);
    assert.equal(meta.id, id);
    assert.ok(meta.label.length > 0, `${id} must have a label`);
    assert.ok(meta.iconKey.length > 0, `${id} must have an iconKey`);
    assert.ok(['primary', 'utility'].includes(meta.tier), `${id} must have a valid tier`);
  }
});

test('utility order matches the canonical utility array exactly', () => {
  assert.deepEqual(UTILITY_SECTION_ORDER, UTILITY_WORKBENCH_SECTIONS);
});

test('isPrimarySection / isUtilitySection partition the sections', () => {
  assert.ok(isPrimarySection('today'));
  assert.ok(!isPrimarySection('review'));
  assert.ok(isUtilitySection('review'));
  assert.ok(!isUtilitySection('today'));
});

test('shortcuts are single lower-case characters', () => {
  const entries = Object.entries(WORKBENCH_SHORTCUTS);
  for (const [name, key] of entries) {
    assert.equal(key.length, 1, `shortcut ${name} must be a single character`);
    assert.equal(key, key.toLocaleLowerCase(), `shortcut ${name} must be lower-case`);
  }
  assert.equal(new Set(entries.map(([, key]) => key)).size, entries.length, 'shortcut keys must be unique');
});

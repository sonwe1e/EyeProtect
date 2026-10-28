import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_DONE_NOTE_LINES,
  ALL_DONE_TITLE_LINES,
  EMPTY_TITLE_LINES,
  META_DONE_PHRASES,
  META_EMPTY_LINES,
  META_OPEN_PHRASES,
  allDoneQueueCopy,
  emptyQueueTitle,
  queueMetaCopy
} from '../src/renderer/src/features/simple/queueCopy';

/**
 * ux interaction-spec §8: queue copy pools, caps and rotation keys. Rotation
 * keys carry ONLY `slot|${todayKey}` — never queue length or task ids (§8.4),
 * so finishing a task can never rotate a line mid-day.
 */

const dayAt = (monthDay: number): string => `2026-05-${String(monthDay).padStart(2, '0')}`;

test('every queue pool line meets the quirk constraints and §8.4 caps', () => {
  const pools: Array<{ lines: readonly string[]; max: number; label: string }> = [
    { lines: META_EMPTY_LINES, max: 10, label: 'queueMeta empty' },
    { lines: META_OPEN_PHRASES, max: 6, label: 'queueMeta open phrase' },
    { lines: META_DONE_PHRASES, max: 7, label: 'queueMeta done phrase' },
    { lines: EMPTY_TITLE_LINES, max: 8, label: 'empty title' },
    { lines: ALL_DONE_TITLE_LINES, max: 10, label: 'all-done title' },
    { lines: ALL_DONE_NOTE_LINES, max: 20, label: 'all-done note' }
  ];
  const noEmoji = /\p{Extended_Pictographic}/u;
  for (const { lines, max, label } of pools) {
    assert.ok(lines.length > 0, `${label} pool must not be empty`);
    assert.equal(new Set(lines).size, lines.length, `${label} pool must not repeat a line`);
    for (const line of lines) {
      assert.ok(line.length > 0, `${label} line must be non-empty`);
      assert.equal(noEmoji.test(line), false, `${label} line must not contain an emoji: ${line}`);
      assert.ok(line.length <= max, `${label} line must be ≤${max} chars: ${line}`);
    }
  }
});

test('meta templates keep numbers and status words fixed, only the phrase rotates', () => {
  const open = queueMetaCopy({ total: 3, open: 2, dayKey: dayAt(1) });
  assert.match(open, /^2 件 · /, 'open slot must keep the `N 件 · ` template');
  assert.ok(META_OPEN_PHRASES.includes(open.slice('2 件 · '.length)), 'the rotating part must be a pool phrase');
  const done = queueMetaCopy({ total: 3, open: 0, dayKey: dayAt(1) });
  assert.match(done, /^都做完了 · /, 'done slot must keep the 都做完了 prefix');
  assert.ok(META_DONE_PHRASES.includes(done.slice('都做完了 · '.length)), 'the rotating part must be a pool phrase');
  assert.ok(META_EMPTY_LINES.includes(queueMetaCopy({ total: 0, open: 0, dayKey: dayAt(1) })), 'empty slot is a whole-line pool');
});

test('same key keeps its line; counts and ids never enter the rotation key', () => {
  // Same day, different queue shapes: the rotating phrase must not move.
  const phraseOf = (meta: string, prefix: string): string => meta.slice(prefix.length);
  assert.equal(
    phraseOf(queueMetaCopy({ total: 2, open: 1, dayKey: dayAt(3) }), '1 件 · '),
    phraseOf(queueMetaCopy({ total: 9, open: 7, dayKey: dayAt(3) }), '7 件 · ')
  );
  assert.equal(emptyQueueTitle(dayAt(3)), emptyQueueTitle(dayAt(3)));
  assert.deepEqual(allDoneQueueCopy(dayAt(3)), allDoneQueueCopy(dayAt(3)));
});

test('adjacent day keys can rotate the line: same key stable, neighbour key free to change', () => {
  // Deterministic rotation (§8.4): find an adjacent-day pair whose empty-slot
  // line actually differs, within a month of fixed dates. A miss would mean the
  // pool degenerated to a single effective line.
  let rotated = false;
  for (let day = 1; day < 28; day += 1) {
    if (emptyQueueTitle(dayAt(day)) !== emptyQueueTitle(dayAt(day + 1))) {
      rotated = true;
      break;
    }
  }
  assert.ok(rotated, 'some adjacent-day pair must rotate the empty-slot line');
  // …and no slot may be stuck on one line across a 60-day sweep.
  const distinct = (pick: (key: string) => string): number => new Set(Array.from({ length: 60 }, (_unused, index) => pick(dayAt(index + 1)))).size;
  assert.ok(distinct((key) => queueMetaCopy({ total: 0, open: 0, dayKey: key })) >= 2, 'meta empty slot must rotate');
  assert.ok(distinct((key) => queueMetaCopy({ total: 4, open: 2, dayKey: key })) >= 2, 'meta open phrase must rotate');
  assert.ok(distinct((key) => queueMetaCopy({ total: 4, open: 0, dayKey: key })) >= 2, 'meta done phrase must rotate');
  assert.ok(distinct(emptyQueueTitle) >= 2, 'empty title must rotate');
  assert.ok(distinct((key) => allDoneQueueCopy(key).title) >= 2, 'all-done title must rotate');
  assert.ok(distinct((key) => allDoneQueueCopy(key).note) >= 2, 'all-done note must rotate');
});

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ReminderTrace, noopReminderTrace, type ReminderTraceEntry } from '../src/main/scheduling/reminderTrace';

const makeDir = (): string => mkdtempSync(join(tmpdir(), 'eyeprotect-trace-'));

const entry = (overrides: Partial<ReminderTraceEntry> = {}): ReminderTraceEntry => ({
  t: 1_000,
  src: 'kernel',
  event: 'scheduled',
  ...overrides
});

test('append + flush writes one JSON line per entry', () => {
  const dir = makeDir();
  try {
    const trace = new ReminderTrace(dir);
    trace.append(entry({ event: 'scheduled', data: { kind: 'eye' } }));
    trace.append(entry({ t: 2_000, src: 'scheduler', event: 'gate' }));
    trace.flush();
    const raw = readFileSync(join(dir, 'reminder-trace.log'), 'utf8');
    const lines = raw.trim().split('\n');
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]) as ReminderTraceEntry;
    assert.equal(first.event, 'scheduled');
    assert.deepEqual(first.data, { kind: 'eye' });
    const second = JSON.parse(lines[1]) as ReminderTraceEntry;
    assert.equal(second.src, 'scheduler');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flush with an empty buffer writes nothing', () => {
  const dir = makeDir();
  try {
    const trace = new ReminderTrace(dir);
    trace.flush();
    assert.equal(existsSync(join(dir, 'reminder-trace.log')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recent() flushes pending buffer and returns newest entries last', () => {
  const dir = makeDir();
  try {
    const trace = new ReminderTrace(dir);
    for (let i = 1; i <= 5; i += 1) {
      trace.append(entry({ t: i * 1_000, event: `e${i}` }));
    }
    // Do NOT flush manually: recent() must flush the buffered entries itself.
    const recent = trace.recent(3);
    assert.equal(recent.length, 3);
    assert.deepEqual(recent.map((e) => e.event), ['e3', 'e4', 'e5']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recent() on a missing file returns an empty array', () => {
  const dir = makeDir();
  try {
    const trace = new ReminderTrace(dir);
    assert.deepEqual(trace.recent(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupted line is skipped by recent() (self-describing log stays usable)', () => {
  const dir = makeDir();
  try {
    const file = join(dir, 'reminder-trace.log');
    writeFileSync(file, '{"t":1,"src":"kernel","event":"ok"}\nNOT-JSON\n{"t":2,"src":"kernel","event":"ok2"}\n', 'utf8');
    const trace = new ReminderTrace(dir);
    const recent = trace.recent(10);
    assert.deepEqual(recent.map((e) => e.event), ['ok', 'ok2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('over-limit file rotates to .prev before appending', () => {
  const dir = makeDir();
  try {
    const file = join(dir, 'reminder-trace.log');
    // Exceed the 1 MB cap with a single line.
    writeFileSync(file, 'x'.repeat(1024 * 1024 + 64), 'utf8');
    const trace = new ReminderTrace(dir);
    trace.append(entry({ event: 'after-rotate' }));
    trace.flush();
    // Original content moved to .prev; the new line lives in the fresh log.
    assert.equal(existsSync(`${file}.prev`), true);
    const raw = readFileSync(file, 'utf8');
    assert.equal(raw.includes('after-rotate'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('noopReminderTrace is inert', () => {
  assert.deepEqual(noopReminderTrace.recent(), []);
  assert.doesNotThrow(() => {
    noopReminderTrace.append({ t: 1, src: 'kernel', event: 'x' });
    noopReminderTrace.flush();
  });
});

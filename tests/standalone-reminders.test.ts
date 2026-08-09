import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SchedulerKernel } from '../src/main/scheduling/kernel';
import { StandaloneReminderService } from '../src/main/standaloneReminders';
import { TaskStore } from '../src/main/taskStore';
import {
  nextStandaloneReminderFireAt,
  sanitizeStandaloneReminderSchedule,
  type StandaloneReminder
} from '../src/shared/types';

const NOW = new Date(2026, 6, 8, 10, 0, 0, 0).getTime();

const withService = (
  run: (service: StandaloneReminderService, store: TaskStore, kernel: SchedulerKernel, clock: { now: number }) => void
): void => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-standalone-'));
  const clock = { now: NOW };
  const kernel = new SchedulerKernel({
    clock: { now: () => clock.now, monotonic: () => clock.now },
    watchdogIntervalMs: 60_000
  });
  const store = new TaskStore(dir);
  const service = new StandaloneReminderService(store, kernel, () => clock.now);
  try {
    kernel.start();
    run(service, store, kernel, clock);
  } finally {
    service.dispose();
    kernel.stop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

test('standalone schedule sanitizer supports once, daily, weekdays, weekly and custom', () => {
  assert.deepEqual(sanitizeStandaloneReminderSchedule({ type: 'once', fireAt: NOW }), {
    type: 'once', fireAt: NOW
  });
  assert.deepEqual(sanitizeStandaloneReminderSchedule({ type: 'daily', hour: 9, minute: 30 }), {
    type: 'daily', hour: 9, minute: 30
  });
  assert.deepEqual(sanitizeStandaloneReminderSchedule({ type: 'weekdays', hour: 9, minute: 30 }), {
    type: 'weekdays', hour: 9, minute: 30
  });
  assert.deepEqual(
    sanitizeStandaloneReminderSchedule({ type: 'weekly', weekdays: [5, 1, 5], hour: 9, minute: 30 }),
    { type: 'weekly', weekdays: [1, 5], hour: 9, minute: 30 }
  );
  assert.deepEqual(
    sanitizeStandaloneReminderSchedule({ type: 'custom', anchorAt: NOW, intervalDays: 3 }),
    { type: 'custom', anchorAt: NOW, intervalDays: 3 }
  );
  assert.equal(sanitizeStandaloneReminderSchedule({ type: 'weekly', weekdays: [], hour: 9, minute: 30 }), null);
});

test('custom recurrence advances by local calendar days and retains its wall-clock time', () => {
  const anchor = new Date(2026, 2, 7, 9, 45, 0, 0).getTime();
  const reference = new Date(2026, 2, 10, 12, 0, 0, 0).getTime();
  const next = nextStandaloneReminderFireAt({ type: 'custom', anchorAt: anchor, intervalDays: 2 }, reference);
  assert.ok(next);
  const result = new Date(next!);
  assert.equal(result.getHours(), 9);
  assert.equal(result.getMinutes(), 45);
  assert.equal(result.getDate(), 11);
});

test('a once reminder persists, fires through the shared kernel, then is deleted', () => {
  withService((service, store, kernel, clock) => {
    let fired: StandaloneReminder | null = null;
    service.on('fired', (reminder: StandaloneReminder) => {
      fired = reminder;
    });
    service.create({ label: '喝水', schedule: { type: 'once', fireAt: NOW + 1_000 } });

    assert.equal(store.getScheduledEvents('standalone').length, 1);
    clock.now += 1_000;
    kernel.reconcile();

    assert.equal(fired?.label, '喝水');
    assert.deepEqual(service.list(), []);
    assert.deepEqual(store.getScheduledEvents('standalone'), []);
  });
});

test('editing a reminder invalidates its old durable occurrence', () => {
  withService((service, store) => {
    const [created] = service.create({
      label: '旧时间',
      schedule: { type: 'once', fireAt: NOW + 10_000 }
    });
    assert.equal(store.getScheduledEvents('standalone')[0].fireAt, NOW + 10_000);

    service.update(created.id, {
      label: '新时间',
      schedule: { type: 'once', fireAt: NOW + 20_000 }
    });
    assert.equal(store.getScheduledEvents('standalone')[0].fireAt, NOW + 20_000);
  });
});

test('a persisted overdue occurrence is reconciled once after restart', () => {
  withService((service, store, kernel, clock) => {
    service.create({ label: '重启恢复', schedule: { type: 'once', fireAt: NOW + 1_000 } });
    service.suspend();
    clock.now += 10_000;
    let fireCount = 0;
    service.on('fired', () => {
      fireCount += 1;
    });
    service.resume();
    kernel.reconcile();
    kernel.reconcile();
    assert.equal(fireCount, 1);
    assert.deepEqual(store.getScheduledEvents('standalone'), []);
  });
});

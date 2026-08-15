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

test('custom schedule sanitizer rejects out-of-range interval days', () => {
  // The UI clamps to 1–365; anything beyond must be rejected (not silently
  // coerced), so an invalid create surfaces as a validation error instead of
  // pretending a reminder was created.
  assert.equal(
    sanitizeStandaloneReminderSchedule({ type: 'custom', anchorAt: NOW, intervalDays: 366 }),
    null
  );
  assert.equal(
    sanitizeStandaloneReminderSchedule({ type: 'custom', anchorAt: NOW, intervalDays: 0 }),
    null
  );
  assert.equal(
    sanitizeStandaloneReminderSchedule({ type: 'custom', anchorAt: NOW, intervalDays: 2.5 }),
    null
  );
  assert.deepEqual(
    sanitizeStandaloneReminderSchedule({ type: 'custom', anchorAt: NOW, intervalDays: 365 }),
    { type: 'custom', anchorAt: NOW, intervalDays: 365 }
  );
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

test('weekly next-fire with no weekdays produces nothing (defensive)', () => {
  // The sanitizer rejects empty weekly weekdays, but the pure helper must not
  // loop forever or fabricate a deadline when called with such a schedule.
  assert.equal(
    nextStandaloneReminderFireAt({ type: 'weekly', weekdays: [], hour: 9, minute: 0 }, NOW),
    null
  );
});

test('a once reminder is deleted only after delivery acknowledgement', () => {
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
    assert.equal(service.list().length, 1, 'unacknowledged occurrence stays durable');
    service.acknowledgeDelivery(service.list()[0].id, NOW + 1_000);
    assert.deepEqual(service.list(), []);
    assert.deepEqual(store.getScheduledEvents('standalone'), []);
  });
});

test('the fired event carries the scheduled fireAt for crash-replay dedupe', () => {
  withService((service, store, kernel, clock) => {
    let firedReminder: StandaloneReminder | null = null;
    let firedFireAt: number | null = null;
    service.on('fired', (reminder: StandaloneReminder, fireAt: number) => {
      firedReminder = reminder;
      firedFireAt = fireAt;
    });
    const scheduledFireAt = NOW + 1_000;
    service.create({ label: '喝水', schedule: { type: 'once', fireAt: scheduledFireAt } });

    const armed = store.getScheduledEvents('standalone');
    assert.equal(armed.length, 1);
    assert.equal(armed[0].fireAt, scheduledFireAt);

    clock.now += 1_000;
    kernel.reconcile();

    assert.equal(firedReminder?.label, '喝水');
    assert.equal(firedFireAt, scheduledFireAt, 'fired emits the scheduled fireAt, not Date.now()');
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
    assert.equal(store.getScheduledEvents('standalone').length, 1, 'unacknowledged occurrence remains replayable');
    const [reminder] = service.list();
    service.acknowledgeDelivery(reminder.id, NOW + 1_000);
    assert.deepEqual(store.getScheduledEvents('standalone'), []);
  });
});

test('a fired but unacknowledged occurrence is not replayed by later re-arms', () => {
  withService((service, store, kernel, clock) => {
    let fireCount = 0;
    service.on('fired', () => {
      fireCount += 1;
    });
    service.create({ label: 'Daily', schedule: { type: 'daily', hour: 9, minute: 0 } });
    // Advance to the first daily fire (NOW is 2026-07-08 10:00).
    clock.now = new Date(2026, 6, 9, 9, 0, 0, 0).getTime();
    kernel.reconcile();
    assert.equal(fireCount, 1);
    // Delivery is still unacknowledged (the durable occurrence never advanced).
    // A later arm() — unlock screen, system resume, any reminder edit — must
    // advance to the NEXT occurrence instead of re-registering the fired one,
    // which would re-trigger the delivery loop.
    service.arm();
    assert.equal(fireCount, 1, 're-arm must not re-fire the same occurrence');
    const persisted = store.getScheduledEvents('standalone');
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].fireAt, new Date(2026, 6, 10, 9, 0, 0, 0).getTime());
    kernel.reconcile();
    assert.equal(fireCount, 1);
  });
});

test('adjacent one-shot reminders both fire and acknowledge independently', () => {
  withService((service, store, kernel, clock) => {
    const fired: Array<{ id: string; fireAt: number }> = [];
    service.on('fired', (reminder: StandaloneReminder, fireAt: number) => fired.push({ id: reminder.id, fireAt }));
    service.create({ label: 'A', schedule: { type: 'once', fireAt: NOW + 1_000 } });
    service.create({ label: 'B', schedule: { type: 'once', fireAt: NOW + 1_500 } });

    clock.now = NOW + 1_000;
    kernel.reconcile();
    assert.equal(fired.length, 1);
    service.acknowledgeDelivery(fired[0].id, fired[0].fireAt);
    assert.equal(store.getScheduledEvents('standalone').length, 1, 'acknowledging A preserves adjacent B');

    clock.now = NOW + 1_500;
    kernel.reconcile();
    assert.equal(fired.length, 2, 'B is not skipped by A advancement');
    service.acknowledgeDelivery(fired[1].id, fired[1].fireAt);
    assert.deepEqual(service.list(), []);
  });
});

test('timezone change recomputes civil schedules but preserves absolute one-shots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-timezone-'));
  const clock = { now: NOW };
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  const kernel = new SchedulerKernel({
    clock: { now: () => clock.now, monotonic: () => clock.now },
    watchdogIntervalMs: Number.MAX_SAFE_INTEGER
  });
  const store = new TaskStore(dir);
  const service = new StandaloneReminderService(store, kernel, () => clock.now);
  try {
    kernel.start();
    const [daily] = service.create({ label: 'Daily', schedule: { type: 'daily', hour: 9, minute: 0 } });
    const [once] = service.create({ label: 'Once', schedule: { type: 'once', fireAt: NOW + 60_000 } })
      .filter((entry) => entry.label === 'Once');
    const before = new Map(store.getScheduledEvents('standalone').map((event) => [event.payloadRef, event.fireAt]));

    process.env.TZ = 'Europe/London';
    (kernel as unknown as { checkDrift(): void }).checkDrift();
    const after = new Map(store.getScheduledEvents('standalone').map((event) => [event.payloadRef, event.fireAt]));
    assert.notEqual(after.get(daily.id), before.get(daily.id), 'daily epoch recomputed for new local timezone');
    assert.equal(after.get(once.id), before.get(once.id), 'absolute one-shot epoch is unchanged');
  } finally {
    service.dispose();
    kernel.stop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

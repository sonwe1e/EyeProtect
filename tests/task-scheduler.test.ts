import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchedulerKernel } from '../src/main/scheduling/kernel';
import { TaskScheduler } from '../src/main/taskScheduler';
import { TaskService } from '../src/main/taskService';
import { TaskStore } from '../src/main/taskStore';
import type { ScheduledEvent } from '../src/main/scheduling/kernel';
import type { Task } from '../src/shared/types';

const DAY = 86_400_000;
const NOW = new Date(2026, 6, 8, 10, 0, 0, 0).getTime();

/** Deterministic wall + monotonic clock; monotonic tracks wall 1:1. */
const makeClock = () => {
  let now = NOW;
  return {
    now: (): number => now,
    monotonic: (): number => now,
    set: (value: number): void => {
      now = value;
    },
    advance: (ms: number): void => {
      now += ms;
    }
  };
};

const task = (over: Partial<Task>): Task =>
  ({
    id: 't1',
    title: '提醒我',
    notes: null,
    status: 'open',
    priority: 'normal',
    projectId: null,
    parentId: null,
    tags: [],
    plannedAt: null,
    dueAt: null,
    reminderAt: null,
    recurrence: null,
    context: 'desk',
    remindOnBreak: false,
    estimateMinutes: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...over
  }) as Task;

test('arm registers the nearest unconsumed reminder, including startup-overdue work', () => {
  const clock = makeClock();
  const kernel = new SchedulerKernel({
    clock: { now: clock.now, monotonic: clock.monotonic },
    watchdogIntervalMs: Number.MAX_SAFE_INTEGER
  });
  kernel.start();

  const tasks: Task[] = [
    task({ id: 'later', reminderAt: NOW + 60_000 }),
    task({ id: 'sooner', reminderAt: NOW + 30_000 }),
    task({ id: 'past', reminderAt: NOW - 1000 })
  ];
  const scheduler = new TaskScheduler(kernel, () => tasks, clock.now);
  scheduler.arm(clock.now());

  const events = kernel.peek().filter((e) => e.owner === 'task');
  assert.equal(events.length, 1, 'exactly one shared task deadline');
  assert.equal(events[0].type, 'task-reminder');
  assert.equal(events[0].fireAt, NOW - 1000, 'an overdue startup reminder is reconciled first');
  assert.ok(events[0].id.includes('past'));

  scheduler.dispose();
  kernel.stop();
});

test('done and archived tasks are never armed', () => {
  const clock = makeClock();
  const kernel = new SchedulerKernel({
    clock: { now: clock.now, monotonic: clock.monotonic },
    watchdogIntervalMs: Number.MAX_SAFE_INTEGER
  });
  kernel.start();

  const tasks: Task[] = [
    task({ id: 'done', status: 'done', reminderAt: NOW + 60_000 }),
    task({ id: 'archived', status: 'archived', reminderAt: NOW + 60_000 })
  ];
  const scheduler = new TaskScheduler(kernel, () => tasks, clock.now);
  scheduler.arm(clock.now());

  assert.equal(kernel.peek().filter((e) => e.owner === 'task').length, 0, 'no deadline for inactive tasks');

  scheduler.dispose();
  kernel.stop();
});

test('arm with no due tasks clears the kernel deadline', () => {
  const clock = makeClock();
  const kernel = new SchedulerKernel({
    clock: { now: clock.now, monotonic: clock.monotonic },
    watchdogIntervalMs: Number.MAX_SAFE_INTEGER
  });
  kernel.start();

  const scheduler = new TaskScheduler(kernel, () => []);
  scheduler.arm(clock.now());
  assert.equal(kernel.peek().filter((e) => e.owner === 'task').length, 0);

  scheduler.dispose();
  kernel.stop();
});

test('a firing reminder emits task-reminder with the due tasks, then re-arms', () => {
  const clock = makeClock();
  const kernel = new SchedulerKernel({
    clock: { now: clock.now, monotonic: clock.monotonic },
    watchdogIntervalMs: Number.MAX_SAFE_INTEGER
  });

  kernel.start();

  const dueTask = task({ id: 'due', reminderAt: NOW + 60_000 });
  const futureTask = task({ id: 'future', reminderAt: NOW + 10 * 60_000 });
  const tasks = [dueTask, futureTask];
  const scheduler = new TaskScheduler(kernel, () => tasks, clock.now);

  const reminders: Task[][] = [];
  scheduler.on('task-reminder', (due) => reminders.push(due));

  scheduler.arm(clock.now());
  const firedEvent = kernel
    .peek()
    .find((e) => e.owner === 'task' && e.type === 'task-reminder') as ScheduledEvent;

  // Advance past the deadline and reconcile through the kernel, which wakes the
  // scheduler to emit and re-arm.
  clock.set(firedEvent.fireAt);
  kernel.reconcile();

  assert.equal(reminders.length, 1, 'one task-reminder emission');
  assert.equal(reminders[0].length, 1, 'exactly the due task surfaced');
  assert.equal(reminders[0][0].id, 'due');

  // After firing, only the future task remains armed.
  const remaining = kernel.peek().filter((e) => e.owner === 'task');
  assert.equal(remaining.length, 1);
  assert.ok(remaining[0].id.includes('future'), 're-armed to the next deadline');

  scheduler.dispose();
  kernel.stop();
});

test('suspend clears the deadline; resume re-arms', () => {
  const clock = makeClock();
  const kernel = new SchedulerKernel({
    clock: { now: clock.now, monotonic: clock.monotonic },
    watchdogIntervalMs: Number.MAX_SAFE_INTEGER
  });
  kernel.start();

  const tasks: Task[] = [task({ id: 'a', reminderAt: NOW + 60_000 })];
  const scheduler = new TaskScheduler(kernel, () => tasks, clock.now);
  scheduler.arm(clock.now());
  assert.equal(kernel.peek().filter((e) => e.owner === 'task').length, 1);

  scheduler.suspend();
  assert.equal(kernel.peek().filter((e) => e.owner === 'task').length, 0, 'suspended → cleared');

  scheduler.resume(clock.now());
  assert.equal(kernel.peek().filter((e) => e.owner === 'task').length, 1, 'resumed → re-armed');

  scheduler.dispose();
  kernel.stop();
});

test('dispose unsubscribes from the kernel and clears deadlines', () => {
  const clock = makeClock();
  const kernel = new SchedulerKernel({
    clock: { now: clock.now, monotonic: clock.monotonic },
    watchdogIntervalMs: Number.MAX_SAFE_INTEGER
  });
  kernel.start();

  const tasks: Task[] = [task({ id: 'a', reminderAt: NOW + 60_000 })];
  const scheduler = new TaskScheduler(kernel, () => tasks, clock.now);
  scheduler.arm(clock.now());
  assert.equal(kernel.peek().filter((e) => e.owner === 'task').length, 1);

  scheduler.dispose();
  assert.equal(kernel.peek().filter((e) => e.owner === 'task').length, 0, 'deadline cleared');

  // After dispose, a kernel wake must not reach the disposed scheduler.
  let fired = false;
  scheduler.on('task-reminder', () => {
    fired = true;
  });
  kernel.set('task', [
    { id: 'x', owner: 'task', type: 'task-reminder', fireAt: NOW - 1, revision: 1 }
  ]);
  clock.set(NOW + 1);
  kernel.reconcile();
  assert.equal(fired, false, 'disposed scheduler ignores post-dispose wakes');

  kernel.stop();
});

test('fired occurrence is consumed only after delivery acknowledgement and stays consumed across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-task-occurrence-'));
  const clock = makeClock();
  try {
    const store = new TaskStore(dir);
    const service = new TaskService(store);
    const reminderAt = NOW + 60_000;
    const [created] = service.createTask({
      title: '每日九点',
      reminderAt,
      recurrence: { type: 'daily', interval: 1 }
    }, NOW);
    const makeScheduler = (kernel: SchedulerKernel): TaskScheduler => new TaskScheduler(
      kernel,
      () => service.getTasks(),
      clock.now,
      {
        isConsumed: (entry) =>
          entry.reminderAt !== null && store.isTaskReminderConsumed(entry.id, entry.reminderAt)
      }
    );

    const firstKernel = new SchedulerKernel({
      clock: { now: clock.now, monotonic: clock.monotonic },
      watchdogIntervalMs: Number.MAX_SAFE_INTEGER
    });
    firstKernel.start();
    const first = makeScheduler(firstKernel);
    first.arm();
    clock.set(reminderAt);
    firstKernel.reconcile();
    assert.equal(service.getTask(created.id)?.reminderAt, reminderAt, 'firing preserves task configuration');
    assert.equal(store.isTaskReminderConsumed(created.id, reminderAt), false, 'scheduler does not acknowledge before presentation');
    store.consumeTaskReminder(created.id, reminderAt);
    assert.equal(store.isTaskReminderConsumed(created.id, reminderAt), true);
    first.dispose();
    firstKernel.stop();

    const restartedKernel = new SchedulerKernel({
      clock: { now: clock.now, monotonic: clock.monotonic },
      watchdogIntervalMs: Number.MAX_SAFE_INTEGER
    });
    restartedKernel.start();
    const restarted = makeScheduler(restartedKernel);
    restarted.arm();
    assert.equal(restartedKernel.peek().filter((event) => event.owner === 'task').length, 0);

    const completedAt = reminderAt + 3 * 60 * 60_000;
    const tasks = service.setTaskStatus(created.id, 'done', completedAt);
    const next = tasks.find((entry) => entry.id !== created.id)!;
    assert.equal(next.reminderAt, reminderAt + DAY, 'next reminder keeps the original wall-clock anchor');

    restarted.dispose();
    restartedKernel.stop();
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

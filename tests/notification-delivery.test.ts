import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotificationDeliveryQueue } from '../src/main/notificationDelivery';
import { TaskStore } from '../src/main/taskStore';

const withStore = async (fn: (store: TaskStore) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-delivery-'));
  try {
    await fn(new TaskStore(dir));
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
};

test('delivery is consumed only after the native show call succeeds', async () => {
  await withStore(async (store) => {
    let shown = 0;
    let delivered = 0;
    const queue = new NotificationDeliveryQueue(store, {
      now: () => 1_000,
      createNotification: () => ({
        on: () => {},
        show: () => {
          shown += 1;
        }
      }),
      onDelivered: () => {
        delivered += 1;
      }
    });
    store.enqueueDelivery('task', 'task-1', 900, 'Task', 'Body', 1_000);

    await queue.pump();
    await queue.pump();

    assert.equal(shown, 1, 'a delivered occurrence is duplicate-safe');
    assert.equal(delivered, 1);
    assert.equal(store.getDueDeliveries(10_000).length, 0);
    queue.stop();
  });
});

test('terminal failure is recovered by re-enqueuing the same occurrence', async () => {
  await withStore(async (store) => {
    let now = 1_000;
    // createNotification always fails so the delivery runs the retry budget.
    const queue = new NotificationDeliveryQueue(store, {
      now: () => now,
      createNotification: () => null
    });
    const sourceId = 'alarm-1';
    store.enqueueDelivery('standalone', sourceId, 900, 'Alarm', 'Body', now);

    // Exhaust the 30s / 2min / 5min retry budget -> terminal failed.
    await queue.pump();
    now += 30_000;
    await queue.pump();
    now += 2 * 60_000;
    await queue.pump();
    now += 5 * 60_000;
    await queue.pump();

    const row = store.getDueDeliveries(Number.MAX_SAFE_INTEGER);
    assert.equal(row.length, 0, 'terminal failed is not due');
    assert.equal(store.getFailedDeliveryCount(), 1, 'one terminal failure recorded');

    // Re-enqueue the same (source, sourceId, occurrenceAt): the stuck failed
    // row must be resurrected to `due`, not silently returned as failed.
    const requeued = store.enqueueDelivery('standalone', sourceId, 900, 'Alarm', 'Body', now);
    assert.equal(requeued.state, 'due', 're-enqueue resurrects a failed row to due');
    assert.equal(requeued.attempts, 0, 'attempts reset on resurrection');

    // A subsequent pump should now deliver it (notification succeeds).
    const requeueQueue = new NotificationDeliveryQueue(store, {
      now: () => now,
      createNotification: () => ({
        on: () => {},
        show: () => {}
      }),
      onDelivered: () => {}
    });
    await requeueQueue.pump();
    const after = store.getDueDeliveries(Number.MAX_SAFE_INTEGER);
    assert.equal(after.length, 0, 'resurrected delivery gets consumed by the pump');
    requeueQueue.stop();
    queue.stop();
  });
});

test('re-enqueue leaves in-flight due/presenting/delivered rows untouched (dedup preserved)', async () => {
  await withStore(async (store) => {
    const now = 1_000;
    const occurrenceAt = 900;

    // A `due` row that has not been attempted yet.
    store.enqueueDelivery('task', 'task-1', occurrenceAt, 'Task', 'Body', now);
    const dueAgain = store.enqueueDelivery('task', 'task-1', occurrenceAt, 'IGNORED', 'IGNORED', now);
    assert.equal(dueAgain.title, 'Task', 're-enqueue of a due row is a no-op (dedup)');
    assert.equal(dueAgain.state, 'due');

    // A `delivered` row stays delivered.
    const queue = new NotificationDeliveryQueue(store, {
      now: () => now,
      createNotification: () => ({ on: () => {}, show: () => {} })
    });
    await queue.pump();
    assert.equal(store.getDueDeliveries(now).length, 0, 'delivered leaves the due queue');
    const deliveredAgain = store.enqueueDelivery('task', 'task-1', occurrenceAt, 'IGNORED', 'IGNORED', now);
    assert.equal(deliveredAgain.state, 'delivered', 'delivered row is not resurrected');
    queue.stop();
  });
});

test('reconcileFailedDeliveries resets every failed row back to due', async () => {
  await withStore(async (store) => {
    let now = 1_000;
    const queue = new NotificationDeliveryQueue(store, {
      now: () => now,
      createNotification: () => null
    });
    // Two independent occurrences, both driven to terminal failure.
    store.enqueueDelivery('standalone', 'a', 900, 'A', 'Body', now);
    store.enqueueDelivery('standalone', 'b', 950, 'B', 'Body', now);
    for (const advance of [30_000, 2 * 60_000, 5 * 60_000]) {
      await queue.pump();
      now += advance;
    }
    await queue.pump();
    assert.equal(store.getFailedDeliveryCount(), 2);

    // Startup reconciliation: every failed row becomes due again.
    store.reconcileFailedDeliveries(now);
    assert.equal(store.getFailedDeliveryCount(), 0, 'no failed rows remain');
    const due = store.getDueDeliveries(Number.MAX_SAFE_INTEGER);
    assert.equal(due.length, 2, 'both rows are due and retryable');
    for (const entry of due) {
      assert.equal(entry.attempts, 0, 'attempts reset');
      assert.equal(entry.nextAttemptAt, now, 'next attempt scheduled to now');
    }
    queue.stop();
  });
});

test('terminal failures remain a durable actionable inbox until retried or dismissed', async () => {
  await withStore(async (store) => {
    let now = 1_000;
    const queue = new NotificationDeliveryQueue(store, {
      now: () => now,
      createNotification: () => null
    });
    const delivery = store.enqueueDelivery('task', 'task-42', 900, '任务提醒', '完成报告', now);
    for (const advance of [30_000, 2 * 60_000, 5 * 60_000]) {
      await queue.pump();
      now += advance;
    }
    await queue.pump();

    const [notice] = store.getFailedDeliveries();
    assert.equal(notice.id, delivery.id);
    assert.equal(notice.sourceId, 'task-42');
    assert.equal(notice.title, '任务提醒');
    assert.equal(notice.body, '完成报告');

    assert.equal(store.retryFailedDelivery(delivery.id, now), true);
    assert.deepEqual(store.getFailedDeliveries(), [], 'manual retry removes it from the failed inbox');
    // Drive it terminal again, then explicitly dismiss it.
    for (const advance of [30_000, 2 * 60_000, 5 * 60_000]) {
      await queue.pump();
      now += advance;
    }
    await queue.pump();
    assert.equal(store.getFailedDeliveries().length, 1);
    assert.equal(store.dismissFailedDelivery(delivery.id), true);
    assert.deepEqual(store.getFailedDeliveries(), []);
    queue.stop();
  });
});

test('delivery failure schedules the bounded retry sequence', async () => {
  await withStore(async (store) => {
    let now = 1_000;
    const queue = new NotificationDeliveryQueue(store, {
      now: () => now,
      createNotification: () => null
    });
    store.enqueueDelivery('standalone', 'alarm-1', 900, 'Alarm', 'Body', now);

    await queue.pump();
    assert.equal(store.getDueDeliveries(now).length, 0);
    now += 30_000;
    assert.equal(store.getDueDeliveries(now).length, 1, 'first retry waits 30 seconds');
    await queue.pump();
    now += 2 * 60_000;
    assert.equal(store.getDueDeliveries(now).length, 1, 'second retry waits two minutes');
    await queue.pump();
    now += 5 * 60_000;
    assert.equal(store.getDueDeliveries(now).length, 1, 'final retry waits five minutes');
    await queue.pump();
    assert.equal(store.getDueDeliveries(Number.MAX_SAFE_INTEGER).length, 0, 'four failures are terminal');
    queue.stop();
  });
});

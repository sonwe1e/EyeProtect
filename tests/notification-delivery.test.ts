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

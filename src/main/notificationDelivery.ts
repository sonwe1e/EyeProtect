import { createRequire } from 'node:module';
import type {
  DeliverySource,
  NotificationDelivery,
  TaskStore
} from './taskStore';

interface NotificationHandle {
  on(event: 'click' | 'close', callback: () => void): void;
  show(): void;
}

interface NotificationConstructor {
  isSupported(): boolean;
  new (options: { title: string; body: string; silent?: boolean }): NotificationHandle;
}

export interface NotificationDeliveryQueueOptions {
  now?: () => number;
  createNotification?: (delivery: NotificationDelivery) => NotificationHandle | null;
  onDelivered?: (delivery: NotificationDelivery) => void;
  onClick?: (delivery: NotificationDelivery) => void;
  onFailed?: (delivery: NotificationDelivery) => void;
}

/** Durable, duplicate-safe native-notification delivery with bounded retry. */
export class NotificationDeliveryQueue {
  private readonly now: () => number;
  private readonly createNotification: (delivery: NotificationDelivery) => NotificationHandle | null;
  private readonly onDelivered: (delivery: NotificationDelivery) => void;
  private readonly onClick: (delivery: NotificationDelivery) => void;
  private readonly onFailed: (delivery: NotificationDelivery) => void;
  private timer: NodeJS.Timeout | null = null;
  private pumping = false;

  constructor(private readonly store: TaskStore, options: NotificationDeliveryQueueOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createNotification = options.createNotification ?? defaultNotification;
    this.onDelivered = options.onDelivered ?? (() => {});
    this.onClick = options.onClick ?? (() => {});
    this.onFailed = options.onFailed ?? (() => {});
  }

  start(): void {
    void this.pump();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  enqueue(
    source: DeliverySource,
    sourceId: string,
    occurrenceAt: number,
    title: string,
    body: string
  ): NotificationDelivery {
    const delivery = this.store.enqueueDelivery(source, sourceId, occurrenceAt, title, body, this.now());
    void this.pump();
    return delivery;
  }

  async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      for (const pending of this.store.getDueDeliveries(this.now())) {
        const delivery = this.store.beginDelivery(pending.id, this.now());
        if (!delivery) continue;
        try {
          const notification = this.createNotification(delivery);
          if (!notification) throw new Error('native notifications are unavailable');
          notification.on('click', () => {
            this.store.markDeliveryOutcome(delivery.id, 'clicked');
            this.onClick(delivery);
          });
          notification.on('close', () => this.store.markDeliveryOutcome(delivery.id, 'dismissed'));
          notification.show();
          this.store.markDeliveryDelivered(delivery.id, this.now());
          this.onDelivered(delivery);
        } catch {
          const failed = this.store.failDelivery(delivery.id, this.now());
          if (failed?.state === 'failed') this.onFailed(failed);
        }
      }
    } finally {
      this.pumping = false;
      const nextAt = this.store.getNextDeliveryAt();
      if (nextAt !== null) {
        this.timer = setTimeout(() => void this.pump(), Math.max(0, nextAt - this.now()));
        this.timer.unref?.();
      }
    }
  }
}

const defaultNotification = (delivery: NotificationDelivery): NotificationHandle | null => {
  const require = createRequire(import.meta.url);
  let NotificationCtor: NotificationConstructor;
  try {
    NotificationCtor = require('electron').Notification as NotificationConstructor;
  } catch {
    return null;
  }
  if (!NotificationCtor.isSupported()) return null;
  return new NotificationCtor({ title: delivery.title, body: delivery.body, silent: true });
};

import { EventEmitter } from 'node:events';
import {
  nextStandaloneReminderFireAt,
  type PersistedScheduledEvent,
  type StandaloneReminder,
  type StandaloneReminderInput
} from '../shared/types';
import type { SchedulerKernel, ScheduledEvent } from './scheduling/kernel';
import type { TaskStore } from './taskStore';

export class StandaloneReminderService extends EventEmitter {
  private revision = 0;
  private readonly onWake: (owner: string, events: ScheduledEvent[]) => void;
  private readonly onStoreChanged: () => void;

  constructor(
    private readonly store: TaskStore,
    private readonly kernel: SchedulerKernel,
    private readonly now: () => number = Date.now
  ) {
    super();
    this.onWake = (owner, events) => {
      if (owner === 'standalone') {
        this.handleWake(events);
      }
    };
    this.kernel.on('wake', this.onWake);
    this.onStoreChanged = () => {
      this.arm();
      this.emit('changed', this.list());
    };
    this.store.on('standalone-reminders-changed', this.onStoreChanged);
  }

  list(): StandaloneReminder[] {
    return this.store.getStandaloneReminders();
  }

  create(input: StandaloneReminderInput): StandaloneReminder[] {
    this.store.createStandaloneReminder(input, this.now());
    return this.list();
  }

  update(id: string, input: Partial<StandaloneReminderInput>): StandaloneReminder[] {
    this.store.updateStandaloneReminder(id, input, this.now());
    return this.list();
  }

  remove(id: string): StandaloneReminder[] {
    this.store.deleteStandaloneReminder(id);
    return this.list();
  }

  arm(now: number = this.now()): void {
    const persisted = new Map(
      this.store.getScheduledEvents('standalone').map((event) => [event.payloadRef, event])
    );
    const events: PersistedScheduledEvent[] = [];
    for (const reminder of this.list()) {
      if (!reminder.enabled) {
        continue;
      }
      const previous = persisted.get(reminder.id);
      const fireAt = previous?.fireAt ?? nextStandaloneReminderFireAt(reminder.schedule, now);
      if (fireAt === null) {
        continue;
      }
      events.push({
        id: `standalone:${reminder.id}`,
        owner: 'standalone',
        type: 'standalone-reminder',
        fireAt,
        revision: ++this.revision,
        payloadRef: reminder.id
      });
    }
    this.store.replaceScheduledEvents('standalone', events);
    this.kernel.set('standalone', events.map(toKernelEvent));
  }

  suspend(): void {
    this.kernel.set('standalone', []);
  }

  resume(): void {
    this.arm();
  }

  dispose(): void {
    this.kernel.off('wake', this.onWake);
    this.store.off('standalone-reminders-changed', this.onStoreChanged);
    this.kernel.clear('standalone');
  }

  private handleWake(events: ScheduledEvent[]): void {
    const dueIds = new Set(events.map((event) => event.id.replace(/^standalone:/, '')));
    const due = this.list().filter((reminder) => dueIds.has(reminder.id));
    for (const reminder of due) {
      this.emit('fired', reminder);
      if (reminder.schedule.type === 'once') {
        this.store.deleteStandaloneReminder(reminder.id);
      }
    }
    // Advance recurring reminders beyond this occurrence. Existing persisted
    // rows must be cleared first or arm() would deliberately reuse them.
    this.store.replaceScheduledEvents('standalone', []);
    this.arm(this.now() + 1_000);
  }
}

const toKernelEvent = (event: PersistedScheduledEvent): ScheduledEvent => ({
  id: event.id,
  owner: event.owner,
  type: event.type,
  fireAt: event.fireAt,
  revision: event.revision
});

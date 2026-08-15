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
  /**
   * Occurrences (`id:fireAt`) already fired in THIS session. The kernel consumes
   * a fired in-memory event, but the durable occurrence stays unacknowledged
   * until delivery succeeds — so a later arm() must not re-register an
   * occurrence that already fired and failed; only the first arm of a session
   * replays overdue persisted occurrences (crash recovery). Fresh processes
   * start with an empty set, so the restart replay semantics are unchanged.
   */
  private readonly firedInSession = new Set<string>();
  private readonly onWake: (owner: string, events: ScheduledEvent[]) => void;
  private readonly onStoreChanged: () => void;
  private readonly onTimezoneChange: () => void;

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
    this.onTimezoneChange = () => this.arm(this.now(), true);
    this.kernel.on('timezone-change', this.onTimezoneChange);
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

  arm(now: number = this.now(), recomputeCalendar = false): void {
    const persisted = new Map(
      this.store.getScheduledEvents('standalone').map((event) => [event.payloadRef, event])
    );
    const events: PersistedScheduledEvent[] = [];
    for (const reminder of this.list()) {
      if (!reminder.enabled) {
        continue;
      }
      const previous = persisted.get(reminder.id);
      // Timezone changes alter civil-time schedules (daily/weekdays/weekly and
      // custom calendar recurrence), but an absolute one-shot epoch must stay
      // exactly where the user put it.
      let fireAt: number | null = null;
      if (previous) {
        const fired = this.firedInSession.has(`${reminder.id}:${previous.fireAt}`);
        const replayable = previous.fireAt > now || !fired;
        if ((reminder.schedule.type === 'once' || !recomputeCalendar) && replayable) {
          fireAt = previous.fireAt;
        } else if (fired || previous.fireAt <= now) {
          // The stored occurrence already fired this session (and is still
          // unacknowledged) or is stale. Advance strictly past it so the
          // recompute cannot resolve to the same instant and re-fire it.
          fireAt = nextStandaloneReminderFireAt(
            reminder.schedule,
            Math.max(now, previous.fireAt + 1)
          );
        }
      }
      fireAt ??= nextStandaloneReminderFireAt(reminder.schedule, now);
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
    // Drop fired-markers of reminders that no longer exist; the set would
    // otherwise grow for the whole session.
    const liveIds = new Set(this.list().map((reminder) => reminder.id));
    for (const key of this.firedInSession) {
      if (!liveIds.has(key.slice(0, key.lastIndexOf(':')))) {
        this.firedInSession.delete(key);
      }
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
    this.kernel.off('timezone-change', this.onTimezoneChange);
    this.store.off('standalone-reminders-changed', this.onStoreChanged);
    this.kernel.clear('standalone');
  }

  private handleWake(events: ScheduledEvent[]): void {
    // Map each due reminder to the scheduled fireAt of its matched event so
    // consumers (crash-replay enqueue) can dedupe on the real occurrence time
    // instead of the moment the wake was processed.
    const fireAtById = new Map(
      events.map((event) => [event.id.replace(/^standalone:/, ''), event.fireAt])
    );
    const dueIds = new Set(fireAtById.keys());
    const due = this.list().filter((reminder) => dueIds.has(reminder.id));
    for (const reminder of due) {
      const fireAt = fireAtById.get(reminder.id) ?? this.now();
      // Remember the fired occurrence so a later arm() never replays it (the
      // durable row stays unacknowledged until delivery succeeds).
      this.firedInSession.add(`${reminder.id}:${fireAt}`);
      this.emit('fired', reminder, fireAt);
    }
    // Do not consume or advance here. The durable delivery queue acknowledges
    // visibility through acknowledgeDelivery(); until then the persisted
    // occurrence remains replayable after a crash or terminal notification
    // failure. The kernel already removed only the due in-memory events, so an
    // adjacent one-shot remains armed and cannot be skipped.
  }

  /** Close exactly one occurrence after a visible surface accepted it. */
  acknowledgeDelivery(id: string, occurrenceAt: number, now: number = this.now()): void {
    const reminder = this.list().find((entry) => entry.id === id);
    const persisted = this.store.getScheduledEvents('standalone');
    const occurrence = persisted.find((event) => event.payloadRef === id);
    if (!reminder || !occurrence || occurrence.fireAt !== occurrenceAt) {
      return;
    }
    if (reminder.schedule.type === 'once') {
      // deleteStandaloneReminder removes only this reminder's durable event;
      // the store change callback re-arms every unaffected occurrence.
      this.store.deleteStandaloneReminder(id);
      return;
    }
    const remaining = persisted.filter((event) => event.payloadRef !== id);
    const nextFireAt = nextStandaloneReminderFireAt(
      reminder.schedule,
      Math.max(now, occurrenceAt + 1)
    );
    if (nextFireAt !== null) {
      remaining.push({
        id: `standalone:${id}`,
        owner: 'standalone',
        type: 'standalone-reminder',
        fireAt: nextFireAt,
        revision: ++this.revision,
        payloadRef: id
      });
    }
    this.store.replaceScheduledEvents('standalone', remaining);
    this.kernel.set('standalone', remaining.map(toKernelEvent));
  }
}

const toKernelEvent = (event: PersistedScheduledEvent): ScheduledEvent => ({
  id: event.id,
  owner: event.owner,
  type: event.type,
  fireAt: event.fireAt,
  revision: event.revision
});

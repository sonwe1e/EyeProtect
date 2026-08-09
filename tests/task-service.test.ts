import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from '../src/main/taskStore';
import { TaskService } from '../src/main/taskService';
import type { RecurrenceRule, Task, TodoItem } from '../src/shared/types';

const DAY = 86_400_000;
const NOW = new Date(2026, 6, 8, 10, 0, 0, 0).getTime();

const withService = (fn: (service: TaskService, store: TaskStore) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-tsvc-'));
  try {
    const store = new TaskStore(dir);
    fn(new TaskService(store), store);
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
};

const sampleTodo = (over: Partial<TodoItem> = {}): TodoItem => ({
  id: 'legacy-1',
  text: '喝水',
  createdAt: NOW,
  completed: false,
  priority: 'normal',
  context: 'desk',
  remindOnBreak: false,
  ...over
});

// ── Read pass-throughs ────────────────────────────────────────────────────────

test('createTask via the service returns the full task list and emits once', () => {
  withService((service) => {
    const events: Task[][] = [];
    service.on('tasks-changed', (tasks) => events.push(tasks));

    const tasks = service.createTask({ title: 'via service' }, NOW);
    assert.equal(tasks.length, 1);
    assert.equal(events.length, 1, 'service re-emits tasks-changed once');
    assert.equal(events[0].length, 1);
    assert.equal(events[0][0].title, 'via service');
  });
});

test('getTask / getProject pass through to the store', () => {
  withService((service) => {
    const task = service.createTask({ title: 'find' }, NOW);
    const project = service.createProject({ name: 'Area' }, NOW);

    assert.ok(service.getTask(task[0].id));
    assert.equal(service.getTask('nope'), null);
    assert.ok(service.getProject(project[0].id));
    assert.equal(service.getProject('nope'), null);
  });
});

// ── Status transitions ────────────────────────────────────────────────────────

test('setTaskStatus transitions and emits exactly once for a non-recurring task', () => {
  withService((service) => {
    const [task] = service.createTask({ title: 'progress' }, NOW);

    // Listen only for the status transition, not the creation above.
    const events: Task[][] = [];
    service.on('tasks-changed', (tasks) => events.push(tasks));

    const result = service.setTaskStatus(task.id, 'done', NOW + 1000);

    assert.equal(result.find((t) => t.id === task.id)!.status, 'done');
    assert.equal(events.length, 1, 'no rollover → single emit');
  });
});

test('setTaskStatus on an unknown id emits the unchanged list', () => {
  withService((service) => {
    service.createTask({ title: 'keep' }, NOW);
    const events: Task[][] = [];
    service.on('tasks-changed', (tasks) => events.push(tasks));

    const result = service.setTaskStatus('missing', 'done', NOW);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, 'open');
    assert.equal(events.length, 1);
  });
});

test('deleteTask emits tasks-changed via the service', () => {
  withService((service) => {
    const [task] = service.createTask({ title: 'doomed' }, NOW);
    const events: Task[][] = [];
    service.on('tasks-changed', (tasks) => events.push(tasks));

    const result = service.deleteTask(task.id, NOW);
    assert.equal(result.length, 0);
    assert.equal(events.length, 1);
  });
});

// ── Recurrence rollover ───────────────────────────────────────────────────────

test('completing a daily task spawns a new inbox instance shifted by one day', () => {
  withService((service) => {
    const reminderAt = NOW + 60_000;
    const rule: RecurrenceRule = { type: 'daily', interval: 1 };
    const [task] = service.createTask({ title: '每日回顾', reminderAt, recurrence: rule }, NOW);

    const result = service.setTaskStatus(task.id, 'done', NOW + 120_000);

    // The completed original plus one new inbox instance.
    assert.equal(result.length, 2, 'original stays done + one new instance');
    const done = result.find((t) => t.id === task.id)!;
    const next = result.find((t) => t.id !== task.id)!;

    assert.equal(done.status, 'done');
    assert.equal(next.status, 'open');
    assert.equal(next.title, '每日回顾', 'title preserved');
    assert.equal(next.recurrence?.type, 'daily', 'recurrence preserved');
    // Next fire is the anchor (reminderAt) shifted by exactly one day.
    assert.equal(next.reminderAt, reminderAt + DAY, 'anchored to the scheduled reminderAt');
    assert.equal(next.priority, done.priority);
    assert.equal(next.context, done.context);
  });
});

test('a daily task with interval 3 shifts by three days', () => {
  withService((service) => {
    const reminderAt = NOW;
    const rule: RecurrenceRule = { type: 'daily', interval: 3 };
    const [task] = service.createTask({ title: 'tri-daily', reminderAt, recurrence: rule }, NOW);

    const result = service.setTaskStatus(task.id, 'done', NOW + 1000);
    const next = result.find((t) => t.id !== task.id)!;
    assert.equal(next.reminderAt, reminderAt + 3 * DAY);
  });
});

test('a weekly task rolls over to the next configured weekday', () => {
  withService((service) => {
    // NOW (2026-07-08) is a Wednesday (3). Schedule reminders on Mondays.
    const reminderAt = NOW;
    const rule: RecurrenceRule = { type: 'weekly', interval: 1, weekdays: [1] };
    const [task] = service.createTask({ title: '周会准备', reminderAt, recurrence: rule }, NOW);

    const result = service.setTaskStatus(task.id, 'done', NOW + 1000);
    const next = result.find((t) => t.id !== task.id)!;
    const fireDate = new Date(next.reminderAt!);
    assert.equal(fireDate.getDay(), 1, 'lands on Monday');
    assert.ok(next.reminderAt! > NOW, 'strictly in the future');
  });
});

test('an after-completion task plans the next instance without inventing a reminder', () => {
  withService((service) => {
    const rule: RecurrenceRule = { type: 'after-completion', days: 7 };
    const [task] = service.createTask({ title: 'follow up', recurrence: rule }, NOW);
    const completedAt = NOW + 5000;

    const result = service.setTaskStatus(task.id, 'done', completedAt);
    const next = result.find((t) => t.id !== task.id)!;
    assert.equal(next.plannedAt, completedAt + 7 * DAY);
    assert.equal(next.reminderAt, null);
  });
});

test('a recurring task without a reminder keeps the next reminder disabled', () => {
  withService((service) => {
    const [task] = service.createTask({
      title: '每日计划',
      plannedAt: NOW,
      recurrence: { type: 'daily', interval: 1 }
    }, NOW);
    const result = service.setTaskStatus(task.id, 'done', NOW + 60_000);
    const next = result.find((entry) => entry.id !== task.id)!;
    assert.equal(next.plannedAt, NOW + DAY);
    assert.equal(next.reminderAt, null);
  });
});

test('completing before a later due time advances to the next day', () => {
  withService((service) => {
    const dueAt = NOW + 7 * 3_600_000;
    const [task] = service.createTask({
      title: '每日截止',
      dueAt,
      recurrence: { type: 'daily', interval: 1 }
    }, NOW);
    const result = service.setTaskStatus(task.id, 'done', NOW + 2 * 3_600_000);
    const next = result.find((entry) => entry.id !== task.id)!;
    assert.equal(next.dueAt, dueAt + DAY);
    assert.equal(next.reminderAt, null);
  });
});

test('a recurring task planned/due dates shift with the reminder', () => {
  withService((service) => {
    const reminderAt = NOW;
    const plannedAt = NOW - DAY;
    const dueAt = NOW + 2 * DAY;
    const rule: RecurrenceRule = { type: 'daily', interval: 1 };
    const [task] = service.createTask(
      { title: 'planned', plannedAt, dueAt, reminderAt, recurrence: rule },
      NOW
    );

    const result = service.setTaskStatus(task.id, 'done', NOW + 1000);
    const next = result.find((t) => t.id !== task.id)!;
    assert.equal(next.plannedAt, plannedAt + DAY, 'planned shifts by the same delta');
    assert.equal(next.dueAt, dueAt + DAY, 'due shifts by the same delta');
  });
});

test('completing a non-recurring task does not spawn a new instance', () => {
  withService((service) => {
    const [task] = service.createTask({ title: 'one-off' }, NOW);
    const result = service.setTaskStatus(task.id, 'done', NOW + 1000);
    assert.equal(result.length, 1, 'no rollover without a recurrence rule');
    assert.equal(result[0].status, 'done');
  });
});

test('a weekly rule with no weekdays produces no rollover', () => {
  withService((service) => {
    const rule: RecurrenceRule = { type: 'weekly', interval: 1, weekdays: [] };
    const [task] = service.createTask({ title: 'broken', reminderAt: NOW, recurrence: rule }, NOW);
    const result = service.setTaskStatus(task.id, 'done', NOW + 1000);
    assert.equal(result.length, 1, 'no next occurrence → no spawn');
  });
});

test('setTaskStatus emits tasks-changed exactly once even with rollover', () => {
  withService((service) => {
    const rule: RecurrenceRule = { type: 'daily', interval: 1 };
    const [task] = service.createTask({ title: 'daily', reminderAt: NOW, recurrence: rule }, NOW);
    const events: Task[][] = [];
    service.on('tasks-changed', (tasks) => events.push(tasks));

    service.setTaskStatus(task.id, 'done', NOW + 1000);
    assert.equal(events.length, 1, 'rollover path still emits exactly once');
    assert.equal(events[0].length, 2);
  });
});

test('a recurring parent clones its complete open subtree into the next occurrence', () => {
  withService((service, store) => {
    const [parent] = service.createTask({
      title: 'Weekly review',
      plannedAt: NOW,
      recurrence: { type: 'daily', interval: 1 }
    }, NOW);
    const child = store.createTask({ title: 'Checklist item', parentId: parent.id, plannedAt: NOW + 1_000 }, NOW);
    store.createTask({ title: 'Nested item', parentId: child.id, dueAt: NOW + 2_000 }, NOW);

    const result = service.setTaskStatus(parent.id, 'done', NOW + 5_000);
    const nextParent = result.find((task) => task.id !== parent.id && task.parentId === null)!;
    const nextChild = result.find((task) => task.parentId === nextParent.id)!;
    const nextNested = result.find((task) => task.parentId === nextChild.id)!;

    assert.equal(nextParent.status, 'open');
    assert.equal(nextChild.title, 'Checklist item');
    assert.equal(nextChild.plannedAt, NOW + DAY + 1_000);
    assert.equal(nextNested.title, 'Nested item');
    assert.equal(nextNested.dueAt, NOW + DAY + 2_000);
    assert.equal(nextChild.recurrence, null);
  });
});

test('delete undo restores a task subtree and the active task', () => {
  withService((service, store) => {
    const [parent] = service.createTask({ title: 'Parent' }, NOW);
    const child = store.createTask({ title: 'Child', parentId: parent.id }, NOW);
    service.setActiveTask(child.id, NOW);

    service.deleteTask(parent.id, NOW + 1_000);
    assert.equal(service.getTasks().length, 0);
    const undo = service.getUndoState(NOW + 2_000)!;
    service.undo(undo.operationId, NOW + 2_000);

    assert.equal(service.getTasks().length, 2);
    assert.equal(service.getTask(child.id)?.parentId, parent.id);
    assert.equal(service.getActiveTaskId(), child.id);
  });
});

test('completion undo removes its generated recurring tree', () => {
  withService((service, store) => {
    const [parent] = service.createTask({
      title: 'Recurring',
      plannedAt: NOW,
      recurrence: { type: 'daily', interval: 1 }
    }, NOW);
    store.createTask({ title: 'Child', parentId: parent.id }, NOW);
    service.setTaskStatus(parent.id, 'done', NOW + 1_000);
    assert.equal(service.getTasks().length, 4);

    const undo = service.getUndoState(NOW + 2_000)!;
    service.undo(undo.operationId, NOW + 2_000);
    const restored = service.getTasks();
    assert.equal(restored.length, 2);
    assert.equal(restored.find((task) => task.id === parent.id)?.status, 'open');
  });
});

test('manual movement atomically reorders only the selected inbox scope', () => {
  withService((service) => {
    const [first] = service.createTask({ title: 'First' }, NOW);
    const second = service.createTask({ title: 'Second' }, NOW + 1).find((task) => task.title === 'Second')!;
    const project = service.createProject({ name: 'Project' }, NOW)[0];
    const projectTask = service.createTask({ title: 'Project task', projectId: project.id }, NOW + 2)
      .find((task) => task.projectId === project.id)!;

    const moved = service.moveTask({
      taskId: second.id,
      beforeTaskId: first.id,
      scope: { type: 'inbox' }
    }, NOW + 3);
    const inbox = moved.filter((task) => task.projectId === null).sort((a, b) => a.sortOrder - b.sortOrder);
    assert.deepEqual(inbox.map((task) => task.title), ['Second', 'First']);
    assert.equal(moved.find((task) => task.projectId === project.id)?.sortOrder, projectTask.sortOrder);
  });
});

// ── migrateFromTodos ───────────────────────────────────────────────────────────

test('migrateFromTodos converts each TodoItem into a Task', () => {
  withService((service) => {
    const todos: TodoItem[] = [
      sampleTodo({ id: 'a', text: '喝水', completed: false, priority: 'important', context: 'desk' }),
      sampleTodo({
        id: 'b',
        text: '接杯水',
        completed: true,
        completedAt: NOW + 100,
        priority: 'normal',
        context: 'desk',
        remindOnBreak: true
      })
    ];

    const tasks = service.migrateFromTodos(todos, NOW);
    assert.equal(tasks.length, 2);

    const a = tasks.find((t) => t.id === 'a')!;
    assert.equal(a.title, '喝水');
    assert.equal(a.status, 'open');
    assert.equal(a.priority, 'important');
    assert.equal(a.context, 'desk');
    assert.equal(a.projectId, null);
    assert.equal(a.reminderAt, null);
    assert.equal(a.recurrence, null);
    assert.equal(a.createdAt, NOW);

    const b = tasks.find((t) => t.id === 'b')!;
    assert.equal(b.title, '接杯水');
    assert.equal(b.status, 'done');
    assert.equal(b.completedAt, NOW + 100);
    assert.equal(b.context, 'away', 'remindOnBreak maps to away context');
  });
});

test('migrateFromTodos is idempotent — only migrates when the store is empty', () => {
  withService((service, store) => {
    const first: TodoItem[] = [sampleTodo({ id: 'a', text: '喝水' })];
    const result1 = service.migrateFromTodos(first, NOW);
    assert.equal(result1.length, 1);

    // A second call with a different list must not add or replace anything.
    const second: TodoItem[] = [sampleTodo({ id: 'b', text: '跑步' })];
    const result2 = service.migrateFromTodos(second, NOW);
    assert.equal(result2.length, 1, 'no migration when tasks already exist');
    assert.equal(result2[0].id, 'a', 'original migrated task preserved');

    // And the underlying store agrees.
    assert.equal(store.getTasks().length, 1);
  });
});

test('migrateFromTodos emits tasks-changed with the migrated list', () => {
  withService((service) => {
    const events: Task[][] = [];
    service.on('tasks-changed', (tasks) => events.push(tasks));

    const tasks = service.migrateFromTodos([sampleTodo({ text: 'emit' })], NOW);
    assert.ok(events.length >= 1);
    assert.deepEqual(events[events.length - 1].length, tasks.length);
  });
});

// ── Project service events ─────────────────────────────────────────────────────

test('project create/update/delete emit projects-changed', () => {
  withService((service) => {
    const events: import('../src/shared/types').Project[][] = [];
    service.on('projects-changed', (projects) => events.push(projects));

    const [project] = service.createProject({ name: 'Area' }, NOW);
    service.updateProject(project.id, { name: 'Renamed' }, NOW + 1);
    service.deleteProject(project.id, NOW + 2);
    assert.equal(events.length, 3, 'three mutations → three project events');
  });
});

test('deleteProject also emits tasks-changed when it detaches tasks', () => {
  withService((service) => {
    const [project] = service.createProject({ name: 'Area' }, NOW);
    service.createTask({ title: 'attached', projectId: project.id }, NOW);
    const taskEvents: Task[][] = [];
    service.on('tasks-changed', (tasks) => taskEvents.push(tasks));

    service.deleteProject(project.id, NOW + 1);
    assert.ok(taskEvents.length >= 1);
    assert.equal(service.getTasks()[0].projectId, null);
  });
});

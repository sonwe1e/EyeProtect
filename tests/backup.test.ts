import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackup, parseBackup } from '../src/main/backup';
import { TaskStore } from '../src/main/taskStore';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Project, type ReminderEvent, type Task } from '../src/shared/types';

const event: ReminderEvent = {
  timestamp: new Date(2026, 6, 27, 12, 0, 0, 0).getTime(),
  kind: 'eye',
  scheduledAt: new Date(2026, 6, 27, 11, 59, 0, 0).getTime(),
  shownAt: new Date(2026, 6, 27, 12, 0, 0, 0).getTime(),
  action: 'complete',
  snoozeCount: 0,
  mode: 'guided'
};

test('complete v4 backup round-trips Task Core, characters, occurrences and reminder history', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    eyeIntervalMinutes: 35
  };
  const task: Task = {
    id: 'task-1', title: '接水', notes: null, status: 'open', priority: 'important',
    projectId: null, parentId: null, tags: [], plannedAt: null, dueAt: null,
    reminderAt: 50, recurrence: null, context: 'away', remindOnBreak: true, estimateMinutes: null,
    sortOrder: 0, createdAt: 1, updatedAt: 1, completedAt: null
  };
  const text = createBackup(settings, [event], '1.1.0', 123_456, {
    tasks: [task],
    projects: [],
    standaloneReminders: [{
      id: 'reminder-1', label: '下午茶', schedule: { type: 'daily', hour: 15, minute: 20 },
      enabled: true, createdAt: 1, updatedAt: 1
    }],
    activeTaskId: task.id,
    taskReminderOccurrences: [{ taskId: task.id, fireAt: 50, consumedAt: 60 }],
    characterCollection: {
      installSalt: 'install', characters: [], candidate: null, appearanceMode: 'daily-random',
      pinnedCharacterId: null, activeCharacterId: 'character-starter'
    }
  });
  const restored = parseBackup(text);

  assert.equal(restored.createdAt, 123_456);
  assert.equal(restored.appVersion, '1.1.0');
  assert.equal(restored.settings.eyeIntervalMinutes, 35);
  assert.equal('todos' in restored.settings, false);
  assert.equal('alarms' in restored.settings, false);
  assert.equal(restored.tasks[0].title, '接水');
  assert.equal(restored.standaloneReminders[0].schedule.type, 'daily');
  assert.equal(restored.activeTaskId, 'task-1');
  assert.deepEqual(restored.taskReminderOccurrences, [{ taskId: task.id, fireAt: 50, consumedAt: 60 }]);
  assert.equal(restored.characterCollection?.installSalt, 'install');
  assert.deepEqual(restored.reminderHistory, [event]);
});

test('v1 backup imports legacy todos and alarms into Task Core domains', () => {
  const restored = parseBackup(JSON.stringify({
    version: 1,
    createdAt: 1,
    appVersion: '1.0.0',
    settings: {
      ...DEFAULT_SETTINGS,
      todos: [{ id: 'todo-1', text: '接水', createdAt: 1, completed: false, priority: 'important', context: 'away', remindOnBreak: true }],
      alarms: [{ id: 'alarm-1', hour: 15, minute: 20, repeat: 'daily', enabled: true, createdAt: 1 }]
    },
    reminderHistory: []
  }));
  assert.equal(restored.tasks[0].title, '接水');
  assert.equal(restored.tasks[0].context, 'away');
  assert.equal(restored.tasks[0].remindOnBreak, true);
  assert.deepEqual(restored.standaloneReminders[0].schedule, { type: 'daily', hour: 15, minute: 20 });
  assert.equal('todos' in restored.settings, false);
});

test('backup parser rejects unsupported containers and any malformed history entry', () => {
  assert.throws(() => parseBackup('{}'), /受支持/);
  assert.throws(
    () =>
      parseBackup(
        JSON.stringify({
          version: 1,
          createdAt: 1,
          appVersion: '0.5.1',
          settings: DEFAULT_SETTINGS,
          reminderHistory: [{ ...event, action: 'unknown' }]
        })
      ),
    /无效记录/
  );
});

test('parseBackup rejects a cyclic task graph (A->B->A)', () => {
  const taskA: Task = {
    id: 'a', title: 'A', notes: null, status: 'open', priority: 'normal',
    projectId: null, parentId: 'b', tags: [], plannedAt: null, dueAt: null,
    reminderAt: null, recurrence: null, context: 'desk', remindOnBreak: false,
    estimateMinutes: null, sortOrder: 0, createdAt: 1, updatedAt: 1, completedAt: null
  };
  const taskB: Task = {
    ...taskA, id: 'b', title: 'B', parentId: 'a'
  };
  assert.throws(
    () => parseBackup(JSON.stringify({
      version: 4,
      createdAt: 1,
      appVersion: '1.1.0',
      settings: DEFAULT_SETTINGS,
      reminderHistory: [],
      tasks: [taskA, taskB],
      projects: []
    })),
    /循环的任务关系/
  );
});

test('parseBackup preserves a valid task DAG (A->B->C)', () => {
  const base = {
    notes: null, status: 'open' as const, priority: 'normal' as const,
    projectId: null, tags: [] as string[], plannedAt: null, dueAt: null,
    reminderAt: null, recurrence: null, context: 'desk' as const,
    remindOnBreak: false, estimateMinutes: null, createdAt: 1, updatedAt: 1, completedAt: null
  };
  const tasks: Task[] = [
    { ...base, id: 'a', title: 'A', parentId: null, sortOrder: 0 },
    { ...base, id: 'b', title: 'B', parentId: 'a', sortOrder: 1 },
    { ...base, id: 'c', title: 'C', parentId: 'b', sortOrder: 2 }
  ];
  const restored = parseBackup(JSON.stringify({
    version: 4,
    createdAt: 1,
    appVersion: '1.1.0',
    settings: DEFAULT_SETTINGS,
    reminderHistory: [],
    tasks,
    projects: []
  }));
  assert.equal(restored.tasks.length, 3);
  assert.equal(restored.tasks.find((t) => t.id === 'b')!.parentId, 'a');
  assert.equal(restored.tasks.find((t) => t.id === 'c')!.parentId, 'b');
  assert.equal(restored.tasks.find((t) => t.id === 'a')!.parentId, null);
});

test('replaceAll rejects a cyclic task graph without changing storage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-cycle-'));
  try {
    const store = new TaskStore(dir);
    const base = {
      notes: null, status: 'open' as const, priority: 'normal' as const,
      projectId: null, tags: [] as string[], plannedAt: null, dueAt: null,
      reminderAt: null, recurrence: null, context: 'desk' as const,
      remindOnBreak: false, estimateMinutes: null, createdAt: 1, updatedAt: 1, completedAt: null
    };
    const tasks: Task[] = [
      { ...base, id: 'a', title: 'A', parentId: 'b', sortOrder: 0 },
      { ...base, id: 'b', title: 'B', parentId: 'a', sortOrder: 1 }
    ];
    store.createTask({ title: 'sentinel' }, 1);
    assert.throws(() => store.replaceAll(tasks, 1), /acyclic/);
    assert.deepEqual(store.getTasks().map((task) => task.title), ['sentinel'], 'rejected replace is non-destructive');
    TaskStore.closeAllForDirectory(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project cycles are rejected by both backup parsing and storage replacement', () => {
  const projects: Project[] = [
    { id: 'a', name: 'A', color: null, parentId: 'b', sortOrder: 0, createdAt: 1, updatedAt: 1 },
    { id: 'b', name: 'B', color: null, parentId: 'a', sortOrder: 1, createdAt: 1, updatedAt: 1 }
  ];
  assert.throws(() => parseBackup(JSON.stringify({
    version: 4,
    createdAt: 1,
    appVersion: '1.1.0',
    settings: DEFAULT_SETTINGS,
    reminderHistory: [],
    tasks: [],
    projects
  })), /循环的项目关系/);

  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-project-cycle-'));
  try {
    const store = new TaskStore(dir);
    store.createProject({ name: 'sentinel' }, 1);
    assert.throws(() => store.replaceProjects(projects), /acyclic/);
    assert.deepEqual(store.getProjects().map((project) => project.name), ['sentinel']);
    TaskStore.closeAllForDirectory(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backup parser sanitizes settings instead of trusting imported paths or ranges', () => {
  const restored = parseBackup(
    JSON.stringify({
      version: 1,
      createdAt: 1,
      appVersion: '0.5.1',
      settings: {
        ...DEFAULT_SETTINGS,
        eyeIntervalMinutes: 99_999,
        quietAppWhitelist: ['C:\\Private\\POWERPNT.EXE']
      },
      reminderHistory: []
    })
  );
  assert.equal(restored.settings.eyeIntervalMinutes, 240);
  assert.deepEqual(restored.settings.quietAppWhitelist, ['powerpnt']);
});

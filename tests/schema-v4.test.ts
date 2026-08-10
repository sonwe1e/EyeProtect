/**
 * Schema v4 domain model tests (USERPLAN 1.2 PR1).
 *
 * Covers the new planning domain exactly where the plan demands it (§二十):
 * invariants live in the database/store, not the UI.
 *
 *   - DailyTaskPlan   (task_id, local_date) unique · rank 1|2|3 exclusive per date
 *   - TimeBlock       end_at > start_at · N blocks per task · FK CASCADE
 *   - ProjectSection  FK CASCADE to project · task section must match its project
 *   - Project.status  lifecycle column on both fresh and migrated databases
 *   - FocusSession    ended_at >= started_at · active_ms >= 0 · ONE live globally
 *   - Migration       v3 databases gain the new tables/columns on open
 *   - Backup          v5 round-trips the planning domain; v1–v4 imports stay valid
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { TaskStore } from '../src/main/taskStore';
import { createBackup, parseBackup } from '../src/main/backup';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import {
  sanitizeDailyTaskPlan,
  sanitizeFocusSession,
  sanitizeProjectSection,
  sanitizeTimeBlock
} from '../src/shared/types';

const NOW = new Date(2026, 7, 10, 10, 0, 0, 0).getTime();

const withStore = (fn: (store: TaskStore, dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-v4-'));
  try {
    fn(new TaskStore(dir), dir);
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
};

const seedTask = (store: TaskStore, title: string): string =>
  store.createTask({ title }, NOW).id;

// ── Fresh database path ────────────────────────────────────────────────────────

test('fresh database creates every schema v4 table', () => {
  withStore((store, dir) => {
    const db = new DatabaseSync(join(dir, 'eyeprotect.db'), { readOnly: true });
    try {
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all()
        .map((row) => String((row as Record<string, unknown>).name));
      for (const expected of ['daily_task_plans', 'time_blocks', 'project_sections', 'focus_sessions']) {
        assert.ok(tables.includes(expected), `missing table ${expected}`);
      }
    } finally {
      db.close();
    }
    void store;
  });
});

// ── Migration path (v3 database gains the planning domain) ─────────────────────

test('a v3 database gains status/section_id columns and new tables on open', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-v3-'));
  try {
    // Build the legacy shape by hand: projects without `status`, tasks without
    // `section_id`, and the migration marker an old build would have written.
    const db = new DatabaseSync(join(dir, 'eyeprotect.db'));
    db.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO schema_migrations(version, applied_at) VALUES (3, ${NOW});
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        goal TEXT,
        view_mode TEXT NOT NULL DEFAULT 'list',
        color TEXT,
        parent_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT,
        status TEXT NOT NULL CHECK(status IN ('open','done','archived')),
        priority TEXT NOT NULL CHECK(priority IN ('normal','important','urgent')),
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        planned_at INTEGER,
        due_at INTEGER,
        reminder_at INTEGER,
        recurrence_json TEXT,
        context TEXT NOT NULL CHECK(context IN ('desk','away','any')),
        remind_on_break INTEGER NOT NULL DEFAULT 0,
        estimate_minutes INTEGER,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      INSERT INTO projects(id, name, view_mode, sort_order, created_at, updated_at)
        VALUES ('p-old', 'Legacy Project', 'list', 0, ${NOW}, ${NOW});
      INSERT INTO tasks(id, title, status, priority, context, sort_order, created_at, updated_at)
        VALUES ('t-old', 'Legacy Task', 'open', 'normal', 'desk', 0, ${NOW}, ${NOW});
    `);
    db.close();

    const store = new TaskStore(dir);
    try {
      const project = store.getProject('p-old');
      assert.ok(project);
      assert.equal(project.status, 'active', 'migrated projects default to active');
      const task = store.getTask('t-old');
      assert.ok(task);
      assert.equal(task.sectionId, null);
      // The planning domain is usable immediately after migration.
      const section = store.createProjectSection({ projectId: 'p-old', name: 'Doing' }, NOW);
      assert.equal(section.projectId, 'p-old');
    } finally {
      TaskStore.closeAllForDirectory(dir);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── DailyTaskPlan ──────────────────────────────────────────────────────────────

test('daily plans are unique per (task, date) and rank 1–3 is exclusive per date', () => {
  withStore((store) => {
    const a = seedTask(store, 'A');
    const b = seedTask(store, 'B');

    store.upsertDailyPlan({ taskId: a, localDate: '2026-08-10', plannedMinutes: 90, dailyRank: 1 }, NOW);
    store.upsertDailyPlan({ taskId: a, localDate: '2026-08-10', plannedMinutes: 120 }, NOW);
    assert.equal(store.getDailyPlans('2026-08-10').length, 1, 'same task+date upserts, never duplicates');
    assert.equal(store.getDailyPlans('2026-08-10')[0].plannedMinutes, 120);
    assert.equal(store.getDailyPlans('2026-08-10')[0].dailyRank, null, 'omitted rank clears the rank');

    store.upsertDailyPlan({ taskId: a, localDate: '2026-08-10', dailyRank: 1 }, NOW);
    store.upsertDailyPlan({ taskId: b, localDate: '2026-08-10', dailyRank: 1 }, NOW);
    const plans = store.getDailyPlans('2026-08-10');
    const ranked = plans.filter((plan) => plan.dailyRank === 1);
    assert.equal(ranked.length, 1, 'only one task may hold rank 1 on a date');
    assert.equal(ranked[0].taskId, b, 'the newest assignment wins the rank');
    assert.equal(plans.find((plan) => plan.taskId === a)?.dailyRank, null);

    // Different dates keep independent ranks; (task, date) stays the key.
    store.upsertDailyPlan({ taskId: a, localDate: '2026-08-11', dailyRank: 1 }, NOW);
    assert.equal(store.getDailyPlans('2026-08-11')[0].taskId, a);

    store.removeDailyPlan(b, '2026-08-10');
    assert.ok(!store.getDailyPlans('2026-08-10').some((plan) => plan.taskId === b));

    assert.throws(() => store.upsertDailyPlan({ taskId: 'missing', localDate: '2026-08-10' }, NOW));
    assert.throws(() => store.upsertDailyPlan({ taskId: a, localDate: 'not-a-date' }, NOW));
  });
});

test('deleting a task cascades to its daily plans', () => {
  withStore((store) => {
    const a = seedTask(store, 'A');
    store.upsertDailyPlan({ taskId: a, localDate: '2026-08-10', dailyRank: 2 }, NOW);
    store.deleteTask(a, NOW);
    assert.equal(store.getDailyPlans('2026-08-10').length, 0);
  });
});

// ── TimeBlock ──────────────────────────────────────────────────────────────────

test('one task may own multiple time blocks; invalid intervals are rejected', () => {
  withStore((store) => {
    const task = seedTask(store, 'Big task');
    const monday = store.createTimeBlock(
      { taskId: task, startAt: NOW, endAt: NOW + 2 * 3_600_000, source: 'planner' },
      NOW
    );
    const tuesday = store.createTimeBlock(
      { taskId: task, startAt: NOW + 86_400_000, endAt: NOW + 86_400_000 + 3_600_000 },
      NOW
    );
    assert.equal(store.getTimeBlocksForTask(task).length, 2);
    assert.equal(monday.source, 'planner');
    assert.equal(tuesday.source, 'manual');

    assert.throws(
      () => store.createTimeBlock({ taskId: task, startAt: NOW + 60_000, endAt: NOW + 60_000 }, NOW),
      /结束时间/,
      'zero-length block rejected'
    );
    assert.throws(
      () => store.createTimeBlock({ taskId: task, startAt: NOW + 120_000, endAt: NOW }, NOW),
      /结束时间/,
      'inverted block rejected'
    );
    assert.throws(() => store.createTimeBlock({ taskId: 'missing', startAt: NOW, endAt: NOW + 1 }, NOW));

    const resized = store.updateTimeBlock(monday.id, { endAt: NOW + 3 * 3_600_000 }, NOW);
    assert.equal(resized?.endAt, NOW + 3 * 3_600_000);
    assert.ok(store.deleteTimeBlock(tuesday.id, NOW));
    assert.equal(store.getTimeBlocksForTask(task).length, 1);
  });
});

test('deleting a task cascades to its time blocks', () => {
  withStore((store) => {
    const task = seedTask(store, 'A');
    store.createTimeBlock({ taskId: task, startAt: NOW, endAt: NOW + 3_600_000 }, NOW);
    store.deleteTask(task, NOW);
    assert.equal(store.getTimeBlocks().length, 0);
  });
});

// ── ProjectSection ─────────────────────────────────────────────────────────────

test('sections order deterministically, rename, move and cascade with their project', () => {
  withStore((store) => {
    const project = store.createProject({ name: 'Research' }, NOW);
    const backlog = store.createProjectSection({ projectId: project.id, name: 'Backlog' }, NOW);
    const doing = store.createProjectSection({ projectId: project.id, name: 'Doing' }, NOW);
    const waiting = store.createProjectSection({ projectId: project.id, name: 'Waiting' }, NOW);
    assert.deepEqual(
      store.getProjectSections(project.id).map((section) => section.name),
      ['Backlog', 'Doing', 'Waiting']
    );

    // Move Waiting to the front.
    store.moveProjectSection(waiting.id, backlog.id, NOW);
    assert.deepEqual(
      store.getProjectSections(project.id).map((section) => section.name),
      ['Waiting', 'Backlog', 'Doing']
    );
    // Move Waiting to the end.
    store.moveProjectSection(waiting.id, null, NOW);
    assert.deepEqual(
      store.getProjectSections(project.id).map((section) => section.name),
      ['Backlog', 'Doing', 'Waiting']
    );

    const renamed = store.updateProjectSection(doing.id, { name: 'In Progress' }, NOW);
    assert.equal(renamed?.name, 'In Progress');

    assert.throws(() => store.createProjectSection({ projectId: 'missing', name: 'X' }, NOW));
    assert.throws(() => store.createProjectSection({ projectId: project.id, name: '   ' }, NOW));

    // Deleting the project cascades its sections.
    store.deleteProject(project.id, NOW);
    assert.equal(store.getProjectSections(project.id).length, 0);
  });
});

test('a task only joins a section of its own project; section delete detaches tasks', () => {
  withStore((store) => {
    const left = store.createProject({ name: 'Left' }, NOW);
    const right = store.createProject({ name: 'Right' }, NOW);
    const task = store.createTask({ title: 'T', projectId: left.id }, NOW);
    const leftSection = store.createProjectSection({ projectId: left.id, name: 'Doing' }, NOW);
    const rightSection = store.createProjectSection({ projectId: right.id, name: 'Doing' }, NOW);

    assert.throws(() => store.setTaskSection(task.id, rightSection.id, NOW), /自己所属项目/);
    // Missing task follows the store's null contract (same as updateTask).
    assert.equal(store.setTaskSection('missing', leftSection.id, NOW), null);

    const assigned = store.setTaskSection(task.id, leftSection.id, NOW);
    assert.equal(assigned?.sectionId, leftSection.id);

    // A sectionless project move drops the foreign section reference.
    const moved = store.updateTask(task.id, { projectId: right.id }, NOW);
    assert.equal(moved?.sectionId, null, 'section of the old project must not survive the move');

    store.setTaskSection(task.id, rightSection.id, NOW);
    store.deleteProjectSection(rightSection.id, NOW);
    assert.equal(store.getTask(task.id)?.sectionId, null, 'deleting a section detaches, never deletes tasks');
  });
});

// ── Project lifecycle ──────────────────────────────────────────────────────────

test('projects carry a lifecycle status that updates without losing data', () => {
  withStore((store) => {
    const project = store.createProject({ name: 'Ship 1.2' }, NOW);
    assert.equal(project.status, 'active');
    const held = store.updateProject(project.id, { status: 'onHold' }, NOW);
    assert.equal(held?.status, 'onHold');
    const completed = store.updateProject(project.id, { status: 'completed' }, NOW);
    assert.equal(completed?.status, 'completed');
    const archived = store.updateProject(project.id, { status: 'archived' }, NOW);
    assert.equal(archived?.status, 'archived');
    assert.equal(store.updateProject(project.id, { name: 'Ship 1.2 final' }, NOW)?.name, 'Ship 1.2 final');
  });
});

// ── FocusSession ───────────────────────────────────────────────────────────────

test('focus session lifecycle: one live globally, accumulates time, ends with outcome', () => {
  withStore((store) => {
    const a = seedTask(store, 'A');
    const b = seedTask(store, 'B');

    assert.equal(store.getLiveFocusSession(), null);
    const session = store.startFocusSession({ taskId: a }, NOW);
    assert.equal(session.taskId, a);
    assert.equal(session.endedAt, null);
    assert.equal(session.activeMs, 0);

    assert.throws(() => store.startFocusSession({ taskId: b }, NOW), /已经有一个专注会话/, 'only one live session globally');

    const grown = store.addFocusSessionActiveMs(session.id, 21 * 60_000, NOW);
    assert.equal(grown?.activeMs, 21 * 60_000);
    // Checkpoint-style increments accumulate into the same logical session.
    store.addFocusSessionActiveMs(session.id, 19 * 60_000, NOW);

    const ended = store.endFocusSession(session.id, 'completed', NOW + 40 * 60_000);
    assert.equal(ended?.outcome, 'completed');
    assert.equal(ended?.activeMs, 40 * 60_000);
    assert.equal(ended?.endedAt, NOW + 40 * 60_000);
    assert.equal(store.getLiveFocusSession(), null);

    // After ending, a new session may start — and time blocks may anchor it.
    const block = store.createTimeBlock({ taskId: b, startAt: NOW, endAt: NOW + 3_600_000 }, NOW);
    const second = store.startFocusSession({ taskId: b, timeBlockId: block.id }, NOW + 41 * 60_000);
    assert.equal(second.timeBlockId, block.id);
    store.endFocusSession(second.id, 'interrupted', NOW + 42 * 60_000);
    assert.throws(
      () => store.startFocusSession({ taskId: a, timeBlockId: block.id }, NOW),
      /时间块不属于/,
      'a block from another task cannot anchor the session'
    );

    const history = store.getFocusSessions();
    assert.equal(history.length, 2);
    assert.ok(history.every((entry) => (entry.endedAt ?? 0) >= entry.startedAt));
  });
});

test('focus session invariants hold at the database level', () => {
  withStore((store, dir) => {
    const task = seedTask(store, 'A');
    const db = new DatabaseSync(join(dir, 'eyeprotect.db'));
    try {
      // ended_at < started_at must be rejected by the CHECK constraint even
      // when service code is bypassed.
      assert.throws(() => {
        db.prepare(`
          INSERT INTO focus_sessions(id, task_id, time_block_id, started_at, ended_at, active_ms, outcome, live_slot, created_at)
          VALUES ('bad-time', ?, NULL, ?, ?, 0, 'completed', 0, ?)
        `).run(task, NOW + 1000, NOW, NOW);
      });
      // active_ms must never be negative.
      assert.throws(() => {
        db.prepare(`
          INSERT INTO focus_sessions(id, task_id, time_block_id, started_at, ended_at, active_ms, outcome, live_slot, created_at)
          VALUES ('bad-ms', ?, NULL, ?, NULL, -1, NULL, 1, ?)
        `).run(task, NOW, NOW);
      });
      // A second live session must violate the partial unique index.
      db.prepare(`
        INSERT INTO focus_sessions(id, task_id, time_block_id, started_at, ended_at, active_ms, outcome, live_slot, created_at)
        VALUES ('live-1', ?, NULL, ?, NULL, 0, NULL, 1, ?)
      `).run(task, NOW, NOW);
      assert.throws(() => {
        db.prepare(`
          INSERT INTO focus_sessions(id, task_id, time_block_id, started_at, ended_at, active_ms, outcome, live_slot, created_at)
          VALUES ('live-2', ?, NULL, ?, NULL, 0, NULL, 1, ?)
        `).run(task, NOW + 1, NOW);
      }, 'only one live focus session globally');
    } finally {
      db.close();
    }
  });
});

// ── Sanitizers ─────────────────────────────────────────────────────────────────

test('schema v4 sanitizers reject malformed input', () => {
  assert.equal(sanitizeDailyTaskPlan({ taskId: 't', localDate: '2026/08/10' }), null);
  assert.equal(sanitizeDailyTaskPlan({ taskId: '', localDate: '2026-08-10' }), null);
  const plan = sanitizeDailyTaskPlan({ taskId: 't', localDate: '2026-08-10', plannedMinutes: -5, dailyRank: 9 });
  assert.ok(plan);
  assert.equal(plan.plannedMinutes, null, 'non-positive minutes are dropped, not faked');
  assert.equal(plan.dailyRank, null, 'ranks outside 1–3 are dropped');

  assert.equal(sanitizeTimeBlock({ id: 'b', taskId: 't', startAt: NOW, endAt: NOW }), null);
  assert.equal(sanitizeTimeBlock({ id: 'b', taskId: 't', startAt: NOW + 10, endAt: NOW }), null);
  assert.equal(sanitizeTimeBlock({ id: '', taskId: 't', startAt: NOW, endAt: NOW + 1 }), null);

  assert.equal(sanitizeProjectSection({ id: 's', projectId: 'p', name: '   ' }), null);
  assert.equal(sanitizeProjectSection({ id: 's', projectId: '', name: 'Doing' }), null);

  assert.equal(sanitizeFocusSession({ id: 'f', taskId: 't', startedAt: NOW, endedAt: NOW - 1, activeMs: 0 }), null);
  assert.equal(sanitizeFocusSession({ id: 'f', taskId: 't', startedAt: NOW, activeMs: -1 }), null);
  assert.equal(sanitizeFocusSession({ id: 'f', taskId: 't', startedAt: NOW, activeMs: 0, endedAt: NOW + 1, outcome: null }), null, 'ended session requires an outcome');
  assert.equal(sanitizeFocusSession({ id: 'f', taskId: 't', startedAt: NOW, activeMs: 0, outcome: 'completed' }), null, 'live session must not carry an outcome');
});

// ── Backup round-trip ──────────────────────────────────────────────────────────

test('backup v5 round-trips the planning domain', () => {
  withStore((store) => {
    const project = store.createProject({ name: 'Research', status: 'onHold' }, NOW);
    const task = store.createTask({ title: 'Paper', projectId: project.id }, NOW);
    const section = store.createProjectSection({ projectId: project.id, name: 'Doing' }, NOW);
    store.setTaskSection(task.id, section.id, NOW);
    store.upsertDailyPlan({ taskId: task.id, localDate: '2026-08-10', plannedMinutes: 90, dailyRank: 1 }, NOW);
    const block = store.createTimeBlock(
      { taskId: task.id, startAt: NOW, endAt: NOW + 3_600_000, source: 'planner', timeZone: 'Asia/Shanghai' },
      NOW
    );
    const session = store.startFocusSession({ taskId: task.id, timeBlockId: block.id }, NOW);
    store.addFocusSessionActiveMs(session.id, 120_000, NOW);
    store.endFocusSession(session.id, 'paused', NOW + 300_000);

    const text = createBackup(DEFAULT_SETTINGS, [], '1.2.0', NOW, {
      tasks: store.getTasks(),
      projects: store.getProjects(),
      standaloneReminders: [],
      activeTaskId: null,
      dailyTaskPlans: store.getAllDailyTaskPlans(),
      timeBlocks: store.getTimeBlocks(),
      projectSections: store.getAllProjectSections(),
      focusSessions: store.getFocusSessions()
    });
    const backup = parseBackup(text);
    assert.equal(backup.version, 5);
    assert.equal(backup.dailyTaskPlans.length, 1);
    assert.equal(backup.dailyTaskPlans[0].dailyRank, 1);
    assert.equal(backup.timeBlocks.length, 1);
    assert.equal(backup.timeBlocks[0].timeZone, 'Asia/Shanghai');
    assert.equal(backup.projectSections.length, 1);
    assert.equal(backup.focusSessions.length, 1);
    assert.equal(backup.focusSessions[0].outcome, 'paused');
    assert.equal(backup.focusSessions[0].timeBlockId, block.id);
    assert.equal(backup.projects[0].status, 'onHold');
    assert.equal(backup.tasks[0].sectionId, section.id);

    // Apply into a fresh store exactly like importBackup does.
    withStore((target) => {
      target.replaceProjects(backup.projects);
      target.replaceAllProjectSections(backup.projectSections);
      target.replaceAll(backup.tasks);
      target.replaceAllDailyTaskPlans(backup.dailyTaskPlans);
      target.replaceAllTimeBlocks(backup.timeBlocks);
      target.replaceAllFocusSessions(backup.focusSessions);
      assert.equal(target.getTask(task.id)?.sectionId, section.id);
      assert.equal(target.getProject(project.id)?.status, 'onHold');
      assert.equal(target.getDailyPlans('2026-08-10')[0].plannedMinutes, 90);
      assert.equal(target.getTimeBlocksForTask(task.id).length, 1);
      assert.equal(target.getFocusSessions()[0].activeMs, 120_000);
    });
  });
});

test('pre-v5 backups import with an empty planning domain', () => {
  const legacy = JSON.stringify({
    version: 4,
    createdAt: NOW,
    appVersion: '1.1.0',
    settings: { ...DEFAULT_SETTINGS },
    reminderHistory: [],
    tasks: [],
    projects: [],
    standaloneReminders: [],
    activeTaskId: null,
    taskReminderOccurrences: [],
    characterCollection: null
  });
  const backup = parseBackup(legacy);
  assert.deepEqual(backup.dailyTaskPlans, []);
  assert.deepEqual(backup.timeBlocks, []);
  assert.deepEqual(backup.projectSections, []);
  assert.deepEqual(backup.focusSessions, []);
});

test('backup import drops planning rows that lost their referential target', () => {
  const text = createBackup(DEFAULT_SETTINGS, [], '1.2.0', NOW, {
    tasks: [],
    projects: [],
    standaloneReminders: [],
    activeTaskId: null,
    dailyTaskPlans: [{ taskId: 'ghost', localDate: '2026-08-10', plannedMinutes: 30, dailyRank: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW }],
    timeBlocks: [{ id: 'tb', taskId: 'ghost', startAt: NOW, endAt: NOW + 1000, timeZone: 'local', source: 'manual', createdAt: NOW, updatedAt: NOW }],
    projectSections: [{ id: 'sec', projectId: 'ghost-project', name: 'Doing', sortOrder: 0, createdAt: NOW, updatedAt: NOW }],
    focusSessions: [{ id: 'fs', taskId: 'ghost', timeBlockId: 'tb', startedAt: NOW, endedAt: NOW + 10, activeMs: 10, outcome: 'completed', createdAt: NOW }]
  });
  const backup = parseBackup(text);
  assert.deepEqual(backup.dailyTaskPlans, []);
  assert.deepEqual(backup.timeBlocks, []);
  assert.deepEqual(backup.projectSections, []);
  assert.deepEqual(backup.focusSessions, []);
});

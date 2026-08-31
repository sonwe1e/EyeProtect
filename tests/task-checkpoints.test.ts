import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TaskStore } from '../src/main/taskStore';

const NOW = new Date(2026, 7, 30, 10, 0, 0).getTime();
const TODAY_START = new Date(2026, 7, 30, 0, 0, 0).getTime();

test('task checkpoints, daily reflections and workstream summaries persist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-checkpoints-'));
  try {
    const store = new TaskStore(dir);
    const project = store.createProject({ name: '代码整理' }, NOW);
    const section = store.createProjectSection({ projectId: project.id, name: '核心模块' }, NOW);
    const task = store.createTask({ title: '扫描仓库', projectId: project.id }, NOW);
    store.setTaskSection(task.id, section.id, NOW);
    store.recordWorkSegment(task.id, NOW, NOW + 20 * 60_000, 20 * 60_000);
    const checkpoint = store.createTaskCheckpoint({
      taskId: task.id,
      kind: 'switch',
      progress: '已确认仓库边界',
      nextStep: '整理核心模块',
      feeling: '被打断后需要重新进入状态'
    }, NOW + 20 * 60_000);
    const reflection = store.upsertDailyReflection({
      localDate: '2026-08-30',
      note: '今天完成了仓库盘点',
      nextStep: '明天先整理核心模块'
    }, NOW + 30 * 60_000);

    assert.equal(store.getTaskCheckpoints(task.id)[0].id, checkpoint.id);
    assert.equal(store.getTaskCheckpoints(task.id)[0].nextStep, '整理核心模块');
    assert.equal(store.getDailyReflection('2026-08-30')?.note, reflection.note);
    assert.deepEqual(store.getProjectWorkstreamSummaries(project.id, TODAY_START), [{
      sectionId: section.id,
      openTaskCount: 1,
      doneTaskCount: 0,
      todayWorkMs: 20 * 60_000,
      totalWorkMs: 20 * 60_000,
      latestCheckpoint: checkpoint
    }]);

    TaskStore.closeAllForDirectory(dir);
    const reopened = new TaskStore(dir);
    assert.equal(reopened.getTaskCheckpoints(task.id)[0].progress, '已确认仓库边界');
    assert.equal(reopened.getDailyReflection('2026-08-30')?.nextStep, '明天先整理核心模块');
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

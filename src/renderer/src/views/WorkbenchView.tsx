import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, Bell, CalendarRange, CheckCircle2, Footprints, Gift, Inbox, Search, Settings2, Sun } from 'lucide-react';
import {
  matchesTaskView,
  matchesProjectView,
  sortTasksForView,
  type FailedDeliveryNotice,
  type Project,
  type Task,
  type TaskView
} from '../../../shared/types';
import { AppHealthBanner } from '../components/AppHealthBanner';
import { CommandButton } from '../components/CommandButton';
import { ProjectList } from '../features/tasks/ProjectList';
import { StandaloneReminderSection } from '../features/reminders/StandaloneReminderSection';
import { TaskComposer } from '../features/tasks/TaskComposer';
import { TaskDetail } from '../features/tasks/TaskDetail';
import { TaskList } from '../features/tasks/TaskList';
import { useActiveTaskId } from '../hooks/useActiveTask';
import { useAppHealth } from '../hooks/useAppHealth';
import { useClock } from '../hooks/useClock';
import { useProjects } from '../hooks/useProjects';
import { useTasks } from '../hooks/useTasks';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useTaskWork } from '../hooks/useTaskWork';
import { useCommand } from '../hooks/useCommand';
import { useUndo } from '../hooks/useUndo';
import { commands } from '../lib/commands';
import SettingsView from './SettingsView';
import { CharacterCollectionView } from '../features/characters/CharacterCollectionView';

const PRIMARY_VIEWS: TaskView[] = ['today', 'inbox', 'upcoming', 'overdue', 'away', 'completed'];
const VIEW_LABELS: Partial<Record<TaskView, string>> = {
  inbox: '收件箱',
  today: '今天',
  upcoming: '即将到来',
  overdue: '过期',
  away: '离桌任务',
  completed: '已完成',
  archived: '已归档'
};
const VIEW_ICONS: Partial<Record<TaskView, typeof Inbox>> = {
  inbox: Inbox,
  today: Sun,
  upcoming: CalendarRange,
  overdue: AlertTriangle,
  away: Footprints,
  completed: CheckCircle2
};
type WorkbenchSection = 'tasks' | 'settings' | 'reminders' | 'collection';

export default function WorkbenchView(): JSX.Element {
  const tasks = useTasks();
  const projects = useProjects();
  const activeTaskId = useActiveTaskId();
  const reminderStatus = useReminderStatus();
  const work = useTaskWork();
  const undo = useUndo();
  const health = useAppHealth();
  const now = useClock(60_000);
  const retryDelivery = useCommand((id: string) => commands.deliveries.retry(id));
  const dismissDelivery = useCommand((id: string) => commands.deliveries.dismiss(id));
  const moveTaskCommand = useCommand((input: Parameters<typeof commands.tasks.move>[0]) =>
    commands.tasks.move(input)
  );
  const undoCommand = useCommand((id: string) => commands.tasks.undo(id));
  const pause = useCommand((minutes: number) => commands.scheduler.pause(minutes));
  const resume = useCommand(() => commands.scheduler.resume());
  const [section, setSection] = useState<WorkbenchSection>('tasks');
  const [selectedView, setSelectedView] = useState<TaskView>('today');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<'all' | Task['priority']>('all');
  const [contextFilter, setContextFilter] = useState<'all' | Task['context']>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Task['status']>('all');
  const [failedDeliveries, setFailedDeliveries] = useState<FailedDeliveryNotice[]>([]);

  useEffect(() => {
    const navigate = (target: 'today' | 'settings' | 'reminders' | 'collection'): void => {
      if (target === 'settings' || target === 'reminders' || target === 'collection') {
        setSection(target);
      } else {
        setSection('tasks');
        setSelectedView('today');
        setSelectedProjectId(null);
      }
    };
    void window.eyeProtect.getWorkbenchSection().then(navigate);
    return window.eyeProtect.onWorkbenchNavigate(navigate);
  }, []);

  useEffect(() => {
    void window.eyeProtect.getFailedDeliveries().then(setFailedDeliveries);
    return window.eyeProtect.onFailedDeliveriesChanged(setFailedDeliveries);
  }, []);

  const viewCounts = useMemo(() => Object.fromEntries(PRIMARY_VIEWS.map((view) => [
    view,
    tasks.filter((task) => matchesTaskView(task, view, now, activeTaskId)).length
  ])) as Partial<Record<TaskView, number>>, [tasks, now, activeTaskId]);

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const scoped = query
      ? tasks.filter((task) => task.status !== 'archived')
      : selectedProjectId
        ? tasks.filter((task) => matchesProjectView(task, selectedProjectId))
        : tasks.filter((task) => matchesTaskView(task, selectedView, now, activeTaskId));
    const filtered = scoped.filter((task) => {
      const searchable = `${task.title}\n${task.notes ?? ''}\n${task.tags.join('\n')}`.toLocaleLowerCase();
      return (!query || searchable.includes(query)) &&
        (priorityFilter === 'all' || task.priority === priorityFilter) &&
        (contextFilter === 'all' || task.context === contextFilter) &&
        (statusFilter === 'all' || task.status === statusFilter);
    });
    const manualScope = !query && priorityFilter === 'all' && contextFilter === 'all' && statusFilter === 'all' &&
      (selectedProjectId !== null || selectedView === 'inbox');
    return manualScope
      ? [...filtered].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
      : sortTasksForView(filtered, now);
  }, [tasks, selectedView, selectedProjectId, now, activeTaskId, search, priorityFilter, contextFilter, statusFilter]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null;

  const selectView = useCallback((view: TaskView) => {
    setSection('tasks');
    setSelectedView(view);
    setSelectedProjectId(null);
    setSelectedTaskId(null);
  }, []);
  const selectProject = useCallback((id: string | null) => {
    setSection('tasks');
    setSelectedProjectId(id);
    setSelectedTaskId(null);
  }, []);
  const filtersClear = !search.trim() && priorityFilter === 'all' && contextFilter === 'all' && statusFilter === 'all';
  const canReorder = filtersClear && (selectedProjectId !== null || selectedView === 'inbox');
  const minutes = (value: number): string => `${Math.floor(value / 60_000)}m`;
  const eyeRemaining = Math.max(0, reminderStatus.nextEyeAt - now);
  const walkRemaining = Math.max(0, reminderStatus.nextWalkAt - now);
  const failedDelivery = failedDeliveries[0] ?? null;
  const locateFailedDelivery = useCallback((notice: FailedDeliveryNotice) => {
    if (notice.source === 'standalone') {
      setSection('reminders');
      return;
    }
    setSection('tasks');
    setSelectedView('today');
    setSelectedProjectId(null);
    if (tasks.some((task) => task.id === notice.sourceId)) setSelectedTaskId(notice.sourceId);
  }, [tasks]);

  return (
    <main className="workbench-shell">
      <AppHealthBanner health={health} />
      <header className="rhythm-strip">
        <strong>EyeProtect</strong>
        <span>👁 {minutes(eyeRemaining)}</span>
        <span>🚶 {minutes(walkRemaining)}</span>
        <span>连续活跃 {minutes(work.continuousActiveMs)}</span>
        <span>当前任务 {activeTask ? minutes(work.taskActiveMs) : '—'}</span>
        {activeTask?.estimateMinutes ? <span>{Math.min(100, Math.round(work.taskActiveMs / (activeTask.estimateMinutes * 600)))}%</span> : null}
        {reminderStatus.pausedUntil ? (
          <CommandButton type="button" state={resume.state} errorReason={resume.error?.message} onClick={() => void resume.run()}>
            恢复提醒
          </CommandButton>
        ) : (
          <CommandButton type="button" state={pause.state} errorReason={pause.error?.message} onClick={() => void pause.run(30)}>
            暂停提醒
          </CommandButton>
        )}
      </header>
      <aside className="workbench-sidebar">
        <div className="sidebar-brand"><span className="sidebar-brand-title">EyeProtect</span><span className="sidebar-brand-sub">工作台</span></div>
        <nav className="sidebar-nav">
          {PRIMARY_VIEWS.map((view) => {
            const Icon = VIEW_ICONS[view]!;
            return <button key={view} type="button" className={`nav-item ${section === 'tasks' && selectedView === view && selectedProjectId === null ? 'is-active' : ''}`.trim()} onClick={() => selectView(view)}>
              <Icon size={15} /><span>{VIEW_LABELS[view]}</span><span className="nav-item-count">{viewCounts[view] ?? 0}</span>
            </button>;
          })}
        </nav>
        <ProjectList
          projects={projects}
          tasks={tasks}
          selectedProjectId={selectedProjectId}
          onSelect={selectProject}
        />
        <div className="sidebar-tools">
          <button type="button" className={`nav-item ${section === 'collection' ? 'is-active' : ''}`} onClick={() => setSection('collection')}><Gift size={15} /><span>公仔收藏</span></button>
          <button type="button" className={`nav-item ${section === 'reminders' ? 'is-active' : ''}`} onClick={() => setSection('reminders')}><Bell size={15} /><span>独立提醒</span></button>
          <button type="button" className={`nav-item ${section === 'settings' ? 'is-active' : ''}`} onClick={() => setSection('settings')}><Settings2 size={15} /><span>设置</span></button>
        </div>
      </aside>

      {section === 'settings' ? <section className="workbench-embedded-page"><SettingsView embedded /></section> : null}
      {section === 'reminders' ? <section className="workbench-embedded-page"><StandaloneReminderSection /></section> : null}
      {section === 'collection' ? <section className="workbench-embedded-page"><CharacterCollectionView /></section> : null}
      {section === 'tasks' ? <>
        <section className="workbench-main">
          <header className="workbench-main-header">
            <div><h1>{selectedProjectId ? projects.find((project) => project.id === selectedProjectId)?.name ?? '项目' : VIEW_LABELS[selectedView]}</h1>
              {activeTask ? <button className="active-task-pill" type="button" onClick={() => setSelectedTaskId(activeTask.id)}>进行中：{activeTask.title}</button> : null}
            </div>
            <div className="workbench-header-actions">
              {selectedProjectId === null && (selectedView === 'completed' || selectedView === 'archived') ? (
                <button type="button" className="completed-filter" onClick={() => selectView(selectedView === 'completed' ? 'archived' : 'completed')}>
                  <Archive size={13} />{selectedView === 'completed' ? '查看归档' : '返回已完成'}
                </button>
              ) : null}
              <span className="workbench-main-count">{filteredTasks.length} 项任务</span>
            </div>
          </header>
          <div className="workbench-filters">
            <label><Search size={14} /><input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="搜索标题、备注或标签" /></label>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.currentTarget.value as typeof priorityFilter)}><option value="all">全部优先级</option><option value="normal">普通</option><option value="important">重要</option><option value="urgent">紧急</option></select>
            <select value={contextFilter} onChange={(event) => setContextFilter(event.currentTarget.value as typeof contextFilter)}><option value="all">全部上下文</option><option value="desk">桌面</option><option value="away">离桌</option><option value="any">任意</option></select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value as typeof statusFilter)}><option value="all">全部状态</option><option value="open">未完成</option><option value="done">已完成</option><option value="archived">已归档</option></select>
          </div>
          <div className="workbench-main-body">
            <TaskComposer projects={projects} defaultProjectId={selectedProjectId} />
            <TaskList
              tasks={filteredTasks}
              view={selectedView}
              projects={projects}
              now={now}
              selectedTaskId={selectedTaskId}
              scopeProjectId={selectedProjectId}
              onSelect={setSelectedTaskId}
              onMove={canReorder ? (taskId, beforeTaskId) => {
                void moveTaskCommand.run({
                  taskId,
                  beforeTaskId,
                  scope: selectedProjectId ? { type: 'project', projectId: selectedProjectId } : { type: 'inbox' }
                });
              } : undefined}
            />
          </div>
        </section>
        <aside className="workbench-detail">
          {selectedTask ? <TaskDetail key={selectedTask.id} task={selectedTask} tasks={tasks} projects={projects} active={selectedTask.id === activeTaskId} onDeleted={() => setSelectedTaskId(null)} /> : <div className="empty-state"><Sun size={28} /><p>选择任务查看详情，或新建一件开始。</p></div>}
        </aside>
      </> : null}
      {undo ? <div className="undo-toast"><span>{undo.kind === 'delete' ? '已删除' : '已完成'}「{undo.taskTitle}」</span><CommandButton type="button" state={undoCommand.state} errorReason={undoCommand.error?.message} onClick={() => void undoCommand.run(undo.operationId)}>撤销</CommandButton></div> : null}
      {failedDelivery ? <div className="delivery-failure-banner" role="alert">
        <div><strong>有一条提醒未能送达{failedDeliveries.length > 1 ? `（${failedDeliveries.length} 条）` : ''}</strong><span>{failedDelivery.title} · {failedDelivery.body}</span></div>
        <button type="button" onClick={() => locateFailedDelivery(failedDelivery)}>查看来源</button>
        <CommandButton type="button" state={retryDelivery.state} errorReason={retryDelivery.error?.message} onClick={() => void retryDelivery.run(failedDelivery.id)}>重试</CommandButton>
        <CommandButton type="button" state={dismissDelivery.state} errorReason={dismissDelivery.error?.message} onClick={() => void dismissDelivery.run(failedDelivery.id)}>忽略</CommandButton>
      </div> : null}
    </main>
  );
}

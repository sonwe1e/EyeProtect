import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, Bell, CalendarRange, CheckCircle2, Footprints, Gift, Inbox, Search, Settings2, Sun } from 'lucide-react';
import {
  matchesTaskView,
  matchesProjectView,
  sortTasksForView,
  type Project,
  type Task,
  type TaskStatus,
  type TaskUpdateInput,
  type TaskView,
  type TodoPriority
} from '../../../shared/types';
import { ProjectList } from '../features/tasks/ProjectList';
import { StandaloneReminderSection } from '../features/reminders/StandaloneReminderSection';
import { TaskComposer } from '../features/tasks/TaskComposer';
import { TaskDetail } from '../features/tasks/TaskDetail';
import { TaskList } from '../features/tasks/TaskList';
import { useActiveTaskId } from '../hooks/useActiveTask';
import { useClock } from '../hooks/useClock';
import { useProjects } from '../hooks/useProjects';
import { useTasks } from '../hooks/useTasks';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useTaskWork } from '../hooks/useTaskWork';
import { useUndo } from '../hooks/useUndo';
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
  const now = useClock(60_000);
  const [section, setSection] = useState<WorkbenchSection>('tasks');
  const [selectedView, setSelectedView] = useState<TaskView>('today');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<'all' | TodoPriority>('all');
  const [contextFilter, setContextFilter] = useState<'all' | Task['context']>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');

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
    return sortTasksForView(filtered, now);
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
  const updateTask = useCallback((id: string, input: TaskUpdateInput) => void window.eyeProtect.updateTask(id, input), []);
  const deleteTask = useCallback((id: string) => void window.eyeProtect.deleteTask(id).then(() => setSelectedTaskId((current) => current === id ? null : current)), []);
  const changeStatus = useCallback((id: string, status: TaskStatus) => void window.eyeProtect.setTaskStatus(id, status), []);
  const changePriority = useCallback((id: string, priority: TodoPriority) => void window.eyeProtect.updateTask(id, { priority }), []);
  const createProject = useCallback((name: string) => {
    const used = new Set(projects.map((project) => project.color).filter(Boolean));
    const palette = ['#217a70', '#e67e22', '#c0392b', '#3498db', '#8e44ad', '#16a085'];
    void window.eyeProtect.createProject({ name, color: palette.find((color) => !used.has(color)) ?? palette[0] });
  }, [projects]);
  const renameProject = useCallback((id: string, name: string) => void window.eyeProtect.updateProject(id, { name }), []);
  const deleteProject = useCallback((id: string) => void window.eyeProtect.deleteProject(id).then(() => setSelectedProjectId((current) => current === id ? null : current)), []);
  const filtersClear = !search.trim() && priorityFilter === 'all' && contextFilter === 'all' && statusFilter === 'all';
  const canReorder = filtersClear && (selectedProjectId !== null || selectedView === 'inbox');
  const moveTask = useCallback((taskId: string, beforeTaskId: string | null) => {
    if (selectedProjectId) {
      void window.eyeProtect.moveTask({ taskId, beforeTaskId, scope: { type: 'project', projectId: selectedProjectId } });
    } else if (selectedView === 'inbox') {
      void window.eyeProtect.moveTask({ taskId, beforeTaskId, scope: { type: 'inbox' } });
    }
  }, [selectedProjectId, selectedView]);
  const minutes = (value: number): string => `${Math.floor(value / 60_000)}m`;
  const eyeRemaining = Math.max(0, reminderStatus.nextEyeAt - now);
  const walkRemaining = Math.max(0, reminderStatus.nextWalkAt - now);

  return (
    <main className="workbench-shell">
      <header className="rhythm-strip">
        <strong>EyeProtect</strong>
        <span>👁 {minutes(eyeRemaining)}</span>
        <span>🚶 {minutes(walkRemaining)}</span>
        <span>连续活跃 {minutes(work.continuousActiveMs)}</span>
        <span>当前任务 {activeTask ? minutes(work.taskActiveMs) : '—'}</span>
        {activeTask?.estimateMinutes ? <span>{Math.min(100, Math.round(work.taskActiveMs / (activeTask.estimateMinutes * 600)))}%</span> : null}
        <button type="button" onClick={() => reminderStatus.pausedUntil ? void window.eyeProtect.resume() : void window.eyeProtect.pause(30)}>
          {reminderStatus.pausedUntil ? '恢复提醒' : '暂停提醒'}
        </button>
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
        <ProjectList projects={projects} tasks={tasks} selectedProjectId={selectedProjectId} onSelect={selectProject} onCreate={createProject} onRename={renameProject} onDelete={deleteProject} />
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
            <TaskList tasks={filteredTasks} view={selectedView} projects={projects} now={now} selectedTaskId={selectedTaskId} onSelect={setSelectedTaskId} onStatusChange={changeStatus} onUpdate={updateTask} onDelete={deleteTask} onPriorityChange={changePriority} onMove={canReorder ? moveTask : undefined} />
          </div>
        </section>
        <aside className="workbench-detail">
          {selectedTask ? <TaskDetail key={selectedTask.id} task={selectedTask} tasks={tasks} projects={projects} active={selectedTask.id === activeTaskId} onDeleted={() => setSelectedTaskId(null)} /> : <div className="empty-state"><Sun size={28} /><p>选择任务查看详情，或新建一件开始。</p></div>}
        </aside>
      </> : null}
      {undo ? <div className="undo-toast"><span>{undo.kind === 'delete' ? '已删除' : '已完成'}「{undo.taskTitle}」</span><button type="button" onClick={() => void window.eyeProtect.undoTaskOperation(undo.operationId)}>撤销</button></div> : null}
    </main>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Folder,
  Pause,
  Pin,
  Play,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Timer,
  Trash2
} from 'lucide-react';
import { localDateKey } from '../../../shared/calendar';
import { groupSimpleTasks, isCurrentTask, isSimpleList, taskSteps } from '../../../shared/simpleTasks';
import { PixelAnimal } from '../features/characters/PixelAnimal';
import type { Project, Task, TaskUpdateInput, WorkbenchNavPayload } from '../../../shared/types';
import { useTasks } from '../hooks/useTasks';
import { useProjects } from '../hooks/useProjects';
import { useSettings } from '../hooks/useSettings';
import { useCommand } from '../hooks/useCommand';
import { useUndo } from '../hooks/useUndo';
import { useClock } from '../hooks/useClock';
import { useAppHealth } from '../hooks/useAppHealth';
import { usePomodoro } from '../hooks/usePomodoro';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { AppHealthBanner } from '../components/AppHealthBanner';
import { CommandButton } from '../components/CommandButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useConfirm } from '../hooks/useConfirm';
import { run } from '../lib/commands';
import { SimpleSettings } from '../features/simple/SimpleSettings';
import { PRIMARY_WORKBENCH_SECTIONS, WORKBENCH_SECTIONS, type WorkbenchSectionId } from '../features/workbench/workbenchNavigation';
import type { FailedDeliveryNotice } from '../../../shared/types';
import '../styles/simple.css';

type TaskDraftMap = Record<string, TaskUpdateInput>;

const emptyDraft = (task: Task): TaskUpdateInput => ({
  title: task.title,
  dueDate: task.dueDate,
  reminderAt: task.reminderAt,
  notes: task.notes,
  projectId: task.projectId
});

const isDraftDirty = (draft: TaskUpdateInput, task: Task): boolean =>
  draft.title !== task.title ||
  draft.dueDate !== task.dueDate ||
  draft.reminderAt !== task.reminderAt ||
  draft.notes !== task.notes ||
  draft.projectId !== task.projectId;

const formatMinutes = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`;
};

export default function WorkbenchView(): JSX.Element {
  const tasks = useTasks();
  const { settings } = useSettings();
  const [failures, setFailures] = useState<FailedDeliveryNotice[]>([]);
  const projects = useProjects();
  const [tab, setTab] = useState<WorkbenchSectionId>('today');
  const [list, setList] = useState('all');
  const [listName, setListName] = useState('');
  const [listEditor, setListEditor] = useState<'new' | 'rename' | null>(null);
  const [title, setTitle] = useState('');
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<TaskDraftMap>({});
  const [pendingFocusTaskId, setPendingFocusTaskId] = useState<string | null>(null);
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  const undo = useUndo();
  const now = useClock(30_000);
  const health = useAppHealth();
  const pomodoro = usePomodoro();
  const reminderStatus = useReminderStatus();

  useEffect(() => {
    const navigate = (payload: WorkbenchNavPayload | WorkbenchSectionId): void => {
      const next: WorkbenchNavPayload =
        typeof payload === 'string'
          ? { section: payload, focusTaskId: null }
          : payload;
      const target: WorkbenchSectionId =
        next.section === 'settings' ? 'settings' : next.section === 'review' ? 'review' : 'today';
      setTab(target);
      if (target === 'today') {
        setList('all');
        setSearch('');
        if (next.focusTaskId) {
          setExpanded(next.focusTaskId);
          setPendingFocusTaskId(next.focusTaskId);
        }
      }
    };
    void window.eyeProtect.getFailedDeliveries().then(setFailures);
    const unbindFailures = window.eyeProtect.onFailedDeliveriesChanged(setFailures);
    void window.eyeProtect.getWorkbenchSection().then(navigate);
    const unbindNavigate = window.eyeProtect.onWorkbenchNavigate(navigate);
    return () => {
      unbindFailures();
      unbindNavigate();
    };
  }, []);

  useEffect(() => {
    if (!pendingFocusTaskId) return;
    const id = pendingFocusTaskId;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`simple-task-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setPendingFocusTaskId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingFocusTaskId, expanded, selectedKey(tasks, list, search)]);

  const updateDraft = (taskId: string, draft: TaskUpdateInput | null): void => {
    setTaskDrafts((current) => {
      const next = { ...current };
      if (draft === null) delete next[taskId];
      else next[taskId] = draft;
      return next;
    });
  };

  const lists = projects.filter(isSimpleList);
  const confirmState = useConfirm();
  const todayKey = localDateKey(now);
  const selected = tasks.filter((task) => !task.parentId && (tab === 'review' || isCurrentTask(task, projects)) &&
    (list === 'all' || (list === 'default' ? !task.projectId : task.projectId === list)) && task.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const history = selected.filter((task) => task.status === 'done' && task.completedAt !== null && (!date || localDateKey(task.completedAt) === date)).sort((a, b) => b.completedAt! - a.completedAt!);
  const days = [...new Set(history.map((task) => localDateKey(task.completedAt!)))];
  const openTasks = selected.filter((task) => task.status === 'open');
  const todayDone = selected.filter((task) => task.status === 'done' && task.completedAt !== null && localDateKey(task.completedAt) === todayKey);
  const searchHasOnlyDoneMatches = Boolean(search) && selected.length > 0 && openTasks.length === 0 && groupSimpleTasks(selected, now).every((group) => group.tasks.length === 0);
  const dateLabel = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'long' }).format(new Date(now));
  const dirtyCount = Object.keys(taskDrafts).filter((id) => {
    const task = tasks.find((entry) => entry.id === id);
    return task ? isDraftDirty(taskDrafts[id], task) : false;
  }).length;

  return <main className="simple-workbench">
    <ConfirmDialog pending={confirmState.pending} onResolve={confirmState.resolveConfirm} />
    <header className="simple-header"><span className="simple-brand"><span className="simple-brand-mark" aria-hidden="true"><Sparkles size={15} /></span><strong>EyeProtect</strong></span><nav aria-label="主导航">
      {PRIMARY_WORKBENCH_SECTIONS.map((id) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{WORKBENCH_SECTIONS[id].label}</button>)}
    </nav><button className="simple-icon-button" aria-label="设置" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}><SettingsIcon size={19} /></button></header>
    <div className="simple-content"><AppHealthBanner health={health} />
      {failures.map((failure) => <div role="alert" className="simple-undo" key={failure.id}><span>{failure.title} · {failure.body}</span><button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.retryFailedDelivery(failure.id))}>重试</button><button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.dismissFailedDelivery(failure.id))}>忽略</button></div>)}
      {action.error ? <p role="alert">{action.error.message}</p> : null}
      {undo && tab !== 'settings' ? <div className="simple-undo">{undo.kind === 'complete' ? '已完成：' : '已删除：'}{undo.taskTitle}<button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.undoTaskOperation(undo.operationId))}>撤销</button></div> : null}
      {dirtyCount > 0 ? <div className="simple-undo simple-dirty-hint" role="status"><span>有 {dirtyCount} 项任务存在未保存修改，收起详情也会保留草稿</span></div> : null}
      <LiveStatusStrip tasks={tasks} pomodoro={pomodoro} pausedUntil={reminderStatus.pausedUntil} />
      {tab === 'settings' ? <SimpleSettings /> : <>
        {tab === 'today' ? (
          <div className="simple-rhythm-banner">
            <div className="simple-rhythm-info">
              <div className="simple-rhythm-title">
                <Sparkles size={16} aria-hidden="true" />
                <span>{dateLabel} · 今日待办节奏</span>
              </div>
              <div className="simple-rhythm-sub">
                {openTasks.length > 0
                  ? `还有 ${openTasks.length} 项待处理，专注工作之余记得护眼休息`
                  : '今日待办已全部完成，保持好心情与健康节奏'}
              </div>
            </div>
            <div className="simple-rhythm-stats">
              <span className="simple-stat-pill">
                <Clock size={13} aria-hidden="true" />
                <span>当前清单待办 {openTasks.length}</span>
              </span>
              <span className="simple-stat-pill is-done">
                <CheckCircle2 size={13} aria-hidden="true" />
                <span>今日完成 {todayDone.length} 项</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="simple-rhythm-banner">
            <div className="simple-rhythm-info">
              <div className="simple-rhythm-title">
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>完成记录与回顾</span>
              </div>
              <div className="simple-rhythm-sub">
                {history.length > 0
                  ? `筛选结果 ${history.length} 项完成，见证你的每日点滴专注`
                  : '完成的任务会自动收录在此处'}
              </div>
            </div>
            <div className="simple-rhythm-stats">
              <span className="simple-stat-pill is-done">
                <CheckCircle2 size={13} aria-hidden="true" />
                <span>筛选结果 {history.length}</span>
              </span>
              {days.length > 0 ? (
                <span className="simple-stat-pill">
                  <Calendar size={13} aria-hidden="true" />
                  <span>跨越 {days.length} 天</span>
                </span>
              ) : null}
            </div>
          </div>
        )}
        <div className="simple-filters"><input type="search" aria-label="搜索任务" placeholder="搜索任务" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          <select aria-label="清单筛选" value={list} onChange={(e) => setList(e.currentTarget.value)}><option value="all">全部清单</option><option value="default">默认清单</option>{lists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button onClick={() => { setListName(''); setListEditor('new'); }}>＋清单</button>
          {list !== 'all' && list !== 'default' ? <button onClick={() => { setListName(lists.find((p) => p.id === list)?.name ?? ''); setListEditor('rename'); }}>重命名</button> : null}
          {tab === 'review' ? <input type="date" aria-label="完成日期" value={date} onChange={(e) => setDate(e.currentTarget.value)} /> : null}
        </div>
        {listEditor ? <form className="simple-add" onSubmit={(e) => { e.preventDefault(); if (!listName.trim()) return; void action.run(async () => { if (listEditor === 'new') { const result = await window.eyeProtect.createProject({ name: listName.trim() }); const created = result.find((p) => !projects.some((old) => old.id === p.id)); if (created) setList(created.id); } else await window.eyeProtect.updateProject(list, { name: listName.trim() }); setListEditor(null); }); }}><input aria-label="清单名称" autoFocus value={listName} onChange={(e) => setListName(e.currentTarget.value)} /><button className="primary" disabled={action.isPending}>保存清单</button><button type="button" onClick={() => setListEditor(null)}>取消</button></form> : null}
        {tab === 'today' ? <>
          <form className="simple-add" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; void action.run(async () => { await window.eyeProtect.createTask({ title: title.trim(), projectId: list === 'all' || list === 'default' ? null : list }); setTitle(''); }); }}>
            <input aria-label="添加任务" placeholder="添加任务，回车保存…" value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={300} /><button className="primary" disabled={action.isPending || !title.trim()}>添加</button>
          </form>
          {groupSimpleTasks(selected, now).map((group) => group.tasks.length ? <section className="simple-group" key={group.title}><h2>{group.title}<small>{group.tasks.length}</small></h2>{group.tasks.map((task) => {
            const draft = taskDrafts[task.id];
            const dirty = draft ? isDraftDirty(draft, task) : false;
            return <SimpleTask
              key={task.id}
              task={task}
              tasks={tasks}
              projects={projects}
              expanded={expanded === task.id}
              dirty={dirty}
              draft={draft}
              onDraftChange={(next) => updateDraft(task.id, next)}
              onExpand={() => setExpanded(expanded === task.id ? null : task.id)}
              confirm={confirmState.confirm}
              todayKey={todayKey}
            />;
          })}</section> : null)}
          {selected.length > 0 && !selected.some((task) => task.status === 'open') && !search ? (
            <div className="simple-empty-state">
              <div className="simple-empty-animal">
                <PixelAnimal animal={settings.petAppearance} action="idle" label="桌宠小憩" />
              </div>
              <h3>今日待办全部搞定啦！</h3>
              <p>没有待处理任务。记一件新想法，或者和小动物一起让眼睛离开屏幕、眺望远方休息片刻吧。</p>
            </div>
          ) : null}
          {selected.length === 0 && !search ? (
            <div className="simple-empty-state">
              <div className="simple-empty-animal">
                <PixelAnimal animal={settings.petAppearance} action="idle" label="桌宠小憩" />
              </div>
              <h3>还没有添加待办任务</h3>
              <p>在上方输入框写下一项要做的事情，按回车即可轻松开始你的每日专注计划。</p>
            </div>
          ) : null}
          {search && searchHasOnlyDoneMatches ? (
            <div className="simple-empty-state">
              <div className="simple-empty-icon"><CheckCircle2 size={22} aria-hidden="true" /></div>
              <h3>“{search}”只出现在完成记录中</h3>
              <p>切换到完成记录页查看，或换个关键词搜索待办。</p>
            </div>
          ) : null}
          {search && groupSimpleTasks(selected, now).every((group) => group.tasks.length === 0) && !searchHasOnlyDoneMatches ? (
            <div className="simple-empty-state">
              <div className="simple-empty-icon"><Search size={22} aria-hidden="true" /></div>
              <h3>未找到匹配“{search}”的任务</h3>
              <p>换个关键词试试，或者直接在上方输入框按回车新建任务。</p>
            </div>
          ) : null}
        </> : days.length ? days.map((day) => (
          <section className="simple-group" key={day}>
            <h2>
              <Calendar size={13} aria-hidden="true" />
              <span>{day}</span>
              <small>{history.filter((task) => localDateKey(task.completedAt!) === day).length} 项完成</small>
            </h2>
            {history.filter((task) => localDateKey(task.completedAt!) === day).map((task) => (
              <div className="simple-history-row" key={task.id}>
                <div className="simple-history-badge" aria-hidden="true">
                  <CheckCircle2 size={16} />
                </div>
                <div className="simple-history-content">
                  <div className="simple-history-header">
                    <span className="simple-history-title">{task.title}</span>
                    <span className="simple-done-tag"><Check size={10} aria-hidden="true" />已完成</span>
                  </div>
                  <div className="simple-history-meta">
                    <span className="simple-project-tag">
                      <Folder size={11} aria-hidden="true" />
                      {projects.find((p) => p.id === task.projectId)?.name ?? '默认清单'}
                    </span>
                    <span className="simple-history-time">
                      <Clock size={11} aria-hidden="true" />
                      {new Date(task.completedAt!).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
                <div className="simple-history-actions">
                  <button
                  type="button"
                  className="simple-history-action-btn"
                  title={
                    projects.find((p) => p.id === task.projectId && (p.status === 'active' || p.status === 'onHold'))
                      ? '恢复至待办清单'
                      : '恢复至默认清单（不会复活已归档清单）'
                  }
                  disabled={action.isPending}
                  onClick={() => void action.run(() => window.eyeProtect.restoreLegacyTask(task.id))}
                >
                    <RotateCcw size={12} aria-hidden="true" />
                    <span>恢复待办</span>
                  </button>
                  <button
                    type="button"
                    className="simple-history-action-btn is-danger"
                    title="彻底删除此条完成记录"
                    disabled={action.isPending}
                    onClick={() => void (async () => {
                      if (await confirmState.confirm('删除后该条记录将被彻底移除。', {
                        title: `删除记录「${task.title}」`,
                        confirmText: '删除',
                        danger: true
                      })) {
                        await action.run(() => window.eyeProtect.deleteTask(task.id));
                      }
                    })()}
                  >
                    <Trash2 size={12} aria-hidden="true" />
                    <span>删除</span>
                  </button>
                </div>
              </div>
            ))}
          </section>
        )) : (
          <div className="simple-empty-state">
            <div className="simple-empty-animal">
              <PixelAnimal animal={settings.petAppearance} action="idle" label="桌宠小憩" />
            </div>
            <h3>还没有符合条件的完成记录</h3>
            <p>完成待办清单中的任务后，这里会自动生成你的每日专注成就记录。</p>
          </div>
        )}
      </>}
    </div>
  </main>;
}

function selectedKey(tasks: Task[], list: string, search: string): string {
  return `${list}|${search}|${tasks.length}|${tasks.map((task) => `${task.id}:${task.revision}:${task.status}`).join(',')}`;
}

function LiveStatusStrip({
  tasks,
  pomodoro,
  pausedUntil
}: {
  tasks: Task[];
  pomodoro: { phase: string; taskId: string | null; remainingMs: number; running: boolean };
  pausedUntil: number | null;
}): JSX.Element | null {
  const focusedTitle = pomodoro.taskId
    ? tasks.find((task) => task.id === pomodoro.taskId)?.title ?? null
    : null;
  const paused = typeof pausedUntil === 'number' && pausedUntil > Date.now();
  const focusing = pomodoro.phase !== 'idle' && pomodoro.phase !== 'ready';
  if (!focusing && !paused) return null;
  return (
    <div className="simple-live-strip" role="status" aria-label="实时状态">
      {focusing ? (
        <span className="simple-live-item">
          <Timer size={14} aria-hidden="true" />
          <strong>{pomodoro.phase === 'break' ? '休息中' : pomodoro.phase === 'focus-finished' ? '专注完成' : '专注中'}</strong>
          <span>{focusedTitle ? `「${focusedTitle}」` : '未绑定任务'}</span>
          <span className="simple-live-time">{formatMinutes(pomodoro.remainingMs)}</span>
        </span>
      ) : null}
      {paused ? (
        <span className="simple-live-item">
          <Pause size={14} aria-hidden="true" />
          <strong>提醒已暂停</strong>
          <span>至 {new Date(pausedUntil).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        </span>
      ) : null}
    </div>
  );
}

function SimpleTask({ task, tasks, projects, expanded, dirty, draft, onDraftChange, onExpand, confirm, todayKey }: {
  task: Task;
  tasks: Task[];
  projects: Project[];
  expanded: boolean;
  dirty: boolean;
  draft: TaskUpdateInput | undefined;
  onDraftChange: (next: TaskUpdateInput | null) => void;
  onExpand: () => void;
  confirm: (message: string, options?: string | { title?: string; detail?: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
  todayKey: string;
}): JSX.Element {
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  const { settings } = useSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const steps = taskSteps(task.id, tasks).filter((step) => step.status !== 'archived');
  const pinned = settings.todoBubbleTaskIds.includes(task.id);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);
  const closeMenu = (): void => setMenuOpen(false);
  const complete = (): void => {
    const pending = steps.filter((step) => step.status === 'open');
    void (async () => {
      if (pending.length && !(await confirm(`还有 ${pending.length} 个步骤未完成。`, { title: '一起完成这些步骤？', confirmText: '一起完成' }))) return;
      await action.run(() => window.eyeProtect.completeTaskTree(task.id, Object.fromEntries([task, ...pending].map((entry) => [entry.id, entry.revision]))));
    })();
  };
  const projectName = projects.find((p) => p.id === task.projectId)?.name;
  return <article id={`simple-task-${task.id}`} className={`simple-task ${expanded ? 'is-expanded' : ''} ${dirty ? 'is-dirty' : ''}`}>
    <div className="simple-task-row">
      <label className="simple-check-hit" title="标记完成">
        <input type="checkbox" aria-label={`完成 ${task.title}`} checked={false} disabled={action.isPending} onChange={complete} onClick={(e) => e.stopPropagation()} />
      </label>
      <button className="simple-task-name" aria-expanded={expanded} onClick={onExpand}>{task.title}</button>
      {dirty ? <span className="simple-dirty-tag" title="有未保存修改，收起详情也会保留">未保存</span> : null}
      {task.priority === 'urgent' ? (
        <span className="simple-priority-tag is-urgent" title="优先级：紧急">
          <AlertCircle size={10} aria-hidden="true" />
          紧急
        </span>
      ) : task.priority === 'important' ? (
        <span className="simple-priority-tag is-important" title="优先级：重要">
          重要
        </span>
      ) : null}
      {projectName ? <span className="simple-project-tag" title={`所属清单：${projectName}`}><Folder size={11} aria-hidden="true" />{projectName}</span> : null}
      {task.dueDate ? (
        <span
          className={`simple-due-tag ${task.dueDate < todayKey ? 'is-overdue' : task.dueDate === todayKey ? 'is-today' : ''}`.trim()}
          title={`截止日期：${task.dueDate}`}
        >
          {task.dueDate < todayKey ? (
            <><AlertCircle size={11} aria-hidden="true" />逾期 {task.dueDate}</>
          ) : task.dueDate === todayKey ? (
            <><Calendar size={11} aria-hidden="true" />今日到期</>
          ) : (
            <><Calendar size={11} aria-hidden="true" />{task.dueDate}</>
          )}
        </span>
      ) : null}
      {steps.length ? (
        <span className="simple-steps-tag" title={`步骤进度：${steps.filter((step) => step.status === 'done').length}/${steps.length}`}>
          <CheckCircle2 size={11} aria-hidden="true" />
          {steps.filter((step) => step.status === 'done').length}/{steps.length}
        </span>
      ) : null}
      {task.reminderAt ? <span className="simple-muted" title={`提醒：${new Date(task.reminderAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`} aria-label={`已设置提醒 ${new Date(task.reminderAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}><Bell size={13} aria-hidden="true" /></span> : null}
      <div className="simple-row-actions">
        <button
          className={pinned ? 'is-pinned' : undefined}
          aria-label={pinned ? '移出浮窗' : '放到浮窗'}
          aria-pressed={pinned}
          title={pinned ? '已固定到浮窗，点击移出' : '放到浮窗（固定到桌宠旁待办气泡）'}
          disabled={action.isPending}
          onClick={(e) => { e.stopPropagation(); void action.run(() => window.eyeProtect.saveSettings({ todoBubbleTaskIds: pinned ? settings.todoBubbleTaskIds.filter((id) => id !== task.id) : [...settings.todoBubbleTaskIds, task.id], todoBubbleEnabled: true })); }}
        >
          <Pin size={16} />
        </button>
        <button
          className="is-focus"
          aria-label={`专注 ${task.title}`}
          title="开始专注这项任务"
          disabled={action.isPending}
          onClick={(e) => { e.stopPropagation(); void action.run(async () => { const state = await window.eyeProtect.getPomodoro(); if (['focus', 'break'].includes(state.phase) && !(await confirm('当前计时会被替换。', { title: '用这项任务开始新的专注？', confirmText: '开始专注' }))) return; await window.eyeProtect.preparePomodoro(task.id, true); }); }}
        >
          <Play size={16} />
          <span className="simple-row-action-label">专注</span>
        </button>
      </div>
      <details
        ref={menuRef}
        className="simple-menu"
        open={menuOpen}
        onToggle={(e) => setMenuOpen(e.currentTarget.open)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMenuOpen(false); } }}
      >
        <summary aria-label={`更多操作 ${task.title}`}>•••</summary>
        <div className="simple-menu-popover" role="menu" aria-label={`任务操作 ${task.title}`}>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            disabled={action.isPending}
            onClick={() => void (async () => {
              closeMenu();
              if (await confirm('任务及其步骤都会被删除，且可用撤销找回。', { title: `删除「${task.title}」？`, confirmText: '删除', danger: true })) {
                await action.run(() => window.eyeProtect.deleteTask(task.id));
              }
            })()}
          >
            删除任务
          </button>
          {pinned ? [-1, 1].map((direction) => (
            <button
              key={direction}
              type="button"
              role="menuitem"
              disabled={action.isPending || settings.todoBubbleTaskIds.indexOf(task.id) + direction < 0 || settings.todoBubbleTaskIds.indexOf(task.id) + direction >= settings.todoBubbleTaskIds.length}
              onClick={() => {
                closeMenu();
                void action.run(() => {
                  const ids = [...settings.todoBubbleTaskIds];
                  const index = ids.indexOf(task.id);
                  [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
                  return window.eyeProtect.saveSettings({ todoBubbleTaskIds: ids });
                });
              }}
            >
              {direction === -1 ? '浮窗上移' : '浮窗下移'}
            </button>
          )) : null}
        </div>
      </details>
    </div>
    {action.error ? <p role="alert">{action.error.message}</p> : null}
    {expanded ? (
      <TaskFields
        task={task}
        steps={steps}
        projects={projects}
        confirm={confirm}
        draft={draft}
        dirty={dirty}
        onDraftChange={onDraftChange}
      />
    ) : null}
  </article>;
}

function TaskFields({
  task,
  steps,
  projects,
  confirm,
  draft: savedDraft,
  dirty,
  onDraftChange
}: {
  task: Task;
  steps: Task[];
  projects: Project[];
  confirm: (message: string, options?: string | { title?: string; detail?: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
  draft: TaskUpdateInput | undefined;
  dirty: boolean;
  onDraftChange: (next: TaskUpdateInput | null) => void;
}): JSX.Element {
  const [localDraft, setLocalDraft] = useState<TaskUpdateInput>(() => savedDraft ?? emptyDraft(task));
  const [revision, setRevision] = useState(task.revision);
  const [stepTitle, setStepTitle] = useState('');
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  // External updates (bubble completion, undo, another edit) must not leave a
  // stale draft behind: resync clean forms when identity/revision changes.
  // Dirty drafts survive so concurrent updates cannot wipe in-progress edits.
  useEffect(() => {
    setRevision(task.revision);
    setLocalDraft((current) => (isDraftDirty(current, task) ? current : emptyDraft(task)));
  }, [task.id, task.revision]);

  const applyLocal = (next: TaskUpdateInput): void => {
    setLocalDraft(next);
    onDraftChange(isDraftDirty(next, task) ? next : null);
  };

  const toDateTime = (time: number | null | undefined): string => time ? new Date(time - new Date(time).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';
  return <div className="simple-task-fields">
    <form onSubmit={(e) => { e.preventDefault(); void action.run(async () => { const result = await window.eyeProtect.updateTask(task.id, { ...localDraft, baseRevision: revision }); const saved = result.find((entry) => entry.id === task.id); if (saved) setRevision(saved.revision); onDraftChange(null); }); }}>
      <div className="simple-fields-head">
        <span className="simple-fields-label">任务详情</span>
        {dirty ? <span className="simple-dirty-tag">有未保存修改</span> : <span className="simple-saved-hint">与保存内容一致</span>}
      </div>
      <label>名称<input value={localDraft.title} required onChange={(e) => applyLocal({ ...localDraft, title: e.currentTarget.value })} /></label>
      <div className="simple-field-grid"><label>截止日期<input type="date" value={localDraft.dueDate ?? ''} onChange={(e) => applyLocal({ ...localDraft, dueDate: e.currentTarget.value || null })} /></label>
        <label>提醒我<input type="datetime-local" value={toDateTime(localDraft.reminderAt)} onChange={(e) => applyLocal({ ...localDraft, reminderAt: e.currentTarget.value ? new Date(e.currentTarget.value).getTime() : null })} /></label>
        <label>清单<select value={localDraft.projectId ?? ''} onChange={(e) => applyLocal({ ...localDraft, projectId: e.currentTarget.value || null })}><option value="">默认清单</option>{projects.filter(isSimpleList).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
      <label>备注<textarea rows={3} value={localDraft.notes ?? ''} onChange={(e) => applyLocal({ ...localDraft, notes: e.currentTarget.value })} /></label>{/* The form owns the save command, and CommandButton defaults to type="button", so submitting has to be requested explicitly. */}<CommandButton type="submit" state={action.state} errorReason={action.error?.message} variant="primary" disabled={action.isPending || !dirty}>保存修改</CommandButton>
    </form>
    <h3>步骤 <small className="simple-step-save-note">步骤名称失焦即自动保存，独立于上方「保存修改」</small></h3>
    {steps.map((step, index) => (
      <div className="simple-step" key={step.id}>
        <label className="simple-check-hit" title="标记步骤完成">
          <input type="checkbox" aria-label={`步骤 ${step.title}`} checked={step.status === 'done'} disabled={action.isPending} onChange={() => void action.run(() => window.eyeProtect.setTaskStatus(step.id, step.status === 'done' ? 'open' : 'done'))} />
        </label>
        <input aria-label="步骤名称" key={`${step.id}-${step.revision}`} defaultValue={step.title} onBlur={(e) => { if (e.currentTarget.value.trim() !== step.title) void action.run(() => window.eyeProtect.updateTask(step.id, { title: e.currentTarget.value, baseRevision: step.revision })); }} />
        <button type="button" aria-label="上移步骤" disabled={!steps.slice(0, index).some((item) => item.parentId === step.parentId) || action.isPending} onClick={() => void action.run(() => window.eyeProtect.moveStep(step.id, -1))}>↑</button>
        <button type="button" aria-label="下移步骤" disabled={!steps.slice(index + 1).some((item) => item.parentId === step.parentId) || action.isPending} onClick={() => void action.run(() => window.eyeProtect.moveStep(step.id, 1))}>↓</button>
        <button type="button" aria-label={`删除步骤 ${step.title}`} disabled={action.isPending} onClick={() => void (async () => { if (await confirm('这一步及其原有下级都会被删除。', { title: `删除步骤「${step.title}」？`, confirmText: '删除', danger: true })) await action.run(() => window.eyeProtect.deleteTask(step.id)); })()}>×</button>
      </div>
    ))}
    <form className="simple-add" onSubmit={(e) => { e.preventDefault(); if (stepTitle.trim()) void action.run(async () => { await window.eyeProtect.createStep(task.id, stepTitle.trim()); setStepTitle(''); }); }}><input aria-label="添加步骤" placeholder="添加一个步骤…" value={stepTitle} onChange={(e) => setStepTitle(e.currentTarget.value)} /><button className="primary" disabled={action.isPending || !stepTitle.trim()}>添加步骤</button></form>
    {action.error ? <p role="alert">{action.error.message}</p> : null}
  </div>;
}

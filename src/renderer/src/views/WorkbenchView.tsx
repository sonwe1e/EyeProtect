import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
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
import { addLocalDays, daysBetweenLocalDateKeys, localDateKey } from '../../../shared/calendar';
import { isCurrentTask, isSimpleList, moveQueueItem, queueTasksForToday, taskSteps } from '../../../shared/simpleTasks';
import { CompanionArtwork } from '../features/characters/CompanionArtwork';
import { nextTodoPriority } from '../../../shared/types';
import type { Project, Task, TaskUpdateInput, TodoPriority, WorkbenchNavPayload } from '../../../shared/types';
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
import { RestCompanionCard } from '../features/simple/RestCompanionCard';
import { ComposerChips, type ComposerDue } from '../features/simple/ComposerChips';
import { allDoneQueueCopy, emptyQueueTitle, queueMetaCopy } from '../features/simple/queueCopy';
import { listAccentIndex } from '../features/simple/listAccent';
import { PRIMARY_WORKBENCH_SECTIONS, WORKBENCH_SECTIONS, type WorkbenchSectionId } from '../features/workbench/workbenchNavigation';
import type { FailedDeliveryNotice } from '../../../shared/types';
import '../styles/simple.css';

type TaskDraftMap = Record<string, TaskUpdateInput>;

const PRIORITY_LABELS: Record<TodoPriority, string> = { normal: '普通', important: '重要', urgent: '紧急' };

/** The drawer's priority control cycles 普通 → 重要 → 紧急 → 普通 (nextTodoPriority). */
const priorityLabel = (priority: TodoPriority | undefined): string => PRIORITY_LABELS[priority ?? 'normal'];

const emptyDraft = (task: Task): TaskUpdateInput => ({
  title: task.title,
  dueDate: task.dueDate,
  reminderAt: task.reminderAt,
  notes: task.notes,
  projectId: task.projectId,
  priority: task.priority
});

const isDraftDirty = (draft: TaskUpdateInput, task: Task): boolean =>
  draft.title !== task.title ||
  draft.dueDate !== task.dueDate ||
  draft.reminderAt !== task.reminderAt ||
  draft.notes !== task.notes ||
  draft.projectId !== task.projectId ||
  (draft.priority ?? 'normal') !== task.priority;

/** One drag in flight: the row being carried and the row it would land on. */
interface QueueDragState {
  id: string;
  target: { id: string; position: 'before' | 'after' } | null;
}

/** How long the "order did not save" notice stays on screen. */
const QUEUE_NOTICE_MS = 6_000;

/**
 * Apply the drag's optimistic order to the freshly derived queue. Tasks the
 * optimistic list does not know about (created in another window mid-drag) keep
 * their relative position behind it, and completed rows stay at the tail.
 */
const applyOptimisticOrder = (tasks: Task[], order: string[] | null): Task[] => {
  if (!order) return tasks;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ordered = order.map((id) => byId.get(id)).filter((task): task is Task => Boolean(task));
  const rest = tasks.filter((task) => !order.includes(task.id));
  return [...ordered, ...rest];
};

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
  // Queue ordering is optimistic only until the main process confirms it: the
  // store stays the single source of truth for order (see useTasks).
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  // Composer chips draft (quick date); merged into the existing createTask call
  // on submit — no second IPC path. A failed submit keeps the draft (ux §1.3).
  const [composerDue, setComposerDue] = useState<ComposerDue | null>(null);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [queueDrag, setQueueDrag] = useState<QueueDragState | null>(null);
  const queueDragRef = useRef<QueueDragState | null>(null);
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
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      document.getElementById(`simple-task-${id}`)?.scrollIntoView({ block: 'center', behavior });
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

  // Today is ONE queue: position is the priority, so nothing is grouped by date
  // any more. Steps and archived tasks never reach this list, and only tasks
  // completed today keep their tail row — otherwise the tail would grow with
  // every task ever completed (queueTasksForToday).
  const queueTasks = queueTasksForToday(selected, projects, todayKey);
  const queue = applyOptimisticOrder(queueTasks, optimisticOrder);
  const openQueue = queue.filter((task) => task.status === 'open');
  // `storedOpenKey` answers one question only: has the store caught up with the
  // optimistic order? The drag payload and the drop-target membership test use
  // the VISIBLE order, so a second drag started before the first write lands
  // builds on what the user can actually see.
  const storedOpenKey = queueTasks
    .filter((task) => task.status === 'open')
    .map((task) => task.id)
    .join(',');
  const openIds = openQueue.map((task) => task.id);
  // Reordering rewrites the whole visible order, which is only honest when the
  // visible rows ARE the queue: a filtered view has hidden tasks between them.
  const reorderDisabled = Boolean(search) || list !== 'all';
  const dragEnabled = tab === 'today' && !reorderDisabled;
  // Queue meta line rotates per day (ux §8): numbers and status words stay
  // informational, only the phrase after 「·」 comes from the pool.
  const queueMeta = queueMetaCopy({ total: queue.length, open: openQueue.length, dayKey: todayKey });
  const allDoneCopy = allDoneQueueCopy(todayKey);
  const searchHasOnlyDoneMatches = Boolean(search) && selected.length > 0 && queueTasks.every((task) => task.status !== 'open');
  const dateLabel = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'long' }).format(new Date(now));
  const dirtyCount = Object.keys(taskDrafts).filter((id) => {
    const task = tasks.find((entry) => entry.id === id);
    return task ? isDraftDirty(taskDrafts[id], task) : false;
  }).length;

  // The optimistic order retires itself as soon as the store agrees with it, so
  // the list is never driven by two orders at once. It also retires when the
  // stored queue no longer holds the same tasks: that is someone else's change
  // (new task, undo, delete) and local order has nothing left to say about it.
  useEffect(() => {
    if (!optimisticOrder) return;
    const stored = storedOpenKey ? storedOpenKey.split(',') : [];
    const settled = optimisticOrder.join(',') === storedOpenKey;
    const stale = optimisticOrder.length !== stored.length || optimisticOrder.some((id) => !stored.includes(id));
    if (settled || stale) setOptimisticOrder(null);
  }, [optimisticOrder, storedOpenKey]);

  // A failed reorder is a transient event, not a state the page should keep
  // announcing: the notice retires itself so it cannot outlive its relevance.
  useEffect(() => {
    if (!queueNotice) return;
    const timer = window.setTimeout(() => setQueueNotice(null), QUEUE_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [queueNotice]);

  // Template-chip feedback ("已排入队尾：…") retires itself the same way.
  useEffect(() => {
    if (!composerNotice) return;
    const timer = window.setTimeout(() => setComposerNotice(null), QUEUE_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [composerNotice]);

  // Leaving the page drops whatever it was apologising for.
  useEffect(() => {
    setQueueNotice(null);
    setComposerNotice(null);
  }, [tab]);

  /** Health template chips create through the same command path as typing. */
  const createFromTemplate = (templateTitle: string): void => {
    void action.run(async () => {
      // createTask records no undo operation (taskService.createTask), so the
      // feedback is a pure notice — no 撤销 button (lead decision 9).
      await window.eyeProtect.createTask({ title: templateTitle, projectId: list === 'all' || list === 'default' ? null : list });
      setComposerNotice(`已排入队尾：${templateTitle}`);
    });
  };

  const commitQueueDrag = (next: QueueDragState | null): void => {
    // `dragover` is a continuous event: its state update may not have flushed by
    // the time `drop` runs, so the ref is the value the handlers actually trust.
    queueDragRef.current = next;
    setQueueDrag(next);
  };

  /** The row (li) a drag event happened on, if any. */
  const queueRowOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof HTMLElement ? target.closest<HTMLElement>('[data-task-id]') : null;

  const startQueueDrag = (event: DragEvent<HTMLOListElement>): void => {
    const id = queueRowOf(event.target)?.dataset.taskId ?? null;
    if (!dragEnabled || !id) {
      event.preventDefault();
      return;
    }
    commitQueueDrag({ id, target: null });
    setQueueNotice(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const trackQueueDrop = (event: DragEvent<HTMLOListElement>): void => {
    const current = queueDragRef.current;
    const row = queueRowOf(event.target);
    const targetId = row?.dataset.taskId ?? null;
    if (!current || !row || !targetId || targetId === current.id) return;
    // Only open rows are in the payload, so only they can be a drop target.
    if (!openIds.includes(targetId)) return;
    event.preventDefault();
    const box = row.getBoundingClientRect();
    const position: 'before' | 'after' = event.clientY > box.top + box.height / 2 ? 'after' : 'before';
    if (current.target?.id === targetId && current.target.position === position) return;
    commitQueueDrag({ id: current.id, target: { id: targetId, position } });
  };

  const dropQueueItem = (event: DragEvent<HTMLOListElement>): void => {
    const current = queueDragRef.current;
    commitQueueDrag(null);
    if (!current?.target) return;
    event.preventDefault();
    reorderQueue(moveQueueItem(openIds, current.id, current.target.id, current.target.position));
  };

  /**
   * Persist a new order. The local order moves first so the row lands under the
   * pointer immediately; a rejected write puts the stored order back instead of
   * leaving the user with an order that only exists on screen.
   */
  function reorderQueue(nextOrder: string[]): void {
    if (nextOrder.join(',') === storedOpenKey) {
      // The drag ended where the store already is: nothing to write, and any
      // pending preview must give way to the real order instead of outliving it.
      setOptimisticOrder(null);
      return;
    }
    setOptimisticOrder(nextOrder);
    setQueueNotice(null);
    void (async () => {
      const outcome = await run(() => window.eyeProtect.reorderTaskQueue(nextOrder));
      if (outcome.ok) return;
      setOptimisticOrder(null);
      setQueueNotice('顺序没存上，已恢复原样');
    })();
  }

  return <main className="simple-workbench" style={{ zoom: settings.restReadingScale, height: `${100 / settings.restReadingScale}vh` }}>
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
        {tab === 'review' ? <RestCompanionCard /> : null}
        {reminderStatus.contextDeferral ? <p className="simple-context-note" role="status">{reminderStatus.contextDeferral.reason}</p> : null}
        {tab === 'today' ? (
          <div className="simple-rhythm-banner">
            <div className="simple-rhythm-info">
              <h1 className="simple-rhythm-title">今天</h1>
              <div className="simple-rhythm-sub">
                {dateLabel} · {openTasks.length > 0
                  ? `还有 ${openTasks.length} 项待处理，专注工作之余记得护眼休息`
                  : todayDone.length > 0 ? '今日待办已全部完成，保持好心情与健康节奏'
                    : '当前没有待处理事项，想做什么就写下来'}
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
              <h1 className="simple-rhythm-title">完成记录</h1>
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
          <form className="simple-add simple-composer" onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            // Quick-date draft resolves at submit time from the current clock,
            // so a stale render tick can never write yesterday's date.
            const dueDate = composerDue === null ? null
              : composerDue === 'today' ? todayKey
                : composerDue === 'tomorrow' ? localDateKey(addLocalDays(now, 1))
                  : composerDue.custom || null;
            void action.run(async () => {
              await window.eyeProtect.createTask({ title: title.trim(), projectId: list === 'all' || list === 'default' ? null : list, dueDate });
              // Success consumes the draft (ux §1.3); failure keeps it.
              setTitle('');
              setComposerDue(null);
            });
          }}>
            <input aria-label="添加任务" placeholder="添加任务，回车保存…" value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={300} /><ComposerChips due={composerDue} onDueChange={setComposerDue} targetListId={list} lists={lists} onTargetListChange={setList} onTemplateCreate={createFromTemplate} disabled={action.isPending} /><button className="primary" disabled={action.isPending || !title.trim()}>添加</button>
          </form>
          {composerNotice ? <p className="simple-undo" role="status">{composerNotice}</p> : null}
          <section className="simple-queue" aria-label="今天的队列">
            <header className="simple-queue-head">
              <div className="simple-queue-title">
                <h2>待办队列</h2>
              </div>
              <p className="simple-queue-meta">{queueMeta}</p>
            </header>
            {reorderDisabled ? <p className="simple-queue-hint">清除筛选后可调整顺序</p> : null}
            {queueNotice ? <p className="simple-queue-hint is-error" role="alert">{queueNotice}</p> : null}
            <ol
              className={`simple-queue-list${queueDrag ? ' is-dragging' : ''}`.trim()}
              onDragStart={startQueueDrag}
              onDragOver={trackQueueDrop}
              onDrop={dropQueueItem}
              onDragEnd={() => commitQueueDrag(null)}
            >
              {queue.map((task) => {
                const draft = taskDrafts[task.id];
                return <SimpleTask
                  key={task.id}
                  task={task}
                  tasks={tasks}
                  projects={projects}
                  position={task.status === 'open' ? openIds.indexOf(task.id) + 1 : null}
                  grip={dragEnabled}
                  dragging={queueDrag?.id === task.id}
                  dropPosition={queueDrag?.target?.id === task.id ? queueDrag.target.position : null}
                  expanded={expanded === task.id}
                  dirty={draft ? isDraftDirty(draft, task) : false}
                  draft={draft}
                  onDraftChange={(next) => updateDraft(task.id, next)}
                  onExpand={() => setExpanded(expanded === task.id ? null : task.id)}
                  confirm={confirmState.confirm}
                  todayKey={todayKey}
                />;
              })}
            </ol>
          </section>
          {queue.length === 0 && !search ? (
            <div className="simple-empty-state">
              <div className="simple-empty-animal">
                <CompanionArtwork companion={settings.petCompanion} outfit={settings.petOutfit} action="idle" motion={settings.petMotion} />
              </div>
              <h3>{emptyQueueTitle(todayKey)}</h3>
              <p>写一件，回车排到队尾。做完的会自动沉到最后，撤销就回原位。</p>
            </div>
          ) : null}
          {queue.length > 0 && openQueue.length === 0 && !search ? (
            <div className="simple-empty-state is-all-done">
              <div className="simple-empty-icon"><CheckCircle2 size={22} aria-hidden="true" /></div>
              <h3>{allDoneCopy.title}</h3>
              <p>{allDoneCopy.note}</p>
            </div>
          ) : null}
          {search && searchHasOnlyDoneMatches ? (
            <div className="simple-empty-state">
              <div className="simple-empty-icon"><CheckCircle2 size={22} aria-hidden="true" /></div>
              <h3>“{search}”只出现在完成记录中</h3>
              <p>切换到完成记录页查看，或换个关键词搜索待办。</p>
            </div>
          ) : null}
          {search && queue.length === 0 && !searchHasOnlyDoneMatches ? (
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
              <CompanionArtwork companion={settings.petCompanion} outfit={settings.petOutfit} action="idle" motion={settings.petMotion} />
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

/**
 * One queue row: grip · position · round check · title + inline tags · "…".
 * Drag is started ONLY from the grip, so clicking the title (which toggles the
 * drawer) can never be mistaken for a drag (AC-03).
 */
function SimpleTask({ task, tasks, projects, position, grip, dragging, dropPosition, expanded, dirty, draft, onDraftChange, onExpand, confirm, todayKey }: {
  task: Task;
  tasks: Task[];
  projects: Project[];
  position: number | null;
  grip: boolean;
  dragging: boolean;
  dropPosition: 'before' | 'after' | null;
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
  const steps = taskSteps(task.id, tasks).filter((step) => step.status !== 'archived');
  const pinned = settings.todoBubbleTaskIds.includes(task.id);
  const done = task.status === 'done';
  const doneSteps = steps.filter((step) => step.status === 'done').length;
  // 完成庆祝挂瞬时类（lead 决策 7 / vision §2.3）：只在 open→done 的那一刻
  // pop 一次；页面加载、撤销回位、重渲染都不放动画。
  const [didCelebrate, setDidCelebrate] = useState(false);
  const prevStatus = useRef(task.status);
  useEffect(() => {
    const justCompleted = prevStatus.current !== 'done' && task.status === 'done';
    prevStatus.current = task.status;
    if (!justCompleted) return;
    setDidCelebrate(true);
    const timer = window.setTimeout(() => setDidCelebrate(false), 500);
    return () => window.clearTimeout(timer);
  }, [task.status]);
  const [addingStep, setAddingStep] = useState(false);
  const [newStepTitle, setNewStepTitle] = useState('');
  // Guards the one delivery that must not happen twice: after Enter removes the
  // input, the browser can still deliver a blur for it. The committed title is
  // remembered so the same value cannot be written again.
  const committedStepRef = useRef<string | null>(null);
  const overdueDays = task.dueDate && task.dueDate < todayKey ? daysBetweenLocalDateKeys(task.dueDate, todayKey) : 0;
  // Calendar badge (vision R2-3): month/day split from the local date key.
  const dueMonth = task.dueDate ? Number(task.dueDate.slice(5, 7)) : 0;
  const dueDay = task.dueDate ? Number(task.dueDate.slice(8, 10)) : 0;
  const accent = listAccentIndex(task.projectId);
  const pinnedIndex = settings.todoBubbleTaskIds.indexOf(task.id);
  const complete = (): void => {
    const pending = steps.filter((step) => step.status === 'open');
    void (async () => {
      if (pending.length && !(await confirm(`还有 ${pending.length} 个步骤未完成。`, { title: '一起完成这些步骤？', confirmText: '一起完成' }))) return;
      await action.run(() => window.eyeProtect.completeTaskTree(task.id, Object.fromEntries([task, ...pending].map((entry) => [entry.id, entry.revision]))));
    })();
  };
  const closeStepInput = (): void => {
    setAddingStep(false);
    setNewStepTitle('');
  };
  const openStepInput = (): void => {
    committedStepRef.current = null;
    setAddingStep(true);
  };
  /**
   * Enter and blur both commit: typed text must not be thrown away just because
   * focus moved on. The ref is what stops a second write — Enter removes the
   * input, and the browser can still deliver a blur for the node it removed.
   */
  const commitStep = (): void => {
    const next = newStepTitle.trim();
    if (next !== '' && committedStepRef.current === next) return;
    closeStepInput();
    if (!next) return;
    committedStepRef.current = next;
    void action.run(() => window.eyeProtect.createStep(task.id, next));
  };
  const toggleStep = (step: Task): void => {
    void action.run(() => window.eyeProtect.setTaskStatus(step.id, step.status === 'done' ? 'open' : 'done'));
  };
  return <li
    id={`simple-task-${task.id}`}
    data-task-id={task.id}
    data-accent={accent === null ? undefined : String(accent + 1)}
    className={[
      'simple-task simple-queue-row',
      expanded ? 'is-expanded' : '',
      dirty ? 'is-dirty' : '',
      done ? 'is-done' : '',
      dragging ? 'is-dragging' : '',
      dropPosition === 'before' ? 'is-drop-before' : '',
      dropPosition === 'after' ? 'is-drop-after' : ''
    ].filter(Boolean).join(' ')}
  >
    <div className="simple-task-row">
      {grip ? <span className="simple-queue-grip" draggable title="拖动调整顺序" aria-hidden="true">⠿</span> : null}
      <span className={`simple-queue-index ${done ? 'is-done' : ''}`.trim()} aria-hidden="true">{position ?? ''}</span>
      {done ? (
        <span className={`simple-queue-check is-done${didCelebrate ? ' did-celebrate' : ''}`.trim()} role="img" aria-label="已完成">
          <span className="simple-queue-dot" aria-hidden="true" />
        </span>
      ) : (
        <label className="simple-queue-check" title="标记完成">
          <input type="checkbox" aria-label={`完成 ${task.title}`} checked={false} disabled={action.isPending} onChange={complete} />
          <span className="simple-queue-dot" aria-hidden="true" />
        </label>
      )}
      <div className={`simple-queue-main${steps.length === 0 && !addingStep ? ' has-no-steps' : ''}`}>
        <div className="simple-queue-line">
          <button className="simple-task-name" aria-expanded={expanded} onClick={onExpand}>{task.title}</button>
          {task.dueDate ? (
            <span
              className={`simple-date-badge ${overdueDays > 0 ? 'is-overdue' : task.dueDate === todayKey ? 'is-today' : ''}`.trim()}
              title={overdueDays > 0 ? `截止日期：${task.dueDate}（逾期 ${overdueDays} 天）` : `截止日期：${task.dueDate}`}
            >
              <small>{dueMonth}月</small>
              <strong>{dueDay}</strong>
            </span>
          ) : null}
          {steps.length ? (
            <span className="simple-step-progress" title={`步骤进度：${doneSteps}/${steps.length}`}>
              <span className="simple-step-progress-track" aria-hidden="true">
                <span className="simple-step-progress-fill" style={{ width: `${(doneSteps / steps.length) * 100}%` }} />
              </span>
              <span className="simple-step-progress-text">{doneSteps}/{steps.length}</span>
            </span>
          ) : null}
          {task.reminderAt ? <span className="simple-muted" title={`提醒：${new Date(task.reminderAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`} aria-label={`已设置提醒 ${new Date(task.reminderAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}><Bell size={13} aria-hidden="true" /></span> : null}
          {dirty ? <span className="simple-dirty-tag" title="有未保存修改，收起详情也会保留">未保存</span> : null}
        </div>
        <ul className="simple-steps" aria-label={`${task.title} 的步骤`}>
          {steps.map((step) => (
            <li key={step.id}>
              <button
                type="button"
                className={`simple-step-chip ${step.status === 'done' ? 'is-done' : ''}`.trim()}
                aria-pressed={step.status === 'done'}
                title={step.status === 'done' ? `取消完成「${step.title}」` : `完成「${step.title}」`}
                disabled={action.isPending}
                onClick={() => toggleStep(step)}
              >
                <span className="simple-step-dot" aria-hidden="true" />
                {step.title}
              </button>
            </li>
          ))}
          {done ? null : <li>
            {addingStep ? (
              <input
                className="simple-step-input"
                aria-label={`新步骤 ${task.title}`}
                autoFocus
                value={newStepTitle}
                maxLength={300}
                placeholder="这一步是…"
                onChange={(e) => setNewStepTitle(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    commitStep();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    closeStepInput();
                  }
                }}
                onBlur={commitStep}
              />
            ) : (
              <button type="button" className="simple-step-add" onClick={openStepInput}>＋ 步骤</button>
            )}
          </li>}
        </ul>
      </div>
      <button type="button" className="simple-queue-more" aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'} ${task.title} 的日期、提醒和清单`} onClick={onExpand}>…</button>
    </div>
    {action.error ? <p role="alert">{action.error.message}</p> : null}
    {expanded ? <>
      <TaskFields
        task={task}
        steps={steps}
        projects={projects}
        confirm={confirm}
        draft={draft}
        dirty={dirty}
        onDraftChange={onDraftChange}
      />
      <div className="simple-drawer-foot">
        <button
          type="button"
          className={pinned ? 'is-pinned' : undefined}
          aria-label={pinned ? '移出浮窗' : '放到浮窗'}
          aria-pressed={pinned}
          title={pinned ? '已固定到浮窗，点击移出' : '放到浮窗（固定到桌宠旁待办气泡）'}
          disabled={action.isPending}
          onClick={() => void action.run(() => window.eyeProtect.saveSettings({ todoBubbleTaskIds: pinned ? settings.todoBubbleTaskIds.filter((id) => id !== task.id) : [...settings.todoBubbleTaskIds, task.id], todoBubbleEnabled: true }))}
        >
          <Pin size={15} aria-hidden="true" />
          <span className="simple-row-action-label">{pinned ? '移出浮窗' : '放到浮窗'}</span>
        </button>
        <button
          type="button"
          title="开始专注这项任务"
          aria-label={`专注 ${task.title}`}
          disabled={action.isPending}
          onClick={() => void action.run(async () => { const state = await window.eyeProtect.getPomodoro(); if (['focus', 'break'].includes(state.phase) && !(await confirm('当前计时会被替换。', { title: '用这项任务开始新的专注？', confirmText: '开始专注' }))) return; await window.eyeProtect.preparePomodoro(task.id, true); })}
        >
          <Play size={15} aria-hidden="true" />
          <span className="simple-row-action-label">专注</span>
        </button>
        {pinned ? [-1, 1].map((direction) => (
          <button
            key={direction}
            type="button"
            disabled={action.isPending || pinnedIndex + direction < 0 || pinnedIndex + direction >= settings.todoBubbleTaskIds.length}
            onClick={() => void action.run(() => {
              const ids = [...settings.todoBubbleTaskIds];
              const index = ids.indexOf(task.id);
              [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
              return window.eyeProtect.saveSettings({ todoBubbleTaskIds: ids });
            })}
          >
            {direction === -1 ? '浮窗上移' : '浮窗下移'}
          </button>
        )) : null}
        <button
          type="button"
          className="is-danger"
          disabled={action.isPending}
          onClick={() => void (async () => {
            if (await confirm('任务及其步骤都会被删除，且可用撤销找回。', { title: `删除「${task.title}」？`, confirmText: '删除', danger: true })) {
              await action.run(() => window.eyeProtect.deleteTask(task.id));
            }
          })()}
        >
          <Trash2 size={15} aria-hidden="true" />
          <span className="simple-row-action-label">删除任务</span>
        </button>
        <p className="simple-drawer-note">这些收进抽屉，主界面只留下顺序</p>
      </div>
    </> : null}
  </li>;
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
      <div className="simple-drawer-grid"><label>截止日期<input type="date" value={localDraft.dueDate ?? ''} onChange={(e) => applyLocal({ ...localDraft, dueDate: e.currentTarget.value || null })} /></label>
        <label>提醒我<input type="datetime-local" value={toDateTime(localDraft.reminderAt)} onChange={(e) => applyLocal({ ...localDraft, reminderAt: e.currentTarget.value ? new Date(e.currentTarget.value).getTime() : null })} /></label>
        <label>清单<select value={localDraft.projectId ?? ''} onChange={(e) => applyLocal({ ...localDraft, projectId: e.currentTarget.value || null })}><option value="">默认清单</option>{projects.filter(isSimpleList).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {/* Priority lives here, not in the row: position already says what is
            next, so an inline priority badge would be a second, contradicting
            authority. It stays editable because it is still exported in backups. */}
        <div className="simple-drawer-field">
          <span className="simple-drawer-label">优先级</span>
          <button
            type="button"
            className="simple-priority-cycle"
            title="点一下切换：普通 → 重要 → 紧急"
            onClick={() => applyLocal({ ...localDraft, priority: nextTodoPriority(localDraft.priority ?? task.priority) })}
          >
            <span className={`simple-priority-dot is-${localDraft.priority ?? 'normal'}`} aria-hidden="true" />
            {priorityLabel(localDraft.priority)}
          </button>
        </div>
      </div>
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

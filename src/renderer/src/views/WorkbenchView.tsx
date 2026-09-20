import { useEffect, useState } from 'react';
import { Bell, Eye, Settings as SettingsIcon, Pin, Play } from 'lucide-react';
import { localDateKey } from '../../../shared/calendar';
import { groupSimpleTasks, isCurrentTask, isSimpleList, taskSteps } from '../../../shared/simpleTasks';
import type { Project, Task, TaskUpdateInput } from '../../../shared/types';
import { useTasks } from '../hooks/useTasks';
import { useProjects } from '../hooks/useProjects';
import { useSettings } from '../hooks/useSettings';
import { useCommand } from '../hooks/useCommand';
import { useUndo } from '../hooks/useUndo';
import { useClock } from '../hooks/useClock';
import { useAppHealth } from '../hooks/useAppHealth';
import { AppHealthBanner } from '../components/AppHealthBanner';
import { CommandButton } from '../components/CommandButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useConfirm } from '../hooks/useConfirm';
import { run } from '../lib/commands';
import { SimpleSettings } from '../features/simple/SimpleSettings';
import { PRIMARY_WORKBENCH_SECTIONS, WORKBENCH_SECTIONS, type WorkbenchSectionId } from '../features/workbench/workbenchNavigation';
import type { FailedDeliveryNotice } from '../../../shared/types';
import '../styles/simple.css';

export default function WorkbenchView(): JSX.Element {
  const tasks = useTasks();
  const [failures, setFailures] = useState<FailedDeliveryNotice[]>([]);
  useEffect(() => { void window.eyeProtect.getFailedDeliveries().then(setFailures); return window.eyeProtect.onFailedDeliveriesChanged(setFailures); }, []);
  const projects = useProjects();
  const undo = useUndo();
  const health = useAppHealth();
  const now = useClock(30_000);
  const [tab, setTab] = useState<WorkbenchSectionId>('today');
  const [list, setList] = useState('all');
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const [title, setTitle] = useState('');
  const [listEditor, setListEditor] = useState<'new' | 'rename' | null>(null);
  const [listName, setListName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  useEffect(() => {
    const navigate = (section: string): void => { setTab(section === 'settings' ? 'settings' : section === 'review' ? 'review' : 'today'); };
    void window.eyeProtect.getWorkbenchSection().then(navigate);
    return window.eyeProtect.onWorkbenchNavigate(navigate);
  }, []);
  const lists = projects.filter(isSimpleList);
  const confirmState = useConfirm();
  const selected = tasks.filter((task) => !task.parentId && (tab === 'review' || isCurrentTask(task, projects)) &&
    (list === 'all' || (list === 'default' ? !task.projectId : task.projectId === list)) && task.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const history = selected.filter((task) => task.status === 'done' && task.completedAt !== null && (!date || localDateKey(task.completedAt) === date)).sort((a, b) => b.completedAt! - a.completedAt!);
  const days = [...new Set(history.map((task) => localDateKey(task.completedAt!)))];
  return <main className="simple-workbench">
    <ConfirmDialog pending={confirmState.pending} onResolve={confirmState.resolveConfirm} />
    <header className="simple-header"><span className="simple-brand"><span className="simple-brand-mark" aria-hidden="true"><Eye size={15} /></span><strong>EyeProtect</strong></span><nav aria-label="主导航">
      {PRIMARY_WORKBENCH_SECTIONS.map((id) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{WORKBENCH_SECTIONS[id].label}</button>)}
    </nav><button className="simple-icon-button" aria-label="设置" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}><SettingsIcon size={19} /></button></header>
    <div className="simple-content"><AppHealthBanner health={health} />
      {failures.map((failure) => <div role="alert" className="simple-undo" key={failure.id}><span>{failure.title} · {failure.body}</span><button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.retryFailedDelivery(failure.id))}>重试</button><button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.dismissFailedDelivery(failure.id))}>忽略</button></div>)}
      {action.error ? <p role="alert">{action.error.message}</p> : null}
      {undo && tab !== 'settings' ? <div className="simple-undo">{undo.kind === 'complete' ? '已完成：' : '已删除：'}{undo.taskTitle}<button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.undoTaskOperation(undo.operationId))}>撤销</button></div> : null}
      {tab === 'settings' ? <SimpleSettings /> : <>
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
          {groupSimpleTasks(selected, now).map((group) => group.tasks.length ? <section className="simple-group" key={group.title}><h2>{group.title}<small>{group.tasks.length}</small></h2>{group.tasks.map((task) => <SimpleTask key={task.id} task={task} tasks={tasks} projects={projects} expanded={expanded === task.id} onExpand={() => setExpanded(expanded === task.id ? null : task.id)} confirm={confirmState.confirm} />)}</section> : null)}
          {selected.length && !selected.some((task) => task.status === 'open') && tab === 'today' ? <p className="simple-empty">没有待处理任务。记一件事，或安心休息。</p> : null}
          {tab === 'today' && selected.length > 0 && groupSimpleTasks(selected, now).every((group) => group.tasks.length === 0) ? <p className="simple-empty">没有匹配“{search}”的任务。换个关键词，或直接回车新建。</p> : null}
        </> : days.length ? days.map((day) => <section className="simple-group" key={day}><h2>{day}</h2>{history.filter((task) => localDateKey(task.completedAt!) === day).map((task) => <div className="simple-history-row" key={task.id}><span>{task.title}<small>{projects.find((p) => p.id === task.projectId)?.name ?? '默认清单'}</small></span><time>{new Date(task.completedAt!).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time><button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.restoreLegacyTask(task.id))}>恢复待办</button></div>)}</section>) : <p className="simple-empty">还没有符合条件的完成记录。</p>}
      </>}
    </div>
  </main>;
}

function SimpleTask({ task, tasks, projects, expanded, onExpand, confirm }: { task: Task; tasks: Task[]; projects: Project[]; expanded: boolean; onExpand: () => void; confirm: (message: string, options?: string | { title?: string; detail?: string; confirmText?: string; danger?: boolean }) => Promise<boolean> }): JSX.Element {
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  const { settings } = useSettings();
  const steps = taskSteps(task.id, tasks).filter((step) => step.status !== 'archived');
  const pinned = settings.todoBubbleTaskIds.includes(task.id);
  const complete = (): void => {
    const pending = steps.filter((step) => step.status === 'open');
    void (async () => {
      if (pending.length && !(await confirm(`还有 ${pending.length} 个步骤未完成。`, { title: '一起完成这些步骤？', confirmText: '一起完成' }))) return;
      await action.run(() => window.eyeProtect.completeTaskTree(task.id, Object.fromEntries([task, ...pending].map((entry) => [entry.id, entry.revision]))));
    })();
  };
  return <article className={`simple-task ${expanded ? 'is-expanded' : ''}`}>
    <div className="simple-task-row"><input type="checkbox" aria-label={`完成 ${task.title}`} checked={false} disabled={action.isPending} onChange={complete} onClick={(e) => e.stopPropagation()} />
      <button className="simple-task-name" aria-expanded={expanded} onClick={onExpand}>{task.title}</button>
      {steps.length ? <span className="simple-muted">{steps.filter((step) => step.status === 'done').length}/{steps.length}</span> : null}<time>{task.dueDate}</time>
      {task.reminderAt ? <span className="simple-muted" title={`提醒：${new Date(task.reminderAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`} aria-label={`已设置提醒 ${new Date(task.reminderAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}><Bell size={13} aria-hidden="true" /></span> : null}
      <div className="simple-row-actions"><button aria-label={pinned ? '移出浮窗' : '放到浮窗'} aria-pressed={pinned} disabled={action.isPending} onClick={(e) => { e.stopPropagation(); void action.run(() => window.eyeProtect.saveSettings({ todoBubbleTaskIds: pinned ? settings.todoBubbleTaskIds.filter((id) => id !== task.id) : [...settings.todoBubbleTaskIds, task.id], todoBubbleEnabled: true })); }}><Pin size={16} /></button>
        <button aria-label={`专注 ${task.title}`} onClick={(e) => { e.stopPropagation(); void action.run(async () => { const state = await window.eyeProtect.getPomodoro(); if (['focus', 'break'].includes(state.phase) && !(await confirm('当前计时会被替换。', { title: '用这项任务开始新的专注？', confirmText: '开始专注' }))) return; await window.eyeProtect.preparePomodoro(task.id, true); }); }}><Play size={16} /></button></div>
      <details className="simple-menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') (e.currentTarget as HTMLDetailsElement).open = false; }}><summary aria-label={`更多操作 ${task.title}`}>•••</summary><button className="is-danger" disabled={action.isPending} onClick={() => void (async () => { if (await confirm('任务及其步骤都会被删除，且可用撤销找回。', { title: `删除「${task.title}」？`, confirmText: '删除', danger: true })) await action.run(() => window.eyeProtect.deleteTask(task.id)); })()}>删除任务</button>{pinned ? [-1, 1].map((direction) => <button key={direction} disabled={action.isPending || settings.todoBubbleTaskIds.indexOf(task.id) + direction < 0 || settings.todoBubbleTaskIds.indexOf(task.id) + direction >= settings.todoBubbleTaskIds.length} onClick={() => void action.run(() => { const ids = [...settings.todoBubbleTaskIds]; const index = ids.indexOf(task.id); [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]]; return window.eyeProtect.saveSettings({ todoBubbleTaskIds: ids }); })}>{direction === -1 ? '浮窗上移' : '浮窗下移'}</button>) : null}</details>
    </div>
    {action.error ? <p role="alert">{action.error.message}</p> : null}
    {expanded ? <TaskFields task={task} steps={steps} projects={projects} confirm={confirm} /> : null}
  </article>;
}

function TaskFields({ task, steps, projects, confirm }: { task: Task; steps: Task[]; projects: Project[]; confirm: (message: string, options?: string | { title?: string; detail?: string; confirmText?: string; danger?: boolean }) => Promise<boolean> }): JSX.Element {
  const [draft, setDraft] = useState<TaskUpdateInput>({ title: task.title, dueDate: task.dueDate, reminderAt: task.reminderAt, notes: task.notes, projectId: task.projectId });
  const [revision, setRevision] = useState(task.revision);
  const [stepTitle, setStepTitle] = useState('');
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  // External updates (bubble completion, undo, another edit) must not leave a
  // stale draft behind: resync when the task identity or revision changes.
  useEffect(() => {
    setDraft({ title: task.title, dueDate: task.dueDate, reminderAt: task.reminderAt, notes: task.notes, projectId: task.projectId });
    setRevision(task.revision);
  }, [task.id, task.revision]);
  const dirty = draft.title !== task.title || draft.dueDate !== task.dueDate || draft.reminderAt !== task.reminderAt || draft.notes !== task.notes || draft.projectId !== task.projectId;
  const toDateTime = (time: number | null | undefined): string => time ? new Date(time - new Date(time).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';
  return <div className="simple-task-fields">
    <form onSubmit={(e) => { e.preventDefault(); void action.run(async () => { const result = await window.eyeProtect.updateTask(task.id, { ...draft, baseRevision: revision }); const saved = result.find((entry) => entry.id === task.id); if (saved) setRevision(saved.revision); }); }}>
      <label>名称<input value={draft.title} required onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })} /></label>
      <div className="simple-field-grid"><label>截止日期<input type="date" value={draft.dueDate ?? ''} onChange={(e) => setDraft({ ...draft, dueDate: e.currentTarget.value || null })} /></label>
        <label>提醒我<input type="datetime-local" value={toDateTime(draft.reminderAt)} onChange={(e) => setDraft({ ...draft, reminderAt: e.currentTarget.value ? new Date(e.currentTarget.value).getTime() : null })} /></label>
        <label>清单<select value={draft.projectId ?? ''} onChange={(e) => setDraft({ ...draft, projectId: e.currentTarget.value || null })}><option value="">默认清单</option>{projects.filter(isSimpleList).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
      <label>备注<textarea rows={3} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.currentTarget.value })} /></label><CommandButton state={action.state} errorReason={action.error?.message} variant="primary" disabled={action.isPending || !dirty}>保存修改</CommandButton>
    </form>
    <h3>步骤</h3>{steps.map((step, index) => <div className="simple-step" key={step.id}><input type="checkbox" aria-label={`步骤 ${step.title}`} checked={step.status === 'done'} disabled={action.isPending} onChange={() => void action.run(() => window.eyeProtect.setTaskStatus(step.id, step.status === 'done' ? 'open' : 'done'))} /><input aria-label="步骤名称" key={`${step.id}-${step.revision}`} defaultValue={step.title} onBlur={(e) => { if (e.currentTarget.value.trim() !== step.title) void action.run(() => window.eyeProtect.updateTask(step.id, { title: e.currentTarget.value, baseRevision: step.revision })); }} /><button type="button" aria-label="上移步骤" disabled={!steps.slice(0, index).some((item) => item.parentId === step.parentId) || action.isPending} onClick={() => void action.run(() => window.eyeProtect.moveStep(step.id, -1))}>↑</button><button type="button" aria-label={`删除步骤 ${step.title}`} onClick={() => void (async () => { if (await confirm('这一步及其原有下级都会被删除。', { title: `删除步骤「${step.title}」？`, confirmText: '删除', danger: true })) await action.run(() => window.eyeProtect.deleteTask(step.id)); })()}>×</button></div>)}
    <form className="simple-add" onSubmit={(e) => { e.preventDefault(); if (stepTitle.trim()) void action.run(async () => { await window.eyeProtect.createStep(task.id, stepTitle.trim()); setStepTitle(''); }); }}><input aria-label="添加步骤" placeholder="添加一个步骤…" value={stepTitle} onChange={(e) => setStepTitle(e.currentTarget.value)} /><button className="primary" disabled={action.isPending || !stepTitle.trim()}>添加步骤</button></form>
    {action.error ? <p role="alert">{action.error.message}</p> : null}
  </div>;
}

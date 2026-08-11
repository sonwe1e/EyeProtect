import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarDays,
  Eye,
  FolderKanban,
  Footprints,
  Gift,
  Inbox,
  Play,
  Search,
  Settings2,
  Sun,
  Target,
  X
} from 'lucide-react';
import {
  matchesTaskView,
  sortTasksForView,
  type FailedDeliveryNotice,
  type Task
} from '../../../shared/types';
import { addLocalDays, localDateKey, sameLocalDate, startOfLocalDate } from '../../../shared/calendar';
import { AppHealthBanner } from '../components/AppHealthBanner';
import { CommandPalette, type PaletteCommand } from '../components/CommandPalette';
import { DailyPlanningFlow } from '../features/planning/DailyPlanningFlow';
import { CommandButton } from '../components/CommandButton';
import { Button, IconButton, NavItem, SideSheet, StatusChip, Toast } from '../components/primitives';
import { CharacterCollectionView } from '../features/characters/CharacterCollectionView';
import { DailyReview } from '../features/review/DailyReview';
import { StandaloneReminderSection } from '../features/reminders/StandaloneReminderSection';
import { ProjectList } from '../features/tasks/ProjectList';
import { ProjectWorkspace } from '../features/tasks/ProjectWorkspace';
import { PlanWorkspace } from '../features/tasks/PlanWorkspace';
import { FocusSurface } from '../features/tasks/FocusSurface';
import { TaskComposer } from '../features/tasks/TaskComposer';
import { TaskDetail } from '../features/tasks/TaskDetail';
import { TaskList } from '../features/tasks/TaskList';
import { useActiveTaskId } from '../hooks/useActiveTask';
import { useAppHealth } from '../hooks/useAppHealth';
import { useClock } from '../hooks/useClock';
import { useCommand } from '../hooks/useCommand';
import { useProjects } from '../hooks/useProjects';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useSettings } from '../hooks/useSettings';
import { useTasks } from '../hooks/useTasks';
import { useDailyPlans } from '../hooks/useDailyPlans';
import { useDailyReview } from '../hooks/useDailyReview';
import { useTimeBlocks } from '../hooks/useTimeBlocks';
import { useTaskWork } from '../hooks/useTaskWork';
import { useUndo } from '../hooks/useUndo';
import { commands } from '../lib/commands';
import SettingsView from './SettingsView';

type WorkbenchSection =
  | 'today'
  | 'inbox'
  | 'plan'
  | 'focus'
  | 'projects'
  | 'reminders'
  | 'collection'
  | 'settings'
  | 'review';

const formatMinutes = (value: number): string => `${Math.max(0, Math.floor(value / 60_000))}m`;

export default function WorkbenchView(): JSX.Element {
  const tasks = useTasks();
  const projects = useProjects();
  const activeTaskId = useActiveTaskId();
  const reminderStatus = useReminderStatus();
  const work = useTaskWork();
  const undo = useUndo();
  const health = useAppHealth();
  const { settings } = useSettings();
  const now = useClock(60_000);
  const moveTask = useCommand((input: Parameters<typeof commands.tasks.move>[0]) => commands.tasks.move(input));
  const undoTask = useCommand((id: string) => commands.tasks.undo(id));
  const retryDelivery = useCommand((id: string) => commands.deliveries.retry(id));
  const dismissDelivery = useCommand((id: string) => commands.deliveries.dismiss(id));
  const pause = useCommand((minutes: number) => commands.scheduler.pause(minutes));
  const resume = useCommand(() => commands.scheduler.resume());
  const [section, setSection] = useState<WorkbenchSection>('today');
  const [planningOpen, setPlanningOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [failedDeliveries, setFailedDeliveries] = useState<FailedDeliveryNotice[]>([]);
  const [reviewDate, setReviewDate] = useState(localDateKey(now));
  const reviewDateLabel = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
    .format(new Date(`${reviewDate}T00:00:00`));
  const { summary: reviewSummary, refresh: refreshReview } = useDailyReview(reviewDate);

  useEffect(() => {
    const navigate = (target: WorkbenchSection): void => {
      setSection(target);
      if (target === 'today') setSelectedProjectId(null);
    };
    void window.eyeProtect.getWorkbenchSection().then(navigate);
    return window.eyeProtect.onWorkbenchNavigate(navigate);
  }, []);

  useEffect(() => {
    if (section !== 'review') {
      setReviewDate(localDateKey(now));
    }
  }, [section, now]);

  useEffect(() => {
    void window.eyeProtect.getFailedDeliveries().then(setFailedDeliveries);
    return window.eyeProtect.onFailedDeliveriesChanged(setFailedDeliveries);
  }, []);

  const openTasks = useMemo(() => tasks.filter((task) => task.status === 'open'), [tasks]);
  const inboxTasks = useMemo(
    () => tasks.filter((task) => matchesTaskView(task, 'inbox', now, activeTaskId)),
    [tasks, now, activeTaskId]
  );
  const overdueTasks = useMemo(
    () => tasks.filter((task) => matchesTaskView(task, 'overdue', now, activeTaskId)),
    [tasks, now, activeTaskId]
  );
  const { blocks: allBlocks } = useTimeBlocks();
  // Tasks owning a TimeBlock that starts today are scheduled — the block is
  // the schedule fact, not plannedAt (USERPLAN PR4 / ADR-001).
  const scheduledTodayIds = useMemo(() => {
    const todayStart = startOfLocalDate(now);
    const ids = new Set<string>();
    for (const block of allBlocks) {
      if (sameLocalDate(block.startAt, todayStart)) ids.add(block.taskId);
    }
    return ids;
  }, [allBlocks, now]);
  const todayTasks = useMemo(() => {
    const overdue = new Set(overdueTasks.map((task) => task.id));
    return sortTasksForView(
      tasks.filter((task) => matchesTaskView(task, 'today', now, activeTaskId, scheduledTodayIds) && !overdue.has(task.id)),
      now
    );
  }, [tasks, overdueTasks, now, activeTaskId, scheduledTodayIds]);
  // ── Today 2.1 (USERPLAN 1.2 §十一): commitments come from DailyTaskPlan,
  // not from global priority. NOW / TODAY'S 3 / SCHEDULED / FLEXIBLE.
  const todayKey = localDateKey(now);
  const { plans: todayPlans } = useDailyPlans(todayKey);
  const planByTask = useMemo(() => new Map(todayPlans.map((plan) => [plan.taskId, plan])), [todayPlans]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const todaysThree = useMemo(
    () =>
      todayPlans
        .filter((plan) => plan.dailyRank !== null)
        .sort((left, right) => (left.dailyRank ?? 0) - (right.dailyRank ?? 0))
        .map((plan) => taskById.get(plan.taskId))
        .filter((task): task is Task => Boolean(task)),
    [todayPlans, taskById]
  );
  const scheduledToday = useMemo(
    () =>
      todayTasks
        .filter((task) => task.plannedAt !== null || scheduledTodayIds.has(task.id))
        .sort((left, right) => (left.plannedAt ?? Infinity) - (right.plannedAt ?? Infinity)),
    [todayTasks, scheduledTodayIds]
  );
  const flexibleToday = useMemo(() => {
    const ranked = new Set(todaysThree.map((task) => task.id));
    const scheduled = new Set(scheduledToday.map((task) => task.id));
    const plannedFlexible = todayPlans
      .map((plan) => taskById.get(plan.taskId))
      .filter((task): task is Task => Boolean(task && task.plannedAt === null && !scheduledTodayIds.has(task.id)));
    const unscheduledDue = todayTasks.filter(
      (task) => task.plannedAt === null && !planByTask.has(task.id)
    );
    return [...plannedFlexible, ...unscheduledDue].filter(
      (task, index, list) => !ranked.has(task.id) && !scheduled.has(task.id) && list.indexOf(task) === index
    );
  }, [todayPlans, taskById, todaysThree, scheduledToday, scheduledTodayIds, todayTasks, planByTask]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null;
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const query = search.trim().toLocaleLowerCase();
  const searchResults = query
    ? tasks.filter((task) => `${task.title}\n${task.notes ?? ''}\n${task.tags.join('\n')}`.toLocaleLowerCase().includes(query))
    : [];
  const eyeRemaining = Math.max(0, reminderStatus.nextEyeAt - now);
  const walkRemaining = Math.max(0, reminderStatus.nextWalkAt - now);

  const selectSection = useCallback((next: WorkbenchSection) => {
    setSection(next);
    if (next !== 'projects') setSelectedProjectId(null);
    setSelectedTaskId(null);
  }, []);

  const selectProject = useCallback((id: string | null) => {
    setSection('projects');
    setSelectedProjectId(id);
    setSelectedTaskId(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false;
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (!isEditing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key.toLocaleLowerCase() === 'n') {
          event.preventDefault();
          selectSection('inbox');
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-quick-add="true"]')?.focus());
        } else if (event.key.toLocaleLowerCase() === 'p') {
          event.preventDefault();
          selectSection('plan');
        } else if (event.key.toLocaleLowerCase() === 'f') {
          event.preventDefault();
          selectSection('focus');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectSection]);

  const navItems: Array<{ id: WorkbenchSection; label: string; icon: typeof Sun; count?: number }> = [
    { id: 'today', label: '今天', icon: Sun, count: todayTasks.length + overdueTasks.length },
    { id: 'inbox', label: '收件箱', icon: Inbox, count: inboxTasks.length },
    { id: 'plan', label: '计划', icon: CalendarDays },
    { id: 'focus', label: '专注', icon: Target },
    { id: 'projects', label: '项目', icon: FolderKanban },
    { id: 'review', label: '今日复盘', icon: CalendarDays }
  ];
  const paletteCommands = useMemo<PaletteCommand[]>(() => [
    { id: 'today', label: '前往：今天', keywords: 'today', run: () => selectSection('today') },
    { id: 'plan-today', label: '每日规划：规划今天', keywords: 'daily planning', run: () => { selectSection('today'); setPlanningOpen(true); } },
    { id: 'inbox', label: '前往：收件箱', keywords: 'inbox', run: () => selectSection('inbox') },
    { id: 'plan', label: '前往：计划', hint: 'P', keywords: 'plan', run: () => selectSection('plan') },
    { id: 'focus', label: '前往：专注', hint: 'F', keywords: 'focus', run: () => selectSection('focus') },
    { id: 'projects', label: '前往：项目', keywords: 'projects', run: () => selectSection('projects') },
    { id: 'review', label: '前往：今日复盘', keywords: 'review', run: () => selectSection('review') },
    { id: 'reminders', label: '前往：独立提醒', run: () => selectSection('reminders') },
    { id: 'collection', label: '前往：公仔收藏', run: () => selectSection('collection') },
    { id: 'settings', label: '前往：设置', run: () => selectSection('settings') },
    { id: 'search-tasks', label: '搜索任务', keywords: 'find', run: () => setSearchOpen(true) },
    { id: 'new-task', label: '新建任务', hint: 'N', keywords: 'create add', run: () => {
      selectSection('inbox');
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-quick-add="true"]')?.focus());
    } }
  ], [selectSection]);

  const taskList = (items: Task[], view: 'today' | 'inbox', scopeProjectId: string | null = null): JSX.Element => (
    <TaskList
      tasks={items}
      view={view}
      projects={projects}
      now={now}
      selectedTaskId={selectedTaskId}
      scopeProjectId={scopeProjectId}
      onSelect={setSelectedTaskId}
      onMove={view === 'inbox' ? (taskId, beforeTaskId) => {
        void moveTask.run({
          taskId,
          beforeTaskId,
          scope: scopeProjectId ? { type: 'project', projectId: scopeProjectId } : { type: 'inbox' }
        });
      } : undefined}
    />
  );

  const advanceReviewDate = (days: number): void => {
    const base = new Date(`${reviewDate}T00:00:00`).getTime();
    setReviewDate(localDateKey(addLocalDays(base, days)));
  };

  const renderWorkspace = (): JSX.Element => {
    if (section === 'settings') return <div className="workbench-embedded-page"><SettingsView embedded /></div>;
    if (section === 'reminders') return <div className="workbench-embedded-page"><StandaloneReminderSection /></div>;
    if (section === 'collection') return <div className="workbench-embedded-page"><CharacterCollectionView /></div>;
    if (section === 'review') return (
      <DailyReview
        dateLabel={reviewDateLabel}
        summary={reviewSummary}
        onTomorrow={() => advanceReviewDate(1)}
        onRearrange={() => selectSection('plan')}
        onBacklog={() => selectSection('inbox')}
        onRefresh={refreshReview}
      />
    );
    if (searchOpen && query) {
      return (
        <div className="workspace-page">
          <header className="page-header"><div><span className="page-eyebrow">搜索</span><h1>“{search.trim()}”</h1></div><span>{searchResults.length} 项结果</span></header>
          {taskList(searchResults, 'today')}
        </div>
      );
    }
    if (section === 'focus') {
      return (
        <FocusSurface
          activeTask={activeTask}
          candidates={todayTasks.length ? todayTasks : openTasks}
          tasks={tasks}
          liveSegmentMs={work.currentSessionMs}
          eyeRemaining={eyeRemaining}
          onOpen={setSelectedTaskId}
        />
      );
    }
    if (section === 'plan') {
      return <PlanWorkspace tasks={tasks} now={now} nextEyeAt={reminderStatus.nextEyeAt} nextWalkAt={reminderStatus.nextWalkAt} onOpen={setSelectedTaskId} />;
    }
    if (section === 'projects') {
      if (!selectedProject) {
        return (
          <div className="workspace-page projects-overview">
          <header className="page-header"><div><span className="page-eyebrow">组织工作</span><h1>项目</h1></div><StatusChip>{projects.length} 个项目</StatusChip></header>
            <p>从左侧选择一个项目，查看任务进度和下一步。</p>
          </div>
        );
      }
      return <ProjectWorkspace project={selectedProject} tasks={tasks} projects={projects} activeTaskId={activeTaskId} now={now} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} />;
    }
    if (section === 'inbox') {
      return (
        <div className="workspace-page">
          <header className="page-header"><div><span className="page-eyebrow">快速收集</span><h1>收件箱</h1></div><span>{inboxTasks.length} 项任务</span></header>
          <TaskComposer projects={projects} />
          <section className="task-section">{taskList(inboxTasks, 'inbox')}</section>
        </div>
      );
    }
    if (planningOpen) {
      return (
        <DailyPlanningFlow
          tasks={tasks}
          now={now}
          settings={settings}
          onOpen={setSelectedTaskId}
          onClose={() => setPlanningOpen(false)}
          onGoToPlan={() => {
            setPlanningOpen(false);
            selectSection('plan');
          }}
        />
      );
    }
    return (
      <div className="workspace-page today-page">
        <header className="page-header">
          <div><span className="page-eyebrow">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(now))}</span><h1>今天</h1></div>
          <div className="today-header-actions">
            <Button onClick={() => setPlanningOpen(true)}><CalendarDays size={15} />规划今天</Button>
            <div className="rhythm-summary"><span><Eye size={16} />{formatMinutes(eyeRemaining)}</span><span><Footprints size={16} />{formatMinutes(walkRemaining)}</span></div>
          </div>
        </header>
        {activeTask ? (
          <section className="now-card">
            <span>NOW</span><h2>{activeTask.title}</h2>
            <p>
              本次 {formatMinutes(work.currentSessionMs)} · 今日 {formatMinutes(work.taskActiveMs)}
              {planByTask.get(activeTask.id)?.plannedMinutes ?? activeTask.estimateMinutes
                ? ` · 计划 ${planByTask.get(activeTask.id)?.plannedMinutes ?? activeTask.estimateMinutes}m`
                : ''}
              {` · 下次护眼 ${formatMinutes(eyeRemaining)}`}
            </p>
            <Button variant="primary" onClick={() => selectSection('focus')}><Play size={16} />继续专注</Button>
          </section>
        ) : null}
        <TaskComposer projects={projects} />
        {todaysThree.length ? (
          <section className="task-section"><h2>今日目标（Today&apos;s {todaysThree.length}）</h2>{taskList(todaysThree, 'today')}</section>
        ) : (
          <section className="task-section today-goals-empty"><h2>今日目标</h2><p className="empty-state">还没有今日承诺。<Button onClick={() => setPlanningOpen(true)}>开始每日规划</Button>，选出不超过 3 件真正要做的事。</p></section>
        )}
        {scheduledToday.length ? <section className="task-section"><h2>已安排</h2>{taskList(scheduledToday, 'today')}</section> : null}
        {flexibleToday.length ? <section className="task-section"><h2>灵活（今天要做，未排时间）</h2>{taskList(flexibleToday, 'today')}</section> : null}
        {overdueTasks.length ? (
          <section className="overdue-callout"><div><strong>{overdueTasks.length} 件需要重新安排</strong><span>逐件决定去向：今天、明天，或放回以后。</span></div><Button onClick={() => setPlanningOpen(true)}>重新安排</Button></section>
        ) : null}
      </div>
    );
  };

  const failedDelivery = failedDeliveries[0] ?? null;
  return (
    <main className={`workbench-v2 ${section === 'focus' && activeTask ? 'is-focus-mode' : ''}`}>
      <AppHealthBanner health={health} />
      <aside className="app-sidebar">
        <div className="app-brand"><span className="app-brand-mark"><Eye size={19} /></span><div><strong>EyeProtect</strong><span>Quiet Focus</span></div></div>
        <nav className="primary-nav" aria-label="主要导航">
          {navItems.map(({ id, label, icon, count }) => <NavItem key={id} icon={icon} label={label} count={count} selected={section === id} onClick={() => selectSection(id)} />)}
        </nav>
        <ProjectList projects={projects} tasks={tasks} selectedProjectId={selectedProjectId} onSelect={selectProject} />
        <nav className="utility-nav" aria-label="辅助导航">
          <NavItem icon={Bell} label="独立提醒" selected={section === 'reminders'} onClick={() => selectSection('reminders')} />
          <NavItem icon={Gift} label="公仔收藏" selected={section === 'collection'} onClick={() => selectSection('collection')} />
          <NavItem icon={Settings2} label="设置" selected={section === 'settings'} onClick={() => selectSection('settings')} />
        </nav>
      </aside>
      <section className="app-workspace">
        <header className="workspace-toolbar">
          {searchOpen ? (
            <label className="workspace-search"><Search size={17} /><input autoFocus value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="搜索标题、备注或标签" /><IconButton aria-label="关闭搜索" onClick={() => { setSearchOpen(false); setSearch(''); }}><X size={17} /></IconButton></label>
          ) : <button type="button" className="command-palette-trigger" onClick={() => setPaletteOpen(true)}><Search size={18} /><span>搜索或运行命令</span><kbd>Ctrl K</kbd></button>}
          <div className="toolbar-rhythm"><span>连续活跃 {formatMinutes(work.continuousActiveMs)}</span>
            {reminderStatus.pausedUntil ? <CommandButton state={resume.state} errorReason={resume.error?.message} onClick={() => void resume.run()}>恢复提醒</CommandButton> : <CommandButton state={pause.state} errorReason={pause.error?.message} onClick={() => void pause.run(30)}>暂停 30 分钟</CommandButton>}
          </div>
        </header>
        <div className="workspace-scroll">{renderWorkspace()}</div>
      </section>
      <SideSheet open={selectedTask !== null} title="任务详情" onClose={() => setSelectedTaskId(null)}>
        {selectedTask ? <TaskDetail key={selectedTask.id} task={selectedTask} tasks={tasks} projects={projects} active={selectedTask.id === activeTaskId} onDeleted={() => setSelectedTaskId(null)} /> : null}
      </SideSheet>
      <CommandPalette open={paletteOpen} commands={paletteCommands} onClose={() => setPaletteOpen(false)} />
      {undo ? <Toast actions={<CommandButton variant="ghost" state={undoTask.state} errorReason={undoTask.error?.message} onClick={() => void undoTask.run(undo.operationId)}>撤销</CommandButton>}><span className="undo-toast-copy">{undo.kind === 'delete' ? '已删除' : '已完成'}「{undo.taskTitle}」</span></Toast> : null}
      {failedDelivery ? <Toast tone="danger" role="alert" actions={<><CommandButton variant="ghost" state={retryDelivery.state} errorReason={retryDelivery.error?.message} onClick={() => void retryDelivery.run(failedDelivery.id)}>重试</CommandButton><CommandButton variant="ghost" state={dismissDelivery.state} errorReason={dismissDelivery.error?.message} onClick={() => void dismissDelivery.run(failedDelivery.id)}>忽略</CommandButton></>}><strong>有提醒未能送达</strong><span>{failedDelivery.title} · {failedDelivery.body}</span></Toast> : null}
    </main>
  );
}

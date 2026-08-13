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
  Settings2,
  Sun,
  Target,
  type LucideIcon
} from 'lucide-react';
import {
  matchesTaskView,
  type FailedDeliveryNotice,
  type Task
} from '../../../shared/types';
import { addLocalDays, localDateKey, sameLocalDate, startOfLocalDate } from '../../../shared/calendar';
import { AppHealthBanner } from '../components/AppHealthBanner';
import { CommandPalette, type PaletteCommand } from '../components/CommandPalette';
import { DailyPlanningFlow } from '../features/planning/DailyPlanningFlow';
import { CommandButton } from '../components/CommandButton';
import { Button, ProjectDot, SideSheet, StatusChip, Toast } from '../components/primitives';
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
import { deriveTodayExecutionModel } from '../features/tasks/todayViewModel';
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
import { useFocusStatus } from '../hooks/useFocusStatus';
import { useTimeBlocks } from '../hooks/useTimeBlocks';
import { useTaskWork } from '../hooks/useTaskWork';
import { useUndo } from '../hooks/useUndo';
import { commands } from '../lib/commands';
import {
  PRIMARY_SECTION_ORDER,
  UTILITY_SECTION_ORDER,
  WORKBENCH_SECTIONS,
  WORKBENCH_SHORTCUTS,
  type WorkbenchSectionId
} from '../features/workbench/workbenchNavigation';
import { WorkbenchSidebar, type WorkbenchNavItem } from '../features/workbench/WorkbenchSidebar';
import { WorkbenchToolbar } from '../features/workbench/WorkbenchToolbar';
import SettingsView from './SettingsView';

const SECTION_ICON: Record<string, LucideIcon> = {
  sun: Sun,
  inbox: Inbox,
  calendarDays: CalendarDays,
  target: Target,
  folderKanban: FolderKanban,
  bell: Bell,
  gift: Gift,
  settings: Settings2
};

// Module-scope formatter: constructing an Intl.DateTimeFormat on every render
// is wasteful, and this view re-renders at least once a minute (useClock).
const reviewDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long'
});

type WorkbenchSection = WorkbenchSectionId;

const formatMinutes = (value: number): string => `${Math.max(0, Math.floor(value / 60_000))}m`;

export default function WorkbenchView(): JSX.Element {
  const tasks = useTasks();
  const projects = useProjects();
  const activeTaskId = useActiveTaskId();
  const reminderStatus = useReminderStatus();
  const work = useTaskWork();
  const focusStatus = useFocusStatus();
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
  const reviewDateLabel = reviewDateFormatter.format(new Date(`${reviewDate}T00:00:00`));
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
  // ── Today 2.1 (USERPLAN 1.2 §十一): commitments come from DailyTaskPlan,
  // not from global priority. NOW / TODAY'S 3 / SCHEDULED / FLEXIBLE.
  const todayKey = localDateKey(now);
  const { plans: todayPlans } = useDailyPlans(todayKey);
  const planByTask = useMemo(() => new Map(todayPlans.map((plan) => [plan.taskId, plan])), [todayPlans]);
  const todayModel = useMemo(
    () => deriveTodayExecutionModel(tasks, todayPlans, scheduledTodayIds),
    [tasks, todayPlans, scheduledTodayIds]
  );
  const todaysThree = todayModel.todaysThree;
  const scheduledToday = todayModel.scheduled;
  const flexibleToday = todayModel.flexible;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null;
  const focusTask = focusStatus.session
    ? tasks.find((task) => task.id === focusStatus.session?.taskId) ?? activeTask
    : activeTask;
  const isFocusMode = section === 'focus'
    && focusStatus.session !== null
    && focusStatus.session.taskId === focusTask?.id;
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
    setSearchOpen(false);
    setSearch('');
  }, []);

  const selectProject = useCallback((id: string | null) => {
    setSection('projects');
    setSelectedProjectId(id);
    setSelectedTaskId(null);
    setSearchOpen(false);
    setSearch('');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false;
      const key = event.key.toLocaleLowerCase();
      const shortcuts = WORKBENCH_SHORTCUTS;
      if (event.key === 'Escape' && isFocusMode) {
        event.preventDefault();
        selectSection('today');
      } else if ((event.ctrlKey || event.metaKey) && key === shortcuts.command) {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (!isEditing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (key === shortcuts.newTask) {
          event.preventDefault();
          selectSection('inbox');
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-quick-add="true"]')?.focus());
        } else if (key === shortcuts.plan) {
          event.preventDefault();
          selectSection('plan');
        } else if (key === shortcuts.focus) {
          event.preventDefault();
          selectSection('focus');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFocusMode, selectSection]);

  // Primary navigation is derived from the single-source-of-truth config
  // (features/workbench/workbenchNavigation.ts). Review intentionally moved to
  // the utility tier — it is a summary action, not a daily work surface.
  const primaryNavItems: WorkbenchNavItem[] = useMemo(
    () =>
      PRIMARY_SECTION_ORDER.map((id) => {
        const meta = WORKBENCH_SECTIONS[id];
        const icon = SECTION_ICON[meta.iconKey] ?? Sun;
        if (id === 'today') return { id, label: meta.label, description: meta.description, icon, count: todayModel.count };
        if (id === 'inbox') return { id, label: meta.label, description: meta.description, icon, count: inboxTasks.length };
        return { id, label: meta.label, description: meta.description, icon };
      }),
    [todayModel.count, inboxTasks.length]
  );
  const utilityNavItems: WorkbenchNavItem[] = useMemo(
    () =>
      UTILITY_SECTION_ORDER.map((id) => {
        const meta = WORKBENCH_SECTIONS[id];
        return { id, label: meta.label, description: meta.description, icon: SECTION_ICON[meta.iconKey] ?? Bell };
      }),
    []
  );
  const paletteCommands = useMemo<PaletteCommand[]>(() => [
    { id: 'today', label: '前往：今天', keywords: 'today', run: () => selectSection('today') },
    { id: 'plan-today', label: '每日规划：规划今天', keywords: 'daily planning', run: () => { selectSection('today'); setPlanningOpen(true); } },
    { id: 'inbox', label: '前往：收件箱', keywords: 'inbox', run: () => selectSection('inbox') },
    { id: 'plan', label: '前往：日程', hint: 'P', keywords: 'plan schedule', run: () => selectSection('plan') },
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
      timeBlocks={allBlocks}
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
          activeTask={focusTask}
          candidates={todayModel.tasks}
          tasks={tasks}
          focus={focusStatus}
          immersive={isFocusMode}
          liveSegmentMs={work.currentSessionMs}
          eyeRemaining={eyeRemaining}
          onOpen={setSelectedTaskId}
          onBack={() => selectSection('today')}
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
          <header className="page-header"><div><span className="page-eyebrow">组织工作</span><h1>项目</h1><p className="page-description">把需要多步推进、持续数天或更久的目标放进项目。</p></div><StatusChip>{projects.length} 个项目</StatusChip></header>
            {projects.length ? (
              <div className="project-overview-list">
                {projects.map((project) => {
                  const projectTasks = tasks.filter((task) => task.projectId === project.id && task.status !== 'archived');
                  const completed = projectTasks.filter((task) => task.status === 'done').length;
                  const open = projectTasks.length - completed;
                  const progress = projectTasks.length ? Math.round(completed / projectTasks.length * 100) : 0;
                  return (
                    <button key={project.id} type="button" className="project-overview-card" onClick={() => selectProject(project.id)}>
                      <ProjectDot color={project.color} />
                      <span><strong>{project.name}</strong><small>{project.goal || '还没有项目目标'}</small></span>
                      <em>{open} 个未完成 · {completed} 个已完成</em>
                      <i aria-label={`完成 ${progress}%`}><span style={{ width: `${progress}%` }} /></i>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="project-overview-empty">
                <p>项目适合：完成论文、上线一个产品、准备一次旅行，或进行长期学习计划。</p>
                <p>“买牛奶”这样的单次任务不需要项目，直接放在收件箱即可。</p>
              </div>
            )}
          </div>
        );
      }
      return <ProjectWorkspace project={selectedProject} tasks={tasks} projects={projects} timeBlocks={allBlocks} activeTaskId={activeTaskId} now={now} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} />;
    }
    if (section === 'inbox') {
      return (
        <div className="workspace-page">
          <header className="page-header"><div><span className="page-eyebrow">快速收集</span><h1>收件箱</h1><p className="page-description">尚未归入项目的任务；它仍然可以同时属于今天或日程。</p></div><span>{inboxTasks.length} 项任务</span></header>
          <TaskComposer projects={projects} tasks={tasks} placement={{ type: 'inbox' }} />
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
          <div><span className="page-eyebrow">{reviewDateFormatter.format(new Date(now))}</span><h1>今天</h1><p className="page-description">今天真正承诺完成的工作；安排具体时间是可选的。</p></div>
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
        <TaskComposer projects={projects} tasks={tasks} placement={{ type: 'today', localDate: todayKey }} />
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
    <main className={`workbench-v2 ${isFocusMode ? 'is-focus-mode' : ''}`}>
      <AppHealthBanner health={health} />
      <WorkbenchSidebar
        primaryItems={primaryNavItems}
        utilityItems={utilityNavItems}
        section={section}
        onSelect={selectSection}
        projects={projects}
        tasks={tasks}
        selectedProjectId={selectedProjectId}
        onSelectProject={selectProject}
      />
      <section className="app-workspace">
        <WorkbenchToolbar
          searchOpen={searchOpen}
          search={search}
          onSearchChange={setSearch}
          onCloseSearch={() => { setSearchOpen(false); setSearch(''); }}
          onOpenPalette={() => setPaletteOpen(true)}
          continuousActiveMs={work.continuousActiveMs}
          formatMinutes={formatMinutes}
          pausedUntil={reminderStatus.pausedUntil}
          resumeState={resume.state}
          resumeError={resume.error?.message}
          onResume={() => void resume.run()}
          pauseState={pause.state}
          pauseError={pause.error?.message}
          onPause={(minutes) => void pause.run(minutes)}
        />
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

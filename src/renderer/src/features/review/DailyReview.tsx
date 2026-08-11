import { CalendarDays, RefreshCcw, RotateCcw, Shuffle } from 'lucide-react';
import { Button, StatusChip } from '../../components/primitives';
import type { DailyReviewSummary } from '../../../../shared/types';
import styles from './DailyReview.module.css';

const formatPlanTime = (minutes: number): string => {
  const totalMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(totalMinutes / 60);
  const rest = totalMinutes % 60;
  return hours > 0 ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest}m`;
};

const formatWorkMs = (ms: number): string => {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const rest = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
};

const renderStatus = (status: DailyReviewSummary['tasks'][number]['status']): string => {
  if (status === 'done') return '完成';
  if (status === 'archived') return '归档';
  return '待办';
};

export const DailyReview = ({
  dateLabel,
  summary,
  onTomorrow,
  onRearrange,
  onBacklog,
  onRefresh
}: {
  dateLabel: string;
  summary: DailyReviewSummary | null;
  onTomorrow: () => void;
  onRearrange: () => void;
  onBacklog: () => void;
  onRefresh: () => void;
}): JSX.Element => {
  return (
    <div className={`workspace-page review-page ${styles.root}`}>
      <header className="page-header">
        <div>
          <span className="page-eyebrow">Daily Shutdown</span>
          <h1>今日复盘 · {dateLabel}</h1>
        </div>
        <StatusChip>{summary ? `${summary.tasks.length} 个计划任务` : '加载中…'}</StatusChip>
      </header>
      {!summary ? (
        <p className="review-loading">正在汇总今日数据…</p>
      ) : (
        <>
          <section className={styles.cards}>
            <article className={styles.card}>
              <span>计划</span>
              <strong>{formatPlanTime(summary.plannedMinutes)}</strong>
            </article>
            <article className={styles.card}>
              <span>实际</span>
              <strong>{formatWorkMs(summary.actualWorkMs)}</strong>
            </article>
            <article className={styles.card}>
              <span>完成 Today&apos;s 3</span>
              <strong>{summary.completedTodaysThreeCount}/{summary.todaysThreeCount}</strong>
            </article>
            <article className={styles.card}>
              <span>任务完成</span>
              <strong>{summary.completedPlannedTaskCount}/{summary.plannedTaskCount}</strong>
            </article>
          </section>

          <section className={styles.cards}>
            <article className={styles.card}>
              <span>专注会话</span>
              <strong>{summary.focusSessionCount}</strong>
              <small>完成 {summary.focusCompletedSessions} · 暂停 {summary.focusPausedSessions} · 中断 {summary.focusInterruptedSessions}</small>
            </article>
            <article className={styles.card}>
              <span>专注有效时长</span>
              <strong>{formatWorkMs(summary.focusWorkMs)}</strong>
            </article>
            <article className={styles.card}>
              <span>健康休息</span>
              <strong>{summary.reminderStats.complete} 次完成</strong>
              <small>{summary.reminderStats.skip} 次跳过 · {summary.reminderStats.naturalBreak} 次自然休息</small>
            </article>
            <article className={styles.card}>
              <span>完成率</span>
              <strong>{Math.round(summary.reminderStats.completionRate * 100)}%</strong>
            </article>
          </section>

          <section>
            <header className="page-sub-header">
              <h2>今日任务明细（按日计划）</h2>
            </header>
            {summary.tasks.length === 0 ? (
              <p className={styles.empty}>今天还没有日计划任务。</p>
            ) : (
              <ul className={styles.taskList}>
                {summary.tasks.map((entry) => (
                  <li key={entry.taskId}>
                    <div>
                      <strong>{entry.title}</strong>
                      <span>{renderStatus(entry.status)}</span>
                    </div>
                    <small>计划 {entry.plannedMinutes ?? '--'}m · 今日 {formatWorkMs(entry.todayWorkMs)} · 累计 {formatWorkMs(entry.totalWorkMs)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.actions}>
            <Button variant="ghost" onClick={onTomorrow}>
              <CalendarDays size={15} /> 明天
            </Button>
            <Button variant="ghost" onClick={onRearrange}>
              <RotateCcw size={15} /> 重新安排
            </Button>
            <Button variant="ghost" onClick={onBacklog}>
              <Shuffle size={15} /> Backlog
            </Button>
            <Button variant="ghost" onClick={() => {
              onRefresh();
            }}>
              <RefreshCcw size={15} /> 刷新
            </Button>
          </section>
        </>
      )}
    </div>
  );
};

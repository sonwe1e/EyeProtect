import { AlertTriangle, FolderOpen, RefreshCw } from 'lucide-react';
import type { AppHealth } from '../../../shared/types';
import { commands } from '../lib/commands';

/**
 * Fail-loud health banner (USERPLAN §十七, §二十八).
 *
 * The opposite of "the app looks fine but every button is fake": when the
 * database or notification subsystem is not healthy, this banner is the first
 * thing the user sees, with a concrete explanation and recovery actions. It is
 * rendered at the top of the workbench; when everything is healthy it mounts
 * nothing.
 *
 * The database being unavailable is the critical case — it is exactly the
 * "many unrelated buttons die together" failure the USERPLAN diagnosed, so we
 * name it plainly and offer [重试] and [打开数据目录].
 */
export function AppHealthBanner({ health }: { health: AppHealth | null }): JSX.Element | null {
  if (health === null) {
    return null;
  }
  if (health.database === 'healthy' && health.notification === 'available') {
    return null;
  }

  // A renderer-only reload cannot exit database-recovery mode (the main-process
  // TaskStore is constructed once at startup), so a full restart is required.
  const reload = (): void => {
    void commands.system.relaunch();
  };
  const openDataDir = (): void => {
    void commands.data.openDataDirectory();
  };

  return (
    <div className="app-health-banner" role="alert">
      <div className="app-health-banner-main">
        <AlertTriangle size={18} />
        <div>
          <strong>
            {health.database === 'unavailable'
              ? '无法打开本地工作数据库'
              : '任务数据库正在恢复模式运行'}
          </strong>
          {/* Database and notification problems are reported independently, so a
              launch that is both DB-degraded and notification-unavailable shows
              both explanations instead of silently dropping one. */}
          {health.database === 'unavailable' ? (
            <span>你的文件仍然保留。可以先导出备份、打开数据目录保留快照，或创建新的空数据库。</span>
          ) : health.database === 'degraded' ? (
            <span>数据库正以不写回原文件的方式运行。你的文件仍然保留，任务修改暂时不会持久保存。</span>
          ) : null}
          {health.notification === 'unavailable' ? (
            <span>系统通知当前不可用，任务提醒仍会显示在 EyeProtect 内。</span>
          ) : null}
        </div>
      </div>
      <div className="app-health-banner-actions">
        {health.database !== 'healthy' ? (
          <>
            <button type="button" className="primary" onClick={reload}>
              <RefreshCw size={14} /> 重试
            </button>
            <button type="button" onClick={openDataDir}>
              <FolderOpen size={14} /> 打开数据目录
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

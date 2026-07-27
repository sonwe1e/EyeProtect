import { app, BrowserWindow } from 'electron';

const LOG_INTERVAL_MS = 5 * 60_000;

/**
 * Lightweight observability for the resource-reduction work (USERPLAN §11):
 * per-process memory/CPU plus live window counts, on a slow interval.
 *
 * Off in packaged builds unless EYEPROTECT_DIAGNOSTICS=1; always on in dev.
 */
export const startDiagnostics = (): void => {
  if (app.isPackaged && !process.env.EYEPROTECT_DIAGNOSTICS) {
    return;
  }

  const timer = setInterval(() => {
    try {
      const metrics = app.getAppMetrics();
      const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length;
      const lines = metrics.map((metric) => {
        const cpu = metric.cpu.percentCPUUsage.toFixed(1);
        const wsKb = metric.memory.workingSetSize;
        return `  ${metric.type} (pid ${metric.pid}): cpu ${cpu}%, mem ${wsKb} KB`;
      });
      console.log(`[diagnostics] windows=${windows}, processes=${metrics.length}\n${lines.join('\n')}`);
    } catch (error) {
      console.warn('[diagnostics] metrics collection failed:', error);
    }
  }, LOG_INTERVAL_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
};

import { BrowserWindow, Notification, app } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ActiveReminder } from '../shared/types';
import { emergencyTitleFor, renderEmergencyHtml } from './scheduling/emergencyTemplate';
import { runReminderSurfaceFallback } from './scheduling/surfaceFallback';

/**
 * ReminderSurfaceManager — owns the fallback chain that guarantees a reminder
 * is always user-visible while the main process is alive (USERPLAN §四.B):
 *
 *   Scheduler
 *      ↓
 *   primary AlertWindow (React, artwork, activities)
 *      ↓  render-process-gone / failed load
 *   Emergency Window (minimal inline HTML, no assets)
 *      ↓  also failed / unsupported
 *   Native Notification
 *      ↓
 *   tray state
 *
 * The emergency surface deliberately has no React, no image assets and no
 * external CSS: it renders from an inline template so it works even when the
 * renderer that builds the pretty card is the very thing that broke.
 */

const moduleDir = join(fileURLToPath(new URL('.', import.meta.url)));
const emergencyPreloadPath = join(moduleDir, '../preload/emergency.cjs');

type EmergencyAction = 'complete' | 'snooze' | 'skip';

export class ReminderSurfaceManager {
  private emergencyWindow: BrowserWindow | null = null;
  private presentationSequence = 0;
  private primaryWebContentsId: number | null = null;
  private emergencyWebContentsId: number | null = null;
  private currentReminderId: string | null = null;
  private surfaceState: 'idle' | 'loading' | 'primary' | 'emergency' | 'notification' = 'idle';

  constructor(
    /** Shows the pretty primary alert; returns false if it could not be shown. */
    private readonly showPrimary: (active: ActiveReminder) => Promise<boolean>,
    /** Invoked when the emergency surface triggers an action, so the scheduler
     *  can record it and reschedule. */
    private readonly onAction: (action: EmergencyAction, reminderId: string) => void,
    private readonly openWorkbench: () => void = () => {},
    private readonly trace: (event: string, data?: Record<string, unknown>) => void = () => {},
    private readonly getPrimaryWebContentsId: () => number | null = () => null,
    private readonly isPrimaryHealthy: () => boolean = () => false,
    /**
     * Invoked when present() returns 'none' for the current sequence: every
     * surface failed so the dim masks (if any) must be torn down to honor the
     * invariant "an active focused reminder always has an actionable surface or
     * its dim masks are destroyed". Defaults to a no-op.
     */
    private readonly onFailOpen: () => void = () => {}
  ) {}

  /**
   * Show a reminder on the best available surface. Returns the surface that
   * ended up presenting it. Never throws: a failure here must not take down the
   * reminder, it must degrade.
   */
  async present(
    active: ActiveReminder
  ): Promise<'primary' | 'emergency' | 'notification' | 'none'> {
    const sequence = ++this.presentationSequence;
    this.currentReminderId = active.id;
    this.surfaceState = 'loading';
    const result = await runReminderSurfaceFallback({
      isCurrent: () => sequence === this.presentationSequence,
      primary: async () => {
        this.trace('window-create', { reminderId: active.id, kind: active.kind, surface: 'primary' });
        const shown = await this.showPrimary(active);
        if (shown) {
          this.primaryWebContentsId = this.getPrimaryWebContentsId();
          this.surfaceState = 'primary';
          this.trace('shown', { reminderId: active.id, surface: 'primary' });
        }
        return shown;
      },
      emergency: async () => {
        this.trace('window-create', { reminderId: active.id, surface: 'emergency' });
        const shown = await this.showEmergency(active);
        if (shown) {
          this.surfaceState = 'emergency';
          this.trace('shown', { reminderId: active.id, surface: 'emergency' });
        }
        return shown;
      },
      notification: () => {
        // A native notification is visible but is not itself the complete /
        // snooze / skip controller. Remove focused dim masks before relying on
        // it, then let a click recreate the actionable emergency card.
        this.onFailOpen();
        const shown = this.showNotification(active);
        if (shown) {
          this.surfaceState = 'notification';
          this.trace('shown', { reminderId: active.id, surface: 'notification' });
        }
        return shown;
      },
      onError: (surface, error) => console.error(`[surface] ${surface} surface failed, falling back:`, error)
    });
    if (result === 'none' && sequence === this.presentationSequence) {
      // Every surface failed: tear down any dim masks so the user is never left
      // with a dimmed desktop and no actionable UI. This is the fail-open path.
      this.trace('surface-failed', { reminderId: active.id, surface: 'none' });
      this.onFailOpen();
    }
    return result;
  }

  /**
   * The primary renderer crashed (or its window was destroyed) while a reminder
   * was on screen. Swap in the emergency surface so the reminder does not
   * silently disappear.
   */
  handleRendererGone(active: ActiveReminder | null, webContentsId?: number): void {
    if (!active) {
      return;
    }
    this.currentReminderId = active.id;
    // A crash of any webcontents we neither own nor track is someone else's
    // concern. Note an undefined id (a generic render-process-gone) is never
    // "unrelated" — it is handled by the fallbacks below.
    const unrelatedId =
      webContentsId !== undefined &&
      webContentsId !== this.primaryWebContentsId &&
      webContentsId !== this.emergencyWebContentsId;
    if (unrelatedId) {
      return;
    }
    if (
      webContentsId !== undefined &&
      webContentsId === this.emergencyWebContentsId &&
      this.surfaceState === 'emergency'
    ) {
      // The emergency surface crashed: degrade to native notification so the
      // reminder is still user-visible.
      console.warn('[surface] emergency surface renderer gone; falling back to native notification');
      this.destroyEmergencyWindow();
      this.presentNotificationFallback(active, 'emergency-renderer-gone');
      return;
    }
    if (webContentsId === undefined && this.surfaceState === 'primary' && this.isPrimaryHealthy()) {
      this.trace('renderer-loss-ignored', { reminderId: active.id, reason: 'primary-healthy' });
      return;
    }
    if (this.emergencyWindow && !this.emergencyWindow.isDestroyed()) {
      return;
    }
    console.warn('[surface] renderer gone during active reminder; showing emergency surface');
    void this.presentEmergencyFallback(active);
  }

  /** Tear down any emergency surface (e.g. when the reminder ends). */
  destroy(): void {
    this.presentationSequence += 1;
    this.primaryWebContentsId = null;
    this.emergencyWebContentsId = null;
    this.currentReminderId = null;
    this.surfaceState = 'idle';
    this.destroyEmergencyWindow();
  }

  private destroyEmergencyWindow(): void {
    if (this.emergencyWindow && !this.emergencyWindow.isDestroyed()) {
      this.emergencyWindow.destroy();
    }
    this.emergencyWindow = null;
    this.emergencyWebContentsId = null;
  }

  // ── Emergency surface ────────────────────────────────────────────────────────

  private async presentEmergencyFallback(active: ActiveReminder): Promise<void> {
    try {
      if (await this.showEmergency(active)) {
        this.surfaceState = 'emergency';
        this.trace('shown', { reminderId: active.id, surface: 'emergency', reason: 'renderer-gone' });
        return;
      }
    } catch (error) {
      console.error('[surface] emergency surface failed after renderer loss:', error);
    }
    this.presentNotificationFallback(active, 'renderer-gone');
  }

  private async showEmergency(active: ActiveReminder): Promise<boolean> {
    if (!app.isReady()) {
      return false;
    }
    this.destroyEmergencyWindow();

    const title = emergencyTitleFor(active.kind);
    const window = new BrowserWindow({
      width: 360,
      height: 220,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: emergencyPreloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    window.setAlwaysOnTop(true, 'screen-saver');
    window.webContents.on('ipc-message', (event, channel, action: unknown) => {
      if (
        channel !== 'emergency-reminder:action' ||
        event.sender.id !== window.webContents.id ||
        (action !== 'complete' && action !== 'snooze' && action !== 'skip')
      ) {
        return;
      }
      this.onAction(action, active.id);
    });
    window.on('closed', () => {
      if (this.emergencyWindow === window) {
        this.emergencyWindow = null;
        this.emergencyWebContentsId = null;
      }
    });

    this.emergencyWindow = window;
    this.emergencyWebContentsId = window.webContents.id;
    try {
      await this.loadEmergencyHtml(window, title);
      if (window.isDestroyed() || this.emergencyWindow !== window) {
        return false;
      }
      window.show();
      window.flashFrame(true);
      // These listeners are attached only after the initial load succeeded;
      // initial load rejection is already handled by the fallback chain.
      window.webContents.once('unresponsive', () => {
        if (this.emergencyWindow === window && this.surfaceState === 'emergency') {
          this.handleRendererGone(active, window.webContents.id);
        }
      });
      window.webContents.once('did-fail-load', () => {
        if (this.emergencyWindow === window && this.surfaceState === 'emergency') {
          this.handleRendererGone(active, window.webContents.id);
        }
      });
      return window.isVisible();
    } catch (error) {
      console.error('[surface] emergency window failed to load:', error);
      if (!window.isDestroyed()) {
        window.destroy();
      }
      return false;
    }
  }

  /** Render the minimal emergency card from a self-contained template (no assets). */
  private async loadEmergencyHtml(
    window: BrowserWindow,
    title: string
  ): Promise<void> {
    const html = renderEmergencyHtml({ title });
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }

  // ── Native notification fallback ─────────────────────────────────────────────

  private showNotification(active: ActiveReminder): boolean {
    if (!Notification.isSupported()) {
      return false;
    }
    const title = active.kind === 'walk' ? 'EyeProtect · 起来走走' : 'EyeProtect · 休息眼睛';
    try {
      const notification = new Notification({
        title,
        body: '点击打开 EyeProtect 处理这枚提醒。',
        silent: true
      });
      notification.on('click', () => {
        if (this.currentReminderId === active.id && this.surfaceState === 'notification') {
          void this.recoverFromNotificationClick(active);
        }
      });
      notification.show();
      return true;
    } catch (error) {
      console.warn('[surface] notification failed:', error);
      return false;
    }
  }

  private presentNotificationFallback(active: ActiveReminder, reason: string): void {
    // Fail open before native/tray fallback: a dimmed desktop must never depend
    // on a surface that cannot execute reminder actions directly.
    this.onFailOpen();
    const shown = this.showNotification(active);
    this.surfaceState = shown ? 'notification' : 'idle';
    this.trace(shown ? 'shown' : 'surface-failed', {
      reminderId: active.id,
      surface: shown ? 'notification' : 'none',
      reason
    });
  }

  private async recoverFromNotificationClick(active: ActiveReminder): Promise<void> {
    try {
      if (await this.showEmergency(active)) {
        this.surfaceState = 'emergency';
        this.trace('shown', { reminderId: active.id, surface: 'emergency', reason: 'notification-click' });
        return;
      }
    } catch (error) {
      console.error('[surface] notification click could not restore emergency surface:', error);
    }
    this.onFailOpen();
    this.openWorkbench();
  }
}

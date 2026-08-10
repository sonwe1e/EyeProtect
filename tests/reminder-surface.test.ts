import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emergencyTitleFor, escapeHtml, renderEmergencyHtml } from '../src/main/scheduling/emergencyTemplate';
import { runReminderSurfaceFallback } from '../src/main/scheduling/surfaceFallback';

test('emergencyTitleFor maps reminder kinds to Chinese copy', () => {
  assert.equal(emergencyTitleFor('walk'), '该起来走走了');
  assert.equal(emergencyTitleFor('combined'), '该休息一下了');
  assert.equal(emergencyTitleFor('eye'), '该休息一下眼睛');
  assert.equal(emergencyTitleFor('unknown'), '该休息一下眼睛', 'defaults to eye copy');
});

test('escapeHtml neutralizes HTML metacharacters', () => {
  assert.equal(escapeHtml('<script>&"x"</script>'), '&lt;script&gt;&amp;&quot;x&quot;&lt;/script&gt;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
});

test('renderEmergencyHtml uses only the dedicated minimal action bridge', () => {
  const html = renderEmergencyHtml({ title: '该休息一下眼睛' });
  assert.ok(html.includes('EyeProtect · 该休息一下眼睛'), 'title rendered');
  assert.ok(html.includes('eyeProtectEmergency.action'), 'dedicated action bridge used');
  assert.ok(!html.includes('window.eyeProtect.'), 'generic renderer API is unavailable');
  assert.ok(!html.includes('reminderId'), 'the data page cannot choose a reminder id');
  assert.ok(html.includes('id="complete"'), 'complete button present');
  assert.ok(html.includes('id="snooze"'), 'snooze button present');
  assert.ok(html.includes('id="skip"'), 'skip button present');
});

test('renderEmergencyHtml is fully self-contained (no external resources)', () => {
  const html = renderEmergencyHtml({ title: 't' });
  assert.ok(!html.includes('<link'), 'no external stylesheets');
  assert.ok(!html.includes('<img'), 'no image assets');
  assert.ok(!html.includes('src='), 'no external src references');
  assert.ok(html.includes('<style>'), 'styles are inlined');
});

test('surface fallback reaches native notification after both windows fail', async () => {
  const attempts: string[] = [];
  const result = await runReminderSurfaceFallback({
    primary: () => { attempts.push('primary'); return false; },
    emergency: () => { attempts.push('emergency'); throw new Error('load failed'); },
    notification: () => { attempts.push('notification'); return true; }
  });
  assert.equal(result, 'notification');
  assert.deepEqual(attempts, ['primary', 'emergency', 'notification']);
});

test('surface fallback stops only when the presentation is externally invalidated', async () => {
  let current = true;
  const result = await runReminderSurfaceFallback({
    isCurrent: () => current,
    primary: () => { current = false; return false; },
    emergency: () => true,
    notification: () => true
  });
  assert.equal(result, 'none');
});

// ── ReminderSurfaceManager integration (fail-open + emergency tracking) ──────
// The manager imports 'electron', which cannot be resolved under plain Node, so
// we install a module-resolution hook that redirects 'electron' to a local stub
// before dynamically importing the manager. The stub is intentionally minimal
// and mirrors only the surface touches used by reminderSurface.ts.

const makeActive = () => ({
  id: 'r-1',
  kind: 'eye',
  kinds: ['eye'],
  startedAt: 0,
  scheduledAt: 0,
  unlockAt: 0,
  snoozeAllowedAt: 0,
  mode: 'focused',
  snoozeCount: 0,
  activityIds: ['eye-1'],
  breakTask: null
});

// Install the 'electron' → stub redirect, then return the live stub exports so a
// test can flip flags (app.isReady / Notification.isSupported) before exercising
// the manager.
async function boot() {
  const { register } = await import('node:module');
  register('./electron-loader.mjs', import.meta.url);
  const electronStub = await import('./electron-stub.mjs');
  const { ReminderSurfaceManager } = await import('../src/main/reminderSurface');
  return { ReminderSurfaceManager, electronStub };
}

// Private fields are ordinary properties at runtime (TS `private` is compile-time
// only); reach them via an untyped view to assert internal manager state.
const emergencyIdOf = (m: unknown): number | null => (m as { emergencyWebContentsId: number | null }).emergencyWebContentsId;
const stateOf = (m: unknown): string => (m as { surfaceState: string }).surfaceState;

test('present() returns "none" and fires onFailOpen when every surface fails', async () => {
  const { ReminderSurfaceManager, electronStub } = await boot();
  // Force the private emergency + notification surfaces to fail: Electron not
  // ready aborts showEmergency; notifications unsupported aborts showNotification.
  electronStub.app._isReady = false;
  electronStub.Notification._supported = false;

  let failOpenCalled = false;
  const manager = new ReminderSurfaceManager(
    () => Promise.resolve(false), // primary fails
    () => undefined,
    () => {},
    () => {},
    () => null,
    () => false,
    () => {
      failOpenCalled = true;
    }
  );

  const result = await manager.present(makeActive());
  assert.equal(result, 'none', 'all surfaces failed');
  assert.equal(failOpenCalled, true, 'onFailOpen invoked on total failure');
});

test('emergency webcontents id is tracked once the emergency surface shows', async () => {
  const { ReminderSurfaceManager, electronStub } = await boot();
  // Default stub state: app ready, BrowserWindow works → emergency shows.
  electronStub.app._isReady = true;

  const manager = new ReminderSurfaceManager(
    () => Promise.resolve(false), // primary fails → fall back to emergency
    () => undefined,
    () => {},
    () => {},
    () => null,
    () => false,
    () => {}
  );

  const result = await manager.present(makeActive());
  assert.equal(result, 'emergency', 'emergency surface presented');
  assert.ok(Boolean(emergencyIdOf(manager)), 'emergency webcontents id tracked after show');
});

test('handleRendererGone for the emergency id degrades to native notification', async () => {
  const { ReminderSurfaceManager, electronStub } = await boot();
  electronStub.app._isReady = true;
  electronStub.Notification._supported = true;
  electronStub.Notification._instances = [];

  const manager = new ReminderSurfaceManager(
    () => Promise.resolve(false), // primary fails → emergency
    () => undefined,
    () => {},
    () => {},
    () => null,
    () => false,
    () => {}
  );

  const result = await manager.present(makeActive());
  assert.equal(result, 'emergency');
  const emergencyId = emergencyIdOf(manager);
  assert.ok(emergencyId, 'have an emergency id to simulate losing');
  assert.equal(stateOf(manager), 'emergency');

  // Simulate the emergency renderer crashing: the manager must tear down the
  // emergency surface and fall back to a native notification.
  manager.handleRendererGone(makeActive(), emergencyId!);
  assert.equal(emergencyIdOf(manager), null, 'emergency id cleared after crash');
  assert.equal(electronStub.Notification._instances.length, 1, 'native notification fired as fallback');
});

test('emergency renderer loss fails open when native notification is unavailable', async () => {
  const { ReminderSurfaceManager, electronStub } = await boot();
  electronStub.app._isReady = true;
  electronStub.Notification._supported = false;
  let failOpenCount = 0;
  const manager = new ReminderSurfaceManager(
    () => Promise.resolve(false),
    () => undefined,
    () => {},
    () => {},
    () => null,
    () => false,
    () => { failOpenCount += 1; }
  );
  assert.equal(await manager.present(makeActive()), 'emergency');
  manager.handleRendererGone(makeActive(), emergencyIdOf(manager)!);
  assert.ok(failOpenCount >= 1, 'dim-mask teardown runs even when the final native fallback fails');
  assert.equal(stateOf(manager), 'idle');
});

test('native notification click recreates an actionable emergency surface', async () => {
  const { ReminderSurfaceManager, electronStub } = await boot();
  electronStub.app._isReady = false; // initial emergency creation fails
  electronStub.Notification._supported = true;
  electronStub.Notification._instances = [];
  let workbenchOpened = false;
  let failOpenCount = 0;
  const manager = new ReminderSurfaceManager(
    () => Promise.resolve(false),
    () => undefined,
    () => { workbenchOpened = true; },
    () => {},
    () => null,
    () => false,
    () => { failOpenCount += 1; }
  );
  assert.equal(await manager.present(makeActive()), 'notification');
  assert.equal(failOpenCount, 1, 'focused dim masks are removed before native-only fallback');

  electronStub.app._isReady = true;
  electronStub.Notification._instances[0].emit('click');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stateOf(manager), 'emergency');
  assert.ok(emergencyIdOf(manager), 'click restores complete/snooze/skip controls');
  assert.equal(workbenchOpened, false, 'workbench is only the last fallback when emergency recovery fails');
});

test('an unresponsive emergency renderer is tracked and degraded', async () => {
  const { ReminderSurfaceManager, electronStub } = await boot();
  electronStub.app._isReady = true;
  electronStub.Notification._supported = true;
  electronStub.Notification._instances = [];
  electronStub.BrowserWindow._instances = [];
  const manager = new ReminderSurfaceManager(
    () => Promise.resolve(false), () => undefined, () => {}, () => {}, () => null, () => false, () => {}
  );
  assert.equal(await manager.present(makeActive()), 'emergency');
  const emergency = electronStub.BrowserWindow._instances.at(-1);
  emergency.webContents.emit('unresponsive');
  assert.equal(electronStub.Notification._instances.length, 1);
  assert.equal(emergencyIdOf(manager), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
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

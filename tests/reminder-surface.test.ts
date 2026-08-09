import assert from 'node:assert/strict';
import test from 'node:test';
import { emergencyTitleFor, escapeHtml, renderEmergencyHtml } from '../src/main/scheduling/emergencyTemplate';

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

test('renderEmergencyHtml embeds the escaped title and a stringified reminder id', () => {
  const html = renderEmergencyHtml({ title: '该休息一下眼睛', reminderId: 'r-1' });
  assert.ok(html.includes('EyeProtect · 该休息一下眼睛'), 'title rendered');
  assert.ok(html.includes('var id = "r-1"', 'reminder id injected as a JS string literal (HTML-escaped)'));
  assert.ok(html.includes('id="complete"'), 'complete button present');
  assert.ok(html.includes('id="snooze"'), 'snooze button present');
  assert.ok(html.includes('id="skip"'), 'skip button present');
});

test('renderEmergencyHtml neutralizes a reminder id that tries to break out of the inline script', () => {
  const injection = '"><script>alert(1)' + '</script>';
  const html = renderEmergencyHtml({ title: 'x', reminderId: injection });
  // The id is JSON-stringified (quotes/backslashes escaped) AND every `<` is
  // escaped to <, so the injected literal can never contain a raw `</script>`
  // that closes the inline script tag early.
  const idLine = html.split('\n').find((line) => line.includes('var id ='));
  assert.ok(idLine, 'id line emitted');
  assert.ok(!idLine!.includes('</script>'), 'injected id contains no raw closing script tag');
  assert.ok(idLine!.includes('\\u003cscript>'), '`<` escaped inside the JS string literal');
});

test('renderEmergencyHtml is fully self-contained (no external resources)', () => {
  const html = renderEmergencyHtml({ title: 't', reminderId: '1' });
  assert.ok(!html.includes('<link'), 'no external stylesheets');
  assert.ok(!html.includes('<img'), 'no image assets');
  assert.ok(!html.includes('src='), 'no external src references');
  assert.ok(html.includes('<style>'), 'styles are inlined');
});

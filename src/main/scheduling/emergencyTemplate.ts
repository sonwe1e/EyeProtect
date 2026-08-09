/**
 * Pure helpers for the emergency reminder surface — kept free of any `electron`
 * import so they can be unit-tested under the Node runner and reused by the
 * ReminderSurfaceManager. The emergency card is intentionally minimal (inline
 * HTML, no React, no image assets) so it renders even when the primary
 * renderer is the thing that broke.
 */

export interface EmergencyTemplateInput {
  title: string;
  reminderId: string;
}

/** Escape a value for safe interpolation into HTML text/attributes. */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Stringify a value for safe embedding inside an inline `<script>` block.
 * `JSON.stringify` round-trips any string as a JS literal, but it leaves `<`
 * untouched — so a value containing `</script>` would close the script tag
 * prematurely and inject HTML. Escaping `<` to `<` keeps the literal
 * identical after evaluation while preventing any tag breakout.
 */
const stringifyForInlineScript = (value: string): string =>
  JSON.stringify(value).replace(/</g, '\\u003c');

/** Render the emergency card HTML. No external resources — fully self-contained. */
export const renderEmergencyHtml = (input: EmergencyTemplateInput): string => {
  const escapedTitle = escapeHtml(input.title);
  const reminderId = stringifyForInlineScript(input.reminderId);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI Variable", "Microsoft YaHei UI", system-ui, sans-serif;
    background: rgba(245, 248, 249, 0.96);
    border-radius: 16px;
    overflow: hidden;
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 22px 24px 18px;
    border: 1px solid rgba(40, 70, 80, 0.12);
  }
  h1 { margin: 0; font-size: 19px; font-weight: 600; color: #1f2a2e; }
  p { margin: 6px 0 0; font-size: 13px; color: #4a5a5e; }
  .actions { display: flex; gap: 10px; margin-top: 16px; }
  button {
    flex: 1;
    border: none;
    border-radius: 10px;
    padding: 11px 0;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    color: #fff;
    background: #2f8f6f;
    transition: filter 0.12s ease;
  }
  button:hover { filter: brightness(1.07); }
  button.secondary { background: #6b7a7e; }
  button.ghost { background: transparent; color: #2f8f6f; border: 1px solid #2f8f6f; }
  .hint { margin-top: 10px; font-size: 11px; color: #8a979a; text-align: center; }
</style></head>
<body>
  <div>
    <h1>EyeProtect · ${escapedTitle}</h1>
    <p>休息提醒未能以完整界面显示，已启用简化提醒。</p>
  </div>
  <div>
    <div class="actions">
      <button id="complete">完成</button>
      <button id="snooze" class="secondary">稍后</button>
      <button id="skip" class="ghost">跳过</button>
    </div>
    <div class="hint">完成 / 稍后 / 跳过均会恢复自动提醒节奏</div>
  </div>
<script>
  var id = ${reminderId};
  function act(action) {
    if (window.eyeProtect && window.eyeProtect.reminderAction) {
      window.eyeProtect.reminderAction(action, id);
    }
  }
  document.getElementById('complete').onclick = function () { act('complete'); };
  document.getElementById('snooze').onclick = function () { act('snooze'); };
  document.getElementById('skip').onclick = function () { act('skip'); };
</script>
</body></html>`;
};

/** Pick the emergency card title from the reminder kind. */
export const emergencyTitleFor = (kind: string): string =>
  kind === 'walk' ? '该起来走走了' : kind === 'combined' ? '该休息一下了' : '该休息一下眼睛';

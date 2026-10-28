/**
 * Pure helpers for the emergency reminder surface — kept free of any `electron`
 * import so they can be unit-tested under the Node runner and reused by the
 * ReminderSurfaceManager. The emergency card is intentionally minimal (inline
 * HTML, no React, no image assets) so it renders even when the primary
 * renderer is the thing that broke.
 */

export interface EmergencyTemplateInput {
  title: string;
  readingScale?: number;
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
/** Render the emergency card HTML. No external resources — fully self-contained. */
export const renderEmergencyHtml = (input: EmergencyTemplateInput): string => {
  const escapedTitle = escapeHtml(input.title);
  const readingScale = Number.isFinite(input.readingScale) ? Math.min(1.5, Math.max(0.9, input.readingScale!)) : 1;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/>
<style>
  :root { color-scheme: light; --reading-scale: ${readingScale}; }
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
    padding: clamp(24px, 6vw, 72px);
    border: 1px solid rgba(40, 70, 80, 0.12);
  }
  h1 { margin: 0; font-size: calc(clamp(28px, 4.5vw, 60px) * var(--reading-scale)); font-weight: 600; color: #1f2a2e; }
  p { margin: 20px 0 0; font-size: calc(clamp(18px, 2.5vw, 28px) * var(--reading-scale)); line-height: 1.65; color: #4a5a5e; }
  .actions { display: flex; gap: 10px; margin-top: 16px; }
  button {
    flex: 1;
    border: none;
    border-radius: 10px;
    padding: 11px 0;
    font-size: 20px;
    font-weight: 600;
    cursor: pointer;
    color: #fff;
    background: #2f8f6f;
    transition: filter 0.12s ease;
  }
  button:hover { filter: brightness(1.07); }
  button.secondary { background: #6b7a7e; }
  button.ghost { background: transparent; color: #2f8f6f; border: 1px solid #2f8f6f; }
  .hint { margin-top: 18px; font-size: 16px; color: #4a5a5e; text-align: center; }
  @media (max-width: 720px), (max-height: 560px) {
    body { padding: 24px; }
    h1 { font-size: calc(28px * var(--reading-scale)); }
    p { font-size: min(24px, calc(18px * var(--reading-scale))); line-height: 1.5; }
  }
</style></head>
<body>
  <div>
    <h1>EyeProtect · ${escapedTitle}</h1>
    <p>现在可以把视线移开屏幕，放松片刻。休息已自动开始，到时会自动收起。</p>
  </div>
  <div>
    <div class="actions">
      <button id="start">开始休息</button>
      <button id="complete">完成</button>
      <button id="snooze" class="secondary">稍后</button>
      <button id="skip" class="ghost">跳过</button>
    </div>
    <div class="hint">无需点击开始或完成；有事可以稍后再休息。</div>
  </div>
<script>
  function act(action) {
    if (window.eyeProtectEmergency && window.eyeProtectEmergency.action) {
      window.eyeProtectEmergency.action(action);
    }
  }
  var state = { started: false, unlockAt: 0 };
  function paint() {
    document.getElementById('start').hidden = state.started;
    document.getElementById('complete').hidden = !state.started;
    var remaining = Math.max(0, Math.ceil((state.unlockAt - Date.now()) / 1000));
    document.getElementById('complete').disabled = remaining > 0;
    document.getElementById('complete').textContent = remaining > 0 ? remaining + ' 秒' : '完成';
  }
  if (window.eyeProtectEmergency && window.eyeProtectEmergency.onState) window.eyeProtectEmergency.onState(function(next) { state = next; paint(); });
  setInterval(paint, 500); paint();
  document.getElementById('start').onclick = function () { act('start'); };
  document.getElementById('complete').onclick = function () { act('complete'); };
  document.getElementById('snooze').onclick = function () { act('snooze'); };
  document.getElementById('skip').onclick = function () { act('skip'); };
</script>
</body></html>`;
};

/** Pick the emergency card title from the reminder kind. */
export const emergencyTitleFor = (kind: string): string =>
  kind === 'walk' ? '该起来走走了' : kind === 'combined' ? '该休息一下了' : '该休息一下眼睛';

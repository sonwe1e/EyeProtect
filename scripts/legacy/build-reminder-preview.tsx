/**
 * Builds a self-contained static preview of the reminder surfaces.
 *
 * Why this exists: the CDP capture scripts (capture-ui-snapshots.mjs,
 * smoke-reminder-experience.mjs) still assert pre-refactor selectors such as
 * `.alert-panel` / `.alert-actions` / `.procedural-character`, and a headless
 * CI runner has no usable GPU process, so there is currently no way to get a
 * real screenshot of the alert/bubble windows. This renders the same markup
 * against the REAL stylesheets (tokens.css / theme.css / base.css / styles.css)
 * and the REAL PixelAnimal component, so a design review needs no Electron.
 *
 * The markup here is a hand-mirrored copy of AlertView.tsx and
 * ReminderBubble.tsx. If you change those components, change this file too —
 * it is a mirror, not a source of truth.
 *
 * Usage: npx tsx scripts/build-reminder-preview.tsx [output.html]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PixelAnimal } from '../src/renderer/src/features/characters/PixelAnimal';

const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] ?? 'artifacts/reminder-glass-preview.html');
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8');

const ALERT_RING_RADIUS = 52;
const ALERT_RING_CIRCUMFERENCE = 2 * Math.PI * ALERT_RING_RADIUS;
const BUBBLE_RING_RADIUS = 32;
const BUBBLE_RING_CIRCUMFERENCE = 2 * Math.PI * BUBBLE_RING_RADIUS;

/**
 * theme.css keys every token off `:root[data-theme=...]`, which cannot be
 * nested. Rewrite those selectors to container classes so one page can show
 * both themes while still reading the values from the real file.
 */
const scopeTheme = (css: string): string => {
  const scoped = css
    .replace(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n  \}\n\}/, '')
    .replace(/:root,\s*:root\[data-theme='light'\]\s*\{/, '.preview-light {')
    .replace(/:root\[data-theme='dark'\]\s*\{/, '.preview-dark {')
    .replace(/(^|\n):root\s*\{/g, '$1.preview-light, .preview-dark {');
  if (/:root/.test(scoped)) {
    throw new Error('theme.css scoping left a :root selector behind; update scopeTheme()');
  }
  return scoped;
};

const pet = (animal: 'cat' | 'dog' | 'rabbit', action: string, label: string): string =>
  renderToStaticMarkup(createElement(PixelAnimal, { animal, action, label }));

const alertRing = (progress: number): string => {
  const offset = (ALERT_RING_CIRCUMFERENCE * (1 - progress)).toFixed(1);
  return `<svg class="rest-ring" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle class="rest-ring-track" cx="60" cy="60" r="${ALERT_RING_RADIUS}" />
        <circle class="rest-ring-value" cx="60" cy="60" r="${ALERT_RING_RADIUS}"
          stroke-dasharray="${ALERT_RING_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${offset}" />
      </svg>`;
};

interface AlertState {
  kind: 'eye' | 'walk' | 'combined';
  badge: string;
  title: string;
  lede: string;
  clock: string;
  caption: string;
  animal: 'cat' | 'dog' | 'rabbit';
  action: string;
  progress: number;
  /** null hides the step block (the 'ready' phase). */
  steps: { title: string; items: string[]; index: number; progress: number; next?: string } | null;
  breakTask?: string;
  note: string;
  primary: string;
  primaryDisabled: boolean;
  hint: string;
  /** Mirrors the .has-steps modifier that shrinks the stage once steps show. */
  hasSteps: boolean;
}

const stepList = (steps: { items: string[]; index: number }): string =>
  `<ol class="rest-steps">${steps.items.map((text, i) => {
    const state = i < steps.index ? 'is-done' : i === steps.index ? 'is-active' : '';
    const mark = i < steps.index ? '✓' : String(i + 1);
    return `<li class="rest-step ${state}"><b aria-hidden="true">${mark}</b><span>${text}</span></li>`;
  }).join('')}</ol>`;

const renderAlert = (state: AlertState): string => `<main class="alert-shell simple-rest kind-${state.kind}">
    <section class="rest-card${state.hasSteps ? ' has-steps' : ''}">
      <div class="rest-ambient" aria-hidden="true"><span class="rest-orb is-1"></span><span class="rest-orb is-2"></span></div>
      <div class="rest-stage">
        <span class="rest-stage-glow" aria-hidden="true"></span>
        ${alertRing(state.progress)}
        <div class="rest-stage-art">${pet(state.animal, state.action, `${state.badge} · 像素动物`)}</div>
        <p class="rest-stage-count" role="timer"><strong>${state.clock}</strong><small>${state.caption}</small></p>
      </div>
      <div class="rest-scroll">
        <span class="rest-badge">${state.badge}</span>
        <h1 class="rest-title">${state.title}</h1>
        <p class="rest-lede">${state.lede}</p>
        ${state.steps ? `<section class="rest-activity">
          <p class="rest-activity-head"><strong>${state.steps.title}</strong><span>第 ${state.steps.index + 1}/${state.steps.items.length} 步</span></p>
          ${stepList(state.steps)}
          <div class="rest-progress" aria-hidden="true"><i style="width:${Math.round(state.steps.progress * 100)}%"></i></div>
          ${state.steps.next ? `<p class="rest-next">接下来：${state.steps.next}</p>` : ''}
        </section>` : ''}
        ${state.breakTask ? `<p class="rest-break-task">顺便处理：${state.breakTask}</p>` : ''}
        <p class="rest-note">${state.note}</p>
      </div>
      <div class="rest-actions">
        <button class="rest-primary"${state.primaryDisabled ? ' disabled' : ''}>${state.primary}</button>
        <div class="rest-actions-row">
          <div class="rest-snooze-group"><button>稍后提醒</button><select aria-label="稍后分钟数"><option>5 分钟</option></select></div>
          <button class="rest-skip">跳过</button>
        </div>
        <p class="rest-hint">${state.hint}</p>
      </div>
    </section>
  </main>`;

const bubbleRing = (progress: number): string => {
  const offset = (BUBBLE_RING_CIRCUMFERENCE * (1 - progress)).toFixed(1);
  return `<p class="bubble-ring" role="timer">
          <svg viewBox="0 0 76 76" aria-hidden="true" focusable="false">
            <circle class="bubble-ring-track" cx="38" cy="38" r="${BUBBLE_RING_RADIUS}" />
            <circle class="bubble-ring-value" cx="38" cy="38" r="${BUBBLE_RING_RADIUS}"
              stroke-dasharray="${BUBBLE_RING_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${offset}" />
          </svg>
          <span>00:13</span>
        </p>`;
};

const renderGentleBubble = (kind: 'eye' | 'walk' | 'combined', badge: string, title: string, step: string, stepLabel: string, progress: number, clock: string): string =>
  `<div class="bubble-shell bubble-reminder kind-${kind}">
    <div class="bubble-card">
      <div class="bubble-head"><span class="bubble-kind">${badge}</span>
        <button class="bubble-close" aria-label="跳过这次提醒">✕</button>
      </div>
      <div class="bubble-main">
        ${bubbleRing(progress).replace('00:13', clock)}
        <div class="bubble-copy"><h2>${title}</h2><p>还有 13 秒</p></div>
      </div>
      <p class="bubble-step"><strong>${step}</strong>${stepLabel}</p>
      <div class="bubble-actions">
        <button class="primary" disabled>完成休息</button>
        <div class="bubble-actions-row"><button>稍后</button><button>跳过</button></div>
      </div>
    </div>
    <span class="bubble-tail"></span>
  </div>`;

const renderPreAlertBubble = (kind: 'eye' | 'walk', badge: string, title: string): string =>
  `<div class="bubble-shell bubble-prealert kind-${kind}">
    <div class="bubble-card">
      <div class="bubble-head"><span class="bubble-kind">${badge}</span></div>
      <div class="bubble-copy"><h2>${title}</h2><p>还有 1 分钟。现在开始，还是稍后？</p></div>
      <div class="bubble-actions">
        <button class="primary">现在开始</button>
        <div class="bubble-actions-row"><button>稍后 2 分钟</button><button>保持计划</button></div>
      </div>
    </div>
    <span class="bubble-tail"></span>
  </div>`;

const ALERTS: { label: string; state: AlertState }[] = [
  {
    label: '护眼 · 待开始',
    state: {
      kind: 'eye', badge: '护眼提醒', title: '让眼睛休息一下',
      lede: '准备好后，点击开始休息。', clock: '00:20', caption: '计划休息',
      animal: 'cat', action: 'idle', progress: 0, steps: null,
      note: '触发于 13:42', primary: '开始休息', primaryDisabled: false,
      hint: '本次休息 20 秒', hasSteps: false
    }
  },
  {
    label: '护眼 · 休息中',
    state: {
      kind: 'eye', badge: '护眼提醒', title: '让眼睛休息一下',
      lede: '还有 13 秒，跟着节奏放松', clock: '00:13', caption: '剩余',
      animal: 'cat', action: 'eye', progress: 0.35,
      steps: { title: '看向远处，缓慢眨眼', items: ['找一个 5 米外的目标', '放松地盯着它', '缓慢地眨眼 10 次'], index: 1, progress: 0.42 },
      note: '已稍后 1 次', primary: '完成休息', primaryDisabled: true,
      hint: '还剩 13 秒 · 提前完成不会被记录', hasSteps: true
    }
  },
  {
    label: '走动 · 休息中',
    state: {
      kind: 'walk', badge: '走动提醒', title: '起来走动一下',
      lede: '还有 26 秒，跟着节奏放松', clock: '00:26', caption: '剩余',
      animal: 'dog', action: 'walk', progress: 0.35,
      steps: { title: '去接一杯水', items: ['站起来走向饮水机', '接一杯温水', '慢慢喝完再回来'], index: 0, progress: 0.14 },
      breakTask: '去打印室打印材料', note: '触发于 13:42', primary: '完成休息', primaryDisabled: true,
      hint: '还剩 26 秒 · 提前完成不会被记录', hasSteps: true
    }
  },
  {
    label: '综合 · 休息中（两个活动合并）',
    state: {
      kind: 'combined', badge: '综合休息', title: '离开屏幕，起来走动一下',
      lede: '还有 41 秒，跟着节奏放松', clock: '00:41', caption: '剩余',
      animal: 'rabbit', action: 'combined', progress: 0.32,
      steps: {
        title: '看向远处，缓慢眨眼', items: ['找一个 5 米外的目标', '放松地盯着它', '缓慢地眨眼 10 次'],
        index: 2, progress: 0.88, next: '去接一杯水'
      },
      note: '触发于 13:42', primary: '完成休息', primaryDisabled: true,
      hint: '还剩 41 秒 · 提前完成不会被记录', hasSteps: true
    }
  },
  {
    label: '已到时间',
    state: {
      kind: 'eye', badge: '护眼提醒', title: '让眼睛休息一下',
      lede: '这次休息时间已到', clock: '00:00', caption: '已到时间',
      animal: 'cat', action: 'eye', progress: 1,
      steps: { title: '看向远处，缓慢眨眼', items: ['找一个 5 米外的目标', '放松地盯着它', '缓慢地眨眼 10 次'], index: 2, progress: 1 },
      note: '触发于 13:42', primary: '完成休息', primaryDisabled: false,
      hint: '已到时间，可以完成本次休息。', hasSteps: true
    }
  }
];

const section = (theme: 'light' | 'dark'): string => `<section class="preview-${theme}">
  <h2 class="preview-h2">${theme === 'light' ? '浅色主题' : '深色主题'}</h2>
  <h3 class="preview-h3">独立提醒窗 · 760 × 720</h3>
  <div class="preview-grid">
    ${ALERTS.map(({ label, state }) => `<figure class="preview-figure">
      <div class="preview-frame preview-frame--alert"><div class="preview-scale-52">${renderAlert(state)}</div></div>
      <figcaption>${label}</figcaption>
    </figure>`).join('')}
  </div>
  <h3 class="preview-h3">桌宠旁的气泡（gentle 模式）</h3>
  <div class="preview-grid preview-grid--bubbles">
    <figure class="preview-figure">
      <div class="preview-frame preview-frame--bubble">${renderGentleBubble('eye', '护眼提醒', '让眼睛休息一下', '放松地盯着它', '第 2/3 步', 0.35, '00:13')}</div>
      <figcaption>gentle 提醒 · 休息中</figcaption>
    </figure>
    <figure class="preview-figure">
      <div class="preview-frame preview-frame--bubble">${renderPreAlertBubble('walk', '走动提醒', '起来走动一下')}</div>
      <figcaption>预提醒</figcaption>
    </figure>
  </div>
</section>`;

const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>EyeProtect 提醒界面预览 · 玻璃拟态</title>
<style>
${read('src/renderer/src/styles/tokens.css')}
${scopeTheme(read('src/renderer/src/styles/theme.css'))}
${read('src/renderer/src/styles/base.css')}
${read('src/renderer/src/styles.css')}

/* ── Preview chrome only. Everything above is the product stylesheet. ───── */
html body.preview-page {
  margin: 0;
  padding: 0;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: #eef0f2;
  color: #1b2024;
  font-family: "Microsoft YaHei UI", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.preview-head { padding: 30px 34px 6px; }
.preview-head h1 { margin: 0 0 6px; font-size: 20px; }
.preview-head p { margin: 0; max-width: 900px; font-size: 13px; line-height: 1.7; color: #5b666e; }
.preview-head code { padding: 1px 5px; background: #fff; border: 1px solid #d8dee3; border-radius: 4px; font-size: 12px; }
.preview-note { margin-top: 10px; padding: 10px 13px; max-width: 900px; font-size: 12.5px; line-height: 1.65; color: #7a5a12; background: #fdf6e3; border: 1px solid #eadfc0; border-radius: 8px; }
.preview-light, .preview-dark { padding: 22px 34px 40px; }
.preview-dark { background: #0e1214; color: #eef4f7; }
.preview-h2 { margin: 0 0 14px; font-size: 15px; letter-spacing: .08em; text-transform: uppercase; opacity: .6; }
.preview-h3 { margin: 22px 0 12px; font-size: 13px; font-weight: 700; opacity: .8; }
.preview-grid { display: flex; flex-wrap: wrap; gap: 22px; align-items: flex-start; }
.preview-figure { margin: 0; }
.preview-figure figcaption { margin-top: 8px; font-size: 12px; opacity: .7; }
.preview-frame { position: relative; overflow: hidden; }
.preview-frame--alert { width: 396px; height: 375px; }
.preview-scale-52 { width: 760px; height: 720px; transform: scale(.52); transform-origin: top left; }
.preview-frame--bubble { width: 300px; height: 224px; background:
  repeating-conic-gradient(#d9dee3 0% 25%, #e8ebee 0% 50%) 50% / 16px 16px; border-radius: 8px; }
</style>
</head>
<body class="preview-page">
  <div class="preview-head">
    <h1>EyeProtect 提醒界面预览 · 玻璃拟态</h1>
    <p>这份页面直接内联了产品真实的样式表（<code>tokens.css</code> / <code>theme.css</code> / <code>base.css</code> / <code>styles.css</code>），像素动物也是真实的 <code>PixelAnimal</code> 组件渲染出来的。玻璃卡的底色来自 <code>--glass-panel</code>（94% 不透明），"玻璃感"由模糊、顶部高光与卡内色晕共同构成——不是靠透出壁纸，否则文字对比度会随用户壁纸变化。</p>
    <p class="preview-note">标记结构是 <code>AlertView.tsx</code> 与 <code>ReminderBubble.tsx</code> 的手工镜像（这两个组件依赖 <code>window.eyeProtect</code>，无法服务端渲染）。改动组件时请同步改动生成脚本。重新生成：<code>npx tsx scripts/build-reminder-preview.tsx</code></p>
  </div>
  ${section('light')}
  ${section('dark')}
</body>
</html>
`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, page);
console.log(`Reminder preview written to ${output}`);

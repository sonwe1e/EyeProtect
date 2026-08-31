# Quiet Editorial UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply one restrained, eye-friendly visual system to every EyeProtect renderer surface without changing data, IPC, scheduling, or window behavior.

**Architecture:** Keep the existing renderer ownership model. `theme.css` remains the only semantic color authority, `tokens.css` remains the foundation-token authority, shared controls stay in `primitives.css`, Workbench chrome stays in `workbench.css`, and surface-specific behavior remains in the existing module/legacy stylesheets. The implementation is a CSS-first visual cutover with no new dependency and no business-logic changes.

**Tech Stack:** Electron 43, electron-vite, React 18, strict TypeScript, Lucide React, native CSS custom properties, CSS modules, Node test runner.

## Global Constraints

- Continue using the existing semantic token names; do not add color tokens to `tokens.css`.
- Keep `theme.css` as the only owner of semantic color values; component styles must not add `#hex`, `rgb()`, or `rgba()` values.
- Preserve the tested Workbench dimensions: sidebar `208px`, toolbar `52px`, default row `52px`, compact row `44px`, medium radius `8px`, large radius `12px`.
- Preserve `44px` navigation/control hit targets and all existing drag, focus, forced-colors, reduced-motion, and narrow-workspace behavior.
- Renderer components must continue to mutate through `commands`/`useCommand`; no IPC, data-model, hook, or window-lifecycle edits are part of this plan.
- Do not introduce Tailwind, Motion, Framer Motion, a component library, or a new runtime animation dependency.
- Run formatters, linters, and project-wide tests only at the final verification checkpoint; intermediate checks are limited to the affected UI contract or typecheck command.

## File Map

- Modify `src/renderer/src/styles/theme.css`: define the warm-paper / ink / sage semantic palette, shadows, overlay, and glass values for light, dark, and system themes.
- Modify `src/renderer/src/styles/primitives.css`: unify buttons, inputs, chips, command palette, dialogs, side sheets, toasts, and their state transitions.
- Modify `src/renderer/src/styles/workbench.css`: refine the Workbench rail, toolbar, page channel, Today/Inbox/task/project/planning shared surfaces while preserving layout contracts.
- Modify `src/renderer/src/features/tasks/PlanWorkspace.module.css`: refine day switch, backlog, timeline blocks, health markers, and drop states.
- Modify `src/renderer/src/features/tasks/ProjectWorkspace.module.css`: refine project header, view switch, board columns/cards, and lifecycle states.
- Modify `src/renderer/src/features/tasks/TaskDetail.module.css`: align the task side-sheet body with the shared field/card grammar.
- Modify `src/renderer/src/features/tasks/FocusSurface.module.css`: make empty, active, break, and immersive focus states calm and legible.
- Modify `src/renderer/src/features/review/DailyReview.module.css`: create a consistent metric/detail/checkpoint rhythm.
- Modify `src/renderer/src/styles/settings.css`: style embedded settings groups and controls using shared semantic layers.
- Modify `src/renderer/src/styles/collection.css`: style the featured visitor, collection cards, and empty states.
- Modify `src/renderer/src/styles.css`: adapt Pet, Alert, Bubble, standalone reminders, and legacy floating surfaces to the same visual grammar without changing transparent-window behavior.
- Modify `docs/color-system.md`: document the final semantic palette and surface/motion rules after implementation.
- Do not modify `src/shared/types.ts`, `src/main/`, `src/preload/`, renderer hooks, commands, or component behavior.

---

### Task 1: Establish the semantic palette

**Files:**
- Modify: `src/renderer/src/styles/theme.css:1-141`
- Modify: `docs/color-system.md:1-70`
- Test: `tests/design-system-contract.test.ts`, `scripts/verify-ui-contract.mjs`

**Interfaces:**
- Consumes: existing semantic token names referenced by every renderer stylesheet.
- Produces: one light/dark/system palette with unchanged token ownership and contrast-check inputs.

- [ ] **Step 1: Replace only theme semantic values**

Keep the existing selectors and token names. Use this exact palette direction in the light and dark blocks:

```css
:root,
:root[data-theme='light'] {
  color-scheme: light;
  --bg-app: #f5f6f4;
  --bg-sidebar: #ecefeb;
  --surface: #ffffff;
  --surface-raised: #fbfcfa;
  --surface-hover: #eef2ef;
  --surface-active: #e5ece8;
  --surface-selected: #e5ece8;
  --border-subtle: #dde4df;
  --border-strong: #c5d0c8;
  --fg-primary: #18201d;
  --fg-secondary: #505d56;
  --fg-tertiary: #65736c;
  --fg-disabled: #89958f;
  --fg-inverse: #ffffff;
  --brand: #2e6b5a;
  --brand-strong: #245647;
  --brand-contrast: #ffffff;
  --brand-subtle: #e6f0eb;
  --danger: #a0433b;
  --danger-strong: #86372f;
  --danger-contrast: #ffffff;
  --danger-subtle: #f8e8e5;
  --warning: #805b16;
  --warning-contrast: #18201d;
  --warning-subtle: #f5edda;
  --success: #347054;
  --success-subtle: #e5f1e9;
  --focus-ring: #2e6b5a;
  --overlay: rgb(23 30 27 / 44%);
  --shadow-overlay: 0 24px 64px rgb(20 31 25 / 16%);
  --shadow-soft: 0 8px 24px rgb(20 31 25 / 7%);
  --glass-surface: rgb(255 255 255 / 90%);
  --glass-surface-strong: rgb(255 255 255 / 98%);
  --glass-border: rgb(24 32 29 / 16%);
}
```

Use the corresponding dark values below while keeping `color-scheme: dark` and the existing system-preference selector:

```css
:root[data-theme='dark'] {
  --bg-app: #111614;
  --bg-sidebar: #0b100e;
  --surface: #171e1b;
  --surface-raised: #1d2722;
  --surface-hover: #222d27;
  --surface-active: #29372f;
  --surface-selected: #29372f;
  --border-subtle: #29352f;
  --border-strong: #3a4840;
  --fg-primary: #eef5f1;
  --fg-secondary: #b6c2bb;
  --fg-tertiary: #8d9b93;
  --fg-disabled: #707d75;
  --fg-inverse: #ffffff;
  --brand: #82c5af;
  --brand-strong: #a2d8c4;
  --brand-contrast: #10201b;
  --brand-subtle: #1a342c;
  --danger: #ef9a90;
  --danger-strong: #f4b0a8;
  --danger-contrast: #24100f;
  --danger-subtle: #3a2523;
  --warning: #e4b869;
  --warning-contrast: #201804;
  --warning-subtle: #382f20;
  --success: #84c99c;
  --success-subtle: #1e3528;
  --focus-ring: #82c5af;
  --overlay: rgb(0 0 0 / 64%);
  --shadow-overlay: 0 24px 64px rgb(0 0 0 / 44%);
  --shadow-soft: 0 8px 24px rgb(0 0 0 / 26%);
  --glass-surface: rgb(23 30 27 / 92%);
  --glass-surface-strong: rgb(23 30 27 / 98%);
  --glass-border: rgb(238 245 241 / 16%);
}
```

Copy the same semantic declarations into the existing `@media (prefers-color-scheme: dark)` system block; do not add a second owner or new custom properties.

- [ ] **Step 2: Update the design-system documentation**

In `docs/color-system.md`, replace the old core color table with the values above, state that ordinary surfaces use `border-subtle` without shadow, and document the three allowed motion cases: floating-layer entry/exit, command feedback, and selection/drag feedback. Keep the existing contrast and scroll-contract sections.

- [ ] **Step 3: Run the affected contract**

Run: `npm run verify:ui-contract`

Expected: `UI contract verified: semantic colors, navigation, hit targets, accessibility modes, and contrast.`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles/theme.css docs/color-system.md
git commit -m "Refresh EyeProtect semantic color system"
```

### Task 2: Refine shared primitives and feedback

**Files:**
- Modify: `src/renderer/src/styles/primitives.css:1-252`
- Test: `npm run verify:ui-contract`

**Interfaces:**
- Consumes: the semantic palette from Task 1 and existing component class names.
- Produces: consistent button/input/chip/overlay states consumed by every surface without JSX changes.

- [ ] **Step 1: Keep contract-critical dimensions and replace primitive state rules**

Preserve `.ui-button` `min-height: 40px`, `.ui-icon-button` `36px × 36px`, and all existing class names. Apply this state grammar:

```css
.ui-button,
.ui-icon-button {
  border: 1px solid transparent;
  border-radius: var(--radius-medium);
  transition: background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast);
}

.ui-button--primary {
  color: var(--brand-contrast);
  background: var(--brand);
  border-color: var(--brand);
  box-shadow: 0 1px 1px color-mix(in srgb, var(--brand-strong) 22%, transparent);
}

.ui-button--primary:hover { background: var(--brand-strong); }
.ui-button--secondary { background: var(--surface); border-color: var(--border-strong); }
.ui-button--secondary:hover,
.ui-button--ghost:hover,
.ui-icon-button:hover { background: var(--surface-hover); border-color: var(--border-subtle); }
.ui-button--danger { color: var(--danger); background: var(--danger-subtle); border-color: transparent; }
.ui-button:active,
.ui-icon-button:active { transform: translateY(1px); }
```

Keep the existing reduced-motion and forced-colors blocks, and extend them so `transform` is disabled under reduced motion and every floating surface retains a visible border under forced colors.

- [ ] **Step 2: Normalize fields, chips, and overlays**

Keep the existing `.ui-input`, `.ui-select`, `.ui-status-chip`, `.ui-dialog`, `.ui-side-sheet`, `.ui-toast`, and command-palette selectors. Use semantic surfaces, `var(--radius-medium)` for controls, `var(--radius-large)` for dialog, and `var(--shadow-overlay)` only for dialog/sheet/toast. Add `transition: border-color var(--motion-fast), box-shadow var(--motion-fast), background var(--motion-fast)` to fields and preserve the current focus-ring declaration.

- [ ] **Step 3: Add restrained state feedback**

Keep the current spinner animation, but ensure `.command-button.is-success` uses `var(--brand)` and `.command-button.is-error` uses `var(--danger)` with a border. Do not add a continuous animation to rows or cards. Keep command palette active rows readable in both themes.

- [ ] **Step 4: Run the affected contract**

Run: `npm run verify:ui-contract`

Expected: PASS with no raw-color, hit-target, reduced-motion, or forced-colors failures.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/styles/primitives.css
git commit -m "Polish shared UI primitives"
```

### Task 3: Rebalance Workbench chrome and task surfaces

**Files:**
- Modify: `src/renderer/src/styles/workbench.css:1-586`
- Modify: `src/renderer/src/styles/tokens.css:1-63` only when a value is not contract-locked
- Test: `npm run verify:ui-contract`

**Interfaces:**
- Consumes: existing Workbench class names from `WorkbenchSidebar`, `WorkbenchToolbar`, `WorkbenchView`, `TaskList`, `TaskComposer`, and `ProjectList`.
- Produces: a quiet rail, command-bar toolbar, editorial page headers, and calmer task/project surfaces while preserving `208px`, `52px`, `52px/44px` and container-query contracts.

- [ ] **Step 1: Refine the rail and toolbar without changing markup**

Keep `.workbench-v2`, `.app-sidebar`, `.app-brand`, `.app-nav-item`, `.app-workspace`, `.workspace-toolbar`, `.command-palette-trigger`, and `.workspace-search` selectors. Use `background: var(--bg-sidebar)` for the rail, a subtle inset border for the brand mark, and a toolbar background that resolves to `var(--bg-app)` with only `border-bottom: 1px solid var(--border-subtle)`. Preserve `.app-nav-item` `min-height: 44px`, neutral selected background, and brand-colored active icon. Give the command trigger a slightly raised surface and visible keyboard key without adding another shadow layer.

- [ ] **Step 2: Make page headers and the Today state bar the visual anchors**

Keep `.workspace-page`, `.page-header`, `.page-eyebrow`, `.page-description`, `.now-card`, `.today-header-actions`, and `.rhythm-summary`. Keep the current page width and responsive container query. Use a more generous `padding-top` only if the `--workbench-page-top: 32px` contract remains unchanged; otherwise add visual spacing inside `.page-header`. Style `.now-card` with `var(--surface-raised)`, a left accent border using `var(--brand)`, and no large shadow.

- [ ] **Step 3: Improve the quick-add and task row hierarchy**

Keep task row height and all task interaction selectors. Use `var(--surface)` for the composer shell, `var(--surface-hover)` for expanded fields, a visible focus-within border, and a slightly stronger row hover. Keep the row default transparent, selected background `var(--surface-selected)`, completion opacity, drag feedback, priority dot semantics, and hidden-on-idle action controls. Make `.task-meta` and `.task-due` legible without making all metadata brand colored.

- [ ] **Step 4: Refine overview cards and planning sections**

Keep project overview card structure and planning selectors. Give cards a thin border and a small hover border shift only; retain no transform on task rows. Use consistent `var(--radius-large)` for overview/planning shells, `var(--radius-medium)` for inner rows, and semantic progress/status colors. Leave all plan layout and container queries untouched.

- [ ] **Step 5: Run the affected contract**

Run: `npm run verify:ui-contract`

Expected: PASS, including neutral selection, active brand icon, navigation hitbox, task-row size, workspace container, and no raw colors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/styles/workbench.css src/renderer/src/styles/tokens.css
git commit -m "Refine Workbench editorial surfaces"
```

### Task 4: Polish Plan, Projects, Focus, Review, and Task Detail

**Files:**
- Modify: `src/renderer/src/features/tasks/PlanWorkspace.module.css:1-115`
- Modify: `src/renderer/src/features/tasks/ProjectWorkspace.module.css:1-52`
- Modify: `src/renderer/src/features/tasks/TaskDetail.module.css`
- Modify: `src/renderer/src/features/tasks/FocusSurface.module.css:1-24`
- Modify: `src/renderer/src/features/review/DailyReview.module.css:1-84`
- Test: `npm run verify:ui-contract`

**Interfaces:**
- Consumes: existing module selectors and global class names emitted by PlanWorkspace, ProjectWorkspace, TaskDetail, FocusSurface, and DailyReview.
- Produces: one surface grammar across schedules, boards, focus, detail sheets, and review metrics.

- [ ] **Step 1: Style Plan as a two-column work surface**

Keep the exact plan grid declaration `grid-template-columns: minmax(210px, 0.65fr) minmax(430px, 1.35fr)` and `@container workspace (max-width: 600px)`. Add only visual changes: a slightly raised `plan-column`, a quiet day-switch active state, a stronger but semantic timeline block border, and a clear dashed unestimated block. Keep `touch-action: none` on drag handles and all existing pointer/drag behavior.

- [ ] **Step 2: Style Project Board and lifecycle states**

Keep Board-owned horizontal scrolling and all board widths. Use a lightly tinted column background on hover/drop, `var(--surface)` task cards with `var(--border-subtle)`, and a visible `:focus-within` state. Keep action opacity behavior and do not add a hover tilt or continuous animation.

- [ ] **Step 3: Style Task Detail and Focus**

Use `TaskDetail.module.css` for flat field rows and a single highlighted primary action area. In `FocusSurface.module.css`, keep the existing centered layout, timer scale, candidate hit targets, and immersive back button. Add a quiet focus-stage treatment using semantic surfaces only; do not move the timer or introduce looping animation.

- [ ] **Step 4: Style Review metrics and details**

Keep CSS module class names. Set metrics to a consistent grid with `var(--surface)` cards, stronger numeric hierarchy, and one shared section gap. Use `var(--surface-raised)` for detail list rows and keep checkpoint items readable. Add no new color literals.

- [ ] **Step 5: Run the affected contract**

Run: `npm run verify:ui-contract`

Expected: PASS with no raw-color or global-SVG violations and unchanged Plan touch/scroll contracts.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/features/tasks/PlanWorkspace.module.css src/renderer/src/features/tasks/ProjectWorkspace.module.css src/renderer/src/features/tasks/TaskDetail.module.css src/renderer/src/features/tasks/FocusSurface.module.css src/renderer/src/features/review/DailyReview.module.css
git commit -m "Polish planning and focus surfaces"
```

### Task 5: Unify Settings, Collection, and Standalone Reminders

**Files:**
- Modify: `src/renderer/src/styles/settings.css:1-62`
- Modify: `src/renderer/src/styles/collection.css:1-111`
- Modify: `src/renderer/src/styles.css:1675-1722`
- Test: `npm run verify:ui-contract`

**Interfaces:**
- Consumes: existing SettingsView, CharacterCollectionView, and StandaloneReminderSection class names and command states.
- Produces: readable grouped forms, a featured character surface, and a compact reminder composer/list using the shared palette.

- [ ] **Step 1: Refine embedded Settings**

Keep `.settings-shell`, `.settings-header`, `.status-strip`, `.settings-section`, `.number-row`, `.switch-row`, `.mode-card`, `.history-*`, `.data-*`, and `.test-actions` selectors. Use `var(--surface)` for section shells, `var(--bg-app)` for control groups, `var(--surface-hover)` for selected/hover states, and `var(--border-subtle)` for separators. Preserve all existing save/error/recovery color semantics and input controls.

- [ ] **Step 2: Refine Collection**

Keep `.candidate-card` as the featured surface with a two-column layout and existing responsive stack. Give `.candidate-stage` a calm brand-subtle wash, `.candidate-copy` a clear type scale, and cards a modest hover border change without adding 3D movement. Keep character artwork dimensions and all buttons/commands unchanged.

- [ ] **Step 3: Refine standalone reminders**

Keep `.standalone-composer` grid columns, weekday controls, interval controls, list layout, and empty-state markup. Replace any inconsistent shadow/radius usage with the shared semantic surfaces; keep active weekdays brand colored and ordinary list items neutral.

- [ ] **Step 4: Run the affected contract**

Run: `npm run verify:ui-contract`

Expected: PASS with no raw colors outside `theme.css`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/styles/settings.css src/renderer/src/styles/collection.css src/renderer/src/styles.css
git commit -m "Unify settings and companion surfaces"
```

### Task 6: Finish Pet, Alert, Bubble, and motion accessibility

**Files:**
- Modify: `src/renderer/src/styles.css:1-1674,1711-1724`
- Modify: `src/renderer/src/styles/primitives.css:236-252`
- Modify: `src/renderer/src/styles/workbench.css:430-445`
- Test: `npm run verify:ui-contract`

**Interfaces:**
- Consumes: existing transparent-window class names from PetView, AlertView, BubbleView, ReminderArtwork, and ActivityGuide.
- Produces: coherent floating surfaces and explicit reduced-motion/forced-colors fallbacks without changing drag regions or choreography.

- [ ] **Step 1: Restyle the pet toolbar and care affordances**

Keep `.pet-shell`, `.pet-toolbar`, `.pet-gear`, `.pet-alarm`, `.pet-todo-tab`, `.pet-care-badge`, `.pet-gift-badge`, `.pet-drag-surface`, and `.pet-drag-handle`. Maintain `-webkit-app-region` declarations exactly where interactive elements require `no-drag`. Use semantic translucent surfaces only for controls, keep the character stage transparent, and avoid adding any always-visible chrome over the desktop.

- [ ] **Step 2: Restyle Alert and Bubble reading surfaces**

Keep `.alert-shell`, `.alert-panel`, `.alert-heading`, `.alert-actions`, `.break-todo-card`, `.bubble-card`, `.bubble-tail`, `.bubble-actions`, and standalone activity selectors. Use the shared border/radius hierarchy, make the primary action use `var(--brand)`, and keep danger/warning states semantic. Preserve the existing artwork background tokens and artwork animations that represent reminder activity.

- [ ] **Step 3: Consolidate motion fallbacks**

In the existing reduced-motion media blocks, disable nonessential `transform` transitions and all decorative loops for pet, artwork, command feedback, sheets, and card hover. Keep state changes readable through color/border/text. Extend forced-colors rules so alert panels, bubbles, task rows, active navigation, dialogs, and sheets have a visible `ButtonText`/`Highlight` border or outline. Do not remove required pointer affordances.

- [ ] **Step 4: Run the affected contract**

Run: `npm run verify:ui-contract`

Expected: PASS with transparent-window selectors intact, reduced-motion coverage present, no raw-color violations, and no global SVG color rules.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/styles/primitives.css src/renderer/src/styles/workbench.css
git commit -m "Polish reminder and pet surfaces"
```

### Task 7: Run complete verification and actual UI smoke checks

**Files:**
- Modify: none unless a verification failure identifies a direct regression in Tasks 1–6.
- Test: repository verification commands and actual Electron surfaces.

**Interfaces:**
- Consumes: all completed visual layers.
- Produces: direct evidence that the visual cutover builds, passes existing behavior contracts, and renders across required themes and surfaces.

- [ ] **Step 1: Run typecheck and all tests**

Run:

```bash
npm run typecheck
npm test
```

Expected: both commands exit `0` with no TypeScript or Node test failures.

- [ ] **Step 2: Run UI contract and build verification**

Run:

```bash
npm run verify:ui-contract
npm run build
```

Expected: the UI contract prints its success line and electron-vite plus `verify:build` completes successfully.

- [ ] **Step 3: Launch the actual application**

Start the app using the repository's existing dev/smoke path. Exercise Today, Inbox, Plan, Projects (list and Board), Focus, Review, Settings, Collection, Standalone Reminders, Pet, Alert, and Bubble. Confirm the following observable contracts:

- light, dark, and system themes use the same hierarchy;
- task selection, completion, priority, drag feedback, and command pending/error states remain readable;
- Plan stays usable at the tested narrow workspace and only Project Board scrolls horizontally;
- Task Detail remains fully visible in its side sheet;
- Pet remains transparent and draggable, and every toolbar action remains clickable;
- Alert and Bubble primary/danger actions remain visible and their artwork remains intact;
- reduced-motion removes nonessential movement without removing state feedback.

- [ ] **Step 4: Capture the required UI matrix**

Run the existing UI capture/smoke scripts that are available for the current environment:

```bash
npm run capture:ui
npm run capture:ui-scale
```

Inspect the resulting captures for Today, Plan, Project, Focus, Settings, Collection, Pet, Reminder, and Bubble. Confirm no text clipping, unexpected page-level horizontal scroll, low-contrast active state, or desktop halo from transparent windows.

- [ ] **Step 5: Commit the final documentation/verification changes**

```bash
git add docs/color-system.md
git commit -m "Document quiet editorial UI finish"
```
## Final Review Checklist

- [ ] Every renderer surface listed in `docs/superpowers/specs/2026-08-31-quiet-editorial-ui-design.md` uses the shared semantic palette.
- [ ] Existing behavior, IPC, command layer, data model, and window boundaries are unchanged.
- [ ] `theme.css` is the only semantic color authority and no renderer CSS contains a new raw color.
- [ ] Workbench dimensions, container queries, Plan drag handles, Board scrolling, hit targets, forced-colors, and reduced-motion contracts pass.
- [ ] `npm run typecheck`, `npm test`, `npm run verify:ui-contract`, and `npm run build` have current successful output.
- [ ] Actual Electron UI and capture matrix have been inspected before claiming completion.

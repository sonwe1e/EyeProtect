---
feature: frontend-ui-audit
status: in-progress
updated: 2026-02-13
branch: fix/frontend-ui-audit
commits: 988b44b..HEAD # filled at delivery
---

# Frontend UI Audit & Repair

## Report

## [S1] Problem

活跃前端（工作台待办 / 完成记录 / 设置、桌宠、气泡、休息遮罩）存在用户已观察到的交互与视觉缺陷，且可能还有同类未发现 bug，影响日常使用：

1. **待办行「•••」菜单布局错位**：点击三点后菜单项进入文档流，行高被撑开，触发按钮相对位移（用户描述为「上移 / 删除下移」），不是锚定 popover。
2. **设置页休息相关控件异常**：护眼短休息 / 走动长休息等开关与按钮「有问题」——命中区域偏小（视觉 24px，低于令牌 `--hit-target-min: 44px`）、写操作 pending 可能锁住整卡、数字输入失焦保存缺少边界钳制与失败可见性。
3. **「动态角色系列」名不副实**：软萌仓鼠 / 粉耳白兔等由 `scripts/build_all_character_themes.py` 对奋斗猫 GIF 换色贴耳生成，切换后并非真正独立角色，造成预期落差。
4. **其它表面未系统审查**：完成记录、桌宠窗口、气泡、提醒遮罩可能存在同类布局/状态/一致性问题，需要一次覆盖全部活跃 UI 的审查并修复。

## [S2] Design

### 2.1 工作区与基线

- 分支：`fix/frontend-ui-audit`（当前检出目录，非 worktree；环境拒绝 `git worktree add`）。
- 基线提交：`988b44b`（设置卡片改版 + 托盘主题切换 + 旧换色脚本）。
- 用户可见写操作继续走命令层 `run` / `useCommand`；计时权威仍在主进程。
- 颜色仅使用 `theme.css` 语义令牌；交互元素保持 `no-drag` 与足够命中区域。

### 2.2 审查范围（全部活跃前端表面）

| 表面 | 入口 | 审查要点 |
| --- | --- | --- |
| 工作台·待办 | `WorkbenchView.tsx` today | 行操作、三点菜单、展开编辑、步骤、空态、筛选/搜索、撤销条 |
| 工作台·完成记录 | `WorkbenchView.tsx` review | 日期分组、筛选、空态、统计条 |
| 工作台·设置 | `SimpleSettings.tsx` + `simple.css` | 开关/数字/下拉、试听与试提醒、角色切换、备份按钮、旧资料折叠 |
| 桌宠 | `PetView.tsx`、`PetCharacter.tsx` | 主题切换是否生效、经典像素 vs 自定义 GIF、拖拽/点击、缩放 |
| 气泡 | `BubbleView.tsx` | 待办/番茄钟优先级、高度、操作可达性 |
| 休息遮罩 | `AlertView.tsx` + `restViewModel.ts` | 文案/进度派生、动作按钮、主题角色展示 |
| 托盘角色菜单 | `src/main/index.ts` `buildPetSubmenuTemplate` | 与设置页同一主题目录、选中态、显示名 |

审查产出写入本文件 `Report`（实现阶段填充）；**实现以修复为准**，不以报告代替代码变更。

### 2.3 待办三点菜单（布局契约）

**现象**：`details.simple-menu` 的子按钮在 `[open]` 时 `display:block` 且参与行内 flex 布局，无 `position:absolute`，导致行高变化与控件位移。

**契约**：

- 菜单触发器（`summary`）留在任务行内，尺寸稳定（≥32×32，建议对齐命中区）。
- 打开后的操作项挂在 **绝对定位 popover** 容器（`.simple-menu-popover`）中：`position:absolute; right:0; top:calc(100%+4px); z-index` 高于行卡片，**不改变父行高度**。
- 操作项至少：删除任务；若已钉到浮窗，另有浮窗上移/下移。
- 点击菜单内按钮不冒泡触发行展开；执行后关闭菜单；`Escape` 关闭；点击外部关闭（可用 `toggle` + 失焦或轻量监听）。
- 危险操作仍走 `ConfirmDialog` / `confirm`，成功路径走 `window.eyeProtect.deleteTask` 等现有 API。
- CSS：popover 使用 `surface-raised` / 边框 / 阴影；`is-danger` 语义色；禁止再用「按钮插入文档流」的实现。

### 2.4 设置页控件（行为契约）

- **开关** `SettingSwitch`：
  - 视觉可保持紧凑拨杆，但 **可点击命中区 ≥ 44px**（padding 或外层热区，不破坏卡片布局）。
  - `aria-switch` + 可读 `aria-label`；`aria-pressed`/`aria-checked` 与持久化状态一致。
  - 写操作失败必须可见（复用 `action.error` 或控件旁 `role="alert"`），不得静默；单次失败不得永久禁用整页开关。
  - 尽量乐观更新或在 IPC 完成后立刻反映 `onSettingsChanged`；避免「点了没反应」。
- **数字字段**（间隔/时长/缩放）：
  - 失焦保存前 **clamp 到 min/max**；非法输入回退为当前持久化值。
  - 避免仅因 `key={settings[key]}` 在每次广播时强制重挂载导致焦点丢失；在外部变更时再同步。
- **试听 / 试一下护眼提醒**：保留现有 API；按钮 pending 时禁用自身而非整页；失败可见。
- **角色选择**：动态系列与经典像素分组；选中态唯一（`customPetTheme` 非空则经典不亮）；切换后桌宠窗口通过既有 settings 广播生效。

### 2.5 独立动态角色（资源与管线）

**目标**：动态角色系列不再是奋斗猫换色贴耳；每个主题拥有 **独立轮廓与动作素材**（GIF），画风与现有奋斗猫自定义动图一致（像素/手绘卡通、透明底、idle/click/fidget/sleep 命名规范）。

**资源来源**（用户已选）：AI 生成同风格独立动图关键帧 → 本地脚本合成为 GIF。

**目录与打包**：

- 仓库内内置主题根目录：`public/assets/pet-themes/<themeId>/`
  - `themeId` 使用新 ID，避免与旧 recolor 文件夹同名覆盖：建议 `shiba`、`bunny`、`hamster`。
  - 每主题至少：`idle.gif`、`click.gif`（或 `click1.gif`）、`sleep.gif`、`fidget.gif`；预览优先 idle 首帧。
- `package.json` `build.files` 已含 `public/assets/**/*`，内置 GIF 随包分发。
- 用户自定义仍位于 `getDataDir()/custom-pet/**`，约定不变。

**主进程发现逻辑**（`pet:custom:get-assets` 与托盘菜单共用）：

1. 读取 **内置目录** `app.getAppPath()/public/assets/pet-themes`（开发）/ 打包后等价资源路径。
2. 读取 **用户目录** `data/custom-pet`。
3. 合并为 `availableThemes`：内置在前；同 id 时 **用户目录覆盖内置**（便于用户替换）。
4. `THEME_DISPLAY_NAMES` 更新为独立角色名，例如：
   - `shiba` → 治愈柴犬
   - `bunny` → 粉耳白兔
   - `hamster` → 软萌仓鼠
   - `default` → 奋斗猫（默认，仅当用户根目录存在素材时出现）
5. 设置「动态角色系列」列表来自合并结果；无内置素材且无用户素材时 **不显示空的动态分组**。
6. 旧脚本 `scripts/build_all_character_themes.py` 不再作为内置角色来源；可保留为用户工具但不在设置页暗示为「官方动态角色」。

**质量门槛（资源）**：

- 三个主题剪影可区分（体型/耳形/尾/道具），不是单纯 recolor。
- GIF 可播放、透明底、命名符合 `loadDirAssets` 前缀约定。
- 生成失败或资源缺失时，设置页不展示破损主题；桌宠回退经典 `petAppearance` 像素渲染。

### 2.6 其它表面修复原则

- 审查中发现的缺陷：布局错位、不可点、状态不同步、文案与行为不符、无障碍缺失 → **本轮修复**。
- 不扩展遗留规划/专注/看板 UI；不恢复已删除的 `_legacy` 路径。
- 测试：优先补纯函数/主进程可测逻辑（主题合并、菜单相关若可测则测行为）；UI 契约跑 `verify:ui-contract` / `verify:product`。

### 2.7 验证命令

交付前在分支工作区运行并记录：

- `npm run typecheck`
- `npm test`
- `npm run lint`（product + ui-contract）
- 涉及主题/IPC 时：相关 `tests/*.test.ts` 必须覆盖新逻辑

## [S3] Out of Scope

- 重做产品信息架构或恢复遗留工作台页面。
- 为经典像素动物新增第四只 SVG（仓鼠等）——动态系列走 GIF 管线；经典仍仅猫/狗/兔。
- 番茄钟/提醒调度算法变更（除非审查发现前端显示派生 bug）。
- 自动打包发布、安装器文案、非 Windows 平台适配。
- 将用户 `data/` 下旧 recolor 产物自动物理删除（可在文档/设置说明中提示；不做强制删用户数据）。

## Tasks

- [ ] T1: 修复待办三点菜单为绝对定位 popover — acceptance: 打开/关闭菜单时任务行几何位置与其它按钮不再位移；删除/浮窗排序仍可用；Escape/外点可关 (covers: S2.3)
- [ ] T2: 修复设置页开关/数字/试提醒控件 — acceptance: 开关命中区≥44px 且状态即时正确；数字 clamp；失败可见且不永久锁死整页；typecheck 通过 (covers: S2.4)
- [ ] T3: 审查并修复工作台待办与完成记录 UI — acceptance: 对 today/review 过一遍交互与空态；发现的布局/状态 bug 在代码中修复并在 Report 记录 (covers: S2.2; depends: T1)
- [ ] T4: 审查并修复桌宠/气泡/休息遮罩/托盘角色菜单一致性 — acceptance: 主题切换在设置页与桌宠一致；气泡与遮罩无阻断使用缺陷；问题修复记入 Report (covers: S2.2, S2.5)
- [ ] T5: 生成并落盘独立动态角色 GIF（shiba/bunny/hamster）— acceptance: `public/assets/pet-themes/<id>/` 含合规 GIF；剪影可区分；可用预览 (covers: S2.5)
- [ ] T6: 主进程合并内置+用户主题并更新显示名/托盘/设置列表 — acceptance: `get-assets` 与托盘列出内置主题；用户同 id 可覆盖；无素材不出现空组；IPC/设置相关测试更新 (covers: S2.5; depends: T5)
- [ ] T7: 补测试并跑验证门 — acceptance: `npm run typecheck`、`npm test`、`npm run lint` 通过；新增逻辑有测试；Report 写明命令结果 (covers: S2.6, S2.7; depends: T1,T2,T3,T4,T6)

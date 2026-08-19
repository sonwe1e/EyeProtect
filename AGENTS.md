# Repository Guidelines

## 项目整体功能

EyeProtect 是一个 Windows 桌面护眼提醒与工作节奏应用，技术栈是 Electron、electron-vite、React 和 TypeScript。应用启动后常驻系统托盘，并显示一个可拖动的透明桌宠窗口。它会按设置触发护眼提醒、走动提醒，两个提醒接近时会合并为一次提醒；提醒出现后支持完成、稍后、跳过和暂停。统一工作台还提供任务、项目、每日计划、TimeBlock、专注会话和每日回顾。配置和运行数据保存在本地，打包后生成 Windows x64 NSIS 安装包与 portable exe。

## 项目结构

- `src/main/`：Electron 主进程代码，负责应用生命周期、托盘、窗口、IPC、提醒调度、设置读写和开机自启。
- `src/preload/`：预加载脚本，通过 `contextBridge` 把安全 API 暴露给 React 渲染端。
- `src/shared/`：主进程、preload、renderer 共用的类型、默认设置和设置范围。
- `src/renderer/`：渲染端入口和 React UI。`src/renderer/src/App.tsx` 只负责按 URL hash 动态加载视图；`views/` 放窗口级界面，`features/` 放任务、提醒、桌宠、计划、复盘等组件，`hooks/` 按窗口订阅所需数据，`styles/` 放基础样式与设计令牌（`styles.css` 为遗留窗口样式：桌宠/提醒/气泡 + 工作台内嵌设置页与独立提醒页）。
- `tests/`：Node 内置 test runner 测试，覆盖提醒调度、调度内核、运行状态恢复、系统生命周期、任务/项目/计划/专注、备份、设置事件、提醒追踪日志和 IPC 页面白名单。`tests/electron-loader.mjs` + `tests/electron-stub.mjs` 为 reminder surface 测试在纯 Node 下打桩 Electron。
- `public/assets/`：静态资源。只包含 `tray-icon.png`（托盘）和 `app-icon.ico`（打包图标）；桌宠与提醒主体由程序化内联 SVG 渲染。`app-icon.png` 源文件在 `scripts/assets/`（仅 `npm run build:icon` 生成 .ico 时使用），不会被打包。
- `out/`、`release/`、`node_modules/`：构建产物、发行产物和依赖目录，通常不要手动修改。

## 功能修改位置速查

| 要修改的功能 | 主要修改文件 | 注意事项 |
| --- | --- | --- |
| 护眼/走动提醒间隔、稍后、完成、跳过、暂停、合并提醒逻辑 | `src/main/reminders.ts` | 同步补充 `tests/reminders.test.ts`。重点覆盖真实提醒与测试提醒是否会重置日程。 |
| 新增或调整设置项、默认值、取值范围 | `src/shared/types.ts`、`src/main/settings.ts`、`src/renderer/src/views/SettingsView.tsx` | 类型、清洗逻辑、UI 控件必须一起更新。 |
| 设置文件读取、写入、容错、保存目录 | `src/main/settings.ts` | 默认目录由 `getDataDir()` 决定；不要把本地 `data/settings.json` 提交为源码。 |
| 开机自启 | `src/main/settings.ts` | 修改 `syncStartupShortcut()`；它只在 packaged 模式下写入 Windows Startup 快捷方式。 |
| 系统托盘菜单、单实例锁、退出行为 | `src/main/index.ts` | 托盘菜单在 `createTray()` 中；IPC handler 也在这里注册。 |
| 桌宠、提醒、设置、气泡和遮罩窗口 | `src/main/windows.ts` | 提醒窗口与桌宠窗口相互独立；设置是工作台内嵌页，没有独立窗口；修改显示器相对布局时同步覆盖窗口生命周期和 bounds 测试。 |
| 主进程到渲染端的新能力/API | `src/shared/types.ts`、`src/preload/index.ts`、`src/main/index.ts` | 先定义 `EyeProtectApi`，再在 preload 调用 IPC，最后在 main 注册 handler。三处通道名保持一致。 |
| IPC 入参清洗（任务/项目创建与更新） | `src/main/ipcTaskInput.ts`、`src/main/ipcProjectInput.ts` | 所有 renderer 传入字段在此白名单化；新增任务字段（含并发保护 `baseRevision`）必须在此透传并补 `tests/ipc-task-input.test.ts`。 |
| 桌宠界面、提醒卡片、设置窗口、按钮、文案、表单 | `src/renderer/src/views/`、`src/renderer/src/features/` | 窗口级状态留在 View，可复用交互放在对应 feature；不要恢复全窗口共用的 `useAppState()`。 |
| 视觉样式、窗口布局、桌宠外观和动画 | `src/renderer/src/styles.css`、`src/renderer/src/styles/` | 窗口透明和拖拽依赖 `-webkit-app-region`，按钮等交互元素必须保持 `no-drag`；公共颜色和节奏优先使用设计令牌。 |
| 公仔生成、收藏、材质、配饰和低频动作 | `src/shared/characters.ts`、`src/main/characterService.ts`、`src/renderer/src/features/characters/` | 角色由种子确定性生成；用户改名/材质/配饰不能改变角色指纹。默认保持静止，仅在页面可见且未启用 reduced-motion 时低频播放一次短动作。 |
| 托盘图标或程序化提醒视觉 | `public/assets/tray-icon.png`、`src/renderer/src/features/reminders/ReminderArtwork.tsx` | 托盘图标必须继续包含在两个发行包中；公仔与提醒为内联 SVG，不依赖旧固定 PNG。修改后运行 `npm run package`。 |
| 打包配置、产物名称、Windows NSIS/portable 目标 | `package.json` | 修改 `build` 字段；默认输出目录是 `release/`。 |
| electron-vite 入口、renderer public 目录 | `electron.vite.config.ts` | main、preload、renderer 的入口都在这里声明。 |

## 构建、测试与运行命令

- `npm install`：安装 `package-lock.json` 锁定的依赖。
- `npm run dev`：启动 Electron 开发环境。
- `npm run typecheck`：执行 `tsc --noEmit`，检查严格 TypeScript 类型。
- `npm test`：执行 `tsx --test tests/*.test.ts`。
- `npm run build`：用 electron-vite 构建到 `out/`，并运行 `verify:build` 契约检查（sandbox preload、CJS 输出等）。
- `npm run start`：预览已构建应用。
- `npm run verify:ui-contract`：检查语义颜色、CSS 所有权、可访问性模式、命中区域和对比度。
- `npm run package`：先构建，再通过 electron-builder 生成 Windows x64 NSIS 安装包和 portable exe 到 `release/`。`package:nsis` / `package:portable` 只构建其中一种目标。
- smoke 与 UI 截图脚本：`smoke:running` / `smoke:experience` / `smoke:emergency` / `smoke:pet-failure` / `smoke:workbench-interactions` / `smoke:plan-interactions` / `capture:ui` / `capture:ui-scale`。全部通过 `scripts/lib/cdp.mjs` 与打包应用通信；修改 CDP 连接逻辑只改这一处。

## 代码风格与约定

使用严格 TypeScript。保持两空格缩进、单引号、分号、`camelCase` 变量/函数、`PascalCase` 类型和 React 组件。新增跨进程数据结构时，优先放在 `src/shared/types.ts`，不要在 main、preload、renderer 三端重复定义。Renderer 不直接访问 Node/Electron 能力，必须通过 `window.eyeProtect` 调用 preload 暴露的 API。

## 测试要求

新增测试文件使用 `*.test.ts` 命名并放在 `tests/`。修改提醒调度、暂停、稍后、合并提醒、测试提醒时，必须增加或更新 `tests/reminders.test.ts`。修改设置清洗逻辑时，应增加默认值、边界值、非法输入回退的测试。交付前至少运行 `npm run typecheck` 和 `npm test`；涉及打包或资源路径时再运行 `npm run build` 或 `npm run package`。

## 提交与 PR 建议

提交信息采用简短祈使句，例如 `Fix reminder pause scheduling`、`Add settings field for pet scale`。PR 描述应说明用户可见变化、涉及的主要文件、运行过的验证命令；UI 改动附截图或录屏，打包相关改动说明对 `release/` 产物的影响。

## 安全与配置注意事项

不要提交本地运行数据、机器路径、密钥或个人配置。`data/settings.json` 是运行时配置文件，不是源码。`out/`、`release/` 和 `node_modules/` 默认视为生成物或依赖；除非任务明确要求更新发行产物，否则不要把它们作为主要修改目标。

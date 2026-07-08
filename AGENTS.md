# Repository Guidelines

## 项目整体功能

EyeProtect 是一个 Windows 桌面护眼提醒应用，技术栈是 Electron、electron-vite、React 和 TypeScript。应用启动后常驻系统托盘，并显示一个可拖动的透明桌宠窗口。它会按设置触发护眼提醒、走动提醒，两个提醒接近时会合并为一次提醒；提醒出现后支持完成、稍后、跳过和暂停。用户可以在设置窗口调整提醒间隔、稍后时长、桌宠缩放、开机自启，并查看下次提醒时间。配置保存到本地 `data/settings.json`，打包后生成 Windows x64 portable exe。

## 项目结构

- `src/main/`：Electron 主进程代码，负责应用生命周期、托盘、窗口、IPC、提醒调度、设置读写和开机自启。
- `src/preload/`：预加载脚本，通过 `contextBridge` 把安全 API 暴露给 React 渲染端。
- `src/shared/`：主进程、preload、renderer 共用的类型、默认设置和设置范围。
- `src/renderer/`：渲染端入口和 React UI。`src/renderer/src/App.tsx` 包含桌宠界面与设置界面，`styles.css` 包含布局、颜色、CSS 桌宠和动画。
- `tests/`：Node 内置 test runner 测试，目前主要覆盖提醒调度逻辑。
- `public/assets/`：静态资源。`tray-icon.png` 是托盘图标，`character.riv` 是可选 Rive 桌宠资源。
- `out/`、`release/`、`node_modules/`：构建产物、发行产物和依赖目录，通常不要手动修改。

## 功能修改位置速查

| 要修改的功能 | 主要修改文件 | 注意事项 |
| --- | --- | --- |
| 护眼/走动提醒间隔、稍后、完成、跳过、暂停、合并提醒逻辑 | `src/main/reminders.ts` | 同步补充 `tests/reminders.test.ts`。重点覆盖真实提醒与测试提醒是否会重置日程。 |
| 新增或调整设置项、默认值、取值范围 | `src/shared/types.ts`、`src/main/settings.ts`、`src/renderer/src/App.tsx` | 类型、清洗逻辑、UI 控件必须一起更新。 |
| 设置文件读取、写入、容错、保存目录 | `src/main/settings.ts` | 默认目录由 `getDataDir()` 决定；不要把本地 `data/settings.json` 提交为源码。 |
| 开机自启 | `src/main/settings.ts` | 修改 `syncStartupShortcut()`；它只在 packaged 模式下写入 Windows Startup 快捷方式。 |
| 系统托盘菜单、单实例锁、退出行为 | `src/main/index.ts` | 托盘菜单在 `createTray()` 中；IPC handler 也在这里注册。 |
| 桌宠窗口、设置窗口、窗口尺寸、置顶层级、位置保存 | `src/main/windows.ts` | 提醒时窗口形态由 `applyReminderStatus()` 和 `getPetBounds()` 控制。 |
| 主进程到渲染端的新能力/API | `src/shared/types.ts`、`src/preload/index.ts`、`src/main/index.ts` | 先定义 `EyeProtectApi`，再在 preload 调用 IPC，最后在 main 注册 handler。三处通道名保持一致。 |
| 桌宠界面、提醒卡片、设置窗口、按钮、文案、表单 | `src/renderer/src/App.tsx` | `PetView` 控制桌宠与提醒动作，`SettingsView` 控制设置页，`NumberField` 是数字输入控件。 |
| 视觉样式、窗口布局、CSS 桌宠外观和动画 | `src/renderer/src/styles.css` | 窗口透明和拖拽依赖 `-webkit-app-region`，按钮等交互元素必须保持 `no-drag`。 |
| Rive 桌宠状态机名称或加载逻辑 | `src/renderer/src/App.tsx`、`public/assets/character.riv` | 当前状态机名称约定为 `idle`、`eyeAlert`、`walkAlert`、`combinedAlert`、`success`。 |
| 托盘图标或桌宠资源 | `public/assets/tray-icon.png`、`public/assets/character.riv` | 没有 `character.riv` 时会回退到 CSS 桌宠。 |
| 打包配置、产物名称、Windows portable 目标 | `package.json` | 修改 `build` 字段；默认输出目录是 `release/`。 |
| electron-vite 入口、renderer public 目录 | `electron.vite.config.ts` | main、preload、renderer 的入口都在这里声明。 |

## 构建、测试与运行命令

- `npm install`：安装 `package-lock.json` 锁定的依赖。
- `npm run dev`：启动 Electron 开发环境。
- `npm run typecheck`：执行 `tsc --noEmit`，检查严格 TypeScript 类型。
- `npm test`：执行 `tsx --test tests/*.test.ts`。
- `npm run build`：用 electron-vite 构建到 `out/`。
- `npm run start`：预览已构建应用。
- `npm run package`：先构建，再通过 electron-builder 生成 Windows x64 portable exe 到 `release/`。

## 代码风格与约定

使用严格 TypeScript。保持两空格缩进、单引号、分号、`camelCase` 变量/函数、`PascalCase` 类型和 React 组件。新增跨进程数据结构时，优先放在 `src/shared/types.ts`，不要在 main、preload、renderer 三端重复定义。Renderer 不直接访问 Node/Electron 能力，必须通过 `window.eyeProtect` 调用 preload 暴露的 API。

## 测试要求

新增测试文件使用 `*.test.ts` 命名并放在 `tests/`。修改提醒调度、暂停、稍后、合并提醒、测试提醒时，必须增加或更新 `tests/reminders.test.ts`。修改设置清洗逻辑时，应增加默认值、边界值、非法输入回退的测试。交付前至少运行 `npm run typecheck` 和 `npm test`；涉及打包或资源路径时再运行 `npm run build` 或 `npm run package`。

## 提交与 PR 建议

当前工作目录未暴露 Git 历史，因此提交信息采用简短祈使句，例如 `Fix reminder pause scheduling`、`Add settings field for pet scale`。PR 描述应说明用户可见变化、涉及的主要文件、运行过的验证命令；UI 改动附截图或录屏，打包相关改动说明对 `release/` 产物的影响。

## 安全与配置注意事项

不要提交本地运行数据、机器路径、密钥或个人配置。`data/settings.json` 是运行时配置文件，不是源码。`out/`、`release/` 和 `node_modules/` 默认视为生成物或依赖；除非任务明确要求更新发行产物，否则不要把它们作为主要修改目标。

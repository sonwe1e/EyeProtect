# EyeProtect 运行时与便携版路径修复设计

> 历史归档：本文记录已完成的 0.5.1 preload 与 portable 路径修复。当前发行行为以代码和 `docs/release-checklist.md` 为准。

日期：2026-07-27  
目标版本：0.5.1  
状态：已批准，待实施

## 背景

EyeProtect 0.5.0 的 portable EXE 能启动后台进程，但桌宠浮窗和设置窗口没有可见内容。实际解包检查表明，发行包中的所有业务窗口启用了 Electron renderer sandbox，同时 preload 仍以 ESM `.mjs` 形式输出，并通过静态 `import` 加载 Electron API。Electron 不支持在 sandboxed preload 中使用 ESM import，因此 `window.eyeProtect` 没有成功注入，依赖该桥接对象的 React 页面随即发生运行时错误。

此外，portable 运行时会先把内部应用解包到临时目录。当前数据目录和开机自启目标都直接基于 `process.execPath`，因此设置会写入临时解包目录，启动快捷方式也会指向临时内部 EXE，而不是用户实际运行的 portable 文件。

## 目标

本次修复必须同时满足以下结果：

1. 桌宠浮窗在 sandbox 开启时正常渲染。
2. 设置窗口可通过桌宠、托盘和第二实例正常打开并渲染。
3. preload 继续只暴露现有的窄 IPC API，不扩大 renderer 权限。
4. portable 设置保存在用户实际放置 EXE 的目录下 `data/settings.json`。
5. 开机自启快捷方式指向用户实际运行的 portable EXE。
6. 非 portable 的开发预览和 unpacked 运行继续使用合理的回退路径。
7. 构建和验证流程能够在未来阻止 sandbox 与 ESM preload 的错误组合再次进入发行包。

## 非目标

本次不调整桌宠外观、提醒动画、设置布局、调度规则、待办或闹钟功能，也不进行与故障无关的架构重构。不会覆盖 0.5.0 发行文件，而是生成新的 0.5.1 产物。

## 方案

采用保留 sandbox 的 CommonJS preload 方案。

### Preload 构建

在 `electron.vite.config.ts` 中将 preload 的 Rollup 输出格式显式设为 `cjs`，并把入口文件固定为 `index.cjs`。`src/preload/index.ts` 继续作为唯一源码，由构建器把 TypeScript/ESM 源码转换为 sandbox 能执行的 CommonJS bundle。

所有需要 preload 的 `BrowserWindow` 统一引用 `../preload/index.cjs`。`contextIsolation: true`、`nodeIntegration: false` 和 `sandbox: true` 保持不变。

为了避免多个窗口再次出现路径漂移，preload 路径只在 `windows.ts` 中计算一次并复用。

### Portable 路径解析

在设置模块中建立两个职责清晰的纯函数：

- 应用数据根目录解析：开发环境使用工作目录；portable 环境优先使用 `PORTABLE_EXECUTABLE_DIR`；其他 packaged 环境回退到 `dirname(process.execPath)`。
- 启动文件解析：portable 环境优先使用 `PORTABLE_EXECUTABLE_FILE`；其他 packaged 环境回退到 `process.execPath`。

对环境变量进行防御性处理：仅接受非空绝对路径。非法、空白或相对路径不得覆盖安全回退值。

`getDataDir()` 使用解析后的应用根目录并追加 `data`。`syncStartupShortcut()` 使用解析后的启动文件及其父目录创建快捷方式。现有 `EYEPROTECT_DATA_DIR` 测试覆盖能力继续保持最高优先级。

## 数据流

portable 启动后，electron-builder 把原始 portable 文件位置放入环境变量。主进程读取该位置，设置存储定位到原始 EXE 旁的 `data` 目录；用户保存设置时继续走现有原子写入逻辑。启用开机自启时，快捷方式直接指向原始 portable EXE。

窗口创建时加载 CommonJS preload。preload 在 sandbox 的受限环境中通过允许的 `require('electron')` 访问 `contextBridge` 和 `ipcRenderer`，将现有 `EyeProtectApi` 暴露为 `window.eyeProtect`。React 页面随后通过该 API 获取设置和提醒状态。

## 错误处理

路径解析遇到非法 portable 环境变量时回退到当前 packaged 行为，不阻止应用启动。设置文件原有的清洗、隔离损坏文件和原子写入逻辑保持不变。

窗口加载应保留现有 Promise 错误传播；同时在真实运行验证中检查 preload 桥接和关键页面根节点，避免仅凭 `loadFile()` 成功就认定窗口可用。

## 测试与验证

自动验证包括：

1. 为 portable 数据目录和启动文件解析增加单元测试，覆盖有效路径、缺失变量、空白值、相对路径和非 portable 回退。
2. 增加构建契约检查，确认 preload 产物为 `out/preload/index.cjs`、包含 CommonJS Electron 加载方式，并且窗口代码不再引用 `index.mjs`。
3. 运行 `npm run typecheck`。
4. 运行 `npm test`。
5. 运行 `npm run build`。

发行验证包括：

1. 把版本更新为 0.5.1 并运行 `npm run package`。
2. 启动新 portable EXE，确认桌宠可见且包含真实 UI 元素。
3. 通过第二实例或桌宠入口打开设置，确认设置页面可见。
4. 保存一次设置，确认数据写入 portable EXE 同目录下的 `data/settings.json`。
5. 核验发行包内部 preload 为 CommonJS 且所有业务窗口保持 sandbox。
6. 关闭测试实例，确保没有后台进程锁定发行文件。

## 验收标准

只有在 0.5.1 portable EXE 的桌宠、设置和数据路径均经过真实运行验证，且类型检查、全部自动测试、构建和打包均通过后，修复才算完成。任何仅通过静态测试但未启动发行 EXE 的结果都不能作为交付完成依据。

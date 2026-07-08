# EyeProtect

EyeProtect 是一个 Windows 桌面护眼桌宠提醒工具。它常驻后台托盘，桌面上保留一个透明小人物；到点后小人物会放大、置顶并播放夸张动作，提醒你放松眼睛或站起来走走。

## 功能

- 护眼提醒和走动提醒分别计时。
- 提醒间隔、稍后提醒时间、桌宠缩放都可以在设置窗口调整。
- 提醒时支持完成、稍后、跳过。
- 护眼和走动提醒在 60 秒内同时到期时会合并成一次提醒。
- 配置保存到 `data/settings.json`，适合免安装便携使用。
- 支持 Rive 角色资源：把角色文件放到 `public/assets/character.riv` 后重新构建即可。

## 开发

```powershell
npm install
npm run dev
```

## 验证

```powershell
npm run typecheck
npm test
npm run build
```

## 打包

```powershell
npm run package
```

打包产物默认在 `release/` 下生成 Windows x64 便携 exe。第一版仅面向 Windows 10/11 x64。

## Rive 角色约定

正式角色文件应命名为 `character.riv`，放在 `public/assets/`。推荐提供以下状态机或动画名：

- `idle`
- `eyeAlert`
- `walkAlert`
- `combinedAlert`
- `success`

如果没有该文件，应用会自动使用内置 CSS 占位小人物，提醒流程仍然可用。

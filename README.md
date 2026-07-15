# Codex Companion

Codex Companion 是一个常驻 Windows 与 macOS 桌面的 Codex 用量小宠物。它通过本机 Codex app-server 展示通用 5 小时额度、每周额度和今日 Token，不需要 API Key。

默认界面只保留宠物与配套的 5h 能量槽；鼠标悬停后显示双圆环额度仪表和今日 Token。可以在小狐、陨石边牧、大橘猫与字节跳跳之间切换，宠物会根据 5h 剩余额度自动进入五种状态；仅在 5h 数据缺失时回退到 weekly：

- 80–100%：活力满满
- 60–80%：专注工作
- 40–60%：观察额度
- 10–40%：紧张提醒
- 0–10%：休眠耗尽

## 宠物与状态

<p align="center">
  <img src="assets/pet-cat1.png" width="49%" alt="大橘猫状态设计稿 1" />
  <img src="assets/pet-cat2.png" width="49%" alt="大橘猫状态设计稿 2" />
</p>

<p align="center">
  <img src="assets/pet-dog1.png" width="49%" alt="陨石边牧状态设计稿 1" />
  <img src="assets/pet-dog2.png" width="49%" alt="陨石边牧状态设计稿 2" />
</p>

<p align="center">
  <img src="src/renderer/assets/pets/bytepop-energized.png" width="30%" alt="字节跳跳活力状态" />
  <img src="src/renderer/assets/pets/bytepop-focused.png" width="30%" alt="字节跳跳专注状态" />
  <img src="src/renderer/assets/pets/bytepop-checking.png" width="30%" alt="字节跳跳关注额度状态" />
</p>

<p align="center">
  <img src="src/renderer/assets/pets/bytepop-worried.png" width="36%" alt="字节跳跳配额告急状态" />
  <img src="src/renderer/assets/pets/bytepop-sleepy.png" width="36%" alt="字节跳跳电量耗尽状态" />
</p>

### 字节跳跳 BytePop

字节跳跳会沿用应用现有的五档 5h 额度阈值切换动作：

| 5h 剩余额度 | 状态 | 字节跳跳形态 |
| --- | --- | --- |
| 80–100% | 活力满满 | 跃动挥手 |
| 60–80% | 专注工作 | 使用电脑编码 |
| 40–60% | 观察额度 | 思考并关注变化 |
| 10–40% | 紧张提醒 | 抱住低电量面板 |
| 0–10% | 休眠耗尽 | 疲惫趴下休息 |

点击悬浮宠物右上角的切换按钮可以依次切换形象，也可以在 Windows 托盘或 macOS 菜单栏的“切换宠物”菜单中直接选择字节跳跳。选择结果会自动保存。

## 功能

- 通用 Codex 5 小时与每周剩余额度
- 今日 Token 使用量
- 小狐、陨石边牧、大橘猫、字节跳跳四种形象
- 五档额度状态与配套表情、动作、颜色
- 透明置顶、拖动、Windows 托盘/macOS 菜单栏驻留、开机启动与实时刷新
- 本机读取，无需 API Key

## 开发

需要 Node.js 20 或更高版本。

```shell
npm ci
npm start
```

运行测试：

```shell
npm test
```

构建当前平台的安装包，或显式构建指定平台：

```shell
npm run dist
npm run dist:mac
npm run dist:win
```

`npm run dist:mac` 会生成两个独立安装包：

- `release/Codex-Companion-2.2.0-mac-arm64.dmg`：Apple Silicon（M 系列）
- `release/Codex-Companion-2.2.0-mac-x64.dmg`：Intel Mac

`npm run dist:win` 会生成 Windows x64 安装包：

- `release/Codex Companion Setup 2.2.0.exe`

如需仅生成未封装的应用目录，可使用 `npm run pack:mac` 或 `npm run pack:win`。`npm run icon` 会从 SVG 跨平台重新生成 1024×1024 应用图标，以及适配 macOS 明暗菜单栏的 16×16/32×32 Template Image。

## macOS 安装与使用

打开与 Mac 架构匹配的 DMG，将 Codex Companion 拖到 Applications。当前产物用于本地安装，未使用 Apple Developer ID 签名或公证；若首次打开被 macOS 阻止，请在 Finder 中按住 Control 点击应用、选择“打开”，或前往“系统设置 → 隐私与安全性”确认打开。

macOS 版本以菜单栏应用运行，不显示 Dock 图标，悬浮宠物会同时显示在所有普通桌面与全屏 Space 中。点击菜单栏图标可以显示或隐藏宠物、刷新数据、设置置顶与登录启动、切换宠物或退出。

应用会依次查找 `CODEX_EXECUTABLE`、`~/.local/bin/codex`、Codex standalone 安装目录、Homebrew/npm 常见目录，以及 ChatGPT/Codex 应用包内的 Codex。若额度一直显示为不可用，请先确认终端中 `codex --version` 可运行，并已登录 Codex。

## Windows 安装与使用

运行 `Codex Companion Setup 2.2.0.exe` 完成安装。应用关闭窗口后会继续驻留系统托盘，可通过托盘菜单重新显示宠物、刷新额度、切换宠物、设置置顶或登录启动，也可以从托盘菜单彻底退出。

## 数据与隐私

额度通过本机官方 `codex app-server` 的 `account/rateLimits/read` 获取，并固定使用通用 `limitId = "codex"`；Spark 独立额度不会混入。今日 Token 优先读取账户当日档，必要时使用本机会话事件补齐。

自动刷新会保留最后一次可信的实时额度。短暂超时、旧窗口响应或并发刷新不会再用历史 JSONL 快照覆盖当前正确数值；只有实时额度持续不可用时才回退到本地记录。

Codex Companion 不读取或保存登录令牌，也不保留提示词、回复内容或文件内容。Codex 可执行文件与登录信息不会被打入安装包。

## License

[MIT](LICENSE)

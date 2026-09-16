# 装成常驻服务（macOS 示例）

想让 Readyroom 像系统服务一样随登录启动、进程退出自动拉起，用一个用户级 LaunchAgent 即可。下面是可直接套用的模板，把 `&lt;PROJECT&gt;` / `&lt;HOME&gt;` 换成你自己的路径。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.readyroom</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>--unhandled-rejections=strict</string>
    <string>--import</string>
    <string>&lt;PROJECT&gt;/scripts/service-lifecycle.mjs</string>
    <string>&lt;PROJECT&gt;/server/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>&lt;PROJECT&gt;</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key><string>production</string>
    <key>OFFICE_PORT</key><string>4317</string>
    <key>OFFICE_DATA_DIR</key><string>&lt;PROJECT&gt;/.office-data</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ExitTimeOut</key><integer>15</integer>
  <key>AbandonProcessGroup</key><false/>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>&lt;HOME&gt;/Library/Logs/Readyroom/stdout.log</string>
  <key>StandardErrorPath</key><string>&lt;HOME&gt;/Library/Logs/Readyroom/stderr.log</string>
</dict>
</plist>
```

安装与常用操作（`$(id -u)` 是当前用户 UID）：

```bash
mkdir -p ~/Library/Logs/Readyroom && chmod 700 ~/Library/Logs/Readyroom
cp local.readyroom.plist ~/Library/LaunchAgents/
plutil -lint ~/Library/LaunchAgents/local.readyroom.plist      # 先校验语法
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.readyroom.plist

# 状态（只看必要字段，避免打印宿主环境变量）
launchctl print gui/$(id -u)/local.readyroom | grep -E '^\s*(state|pid|runs|last exit code) '

# 只重启进程（管理器会重新拉起）
launchctl kill SIGTERM gui/$(id -u)/local.readyroom

# 停止并取消托管（仅杀 PID 会被自动拉起）
launchctl bootout gui/$(id -u)/local.readyroom
```

`scripts/service-lifecycle.mjs` 会把启动 PID、收到的信号与退出码写成一行 JSON 到日志；未捕获异常继续失败退出并记录，不吞掉错误。日志目录建议 700、文件 600。

## 更新流程

- **只改前端**：`npm run build` 后刷新浏览器。服务对 HTML 发 `no-store`、对 `dist/assets/*` 哈希文件发 `immutable`，普通刷新就能拿到新版本。
- **改了后端**：先确认没有活动任务（`GET /api/bootstrap` 里没有 `running/queued` 的成员），再 `launchctl kill SIGTERM`。
- 服务重启会把未结束的任务标记为中断，**不会自动重跑**，需要显式继续或重试。

## 环境变量

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `OFFICE_PORT` | HTTP 端口 | `4317` |
| `OFFICE_DATA_DIR` | 会话/项目数据目录 | `<项目>/.office-data` |
| `OFFICE_MAX_SESSIONS` / `OFFICE_MAX_WORKERS` / `OFFICE_MAX_BOSSES` | 全局活跃会话 / 每目标执行成员 / 活跃老板上限 | `6` / `3` / `2` |
| `OFFICE_CODEX_BIN` / `OFFICE_CODEX_WEB_SEARCH` | Codex 可执行文件、联网搜索模式 | 项目内 `node_modules/.bin/codex`、`live` |
| `OFFICE_ZCODE_BIN` / `OFFICE_ZCODE_CONFIG` | ZCode 程序与配置路径 | `/Applications/ZCode.app/.../zcode.cjs`、`~/.zcode/v2/config.json` |
| `OFFICE_EDGE0_URL` / `OFFICE_EDGE0_MAX_TOKENS` / `OFFICE_EDGE0_HISTORY_MESSAGES` | 本机 Edge0 服务地址、单轮上限、携带历史消息条数 | `http://127.0.0.1:8000`、`2048`、`12` |
| `OFFICE_EDGE0_PYTHON` / `OFFICE_EDGE0_CONTROL` | Edge0 未启动时自动拉起用的解释器与脚本；留空则不自动拉起 | 空 |
| `OFFICE_DSH_BIN` / `OFFICE_DSH_PROFILE` / `OFFICE_DSH_PERMISSION_MODE` / `OFFICE_DSH_PATCH` | DSH 可执行文件、profile、权限模式与自定义覆盖补丁 | 自动探测 `dsh`、`acp`、空、空 |

## 排障

- plist 里写死了 Node 路径、项目路径与日志路径；移动项目或换 Node 版本后要同步修改并 `bootout` + `bootstrap`。
- 用户级服务在退出登录/关机期间不运行，睡眠期间也不保证响应。
- `SIGKILL` / 系统强杀无法由 JS 写退出日志；结合 `launchctl print` 的退出结果与下一条启动日志判断。
- DSH 侧有个已知坑：`~/.dsh/cordis.patch.yml`（home 层）会作用于所有 profile，但客户端皮肤只装在桌面/网页 profile，会让 `dsh --profile acp` 启动即 `ERR_MODULE_NOT_FOUND`。桥接会在拉起子进程时生成只读覆盖补丁禁用这些客户端 UI 行，不改动用户文件；详见 [DSH 运行环境](dsh-runtime.md)。
- 端口被占用时服务会以退出码 1 结束并写入 stderr；先确认没有另一个 `npm start` / `npm run dev` 在跑。

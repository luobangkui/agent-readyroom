# 接入 Kimi 运行环境 + Windows 适配（变更说明）

> 提交：`40bb3c9`（main，已推送）· 24 个文件，+1358 / −111
> 测试：283 项全部通过（基线 245 项在 Windows 下有 18 项失败）

## 一句话总结

待命室新增第四个运行环境 **Kimi Code CLI**（`kimi acp`，ACP 协议），与 Codex / ZCode / DSH 平级、按岗位混用；同时完成了 Windows 平台的完整适配。运行环境桥接层现在是操作系统无关的。

## Kimi 运行环境接入

- **`server/kimi.js`（新增）**：Kimi Code CLI 的 ACP v1 桥接（stdio 上按行分隔的 JSON-RPC）。覆盖：握手与登录态探针、实时模型目录学习、模型/思考档位/执行模式选择、待命室 MCP 协作工具挂载、授权卡（`session/request_permission` → 仅本次允许/拒绝）、中断（`session/cancel`）、会话恢复（恢复失败自动新建并在任务日志留痕）。
- **凭证不落地**：项目不带任何密钥。Kimi 的登录态由 CLI 自己管理——终端跑一次 `kimi login`，或配置 `~/.kimi-code/config.toml` / `KIMI_MODEL_*` 环境变量；二进制位置可用 `OFFICE_KIMI_BIN` 覆盖。
- **项目自带运行时**：`@moonshot-ai/kimi-code@2.0.0` 作为 npm 依赖（与 `@openai/codex` 同一模式，不动全局安装）；其入口是纯 JS，直接用当前 Node 运行，天然跨平台。
- **执行模式映射**：只读目标（先出方案）→ ACP `plan` 模式；协作交付 → `yolo`；默认 → `default`（敏感操作弹授权卡）。思考档位 off/on 两档映射待命室的 effort。
- **接线**：`server/runtimes.js`（路由、登录提示、`kreq_` 授权前缀）、`server/missions.js`（ACP 提供方判定）、`server/index.js`（桥接注册）、`src/main.js` + `index.html`（连接指示、「Kimi」模型分组、重建连接提示）。

## Windows 适配

| 问题 | 影响 | 修复 |
| --- | --- | --- |
| `scopePath` 落库为 `src\a`（反斜杠），而范围包含/冲突判断按 `/` 比较 | Windows 下拆分子任务被误判「超出父工作单」、并行调度失败 | 范围路径统一 POSIX 形态落库（`server/collaboration.js`） |
| 文档预览拒绝一切含 `\` 的路径 | Windows 下绝对路径预览 400 | 相对路径保持 POSIX 约定；本机绝对路径按平台原样解析；返回的 `path` 字段统一 POSIX（`server/documents.js`） |
| `process.getuid()` 不存在于 Windows | `restart-service.mjs` 直接崩溃 | launchd 分支仅 macOS 执行，其他平台跳过服务信号 |
| `process.exit` 撞上 undici 句柄关闭 | 触发 libuv 断言 0xC0000409，退出码丢失 | 统一 `settleExit`：先置 `exitCode`，延迟硬退出兜底 |
| npm CLI 的 `.bin` 垫片在 Windows 是 `.cmd`，直接 spawn 报 EINVAL | Codex/DSH 子进程起不来 | `server/cli.js` 统一解析与启动（`.cmd` 走 shell 包装，`.exe`/无扩展名直启） |
| `--import` 不接受裸盘符路径 | service-lifecycle 测试全挂 | 改传 `file://` URL |
| Windows 无开发者模式不能建文件符号链接 | 5 个测试 EPERM | 目录链接改用 junction（免特权、realpath 行为等价）；文件符号链接用例自动跳过 |

## 平台无关设计（agent 接入与 OS 无关）

二进制解析顺序对所有运行环境一致：`OFFICE_*_BIN` 环境变量 → 项目自带 npm 包 → 平台默认安装位置（Kimi：Win `%USERPROFILE%\.kimi-code\bin\kimi.exe`，mac/Linux `~/.kimi-code/bin/kimi`）→ PATH。桥接协议（ACP/JSON-RPC over stdio）本身与操作系统无关。

## 验证证据

- **真实冒烟** `node scripts/check-kimi-acp.mjs`（新增）：真实 kimi 进程完成 ACP 握手 → 模型目录（k2d8-preview / k3-agent / k3-agent-swarm）→ 待命室 MCP 被 kimi 真实拉起（marker 文件证据）→ 一轮极小模型轮次正常收尾。过程中发现并修复了 kimi 侧 `session/close` 与新会话的异步竞态（桥接已串行化探针关闭）。
- **单元测试** `test/kimi.test.js`（新增 9 项）：路径解析矩阵（env/项目模块/Win/mac 候选/PATH）、模型与模式选择、MCP 透传、授权卡映射、恢复兜底、中断、OfficeRuntimes 路由。
- **全量**：283 项通过、0 失败（Windows 实测）；`npm run build` 通过；浏览器实测连接指示「Kimi 已连接」、新建目标表单的岗位模型下拉出现 Kimi 分组。

## 使用

```bash
npm install && npm run build && npm start   # → http://127.0.0.1:4317/
kimi login                                  # 首次使用先登录（一次性）
```

打开页面后 Kimi 运行环境约 15 秒内自动上线；创建目标时为每个岗位单独选 Kimi 模型即可，四个运行环境可混用。

## 已知边界

- `kimi acp` 与 DSH 一样只上报已提交消息与工具生命周期，没有逐字增量，也不支持轮中 steer（轮中补充会明确拒绝）。
- `KIMI_MODEL_*` 环境注入的部署只有一个伪模型槽位（`__kimi_env_model__`），桥接会把其 `name` 映射回真实模型 id；OAuth 登录的部署不受影响。
- macOS 常驻服务脚本（launchd）不适用 Windows；Windows 直接重启进程即可。

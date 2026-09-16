# DSH 运行环境：把 DeepSeek Harness 接进待命室

## 目标与边界

让四个固定岗位在按岗位选择模型时，除了云端 Codex / ZCode 和纯对话的本机 Edge0，还可以选 DeepSeek Harness（`dsh`）的模型，尤其是 **DeepSeek-V41-Flash**（`deepseek-flash`）。DSH 成员要有真实文件、命令、搜索能力，并继续使用待命室的 `office_*` 协作工具、调度、范围锁、证据与审批流程；不新增第二套调度，不改动 Codex / ZCode / Edge0 现有行为。

不在本次范围：把 DSH 的 Web/TUI 界面嵌进工作台、多 harness 实例隔离、harness 侧的计费统计、DSH 的会话标题与计划面板。

## 候选方案

1. 一轮一个 `dsh --profile headless "<任务>"`：实现最简单，但每次拉起进程、无多轮会话、无中途事件、无法审批，也不方便挂 MCP。放弃。
2. **`dsh --profile acp`（采用）**：官方 ACP v1 自动化面，stdio 上的 JSON-RPC，一个常驻进程承载多会话，支持 `session/new`、`session/resume`、`session/close`、`session/set_config_option`、`session/prompt`、`session/cancel`，以及 stdio/HTTP MCP 声明和 `session/request_permission` 审批。与既有 ZCode 桥接同构。
3. 直接内嵌 `@deepseek-ai/dsh-*` 包当库用：耦合内部 API、升级易碎，且要自己装配插件树。放弃。

## 协议映射

| 待命室 App Server | ACP v1 | 说明 |
| --- | --- | --- |
| `account/read` | `initialize` 结果 | 握手成功即视为已连接 |
| `model/list` | 静态目录 ∪ 会话 `configOptions` | 会话一建立就把实时目录并回列表 |
| `thread/start` | `session/new` + `session/set_config_option` | 会话工作目录即 ACP `cwd`；待命室 MCP 作为 `mcpServers` 声明 |
| `thread/resume` | `session/resume` | 失败（会话被清理或目录变化）时新建会话并在执行记录说明 |
| `thread/name/set` | — | ACP 无标题面，直接忽略 |
| `turn/start` | `session/prompt` | 立即返回轮次 ID，结算后再发 `turn/completed` |
| `turn/interrupt` | `session/cancel` | `stopReason: cancelled` 映射为 `interrupted` |
| `turn/steer` | — | ACP 每会话只允许一个在途提示，明确拒绝而不是静默丢弃 |
| `item/agentMessage/delta` | `agent_message_chunk` | ACP 上报已提交消息，通常整段到达 |
| `item/started` / `item/completed` | `tool_call` / `tool_call_update` | `kind` 决定命令、文件还是协作工具事件 |
| `thread/tokenUsage/updated` | `usage_update` | 上下文占用作为总量上报 |
| 审批卡 | `session/request_permission` | 允许/拒绝映射回 `allow-once` / `reject-once` |

会话 ID 加 `dsh:` 前缀放进待命室线程 ID；桥接按前缀与 `deepseek-` 模型名路由，旧会话缺少 `provider` 字段时也能回到正确运行环境。

## 模型与权限

- 模型选择用 `session/set_config_option`（`configId: model`，值为 `["deepseek-official", "<model>"]` 的 JSON 串），选择失败直接让成员启动失败并显示原因，不静默替换模型。
- 思考深度按 Codex 名称映射到 harness 的 `off/low/high/max`，模型未提供该选项时保留自身默认值。
- harness 默认 `workspace-write + ask`：工作区内写入直接执行，越界写入和高风险命令走待命室审批卡。`OFFICE_DSH_PERMISSION_MODE=danger-full-access` 可切到与 Codex 完全执行岗位一致的 `never`，属于部署级显式选择。

## 已知环境坑

`~/.dsh/cordis.patch.yml` 是 home 层补丁，会作用于所有 profile，而 dsh 皮肤只装在桌面/网页 profile 的 `node_modules` 里。结果是 `dsh --profile acp`（以及 headless/sdk）在启动时因 `ERR_MODULE_NOT_FOUND` 直接失败，连 `initialize` 都过不去。桥接的做法：启动子进程前读取该文件，生成一个临时覆盖补丁把其中的客户端 UI 行 `disabled: true`，通过 `--patch` 传入；用户文件保持原样，换肤后下次启动自动跟随。其他无法解析的 home 行不做静默禁用，仍然继续报错，避免悄悄改变运行环境。

## 验证

- `test/dsh.test.js`：假 ACP 服务覆盖模型目录、模型/深度选择、MCP 声明、消息与工具事件、用量、中断、审批往返、会话恢复回退、路由，以及经 `MissionService` 的一次完整对话。
- `node scripts/check-dsh-acp.mjs`：真实 `dsh --profile acp` + 真实待命室 MCP 服务（记录被拉起）+ 一次极小模型轮次。
- `node scripts/check-dsh-mission.mjs`：真实调度器在临时数据目录跑通一次 DSH 对话，验证连接、按岗位模型、线程、轮次与交付状态。
- 本机实测：连接、模型目录与四个 provider 并列，`deepseek-flash → DeepSeek-V41-Flash（DSH）`；一次自检轮次回复正常，用量约 12k tokens（含岗位合同与工具 schema）。

## 限制与回退

- ACP 只给已提交消息，界面没有逐字打字效果；也没有计划、标题、命令面板等 DSH 自有呈现。
- 审批是部署级策略，不是按岗位差异化；DSH 成员无法像 Codex 那样用 `sandbox` 参数切换只读/可写。
- 恢复依赖 harness 自己的会话存储；被清理后待命室会新建会话，上下文由本轮任务描述重建。
- 回退只需不选 DSH 模型：`server/runtimes.js` 里去掉 `dsh` 后端即可，其余运行环境和历史会话不受影响。

# Codex Office：从场景到可执行工作台

## 目标与边界
用户在待命室下发目标、选目录和工作模式；看到真实协作消息、计划、工具执行、审批、文件变更与结果；可在执行中补充指令或停止。3D 角色由真实运行状态驱动。

本版本只在本机运行，复用 Codex 登录。任务在选定目录执行；默认使用本项目的 workspace 练习目录。不开远程端口，不自动发布、推送或外发消息。

## 候选方案
1. `codex exec --json`：简单，适合批处理，但主动补充指令和互动审批较弱。
2. Codex SDK：方便包装任务，丰富客户端事件和审批需要额外实现。
3. **Codex App Server（选用）**：stdio JSON-RPC，自带会话、流式事件、turn/steer、中断和审批；实验性动态工具实现可见的委派合同。

实际协议取自本机 项目内 codex-cli 0.153.4 生成的 JSON Schema。

## 工作方式
- 直接执行：一个员工负责从理解到验证，小任务不强行拆分。
- 协作交付：老板是协调者，使用显式委派工具；执行员工完成产物，检查员工独立验收；调研可并行。
- 先出方案：只读目录，先给方案，用户追问后仍保持只读，避免模式与权限悄悄改变。
- 默认 GPT-6 Astra + high；模型和可用推理强度从本机 model/list 读取，不静默替换模型。
- 每个任务最多 3 个同时活跃的执行成员；全局最多 2 位老板和 6 个活跃会话，为员工保留执行名额；共享目录只允许 1 个写入者，其他写任务排队，检查等依赖通过任务依赖显式串联；检查期间暂停该目录的写入。
- 所有 Agent 共享目标和必要成果，委派上下文限定到具体子任务；模型可重用已有员工继续修改。

## 领域模型与状态
Mission 含用户目标、目录、模式、模型、成员、消息、计划、审批和产物。Agent 对应一个 Codex thread，Turn 是一轮执行。Subtask 通过依赖组织，运行状态为 queued / running / waiting / completed / failed / stopped。

Mission 在成员工作未完成时不能标记交付。老板过早结束时，等待成员结束再自动唤醒老板汇总（次数受限）。执行失败和服务中断保留记录，重启后标记已中断，用户可继续已有会话。

计划进度是完成步骤数 / 总步骤数；没有模型计划时显示当前阶段和运行时长。模型的最终回复与用户验收分开。

## 模块与数据流
浏览器 → 本机 HTTP API → MissionService → CodexBridge → codex app-server。
App Server 通知和 office_plan → 更新任务快照 / 消息 / 活动 → SSE → 任务面板和 3D 场景。
动态工具 → 委派 / 等待 / 员工消息；工具响应仍走同一 JSON-RPC。
审批请求 → 待处理事项 → 人类单次授权 / 拒绝 → 原请求响应。

## 持久化、边界与风险
任务和可读事件写入本地 .office-data，采用临时文件原子替换，凭证由 Codex 自己管理。HTTP 绑定 127.0.0.1，核验 Host / Origin，写接口校验每次启动产生的令牌；命令参数通过 spawn 数组传递。App Server 失连不自动重放写操作。
GPT-5.6 Sol 与 GPT-6 Astra 在非 plan 任务中使用 `danger-full-access` + `approval_policy=never`，对应 Codex 的完整权限模式；GLM 角色继续使用受限沙箱与人工审批。plan 模式始终保持 read-only。重启后不自动恢复执行，防止重复变更。
实验性动态工具通过本机 schema 和真实任务验证；协议升级需要重跑集成测试。

## 参考
- https://learn.chatgpt.com/docs/app-server
- https://developers.openai.com/api/docs/guides/latest-model

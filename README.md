# Readyroom · 待命室

> 一间跑在本机的 3D 待命室：四个固定岗位的 AI 成员坐在同一间屋子里干活。规划者把目标拆成**无环任务图**，程序按输入就绪**并行派发**，产出必须留下**可复现证据**，再由另一位成员**独立复核**。

**English** — Readyroom is a local, single-machine 3D workbench where a fixed four-role AI crew (plan / contract / build / verify) shares one room, turns a goal into an acyclic task graph, and works it in parallel under scope locks, staged contracts, independent review and evidence gates. It drives Codex, ZCode, DeepSeek Harness (DSH) or a local Edge0 model, one runtime per role. UI, prompts and docs are in Chinese.

![Readyroom 工作台：木叶庭院主题下的四个工位](docs/images/readyroom-workbench.jpg)

## 亮点

- **无环任务图（DAG）**：显式依赖与阶段契约依赖合成同一张图，提交和运行时拆分都会先复查环，发现环就带出环路并原子拒绝；调度器与界面共用同一份图实现。
- **运行时可拆分**：成员发现手头工作其实是多件事，用 `office_split` 当场拆成 2–12 个并行子任务并立刻释放席位；父工作单保留为**汇总代次**，子任务结束后回来对原验收条件负责，下游无需改指向。
- **回调通知而不是轮询**：`office_watch` 订阅 `work.settled` / `artifact.validated` / `member.idle` 等事件，先落可靠收件箱，空闲的订阅者会被一张真实回调工作单唤醒。
- **范围锁与资源预约**：工作单声明读写范围，纯读并行、重叠读写等待；端口、浏览器、构建等按实体预约容量。不声明范围则保守锁住整个目录。
- **阶段契约**：`office_publish` snapshots 一个带 SHA-256 的不可变版本，`office_validate` 要求非作者独立验证；消费者按 `name:version` 消费快照，接口就绪即可开工，不必等作者整轮结束。
- **证据与独立复核**：每份工作单用 `office_report` 逐条对应验收条件提交检查证据；写入成果必须由另一位成员只读复核，作者不能自审，改动会让旧复核失效。
- **关键路径优先的派发**：候选排序 = 优先级 + 下游最长链 + 续接奖励 + 等待时长；一轮调度把就绪工作同时派给所有空闲且岗位匹配的成员。
- **四个运行环境，按岗位选模型**：Codex、ZCode、DSH（DeepSeek Harness）、本机 Edge0 可混用，创建目标时为每个岗位单独指定。
- **3D 场景就是状态**：人物走动、落座、交流、气泡都来自真实事件；暂停动画不影响模型任务。
- **全部本机**：只监听 `127.0.0.1`，校验 Host/Origin 与会话令牌；数据落在 `.office-data/`（不入 Git），模型凭证始终由各运行环境自己管理。

## 快速开始

需要 **Node ≥ 20**（实测 v24），macOS 或 Linux。

```bash
npm install
npm run build
npm start            # → http://127.0.0.1:4317/
```

开发时用 `npm run dev`（前端热更新，改后端需重启进程）。

第一次打开先「添加项目目录」，再新建目标或对话。至少要让一个运行环境可用：

| 运行环境 | 前置条件 | 能力 |
| --- | --- | --- |
| **Codex** | 本机 Codex 登录（`npx codex login`）；项目自带 `@openai/codex 0.153.4`，不动全局 | 文件、命令、网络，四个岗位通用 |
| **ZCode** | ZCode 中已配置 GLM 提供方 | 同上 |
| **DSH**（DeepSeek Harness） | 本机 `dsh` 可用并已登录 | 同上；默认工作区可写、敏感操作弹出授权卡 |
| **Edge0** | 本机 `127.0.0.1:8000` 的 OpenAI 兼容服务 | 纯对话：不读写文件、不执行命令、不联网 |

模型目录来自各运行环境的实时列表，界面里按 `运行环境` 分组显示，不会静默替换你选的模型。

## 使用

1. 左侧「添加项目目录」选择或输入目录；同一真实目录只会有一个项目。
2. 在项目下点「＋ 目标」或「＋ 对话」：为目标四个岗位各选人物与模型，填目标、验收要求、工作方式；对话只创建一个项目助手会话，发送第一条消息才调用模型。
3. 观察成员与产出：「任务图」看依赖与批次，「工作计划」看分工、范围、复核与验收缺项，「执行记录」看命令与工具，「文件」看差异与产物。
4. 执行中可以直接追加要求（发给老板或指定成员，Cmd/Ctrl + Enter）；成员已在跑就实时送入本轮，已结束就变成它的一张新工作单。
5. 需要你决策或授权时会出现在「需要你处理」，授权只对当次操作生效。
6. 结束后可继续对话，或点「确认验收」；历史会话可「归档」并在左侧恢复。

## 三种工作方式

| 方式 | 执行方式 | 文件权限 |
| --- | --- | --- |
| 协作交付 | 简单工作直接执行；复杂工作提交输入/交付物依赖图，程序调度并独立验收 | 四个岗位完全执行（文件、命令、网络），仍以用户授权范围为准 |
| 直接执行 | 一位员工处理小任务，从理解到验证 | 选定目录可写 |
| 先出方案 | 只读分析，交付计划 | 只读，后续追问不变更权限 |

默认每个目标最多 3 个活跃执行成员、全局最多 6 个活跃会话、最多 2 位老板；可用 `OFFICE_MAX_WORKERS` / `OFFICE_MAX_SESSIONS` / `OFFICE_MAX_BOSSES` 调整。

## 协作是怎么跑的

- 规划者用 `office_submit_graph` 一次提交交付物依赖图：需要什么输入、允许改什么、怎样验收、要预约什么资源。等待输入的工作单不占人物席位。
- 空闲且岗位匹配的成员自动领取就绪工作单；程序在完成、发布、验证事件后重新调度，不需要逐人唤醒，也不需要整批等待。
- **拆分**：`office_split` 把当前工作单拆成并行子任务（子任务范围不得超出父工作单已批准范围，深度 ≤3 层，`requestId` 幂等）；父工作单随后作为汇总代次重新被领取。
- **回调**：`office_watch` / `office_unwatch` 订阅事件（工作单 key、`name:version`、成员 ID 或 `*`），事件先落收件箱，`wake` 打开时再开一张回调工作单把空闲订阅者唤醒。
- **挂起与恢复**：缺输入时用 `office_suspend` 存检查点并立刻结束本轮，真实轮次结束后释放席位，输入就绪自动恢复；失败不会自动重试，核查外部副作用后用 `office_retry`（最多两次）。
- **消息**：`office_message` 先落可靠收件箱再尝试实时投递，`office_inbox` 读取并确认；`office_team` 是带 revision 的共享看板。
- **任务图视图**：工作计划页顶部按拓扑批次分列，标出每批可并行项数、关键路径（加粗）、契约依赖（虚线）、领取人与等待原因，以及拆分/回调/复核/高优先级徽标。

## 交付与验收

- `office_report` 的 checks 用 `criterion` 对应 acceptance 的零起始编号；没执行写 `not_run`，失败写 `failed`，不能为通过而写 `passed`。
- 写入成果需要另一位成员的只读 `reviewOf` 复核；复核后文件再被修改，复核标记过期。修复用 `replaces` 保留旧记录。
- 缺证据最多自动补全两轮，仍不满足就标为待处理，不会把未验证说成已交付。
- 工作单越界写入、超时、范围/资源/模型/工具等待都会记录在工作计划里；计时不代表模型计费金额，也不把并行耗时相加当总耗时。

## 界面与 3D 场景

- 右上角切换主题（暖木待命室 / 木叶忍者 / 木叶庭院），即时替换人物服饰、场景装饰、材质与灯光，保留位置与动作。
- 待命室是 4 个面对面工位加休闲区，人物沿通道走动：闲置时坐姿休息与短休，偶尔散步、喝咖啡、看窗外；真实任务与待答复事项优先。
- 行走会绕开其他人的占座保护区，堵塞时停等重规划；坐下、起身、回程按动作衔接。
- 「最大化」铺满窗口（Esc 还原），「暂停动画」只暂停画面不影响任务，「回放交流」重放最近 6 条真实交流并明确标注为历史。
- 已结束或停止的任务可继续对话；停止、断线都不会把任务算作完成。

## 数据、隐私与边界

- 服务仅监听回环地址，校验 Host/Origin 与写入令牌；模型凭证由 Codex / ZCode / DSH 各自管理，不写入本项目。
- 目标与对话数据在 `.office-data/missions.json`、项目目录在 `.office-data/projects.json`，已加入 `.gitignore`。
- 文档预览只允许当前项目内的非敏感普通文件：拒绝越界路径、隐藏配置、密钥文件、外部符号链接；HTML 走净化内容与禁脚本沙箱，不自动加载外部资源；文本预览上限 512 KB，下载上限 50 MB。
- 范围锁与资源预约是**调度层约定**，不是操作系统级沙箱；请按岗位合同与你自己的审批判断风险。
- 历史目标不会补造依赖或证据；服务重启不会自动重放中断的模型任务。

## 目录结构

```
server/
  index.js            仅监听回环的 HTTP + SSE 服务（Host/Origin/令牌校验）
  missions.js         任务状态机、成员调度、消息、审批与持久化
  harness.js          任务图协议 v2：提交、拆分、领取、发布、验证、挂起、证据
  collaboration.js    工作单、读写范围与冲突判定、交付报告与质量门
  work-state.js       状态迁移与等待计时
  prompts.js          岗位合同与 office_* 工具 schema
  roster.js / projects.js / documents.js / artifacts.js
  codex.js / zcode.js / zcode-config.js / edge0.js / dsh.js    四个运行环境桥接
  office-mcp.mjs      以 stdio MCP 暴露协作工具（每会话独立令牌）
src/
  main.js             工作台界面与实时渲染
  office.js           程序化 3D 待命室、角色姿态与消息特效
  scene-director.js   真实状态 → 走位、朝向、气泡与历史回放
  work-graph.js       DAG 原语（分层、关键路径、环检测），前后端共用
  work-graph-view.js  工作计划页的任务图 SVG
  collaboration-panel.js / project-sidebar.js / document-preview.js
  themes/             主题、场景与角色资产
test/                 245 项 node:test 用例
scripts/              模型导入、场景构建与自检脚本
```

## 测试与自检

```bash
npm test                              # 调度、协作、任务图、桥接、预览等 245 项
npm run build                         # 生成 dist/ 静态前端
node scripts/check-collaboration-graph.mjs   # 真实调度器跑通「提交图 → 拆分 → 并行 → 回调 → 汇总」，输出 DAG 预览
node scripts/check-dsh-acp.mjs               # 真实 dsh 的 ACP 握手、模型目录与 MCP 挂载（含一次极小模型轮次）
node scripts/preview-harness.mjs             # 只读夹具：用真实调度器渲染工作计划页
```

## 文档

- [架构设计](docs/tech/codex-office.md) · [输入就绪调度](docs/tech/input-ready-harness.md) · [协作任务图](docs/tech/collaboration-graph.md) · [并行协作](docs/tech/parallel-collaboration.md)
- [DSH 运行环境](docs/tech/dsh-runtime.md) · [项目目录](docs/tech/project-workspaces.md) · [木叶庭院](docs/tech/konoha-courtyard.md) · [主题扩展](src/themes/README.md)
- [本机常驻服务（macOS）](docs/tech/local-service.md) · [协作任务图](docs/tech/collaboration-graph.md)

## 许可

- **代码**：[MIT](LICENSE)。`server/`、`src/`、`scripts/`、`test/` 与文档可以自由使用、修改、分发。
- **第三方素材不在 MIT 范围内**：`public/assets/`（含 `characters/custom/` 下的 Q 版角色模型与场景素材）属于第三方角色模型、贴图与概念图，来源、许可证与转换过程记录在 [ASSET-SOURCES.md](ASSET-SOURCES.md)，请按该文件说明当作本地学习用途对待，不要随代码一起再分发。公开快照不含原始导入文件（`assets/imports/`）与内部验收记录（`evidence/`）。
- 其余依赖（Three.js、marked、DOMPurify、Vite、`@openai/codex`）遵循各自上游许可证。

## 已知限制

- 本机单人使用：没有多用户、远程访问、Git worktree 隔离或自动合并。
- 范围与证据依赖成员如实声明和实际检查，不能当成沙箱或质量的数学保证。
- Codex 动态工具协议仍是实验性接口，升级运行环境后需要重跑集成检查。
- DSH 走 ACP：只上报已提交消息与工具生命周期，没有逐字增量，也不支持中途 steer。

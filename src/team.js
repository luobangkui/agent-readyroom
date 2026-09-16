export const TEAM=[
  {role:'boss',name:'可可',position:'目标规划与验收',shortPosition:'规划与验收',model:'gpt-5.6-sol',modelName:'GPT-5.6 Sol',provider:'codex',avatarId:'merchant',effort:'high',fullAccess:true,description:'确定目标与验收，提交交付物依赖图，处理异常决策和最终交付',contract:{scope:'负责目标、边界、交付协议、关键路径与最终验收；正常依赖检查交给程序调度。简单任务仍可直接实现和验证。',allowed:['需求澄清','任务图规划','接口验约','异常决策','直接实现简单任务','执行验证','最终验收'],forbidden:['同事执行期间同时修改共享目录','正常路径逐人轮询派单','未经授权对外发布或执行不可逆操作','以作者自述代替独立验证'],handoff:'按输入和交付物拆任务，提交图后结束无事可做的模型轮次；程序自动领取就绪任务，仅异常与最终汇总唤醒规划者。'}},
  {role:'tech',name:'小满',position:'契约与关键技术',shortPosition:'契约与技术',model:'gpt-6-astra',modelName:'GPT-6 Astra',provider:'codex',avatarId:'student',effort:'high',fullAccess:true,description:'提前固定接口契约、攻克关键技术、实现难点和独立高风险审查',contract:{scope:'技术负责人负责架构与契约、关键实现、复杂故障和高风险审查；契约可在实现结束前发布并经他人验证。',allowed:['接口定义与样例','架构设计','故障诊断','关键实现','风险审查','独立验证'],forbidden:['把本人结束作为所有下游的默认依赖','自审自己的产出','未经授权改变目标或对外发布'],handoff:'发布带版本、快照和证据的契约，独立验证后由调度器触发下游；等待输入时交出检查点并结束轮次。'}},
  {role:'builder',name:'夏禾',position:'实现与集成',shortPosition:'实现与集成',model:'GLM-5.3',modelName:'GLM-5.3',provider:'zcode',avatarId:'archer',effort:'high',fullAccess:true,description:'消费固定输入版本，实现功能、测试和受控集成',contract:{scope:'负责明确范围内的代码、配置、单元测试和集成；按已验证的契约开工，不必等待上游全部结束。',allowed:['代码实现','修复问题','编写测试','局部验证','受控集成','交付证据'],forbidden:['擅自覆盖已发布契约','自审自己的产出','未经授权发布或重放外部操作'],handoff:'提交修改、输入版本、实际检查与风险；作者与最终复核者分离，缺输入则保存检查点释放席位。'}},
  {role:'ops',name:'阿澄',position:'验证与资料支持',shortPosition:'验证与资料',model:'GLM-5.3-Flash',modelName:'GLM-5.3-Flash',provider:'zcode',avatarId:'ninja',effort:'low',fullAccess:true,description:'前置验收场景与测试准备、独立复现检查、资料和办公成果',contract:{scope:'提前准备测试场景和数据，独立验证可复现结果；保留资料、文档、表格、演示稿、浏览器和标准事务能力。',allowed:['测试准备','验收场景','复现验证','契约检查','资料整理','文档表格演示稿','浏览器操作'],forbidden:['自审自己的产出','用作者声称通过代替实际检查','代替技术负责人判断复杂架构安全风险','未经授权对外提交'],handoff:'输入就绪即领取，检查不通过返回证据；高风险技术问题交 tech，不必等整批实现结束才开始准备。'}}
];
export const teamRole=role=>({reviewer:'tech',researcher:'tech',solo:'builder'}[role]||role);
export const teamMember=role=>TEAM.find(member=>member.role===teamRole(role));
export const roleContract=role=>teamMember(role)?.contract||null;
// Role descriptions guide routing and handoff. Runtime permissions, rather
// than keyword matching in a task description, govern file operations.
export const teamCanWrite=(mode,role)=>mode!=='plan'&&['boss','tech','builder','ops'].includes(teamRole(role));
export const previewTeam=()=>TEAM.map(member=>({...member,id:`office-resident-${member.role}`,status:'idle',sceneOnly:true}));

import path from 'node:path';
import {existsSync,realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {transition} from './work-state.js';

const active=new Set(['queued','starting','running','waiting','waiting_input','ready','suspending','suspended']);
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const text=(value,label,max=4000)=>typeof value==='string'&&value.trim()&&value.length<=max?value.trim():fail(`${label}不能为空，且最多 ${max} 字。`);
const list=(value,label,max=32)=>Array.isArray(value)&&value.length<=max?value:fail(`${label}必须是最多 ${max} 项的列表。`);
const overlaps=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);

function canonical(file){
  if(existsSync(file))return realpathSync(file);
  const parent=path.dirname(file);return parent===file?file:path.join(canonical(parent),path.basename(file));
}
export function scopePath(cwd,value){
  const relative=text(value,'范围路径',1000);
  if(path.isAbsolute(relative)||/[\0*?\[\]{}\\]/.test(relative))fail('范围请使用项目相对文件或目录路径，不支持绝对路径、通配符或反斜杠。');
  const root=canonical(cwd),file=canonical(path.resolve(root,relative));
  if(file!==root&&!file.startsWith(root+path.sep))fail('范围路径不能越出项目目录（包括符号链接）。');
  // 范围一律存 POSIX 形态：调度器与界面的包含/重叠判断以 '/' 为准，
  // Windows 的 path.relative 会返回反斜杠，必须在落库前统一。
  return path.relative(root,file).split(path.sep).join('/')||'.';
}
export function normalizeScope(m,value,canWrite=true){
  if(value===undefined)return {readPaths:['.'],writePaths:canWrite&&m.mode!=='plan'?['.']:[]};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['readPaths','writePaths'].includes(k)))fail('范围必须包含 readPaths 和 writePaths。');
  const readPaths=[...new Set(list(value.readPaths,'读取范围').map(p=>scopePath(m.cwd,p)))],writePaths=[...new Set(list(value.writePaths,'写入范围').map(p=>scopePath(m.cwd,p)))];
  if(writePaths.length&&(!canWrite||m.mode==='plan'))fail('只读任务不能申请写入范围。');
  return {readPaths,writePaths};
}
export const workFor=(m,a)=>(m.workItems||[]).find(w=>w.id===a.workId);
// A work item holds no lock while its splitting turn drains: that turn only
// records the fan-out and ends, and the children's ranges are already inside the
// parent's approved range, so blocking the whole fan-out behind it would be a
// needless serialization. Everything else keeps its declared scope.
export function effectiveScope(m,a){
  if(m.harnessVersion&&a.role==='boss'&&a.coordinationOnly)return {readPaths:[],writePaths:[]};
  const work=workFor(m,a);
  if(work?.drain)return {readPaths:[],writePaths:[]};
  return normalizeScope(m,work?.scope,a.write);
}
// Same decision as scopesConflict, but it also returns *which* declared paths
// collide, so a scheduler wait can say what actually overlaps instead of leaving
// the reader to guess why two parallel-looking tasks are queued.
export function scopeOverlap(cwdA,scopeA,cwdB,scopeB){
  const abs=(cwd,paths)=>paths.map(p=>canonical(path.resolve(cwd,p)));
  const relative=(cwd,p)=>path.relative(canonical(cwd),p).split(path.sep).join('/')||'.';
  const ar=abs(cwdA,scopeA.readPaths),aw=abs(cwdA,scopeA.writePaths),br=abs(cwdB,scopeB.readPaths),bw=abs(cwdB,scopeB.writePaths),pairs=[];
  const collect=(xs,ys,side)=>{for(const x of xs)for(const y of ys)if(overlaps(x,y))pairs.push({path:relative(cwdA,x),other:relative(cwdB,y),side});};
  collect(aw,[...br,...bw],'write');
  collect(bw,ar,'read');
  return pairs;
}
export const scopesConflict=(cwdA,scopeA,cwdB,scopeB)=>scopeOverlap(cwdA,scopeA,cwdB,scopeB).length>0;
// One line the plan panel can show verbatim: the paths, and how to get
// parallelism back when two work items really did mean the same directory.
export function scopeConflictMessage(overlap){
  const paths=[...new Set(overlap.map(pair=>pair.path===pair.other?pair.path:`${pair.path} ↔ ${pair.other}`))];
  const shown=paths.slice(0,3).join('、'),rest=paths.length>3?` 等 ${paths.length} 处`:'';
  const sameDirectory=overlap.some(pair=>pair.path===pair.other);
  return `重叠路径：${shown}${rest}${sameDirectory?'；同一个目录无法判断内部是否真的冲突——需要并行就声明到文件级，需要排队就用 resources 表达容量':''}`;
}
// Submission-time advice: a directory claimed as a writable range by several
// work items turns the parallel graph into a queue, and the planner can still
// fix it cheaply right after submitting instead of discovering it in wait
// reasons later. Only identical directory declarations are reported: prefix
// overlaps are usually a real parent/child conflict.
export function sharedScopeAdvisory(works,{limit=3}={}){
  const counts=new Map();
  for(const work of works||[])for(const path of work?.scope?.writePaths||[])counts.set(path,(counts.get(path)||0)+1);
  const shared=[...counts].filter(([,count])=>count>1).sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])));
  if(!shared.length)return null;
  return {paths:shared.slice(0,limit).map(([path,workItems])=>({path,workItems})),total:shared.length,advice:'这些工作单把同一个目录声明为写入范围，程序无法判断目录内部是否真的冲突，只能让它们串行。要并行请把写入声明到具体文件或子目录；确实要共用同一实体（构建输出、临时目录、端口），用 resources 声明同名实体与 capacity，让排队出现在资源列而不是范围列。'};
}
export function workDependencies(m,a){
  const work=workFor(m,a);
  return work?work.dependsOn.map(id=>m.workItems.find(w=>w.id===id)||m.agents.find(x=>x.id===id)):(a.dependsOn||[]).map(id=>m.agents.find(x=>x.id===id));
}
export function makeWork(m,a,{task,scope,acceptance=[],reviewOf=[],replaces=null},dependencies=[]){
  const normalized=normalizeScope(m,scope,a.write),criteria=list(acceptance,'验收条件',12).map(v=>text(v,'验收条件',1000));
  const targets=[...new Set(list(reviewOf,'复核目标',12))].map(id=>{
    const w=m.workItems?.find(w=>w.id===id);if(!w||w.replacedBy)fail('复核目标必须是当前任务的有效工作单。');
    if(w.agentId===a.id)fail('成果作者不能独立复核自己的工作单。');
    if(w.status!=='completed')fail('请等待目标工作单结束后再安排最终复核。');
    if(w.reviewOf.length)fail('请复核原始成果，不对复核报告循环验收。');
    return w;
  });
  if(targets.length){
    if(normalized.writePaths.length)fail('独立复核必须保持只读；发现问题请交还作者修复。');
    for(const w of targets)for(const p of w.scope.writePaths)if(!normalized.readPaths.some(r=>r==='.'||p===r||p.startsWith(r+'/')))fail('复核读取范围必须覆盖目标成果的写入范围。');
  }
  const replaced=replaces?m.workItems?.find(w=>w.id===replaces):null;
  if(replaces&&(!replaced||replaced.agentId!==a.id||active.has(replaced.status)||replaced.replacedBy))fail('只能替代本成员已经结束的有效工作单。');
  if(replaced)for(const p of replaced.scope.writePaths)if(!normalized.writePaths.some(r=>r==='.'||p===r||p.startsWith(r+'/')))fail('修复范围必须覆盖被替代工作单的写入范围。');
  if((m.workItems?.length||0)>=200)fail('本目标已达到 200 个工作单，请拆分新的目标。');
  const work={id:`work_${randomUUID().slice(0,8)}`,agentId:a.id,role:a.role,task,scope:normalized,acceptance:criteria,dependsOn:dependencies.map(d=>d.id),reviewOf:targets.map(w=>w.id),replaces:replaced?.id||null,status:'queued',report:null,violations:[],createdAt:new Date().toISOString()};
  m.workItems??=[];m.workItems.push(work);a.workId=work.id;if(replaced)replaced.replacedBy=work.id;
  return work;
}
export function setWorkStatus(m,a,status){const w=workFor(m,a);if(w){if(w.protocol===2){transition(w,status);return;}w.status=status;if(!active.has(status))w.finishedAt=new Date().toISOString();}}
export function invalidateReviews(m,work){
  if(!work?.scope.writePaths.length)return;
  for(const review of m.workItems||[])if(review.status==='completed'&&review.reviewOf.length&&scopesConflict(m.cwd,work.scope,m.cwd,review.scope))review.stale=true;
}
export function recordReport(m,a,args){
  const work=args.workId?m.workItems?.find(w=>w.id===args.workId):workFor(m,a);
  if(!work||work.agentId!==a.id||work.replacedBy)fail('只能报告本人所属的有效工作单。');
  if(!['ready','blocked'].includes(args.verdict))fail('交付结论必须是 ready 或 blocked。');
  const checks=list(args.checks,'检查项',20).map(c=>{
    if(!c||!['passed','failed','not_run'].includes(c.result))fail('检查结果必须是 passed、failed 或 not_run。');
    if(c.criterion!==undefined&&(!Number.isInteger(c.criterion)||c.criterion<0||c.criterion>=work.acceptance.length))fail('检查项 criterion 必须对应本工作单验收条件的编号（从 0 开始）。');
    return {name:text(c.name,'检查名称',300),result:c.result,evidence:text(c.evidence,'检查证据',4000),...(c.criterion!==undefined?{criterion:c.criterion}:{})};
  });
  // A ready report whose checks all pass but whose criterion indexes miss some
  // acceptance item looks complete to its author, yet the graph gate stalls
  // every consumer on it forever. Unindexed checks never count toward
  // coverage, so reject the mismatch here with the exact missing indexes.
  if(args.verdict==='ready'&&checks.every(c=>c.result==='passed')){
    const missing=(work.acceptance||[]).map((criterion,index)=>checks.some(c=>c.criterion===index)?null:`criterion ${index}（${String(criterion).slice(0,60)}）`).filter(Boolean);
    if(missing.length)fail(`verdict 为 ready 且全部检查通过时，每条验收条件都必须有一条 criterion=编号 且 result=passed 的检查，未编号的检查不计入验收覆盖。缺少：${missing.join('、')}。请给对应检查补上 criterion（验收条件从 0 开始编号）后重新提交，或如实改判 blocked。`);
  }
  const report={summary:text(args.summary,'交付摘要'),artifacts:list(args.artifacts,'成果路径').map(p=>scopePath(m.cwd,p)),checks,risks:list(args.risks,'风险',20).map(r=>text(r,'风险',2000)),verdict:args.verdict,createdAt:new Date().toISOString()};
  work.report=report;for(const review of m.workItems)if(review.status==='completed'&&review.reviewOf.includes(work.id))review.stale=true;return work;
}
export function reportReady(w){return w.report?.verdict==='ready'&&w.report.checks.length>0&&w.report.checks.every(c=>c.result==='passed')&&(w.acceptance||[]).every((_,i)=>w.report.checks.some(c=>c.criterion===i&&c.result==='passed'))&&!w.violations?.length;}
const reviewableWork=m=>(m.workItems||[]).filter(w=>!w.replacedBy&&(!w.reviewOf.length||w.reviewOf.some(id=>!m.workItems.find(t=>t.id===id)?.replacedBy)));
// Evidence gaps on settled work only: problems a re-filed office_report or a
// fresh independent review can fix right now, ignoring anything still running.
export function evidenceIssues(m){
  const items=reviewableWork(m),ready=w=>w.status==='completed'&&reportReady(w),issues=[];
  for(const w of items){
    if(active.has(w.status)||w.status!=='completed')continue;
    if(!w.report){issues.push(`${w.id} 缺少 office_report 交付证据`);continue;}
    if(!ready(w))issues.push(`${w.id} 有阻塞、验收项未覆盖、检查未通过/未执行或范围越界`);
    for(const output of w.produces||[])if(!(m.artifactVersions||[]).some(v=>v.name===output.name&&v.version===output.version&&v.status==='validated'))issues.push(`${w.id} 的阶段成果 ${output.name}:${output.version} 尚未独立验证`);
    if(w.stale&&w.reviewOf.length)issues.push(`${w.id} 的复核后相关文件又有修改，需要重新复核`);
    if(w.scope.writePaths.length&&!items.some(r=>r.agentId!==w.agentId&&r.reviewOf.includes(w.id)&&!r.stale&&ready(r)))issues.push(`${w.id} 缺少另一成员通过的独立复核`);
  }
  return issues;
}
export function qualityIssues(m){
  const items=reviewableWork(m),issues=[];
  for(const w of items){
    if(active.has(w.status)){issues.push(`${w.id} 尚未结束`);continue;}
    if(w.status!=='completed'){issues.push(`${w.id} 未成功完成`);continue;}
  }
  return [...issues,...evidenceIssues(m)];
}
export function workContext(m,a){
  const work=workFor(m,a);if(!work)return '';
  const dependencies=work.dependsOn.map(id=>m.workItems.find(w=>w.id===id)||m.agents.find(a=>a.id===id)).filter(Boolean);
  const targets=work.reviewOf.map(id=>m.workItems.find(w=>w.id===id)).filter(Boolean);
  const brief=w=>({id:w.id,agentId:w.agentId||w.id,task:(w.task||'').slice(0,500),scope:w.scope,acceptance:w.acceptance,report:w.report?{...w.report,checks:w.report.checks.map(c=>({...c,evidence:c.evidence.slice(0,1200)}))}:null,...(!w.report?{result:(w.result||'').slice(0,6000)}:{})});
  const {task,report,result,attempts,threadId,threadAgentId,...contract}=work;
  return `\n\n本轮协作工作单（以本轮范围为准）：${JSON.stringify(contract)}\n只读取 readPaths 与 writePaths 范围，只修改 writePaths 范围；空写入列表表示本轮只读。共享构建输出、锁文件、依赖安装也属于写入，不能漏报。完整执行权限不代表可以越过本轮分工范围。\n依赖成果：${JSON.stringify(dependencies.map(brief))}\n待复核成果：${JSON.stringify(targets.map(brief))}\n结束前调用 office_report（workId=${work.id}）记录真实检查、成果与风险；checks 必须用 criterion=验收条件编号（从 0 开始）逐条覆盖本单 acceptance，不带 criterion 的补充检查不计入验收覆盖，全部通过但缺编号覆盖的 ready 报告会被拒绝。复核者必须独立验证，不把作者自述当证据。`;
}

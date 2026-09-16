// Deterministic self-check for the collaboration graph: real MissionService,
// real scheduler, scripted executor, no model calls.
//
// It runs the whole new path once — planner submits a graph, a worker splits its
// running item into parallel children, children run concurrently, a subscriber
// is woken by an artifact event, and the parent joins — then prints the work-plan
// DAG view the browser draws. Run it by hand: `node scripts/check-collaboration-graph.mjs`.
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {MissionService} from '../server/missions.js';
import {TEAM} from '../src/team.js';
import {workFor,qualityIssues} from '../server/collaboration.js';
import {candidates} from '../server/harness.js';
import {collaborationGraph} from '../src/work-graph-view.js';
import {topoLayers,criticalPath} from '../src/work-graph.js';

class ScriptedBridge extends EventEmitter {
  constructor(){super();this.calls=[];this.seq=0;}
  async request(method,params){this.calls.push({method,params});if(method==='thread/start')return {thread:{id:`thread-${++this.seq}`},model:params.model};if(method==='turn/start')return {turn:{id:`turn-${++this.seq}`}};return {};}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const directory=mkdtempSync(path.join(tmpdir(),'office-graph-check-')),cwd=path.join(directory,'project');mkdirSync(cwd);
const bridge=new ScriptedBridge(),service=new MissionService(bridge,{directory,defaultCwd:cwd});
service.connection={connected:true,authenticated:true,models:TEAM.map(agent=>({id:agent.model,efforts:['high']}))};
const scope=(readPaths,writePaths)=>({readPaths,writePaths});
const work=(m,key)=>m.workItems.find(entry=>entry.key===key);
const memberOf=(m,key)=>service.agent(m,work(m,key).agentId);
const report=agent=>service.dynamic(mission,agent,'office_report',{summary:'脚本检查结果',artifacts:[],checks:workFor(mission,agent).acceptance.map((name,criterion)=>({name,criterion,result:'passed',evidence:'脚本断言'})),risks:[],verdict:'ready'});
const complete=agent=>service.notification({method:'turn/completed',params:{threadId:agent.threadId,turn:{id:agent.turnId,status:'completed',items:[]}}});
async function finish(key){const agent=memberOf(mission,key);await report(agent);complete(agent);await tick();}
const checks=[{name:'脚本检查',result:'passed',evidence:'确定性断言'}];
let mission,failed=false;
try{
  mission=await service.create({prompt:'协作图自检'});await tick();
  const boss=mission.agents[0];
  await service.dynamic(mission,boss,'office_submit_graph',{requestId:'check-1',tasks:[
    {key:'contract',task:'先发布接口契约',eligibleRoles:['tech'],scope:scope([],['contract.json']),acceptance:['契约字段完整'],produces:[{name:'api',version:'v1'}]},
    {key:'feature',task:'实现功能',eligibleRoles:['builder'],scope:scope(['src'],['src']),acceptance:['功能可用','并行拆分后仍覆盖验收'],priority:6},
    {key:'verify',task:'独立验证契约',eligibleRoles:['ops'],scope:scope(['contract.json'],[]),acceptance:['按固定版本复核'],requires:[{name:'api',version:'v1',status:'published'}]}
  ]});
  await tick();
  const builder=mission.agents.find(agent=>agent.role==='builder'),tech=mission.agents.find(agent=>agent.role==='tech');
  assert.equal(work(mission,'feature').status,'running','实现工作应先被领取');
  // The contract author subscribes instead of polling: it wants to know the
  // moment its snapshot passes independent validation.
  await service.dynamic(mission,tech,'office_watch',{events:[{kind:'artifact.validated',target:'api:v1'}],note:'我的契约一旦验证通过，就接着做接口联调',wake:true});
  // The worker discovers its item is really two parallel jobs and splits it.
  await service.dynamic(mission,builder,'office_split',{workId:work(mission,'feature').id,requestId:'check-split',tasks:[
    {key:'feature-ui',task:'实现界面',eligibleRoles:['builder'],scope:scope(['src/ui'],['src/ui']),acceptance:['界面可用']},
    {key:'feature-api',task:'实现后端',eligibleRoles:['ops','tech'],scope:scope(['src/api'],['src/api']),acceptance:['接口可用']}
  ]});
  await tick();
  assert.equal(work(mission,'feature').children.length,2);
  complete(builder);await tick();
  assert.equal(work(mission,'feature').status,'waiting_input','父工作单等待子任务');
  const running=['feature-ui','feature-api','contract'].filter(key=>work(mission,key).status==='running');
  console.log(`并行派发：${running.join('、')}（${running.length} 项同时执行）`);
  // Publish the staged contract, then free its author (which stays subscribed).
  writeFileSync(path.join(cwd,'contract.json'),'{"input":"q","output":"items"}');
  const published=await service.dynamic(mission,memberOf(mission,'contract'),'office_publish',{name:'api',version:'v1',files:['contract.json'],summary:'接口输入与输出',checks});await tick();
  await finish('contract');
  // The verification item needs the published snapshot, so it waits for a free
  // ops member: finish the parallel child first, then the scheduler hands it over.
  await finish('feature-api');await tick();
  assert.equal(work(mission,'verify').status,'running','发布后验证工作立即被领取');
  await service.dynamic(mission,memberOf(mission,'verify'),'office_validate',{name:'api',version:'v1',digest:published.digest,checks});await tick();
  const callbacks=(mission.mailbox||[]).filter(entry=>entry.callback==='artifact.validated');
  assert.equal(callbacks.length,1,'订阅者应收到一次性回调');
  console.log(`回调通知：${callbacks[0].text.split('\n')[0]}`);
  const woken=mission.workItems.filter(entry=>entry.callback);
  assert.equal(woken.length,1,'空闲的订阅者应被回调工作单唤醒');
  assert.equal(woken[0].agentId,tech.id);
  console.log(`回调唤醒：${tech.name} 领取 ${woken[0].key}（优先级 ${woken[0].priority}）`);
  await finish('verify');await finish(woken[0].key);
  await finish('feature-ui');await tick();
  assert.equal(work(mission,'feature').status,'running','子任务结束后父工作单进入汇总代次');
  assert.equal(work(mission,'feature').generation,2);
  await finish('feature');
  assert.equal(work(mission,'feature').status,'completed');
  assert.match(qualityIssues(mission).join('\n'),/缺少另一成员通过的独立复核/,'写入成果仍需独立复核');
  const {layers,cycles}=topoLayers(mission),{chain}=criticalPath(mission);
  assert.deepEqual(cycles,[],'任务图无环');
  console.log(`任务图：${mission.workItems.length} 项 · ${layers.length} 批 · 关键路径 ${chain.map(id=>mission.workItems.find(entry=>entry.id===id)?.key||id).join(' → ')}`);
  assert.deepEqual(candidates(mission).map(entry=>entry.key).filter(key=>key==='feature'),[],'父工作单已完成，不再出现在候选');
  const svg=collaborationGraph(mission,id=>mission.agents.find(agent=>agent.id===id)?.name||id);
  const batches=(svg.match(/第 \d+ 批 · \d+ 项可并行/g)||[]).slice(0,4);
  console.log(`DAG 视图：${batches.join(' | ')}`);
  assert.match(svg,/拆分 2/,'父工作单标出拆分数量');
  // 预览写到本地数据目录（.office-data 已在 .gitignore 内），不往仓库里丢生成物。
  const preview=new URL('../.office-data/preview/',import.meta.url);
  mkdirSync(preview,{recursive:true});
  writeFileSync(new URL('collaboration-graph.html',preview),`<!doctype html><meta charset="utf-8"><title>协作任务图预览</title><link rel="stylesheet" href="../../src/style.css"><body style="padding:24px;background:#f5f4ee">${svg}</body>`);
  console.log('协作图自检通过，DAG 预览：.office-data/preview/collaboration-graph.html');
}catch(error){
  failed=true;
  console.error(`协作图自检失败：${error.message}`);
}finally{
  service.save();clearInterval(service.harnessTimer);clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);
  rmSync(directory,{recursive:true,force:true});
  if(failed)process.exitCode=1;
}

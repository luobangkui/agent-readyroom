import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MissionService} from '../server/missions.js';
import {TEAM} from '../src/team.js';
import {workFor,qualityIssues} from '../server/collaboration.js';
import {candidates} from '../server/harness.js';

class Bridge extends EventEmitter {
  constructor(){super();this.calls=[];this.seq=0;}
  async request(method,params){this.calls.push({method,params});if(method==='thread/start')return {thread:{id:`thread-${++this.seq}`},model:params.model};if(method==='turn/start')return {turn:{id:`turn-${++this.seq}`}};return {};}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t,options){const directory=mkdtempSync(path.join(tmpdir(),'office-split-')),cwd=path.join(directory,'project');mkdirSync(cwd);const bridge=new Bridge(),service=new MissionService(bridge,{directory,defaultCwd:cwd,...options});service.connection={connected:true,authenticated:true,models:TEAM.map(a=>({id:a.model,efforts:['high']}))};t.after(()=>{clearInterval(service.harnessTimer);clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);rmSync(directory,{recursive:true,force:true});});const m=await service.create({prompt:'拆分与回调测试'});await tick();return {service,bridge,m,boss:m.agents[0],directory,cwd};}
const scope=(readPaths=['.'],writePaths=[])=>({readPaths,writePaths});
// Disjoint scopes everywhere: the scheduler serializes anything that overlaps,
// and these tests exercise parallelism, not lock contention.
const task=(key,role,dir=key,extra={})=>({key,task:`交付 ${key}`,eligibleRoles:[role],scope:scope([dir],[dir]),acceptance:['可复现检查通过'],...extra});
const work=(f,key)=>f.m.workItems.find(w=>w.key===key);
const actor=(f,key)=>f.service.agent(f.m,work(f,key).agentId);
const member=(f,role)=>f.m.agents.find(a=>a.role===role);
async function graph(f,tasks,requestId='initial'){const result=await f.service.dynamic(f.m,f.boss,'office_submit_graph',{requestId,tasks});await tick();return result;}
const report=(f,a)=>f.service.dynamic(f.m,a,'office_report',{summary:'夹具结果',artifacts:[],checks:workFor(f.m,a).acceptance.map((name,criterion)=>({name,criterion,result:'passed',evidence:'测试断言'})),risks:[],verdict:'ready'});
const complete=(f,a,status='completed')=>f.service.notification({method:'turn/completed',params:{threadId:a.threadId,turn:{id:a.turnId,status,items:[]}}});
async function finish(f,key){const a=actor(f,key);await report(f,a);complete(f,a);await tick();}
const split=(f,a,args)=>f.service.dynamic(f.m,a,'office_split',args);
const child=(key,role,dir=key,extra={})=>({key,task:`子任务 ${key}`,eligibleRoles:[role],scope:scope([dir],[dir]),acceptance:[`${key} 可复现检查通过`],...extra});
const file=(f,name,content)=>writeFileSync(path.join(f.cwd,name),content);
const checks=[{name:'夹具检查',result:'passed',evidence:'测试断言'}];
const publish=(f,a,name='api',version='v1')=>f.service.dynamic(f.m,a,'office_publish',{name,version,files:['contract.json'],summary:'接口输入、输出与错误样例',checks});
const validate=(f,a,artifact)=>f.service.dynamic(f.m,a,'office_validate',{name:artifact.name,version:artifact.version,digest:artifact.digest,checks});

test('a member splits its running work item into parallel children and joins when they finish',async t=>{
  const f=await fixture(t);
  await graph(f,[task('big','builder','src',{scope:scope(['src'],['src'])})]);
  const builder=actor(f,'big');
  assert.equal(work(f,'big').status,'running');
  const result=await split(f,builder,{workId:work(f,'big').id,requestId:'split-1',tasks:[child('part-a','builder','src/a'),child('part-b','tech','src/b'),child('part-c','ops','src/c')]});
  await tick();
  assert.deepEqual(result.children.map(entry=>entry.key),['part-a','part-b','part-c']);
  assert.equal(work(f,'big').status,'waiting_input');
  assert.deepEqual(work(f,'big').children.map(id=>f.m.workItems.find(w=>w.id===id).key),['part-a','part-b','part-c']);
  assert.deepEqual(work(f,'big').dependsOn,work(f,'big').children);
  assert.equal(work(f,'part-a').splitOf,work(f,'big').id);
  assert.equal(work(f,'part-a').splitDepth,1);
  // The splitting turn holds no scope: it only records the fan-out and ends, and
  // the children's ranges are already inside the parent's approved range, so the
  // whole fan-out starts immediately instead of queueing behind that turn.
  assert.equal(work(f,'part-b').agentId,member(f,'tech').id,'子任务不等待拆分轮次结束');
  assert.equal(work(f,'part-c').agentId,member(f,'ops').id);
  assert.equal([work(f,'part-b'),work(f,'part-c')].filter(w=>w.status==='running').length,2);
  complete(f,builder);await tick();
  assert.equal(work(f,'big').status,'waiting_input','拆分轮次结束不等于汇总完成');
  // The splitter itself is now free and picks up one of its own children, so the
  // three children run in parallel across three roles.
  assert.equal(work(f,'part-a').agentId,builder.id,'释放席位后拆分者自己领一份子任务');
  assert.equal([work(f,'part-a'),work(f,'part-b'),work(f,'part-c')].filter(w=>w.status==='running').length,3);
  await finish(f,'part-b');await finish(f,'part-c');await finish(f,'part-a');
  assert.equal(work(f,'big').status,'running','子任务结束后父工作单重新可领取');
  assert.equal(work(f,'big').generation,2);
  const joinInput=f.bridge.calls.filter(c=>c.method==='turn/start').at(-1).params.input[0].text;
  assert.match(joinInput,/拆分后的汇总代次/);
  await finish(f,'big');
  assert.equal(work(f,'big').status,'completed','汇总代次结束父工作单');
  assert.equal(work(f,'big').report.verdict,'ready');
  assert.equal(work(f,'big').generation,2);
  // Writes still need another member's review, so the mission keeps running the
  // normal quality path instead of declaring delivery on the author's word.
  assert.match(qualityIssues(f.m).join('\n'),/缺少另一成员通过的独立复核/);
  assert.notEqual(f.m.status,'failed');
});

test('scope widening, unknown references and cycles are rejected without leaving a partial split',async t=>{
  const f=await fixture(t);
  await graph(f,[task('base','builder','src',{scope:scope(['src'],['src'])}),task('downstream','ops','down',{dependsOn:['base']})]);
  const builder=actor(f,'base'),before=f.m.workItems.length;
  await assert.rejects(split(f,builder,{workId:work(f,'base').id,requestId:'wide',tasks:[child('x','builder','src/x'),child('y','builder','lib/y')]}),/写入范围超出父工作单/);
  await assert.rejects(split(f,builder,{workId:work(f,'base').id,requestId:'unknown',tasks:[child('x','builder','src/x'),child('y','builder','src/y',{dependsOn:['nope']})]}),/不存在或已替代/);
  // downstream waits on base, so a child that waits on downstream would close a cycle
  await assert.rejects(split(f,builder,{workId:work(f,'base').id,requestId:'cycle',tasks:[child('x','builder','src/x'),child('y','builder','src/y',{dependsOn:['downstream']})]}),/循环依赖/);
  await assert.rejects(split(f,builder,{workId:work(f,'base').id,requestId:'single',tasks:[child('only','builder','src/only')]}),/至少需要两个子任务/);
  assert.equal(f.m.workItems.length,before);
  assert.equal(work(f,'base').children,undefined);
  assert.equal(work(f,'base').status,'running');
});

test('only the owner or the planner splits, once, and repeated request IDs are idempotent',async t=>{
  const f=await fixture(t);
  await graph(f,[task('own','builder','src'),task('other','ops','elsewhere')]);
  const ops=actor(f,'other');
  await assert.rejects(split(f,ops,{workId:work(f,'own').id,requestId:'foreign',tasks:[child('a','builder','src/a'),child('b','builder','src/b')]}),/只有领取人本人或目标负责人/);
  const builder=actor(f,'own'),tasks=[child('a','builder','src/a'),child('b','builder','src/b')];
  const first=await split(f,builder,{workId:work(f,'own').id,requestId:'same',tasks});
  const again=await split(f,builder,{workId:work(f,'own').id,requestId:'same',tasks});
  assert.equal(again.duplicate,true);
  assert.equal(f.m.workItems.filter(w=>w.splitOf===work(f,'own').id).length,2);
  await assert.rejects(split(f,builder,{workId:work(f,'own').id,requestId:'same',tasks:[child('a','builder','src/a')]}),/同一 requestId 不能用于不同的拆分/);
  await assert.rejects(split(f,builder,{workId:work(f,'own').id,requestId:'twice',tasks:[child('c','builder','src/c'),child('d','builder','src/d')]}),/已经拆分过/);
  // The planner may split someone else's item, and a child may be split again.
  const plannerSplit=await f.service.dynamic(f.m,f.boss,'office_split',{workId:first.children[0].id,requestId:'boss-split',tasks:[child('a1','tech','src/a/1'),child('a2','ops','src/a/2')]});
  assert.equal(plannerSplit.children.length,2);
  assert.equal(work(f,'a1').splitDepth,2);
});

test('a subscription delivers a durable callback and wakes an idle subscriber once',async t=>{
  const f=await fixture(t);file(f,'contract.json','{"input":"q","output":"items"}');
  // The validator waits on the published snapshot; the watcher is an ordinary
  // member that finishes its own work and then goes idle.
  await graph(f,[task('contract','tech','.',{scope:scope([],['contract.json']),produces:[{name:'api',version:'v1'}]}),task('validator','ops','checks',{requires:[{name:'api',version:'v1',status:'published'}]}),task('watcher','builder','app')]);
  const builder=actor(f,'watcher'),tech=actor(f,'contract');
  const watch=await f.service.dynamic(f.m,builder,'office_watch',{events:[{kind:'artifact.validated',target:'api:v1'}],note:'契约验证通过后我要对齐接口',wake:true});
  assert.match(watch.watchId,/^watch_/);
  assert.equal((f.m.watches||[]).length,1);
  await finish(f,'watcher');
  assert.equal(builder.status,'completed');
  const published=await publish(f,tech);await tick();
  assert.equal(work(f,'validator').status,'running');
  await validate(f,actor(f,'validator'),published);await tick();
  const callbacks=(f.m.mailbox||[]).filter(entry=>entry.callback==='artifact.validated');
  assert.equal(callbacks.length,1);
  assert.equal(callbacks[0].to,builder.id);
  assert.match(callbacks[0].text,/api:v1/);
  const callbackWork=f.m.workItems.filter(w=>w.callback);
  assert.equal(callbackWork.length,1,'空闲订阅者应被唤醒一次');
  assert.equal(callbackWork[0].agentId,builder.id);
  assert.equal(member(f,'ops').status!=='queued',true,'无关成员不应被唤醒');
  assert.equal(f.m.watches[0].fires,1);
});

test('a one-shot subscription stops after its first event and can be cancelled',async t=>{
  const f=await fixture(t);
  await graph(f,[task('a','tech','a'),task('b','ops','b')]);
  const tech=actor(f,'a');
  const watch=await f.service.dynamic(f.m,tech,'office_watch',{events:[{kind:'work.settled',target:'b'}],note:'b 结束后告诉我',wake:false});
  const ops=actor(f,'b');
  await report(f,ops);complete(f,ops);await tick();
  const first=(f.m.mailbox||[]).filter(entry=>entry.callback==='work.settled');
  assert.equal(first.length,1);
  assert.match(first[0].text,/工作单 b/);
  assert.equal(f.m.workItems.filter(w=>w.callback).length,0,'wake=false 时不创建回调工作单');
  await report(f,tech);complete(f,tech);await tick();
  assert.equal((f.m.mailbox||[]).filter(entry=>entry.callback==='work.settled').length,1,'一次性订阅不会重复触发');
  // Registering the same active subscription twice is a no-op, not a second row.
  const duplicate=await f.service.dynamic(f.m,tech,'office_watch',{events:[{kind:'work.settled',target:'b'}],note:'b 结束后告诉我',wake:false});
  assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.watchId,watch.watchId);
  const second=await f.service.dynamic(f.m,tech,'office_watch',{events:[{kind:'member.idle',target:'*'}],wake:false});
  await f.service.dynamic(f.m,tech,'office_unwatch',{watchId:second.watchId});
  assert.notEqual(f.m.watches.find(entry=>entry.id===second.watchId).cancelledAt,undefined);
  await assert.rejects(f.service.dynamic(f.m,tech,'office_unwatch',{watchId:'watch_missing'}),/没有这条有效订阅/);
  assert.equal((f.m.watches.find(entry=>entry.id===watch.watchId).fires||0),1);
});

test('subscriptions validate their kind, target and mission type',async t=>{
  const f=await fixture(t);
  await graph(f,[task('a','tech','a')]);
  const tech=actor(f,'a');
  await assert.rejects(f.service.dynamic(f.m,tech,'office_watch',{events:[{kind:'work.exploded',target:'a'}]}),/事件类型必须是/);
  await assert.rejects(f.service.dynamic(f.m,tech,'office_watch',{events:[]}),/1–8 个事件/);
  const chat=await f.service.create({kind:'chat'});
  await assert.rejects(f.service.dynamic(chat,chat.agents[0],'office_watch',{events:[{kind:'work.settled',target:'*'}]}),/只有目标会话/);
});

test('a scope wait names the overlapping path and how to get parallelism back',async t=>{
  const f=await fixture(t);
  // Two tasks that declare the same shared scratch directory must queue, and the
  // wait must say which path collides instead of just naming a person.
  await graph(f,[task('holder','builder','holder',{scope:scope(['.scratch'],['.scratch/e2e'])}),task('waiter','ops','waiter',{scope:scope(['.scratch'],['.scratch/e2e'])}),task('sibling','tech','sibling',{scope:scope(['sibling'],['sibling'])})]);
  const blocking=work(f,'holder');
  assert.equal(blocking.status,'running');
  assert.equal(work(f,'sibling').status,'running','范围不重叠的工作单照常并行');
  const reason=work(f,'waiter').waitReason;
  assert.equal(reason.kind,'scope');
  assert.match(reason.message,/\.scratch\/e2e/,'等待原因要说明是哪条路径冲突');
  assert.match(reason.message,/文件级/,'同一个目录声明要给出恢复并行的办法');
  assert.equal(work(f,'waiter').agentId,null,'等待期间不占人物');
});

test('submitting or splitting work that shares one writable directory reports it up front',async t=>{
  const f=await fixture(t);
  const submitted=await graph(f,[task('one','builder','one',{scope:scope(['sh'],['.scratch/e2e'])}),task('two','ops','two',{scope:scope(['sh'],['.scratch/e2e'])}),task('three','tech','three',{scope:scope(['sh'],['.scratch/own'])})]);
  assert.deepEqual(submitted.sharedWritePaths.paths,[{path:'.scratch/e2e',workItems:2}]);
  assert.match(submitted.sharedWritePaths.advice,/文件或子目录/);
  assert.ok(f.m.events.some(event=>event.text.includes('被多个工作单声明为写入范围')),'提交时就在执行记录里说清楚');
  const builder=actor(f,'one'),taskOf=(key,role,write)=>({key,task:key,eligibleRoles:[role],scope:scope(['sh'],[write]),acceptance:[`${key} 可复现检查通过`]});
  const children=await split(f,builder,{workId:work(f,'one').id,requestId:'shared-split',tasks:[taskOf('c1','builder','.scratch/e2e/a'),taskOf('c2','tech','.scratch/e2e/a')]});
  assert.deepEqual(children.sharedWritePaths.paths,[{path:'.scratch/e2e/a',workItems:2}],'拆出的子任务共享目录同样当场提醒');
  // A fan-out with disjoint writable subpaths is the shape the advice asks for.
  const clean=await split(f,actor(f,'three'),{workId:work(f,'three').id,requestId:'clean-split',tasks:[taskOf('d1','builder','.scratch/own/x'),taskOf('d2','tech','.scratch/own/y')]});
  assert.equal(clean.sharedWritePaths,undefined,'各自写入不同子路径时不提醒');
});

test('candidates dispatch the critical path before equal-priority leaves and respect configured slots',async t=>{
  const f=await fixture(t,{maxWorkers:1});
  await graph(f,[task('chain-1','builder','one',{priority:3}),task('chain-2','builder','two',{priority:3,dependsOn:['chain-1']}),task('leaf','builder','leaf',{priority:3})]);
  assert.equal(work(f,'chain-1').status,'running','关键路径上的 chain-1 先于同级 leaf 派发');
  assert.equal(work(f,'leaf').agentId,null,'每目标执行名额为 1 时第二项不占人');
  assert.match(work(f,'leaf').waitReason.message,/等待本目标执行名额（1）/);
  assert.deepEqual(candidates(f.m).map(w=>w.key),['leaf'],'只有未被领取的就绪工作会出现在候选里');
  await finish(f,'chain-1');await tick();
  assert.equal(work(f,'chain-2').status,'running','依赖完成后关键路径续接仍优先于同优先级叶子');
  assert.equal(work(f,'leaf').agentId,null);
});

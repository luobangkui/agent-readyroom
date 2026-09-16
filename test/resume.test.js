import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MissionService} from '../server/missions.js';
import {TEAM} from '../src/team.js';
import {workFor} from '../server/collaboration.js';

class Bridge extends EventEmitter {
  constructor(){super();this.calls=[];this.seq=0;}
  async request(method,params){this.calls.push({method,params});if(method==='thread/start')return {thread:{id:`thread-${++this.seq}`},model:params.model};if(method==='turn/start')return {turn:{id:`turn-${++this.seq}`}};return {};}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const scope=(readPaths,writePaths)=>({readPaths,writePaths});
const task=(key,role,dir,extra={})=>({key,task:`交付 ${key}`,eligibleRoles:[role],scope:scope([dir],[dir]),acceptance:['可复现检查通过'],...extra});
const work=(m,key)=>m.workItems.find(entry=>entry.key===key);
const models=()=>TEAM.map(agent=>({id:agent.model,efforts:['high']}));

// 建一个目标并跑起来，然后按"服务重启"的方式把现场改写成中断状态——这正是
// 重启后 missions.json 里留下的样子。
async function crashed(t){
  const directory=mkdtempSync(path.join(tmpdir(),'office-resume-')),cwd=path.join(directory,'project');mkdirSync(cwd);
  const bridge=new Bridge(),service=new MissionService(bridge,{directory,defaultCwd:cwd});
  service.connection={connected:true,authenticated:true,models:models()};
  t.after(()=>{clearInterval(service.harnessTimer);clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);rmSync(directory,{recursive:true,force:true});});
  const mission=await service.create({prompt:'中断恢复测试'});await tick();
  const boss=mission.agents[0];
  await service.dynamic(mission,boss,'office_submit_graph',{requestId:'r1',tasks:[
    task('api','tech','api',{produces:[{name:'api',version:'v1'}]}),
    task('client','builder','client',{requires:[{name:'api',version:'v1'}]}),
    task('review','ops','review',{reviewOf:['client'],scope:scope(['client'],[])}),
    task('leaf','builder','leaf'),
  ]});
  await tick();
  // 模拟重启：ACTIVE/queued 的工作单与成员都变成 interrupted，等待恢复
  for(const item of mission.workItems)if(['starting','running','waiting','queued','suspending'].includes(item.status)){item.status='interrupted';item.waitReason={kind:'recovery',message:'服务重启，需明确检查后重试；未自动重放外部操作'};}
  for(const agent of mission.agents)if(['starting','running','waiting','queued'].includes(agent.status)){agent.status='interrupted';agent.turnId=null;}
  mission.status='interrupted';
  service.save();
  return {service,bridge,mission,boss,directory,cwd};
}

test('继续：把被中断的工作单重新排队并让调度器接着派发',async t=>{
  const f=await crashed(t);
  const before=f.bridge.calls.filter(call=>call.method==='turn/start').length;
  const result=await f.service.resume(f.mission.id);
  await tick();
  // client 当时在等输入（waiting_input），重启不会动它；被重启打断的是 api 与 leaf
  assert.deepEqual(result.requeued.sort(),['api','leaf'],'被中断的工作单重新排队');
  assert.ok(result.revived.length>=3,`被中断的成员恢复待命：${result.revived.join('、')}`);
  assert.equal(f.mission.status,'running');
  assert.equal(work(f.mission,'api').status,'running','重新排队后又执行起来了');
  assert.ok(f.bridge.calls.filter(call=>call.method==='turn/start').length>before,'产生了新的执行轮次');
  assert.equal(work(f.mission,'client').agentId,null,'仍缺输入的工作单不占人');
  assert.equal(result.held.length,0);
});

test('继续：不会静默重放失败或用户停止的工作单，而是交给规划者判断',async t=>{
  const f=await crashed(t);
  const api=work(f.mission,'api');
  api.status='failed';api.report=null;
  const leaf=work(f.mission,'leaf');
  leaf.status='stopped';leaf.waitReason={kind:'stop',message:'用户已停止，未自动重试'};
  const result=await f.service.resume(f.mission.id);
  await tick();
  assert.deepEqual(result.needsPlanner.sort(),['api','leaf'],'失败与停止的工作单都交给规划者');
  assert.equal(work(f.mission,'api').status,'failed','失败的工作单没有被静默重跑');
  assert.equal(work(f.mission,'leaf').status,'stopped');
  assert.ok(['queued','starting','running'].includes(f.boss.status),`规划者被唤醒：${f.boss.status}`);
  assert.match(f.boss.task,/office_retry|重新规划/);
  assert.ok(f.mission.events.some(entry=>/用户请求继续/.test(entry.text)),'执行记录里说明这次恢复做了什么');
});

test('继续：超时中断的工作单需要用户先确认副作用',async t=>{
  const f=await crashed(t);
  const leaf=work(f.mission,'leaf');
  leaf.timeoutRequestedAt=new Date().toISOString();
  const result=await f.service.resume(f.mission.id);
  await tick();
  assert.deepEqual(result.held,['leaf'],'超时中断不自动重放');
  assert.equal(work(f.mission,'leaf').status,'interrupted');
  assert.ok(!result.requeued.includes('leaf'));
});

test('继续：归档记录要先恢复，有成员在跑时先等它结束',async t=>{
  const f=await crashed(t);
  f.service.setArchived(f.mission.id,true);
  await assert.rejects(f.service.resume(f.mission.id),/已归档/);
  f.service.setArchived(f.mission.id,false);
  f.mission.agents[1].status='running';
  await assert.rejects(f.service.resume(f.mission.id),/还有成员在执行或排队/);
});

test('继续：重启后通过服务重载也能恢复（读盘路径）',async t=>{
  const f=await crashed(t);
  f.service.save();
  const reloaded=new MissionService(new Bridge(),{directory:f.directory,defaultCwd:f.cwd});
  reloaded.connection={connected:true,authenticated:true,models:models()};
  t.after(()=>{clearInterval(reloaded.harnessTimer);clearTimeout(reloaded.saveTimer);clearTimeout(reloaded.broadcastTimer);});
  const mission=reloaded.missions.find(entry=>entry.id===f.mission.id);
  assert.equal(mission.status,'interrupted','重载后是中断状态');
  const result=await reloaded.resume(mission.id);
  await tick();
  assert.deepEqual(result.requeued.sort(),['api','leaf'],`重载后同样可以继续：${result.requeued.join('、')}`);
  assert.ok(reloaded.missions.find(entry=>entry.id===mission.id).agents.every(agent=>agent.status!=='interrupted'),'没有成员卡在中断态');
  assert.ok(JSON.parse(readFileSync(reloaded.file,'utf8')).length>0);
});

test('继续：运行环境掉线造成的成员失败会被复位，过期的错误不再挂着',async t=>{
  const f=await crashed(t);
  // 小樱式的现场：成员因运行环境掉线失败，但工作单还活着（ready/等范围）
  const ops=f.mission.agents.find(agent=>agent.role==='ops');
  ops.status='failed';ops.error='DSH 尚未连接，请确认本机 dsh 可用';
  const review=work(f.mission,'review');
  review.status='ready';review.agentId=ops.id;ops.workId=review.id;
  const result=await f.service.resume(f.mission.id);
  await tick();
  assert.ok(result.revived.includes(ops.name),`环境类失败应被复位：${result.revived.join('、')}`);
  assert.equal(ops.status!=='failed',true);
  assert.equal(ops.error,null,'过期的失败原因被清掉');
  assert.notEqual(review.status,'failed','工作单没有被误判为失败');
});

test('继续：可以只恢复某一位成员，并重新排队它未完成的工作单',async t=>{
  const f=await crashed(t);
  const ops=f.mission.agents.find(agent=>agent.role==='ops');
  const review=work(f.mission,'review');
  review.status='failed';review.agentId=ops.id;review.report=null;ops.workId=review.id;
  ops.status='failed';ops.error='模型返回错误';
  const result=await f.service.resume(f.mission.id,{agentId:ops.id});
  await tick();
  assert.deepEqual(result.revived,[ops.name]);
  assert.deepEqual(result.requeued,['review'],'成员自己的失败工作单重新排队');
  assert.equal(ops.status!=='failed',true);
  assert.equal(['waiting_input','ready'].includes(review.status),true,`工作单回到可调度状态：${review.status}`);
});

test('继续：成员正在执行时拒绝单独恢复它',async t=>{
  const f=await crashed(t);
  const ops=f.mission.agents.find(agent=>agent.role==='ops');
  ops.status='running';
  await assert.rejects(f.service.resume(f.mission.id,{agentId:ops.id}),/正在执行或排队/);
});

test('继续：模型失败（非环境问题）不会被静默复位',async t=>{
  const f=await crashed(t);
  const ops=f.mission.agents.find(agent=>agent.role==='ops');
  const review=work(f.mission,'review');
  review.status='failed';review.agentId=ops.id;ops.workId=review.id;
  ops.status='failed';ops.error='模型拒绝了这次调用：内容策略';
  const result=await f.service.resume(f.mission.id);
  await tick();
  assert.ok(!result.revived.includes(ops.name),'模型失败要交给规划者判断，不静默复位');
  assert.equal(ops.status,'failed');
  assert.equal(review.status,'failed');
});

test('一键继续：retryFailed 会把失败与停止的工作单一起重试并复位对应成员',async t=>{
  const f=await crashed(t);
  const api=work(f.mission,'api'),leaf=work(f.mission,'leaf');
  api.status='failed';api.report={summary:'旧报告',checks:[],verdict:'blocked'};
  leaf.status='stopped';leaf.waitReason={kind:'stop',message:'用户已停止，未自动重试'};
  const builder=f.mission.agents.find(agent=>agent.role==='builder');
  builder.status='failed';builder.error='模型拒绝了这次调用：内容策略';builder.workId=leaf.id;
  const result=await f.service.resume(f.mission.id,{retryFailed:true});
  await tick();
  assert.deepEqual(result.requeued.sort(),['api','leaf'],'失败与停止的工作单都重新排队');
  assert.equal(result.retried.length,2,'结果里列出重试项');
  assert.equal(result.needsPlanner.length,0,'都重试了就不需要再交给规划者');
  assert.equal(api.retries,1,'重试次数+1');
  assert.equal(api.report,null,'旧报告清掉，避免和本轮证据混淆');
  assert.ok(result.revived.includes(builder.name),'它的成员一起复位');
  assert.equal(builder.error,null);
  assert.equal(['waiting_input','ready','running','queued'].includes(api.status),true,`工作单回到可调度：${api.status}`);
});

test('一键继续：默认不重试失败工作单（工具路径保持保守）',async t=>{
  const f=await crashed(t);
  const api=work(f.mission,'api');
  api.status='failed';
  const result=await f.service.resume(f.mission.id);
  await tick();
  assert.deepEqual(result.needsPlanner,['api'],'不带 retryFailed 时交给规划者');
  assert.deepEqual(result.retried,[]);
  assert.equal(api.retries||0,0,'没有静默重试');
});

test('一键继续：超时中断的工作单也会被重试，并在结果里单列',async t=>{
  const f=await crashed(t);
  const leaf=work(f.mission,'leaf');
  leaf.status='interrupted';leaf.timeoutRequestedAt=new Date().toISOString();
  const result=await f.service.resume(f.mission.id,{retryFailed:true});
  await tick();
  assert.deepEqual(result.requeued.sort(),['api','leaf'],'用户明确授权后超时工作单也重新排队');
  assert.equal(leaf.timeoutRequestedAt,null,'清掉超时标记，避免立刻又被判超时');
});

test('一键继续：先重建掉线的运行环境，再做恢复；仍连不上会在结果里说明',async t=>{
  const f=await crashed(t);
  const calls=[];
  f.service.bridge={...f.service.bridge,ensureConnected:async()=>{calls.push('ensureConnected');f.service.connection={...f.service.connection,providers:{...f.service.connection.providers,ops:{connected:true,authenticated:true,message:'已连接'}}};}};
  f.service.connection={...f.service.connection,providers:{...f.service.connection.providers,ops:{connected:false,authenticated:false,message:'DSH 尚未连接'}}};
  const result=await f.service.resume(f.mission.id,{retryFailed:true});
  await tick();
  assert.deepEqual(calls,['ensureConnected'],'恢复前会尝试重建连接');
  assert.deepEqual(result.reconnected,['ops'],'结果里报告重建了哪个运行环境');
  assert.deepEqual(result.stillOffline,[],'重建后不再有掉线的');
  assert.ok(result.requeued.length>0,'连接恢复后照常重新排队');
});

test('一键继续：连接仍不可用时照样排队，但会明确告知还在等它',async t=>{
  const f=await crashed(t);
  f.service.bridge={...f.service.bridge,ensureConnected:async()=>{}};
  f.service.connection={...f.service.connection,providers:{...f.service.connection.providers,ops:{connected:false,authenticated:false,message:'DSH 尚未连接'}}};
  const result=await f.service.resume(f.mission.id,{retryFailed:true});
  await tick();
  assert.deepEqual(result.reconnected,['ops']);
  assert.deepEqual(result.stillOffline,['ops'],'仍掉线的运行环境被单独列出');
  assert.ok(f.mission.events.some(event=>/仍未连接/.test(event.text)),'执行记录里写明结果');
});

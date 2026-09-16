import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MissionService} from '../server/missions.js';
import {TEAM} from '../src/team.js';
import {workFor,qualityIssues} from '../server/collaboration.js';
import {harnessMetrics} from '../server/harness.js';
import {transition,setWaitReason} from '../server/work-state.js';
import {collaborationPanel,collaborationUsage} from '../src/collaboration-panel.js';
import {ZcodeBridge} from '../server/zcode.js';

export class Bridge extends EventEmitter {
  constructor(){super();this.calls=[];this.seq=0;}
  async request(method,params){this.calls.push({method,params});if(method==='thread/start')return {thread:{id:`thread-${++this.seq}`},model:params.model};if(method==='turn/start')return {turn:{id:`turn-${++this.seq}`}};return {};}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t){const directory=mkdtempSync(path.join(tmpdir(),'office-harness-')),cwd=path.join(directory,'project');mkdirSync(cwd);const bridge=new Bridge(),service=new MissionService(bridge,{directory,defaultCwd:cwd});service.connection={connected:true,authenticated:true,models:TEAM.map(a=>({id:a.model,efforts:['high']}))};t.after(()=>{clearInterval(service.harnessTimer);clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);rmSync(directory,{recursive:true,force:true});});const m=await service.create({prompt:'输入就绪协作测试'});await tick();return {service,bridge,m,boss:m.agents[0],directory,cwd};}
const scope=(readPaths=[],writePaths=[])=>({readPaths,writePaths});
const task=(key,role,extra={})=>({key,task:`交付 ${key}`,eligibleRoles:[role],scope:scope(),acceptance:['可复现检查通过'],...extra});
const work=(f,key)=>f.m.workItems.find(w=>w.key===key);
const actor=(f,key)=>f.service.agent(f.m,work(f,key).agentId);
async function graph(f,tasks,requestId='initial'){const result=await f.service.dynamic(f.m,f.boss,'office_submit_graph',{requestId,tasks});await tick();return result;}
const checks=[{name:'测试夹具检查',result:'passed',evidence:'本测试中的可复现断言'}];
const report=(f,a)=>f.service.dynamic(f.m,a,'office_report',{summary:'夹具结果',artifacts:[],checks:workFor(f.m,a).acceptance.map((name,criterion)=>({name,criterion,result:'passed',evidence:'实际测试断言'})),risks:[],verdict:'ready'});
function complete(f,a,status='completed',turnId=a.turnId){f.service.notification({method:'turn/completed',params:{threadId:a.threadId,turn:{id:turnId,status,items:[]}}});}
async function finish(f,key){const a=actor(f,key);await report(f,a);complete(f,a);await tick();}
function file(f,name,content){mkdirSync(path.dirname(path.join(f.cwd,name)),{recursive:true});writeFileSync(path.join(f.cwd,name),content);}
const publish=(f,a,name='api',version='v1',files=['contract.json'])=>f.service.dynamic(f.m,a,'office_publish',{name,version,files,summary:'接口输入、输出、错误和样例',checks});
const validate=(f,a,artifact)=>f.service.dynamic(f.m,a,'office_validate',{name:artifact.name,version:artifact.version,digest:artifact.digest,checks});

test('A completes and D starts immediately while B and C are still running, without planner turn',async t=>{
  const f=await fixture(t);await graph(f,[task('A','tech'),task('B','builder'),task('C','ops'),task('D','tech',{dependsOn:['A']})]);complete(f,f.boss);await tick();
  assert.equal(work(f,'D').agentId,null);await finish(f,'A');
  assert.equal(work(f,'D').status,'running');assert.equal(work(f,'B').status,'running');assert.equal(work(f,'C').status,'running');assert.equal(f.boss.status,'completed');
  assert.equal(f.bridge.calls.filter(c=>c.method==='turn/start').length,5);
  assert.equal(actor(f,'D').role,'tech');assert.notEqual(work(f,'A').threadId,work(f,'D').threadId);
});

test('waiting inputs reserve neither a person nor a model slot',async t=>{
  const f=await fixture(t);await graph(f,[task('produce','tech',{produces:[{name:'api',version:'v1'}]}),task('waiting','ops',{requires:[{name:'api',version:'v1'}]}),task('available','ops')]);
  assert.equal(work(f,'waiting').status,'waiting_input');assert.equal(work(f,'waiting').agentId,null);assert.equal(work(f,'available').status,'running');assert.equal(harnessMetrics(f.m).active,2);
});

test('published contract requires independent validation and triggers downstream before producer completion',async t=>{
  const f=await fixture(t);file(f,'contract.json','{"input":"q","output":"items","errors":[400]}');
  await graph(f,[task('producer','tech',{scope:scope([],['contract.json','server']),produces:[{name:'api',version:'v1'}]}),task('validator','ops',{requires:[{name:'api',version:'v1',status:'published'}]}),task('client','builder',{requires:[{name:'api',version:'v1'}],scope:scope([],['client'])})]);
  const producer=actor(f,'producer'),published=await publish(f,producer);await tick();assert.equal(work(f,'validator').status,'running');assert.equal(work(f,'client').status,'waiting_input');
  await assert.rejects(validate(f,producer,published),/另一位/);await validate(f,actor(f,'validator'),published);await tick();
  assert.equal(work(f,'client').status,'running');assert.equal(producer.status,'running');assert.equal(work(f,'client').inputs[0].digest,published.digest);
  const clientInput=f.bridge.calls.filter(c=>c.method==='turn/start').at(-1).params.input[0].text;assert.match(clientInput,/固定输入快照/);assert.match(clientInput,/items/);
});

test('versions cannot be overwritten, exact publication retries are safe and consumers retain v1 bytes',async t=>{
  const f=await fixture(t);file(f,'contract.json','{"v":1}');await graph(f,[task('producer','tech',{scope:scope(['contract.json']),produces:[{name:'api',version:'v1'}]}),task('consumer','builder',{requires:[{name:'api',version:'v1'}]})]);
  const a=actor(f,'producer'),first=await publish(f,a);assert.equal((await publish(f,a)).duplicate,true);await validate(f,f.boss,first);await tick();file(f,'contract.json','{"v":2}');await assert.rejects(publish(f,a),/不可覆盖/);
  const saved=await f.service.dynamic(f.m,actor(f,'consumer'),'office_artifact',{name:'api',version:'v1'});assert.equal(saved.files[0].content,'{"v":1}');assert.equal(saved.digest,first.digest);
  f.service.save();assert.equal(JSON.parse(readFileSync(f.service.file,'utf8'))[0].artifactVersions[0].files[0].content,'{"v":1}');
});

test('graphs reject cycles, missing inputs, duplicate keys, invalid reviews and bounds atomically',async t=>{
  const f=await fixture(t),before=f.bridge.calls.length;
  for(const tasks of [[task('A','tech',{dependsOn:['B']}),task('B','builder',{dependsOn:['A']})],[task('A','tech',{requires:[{name:'none',version:'v1'}]})],[task('A','tech'),task('A','ops')],[task('A','tech',{scope:scope([],['src'])}),task('R','tech',{scope:scope(['src']),reviewOf:['A']})],[task('A','tech',{scope:scope([],['../escape'])})]])await assert.rejects(graph(f,tasks));
  assert.equal(f.m.workItems,undefined);assert.equal(f.bridge.calls.length,before);
  const tasks=[task('A','ops')];const first=await graph(f,tasks,'same');const second=await graph(f,tasks,'same');assert.equal(second.duplicate,true);assert.equal(second.workItems[0].id,first.workItems[0].id);assert.equal(f.m.workItems.length,1);
  await assert.rejects(graph(f,[task('different','ops')],'same'),/不能用于不同/);
});

test('persistence failure never dispatches a partial task graph or publishes an input',async t=>{
  const f=await fixture(t),save=f.service.save.bind(f.service),before=f.bridge.calls.length;f.service.save=()=>false;
  await assert.rejects(graph(f,[task('A','ops')]),/未成功保存/);assert.equal(f.m.workItems.length,0);assert.equal(f.bridge.calls.length,before);f.service.save=save;
  file(f,'contract.json','{}');await graph(f,[task('A','tech',{scope:scope(['contract.json']),produces:[{name:'api',version:'v1'}]}),task('B','builder',{requires:[{name:'api',version:'v1',status:'published'}]})]);f.service.save=()=>false;
  await assert.rejects(publish(f,actor(f,'A')),/未保存/);assert.equal(f.m.artifactVersions.length,0);assert.equal(work(f,'B').agentId,null);f.service.save=save;
});

test('resources and path conflicts block only consumers of those resources',async t=>{
  const f=await fixture(t);await graph(f,[task('A','tech',{resources:[{name:'port:4318'}]}),task('B','builder',{resources:[{name:'port:4318'}]}),task('C','ops')]);
  assert.equal(work(f,'A').status,'running');assert.equal(work(f,'B').waitReason.kind,'resource');assert.equal(work(f,'C').status,'running');await finish(f,'A');assert.equal(work(f,'B').status,'running');
});

test('suspension keeps the slot until turn completion then lends it to ready work and restores checkpoint',async t=>{
  const f=await fixture(t);file(f,'contract.json','{}');await graph(f,[task('A','tech'),task('input','builder',{scope:scope(['contract.json']),produces:[{name:'api',version:'v1'}]}),task('other','tech')]);
  const first=actor(f,'A'),oldToken=f.service.memberTokens.get(first.id),firstThread=first.threadId;
  const result=await f.service.dynamic(f.m,first,'office_suspend',{checkpoint:'已完成定位，下一步使用接口',requires:[{name:'api',version:'v1'}]});
  assert.equal(result.released,false);assert.equal(first.status,'running');assert.equal(work(f,'other').status,'ready');complete(f,first);await tick();
  assert.equal(work(f,'A').status,'waiting_input');assert.equal(work(f,'other').status,'running');assert.equal(actor(f,'other').id,first.id);
  await assert.rejects(f.service.callMemberTool(oldToken,'office_report',{}),/过期/);
  const published=await publish(f,actor(f,'input'));await validate(f,f.boss,published);await tick();assert.equal(work(f,'A').status,'ready');await finish(f,'other');
  assert.equal(work(f,'A').status,'running');assert.equal(work(f,'A').generation,2);assert.notEqual(actor(f,'A').threadId,firstThread);assert.ok(actor(f,'A').sessionHistory.some(s=>s.threadId===firstThread));assert.match(f.bridge.calls.filter(c=>c.method==='turn/start').at(-1).params.input[0].text,/已完成定位/);
});

test('suspend rejects cyclic dependencies and missing producers',async t=>{
  const f=await fixture(t);await graph(f,[task('A','tech'),task('B','builder',{dependsOn:['A'],produces:[{name:'api',version:'v1'}]})]);
  await assert.rejects(f.service.dynamic(f.m,actor(f,'A'),'office_suspend',{checkpoint:'等待',requires:[{name:'api',version:'v1'}]}),/循环/);
  await assert.rejects(f.service.dynamic(f.m,actor(f,'A'),'office_suspend',{checkpoint:'等待',requires:[{name:'missing',version:'v1'}]}),/生产者/);
});

test('timeout requests interruption but retains actual slot until confirmation; retries fence old turns',async t=>{
  const f=await fixture(t);await graph(f,[task('A','tech',{timeoutSeconds:60}),task('B','tech')]);const a=actor(f,'A'),oldTurn=a.turnId;
  await f.service.checkHarnessTimeouts(Date.parse(work(f,'A').startedAt)+61000);assert.equal(a.status,'running');assert.equal(work(f,'B').status,'ready');assert.equal(work(f,'A').waitReason.kind,'timeout');
  complete(f,a,'interrupted');await tick();assert.equal(work(f,'A').status,'failed');assert.equal(work(f,'B').status,'running');
  complete(f,a,'completed',oldTurn);assert.equal(work(f,'B').status,'running');
  await f.service.dynamic(f.m,f.boss,'office_retry',{requestId:'retry-a',workId:work(f,'A').id,reason:'已核验无外部副作用',externalEffectsReviewed:true});await tick();await finish(f,'B');assert.equal(work(f,'A').generation,2);assert.equal(work(f,'A').status,'running');
  complete(f,actor(f,'A'),'completed',oldTurn);assert.equal(work(f,'A').status,'running');
});

test('predeclared independent review runs automatically then final synthesis is requested once',async t=>{
  const f=await fixture(t);await graph(f,[task('build','builder',{scope:scope([],['src'])}),task('review','ops',{scope:scope(['src']),reviewOf:['build']})]);complete(f,f.boss);await tick();
  await finish(f,'build');assert.equal(work(f,'review').status,'running');assert.equal(f.boss.status,'completed');await finish(f,'review');
  assert.deepEqual(qualityIssues(f.m),[]);assert.equal(f.boss.status,'running');complete(f,f.boss);await tick();assert.equal(f.m.status,'completed');
});

test('stop cancels waiting graph work, and restart does not silently replay unfinished work',async t=>{
  const f=await fixture(t);await graph(f,[task('A','tech'),task('B','builder',{dependsOn:['A']})]);await f.service.stop(f.m.id);assert.equal(f.m.status,'stopping');assert.equal(work(f,'B').status,'stopped');assert.equal(work(f,'A').status,'running');complete(f,actor(f,'A'),'interrupted');assert.equal(f.m.status,'stopped');assert.ok(f.m.workItems.every(w=>w.status==='stopped'));f.service.save();
  const bridge=new Bridge(),restored=new MissionService(bridge,{directory:f.directory,defaultCwd:f.cwd});t.after(()=>{clearInterval(restored.harnessTimer);clearTimeout(restored.saveTimer);clearTimeout(restored.broadcastTimer);});
  assert.equal(bridge.calls.length,0);assert.equal(restored.get(f.m.id).workItems[1].status,'stopped');
});

test('a new role is a capability preference, not an exclusive lane',async t=>{
  const f=await fixture(t);await graph(f,[task('specialist','tech'),task('flexible','tech',{eligibleRoles:['tech','ops']})]);assert.equal(actor(f,'specialist').role,'tech');assert.equal(actor(f,'flexible').role,'ops');
  assert.match(TEAM.find(a=>a.role==='ops').position,/验证/);assert.match(TEAM.find(a=>a.role==='boss').description,/依赖图/);
});

test('independent-review allocation cannot strand a review or recursively review reports',async t=>{
  const f=await fixture(t);await graph(f,[task('A','tech',{eligibleRoles:['ops','tech'],scope:scope([],['src'])}),task('R','ops',{reviewOf:['A'],scope:scope(['src'])})]);assert.equal(actor(f,'A').role,'tech');
  await assert.rejects(graph(f,[task('B','tech'),task('C','ops'),task('impossible','ops',{eligibleRoles:['ops','tech'],reviewOf:['B','C']})],'bad-review'),/独立复核所有/);
  await assert.rejects(graph(f,[task('recursive','tech',{reviewOf:['later']}),task('later','ops',{reviewOf:['A'],scope:scope(['src'])})],'recursive'),/递归/);
});

test('failed branch wakes the planner while independent branches keep running',async t=>{
  const f=await fixture(t);await graph(f,[task('A','tech'),task('B','builder'),task('C','ops')]);complete(f,f.boss);await tick();complete(f,actor(f,'A'),'failed');await tick();
  assert.equal(work(f,'B').status,'running');assert.equal(work(f,'C').status,'running');assert.equal(f.boss.status,'running');assert.equal(f.boss.coordinationOnly,true);assert.match(f.boss.task,/其他独立工作继续/);
});

test('repair graph preserves history and requires a review of the new work ID',async t=>{
  const f=await fixture(t);await graph(f,[task('build','builder',{scope:scope([],['src'])}),task('review','ops',{scope:scope(['src']),reviewOf:['build']})]);await finish(f,'build');await finish(f,'review');
  const oldBuild=work(f,'build'),oldReview=work(f,'review');await graph(f,[task('repair','builder',{scope:scope([],['src']),replaces:oldBuild.id}),task('review-again','ops',{scope:scope(['src']),reviewOf:['repair'],replaces:oldReview.id})],'repair');
  assert.equal(oldBuild.replacedBy,work(f,'repair').id);assert.equal(oldReview.replacedBy,work(f,'review-again').id);assert.ok(oldBuild.report);await finish(f,'repair');await finish(f,'review-again');assert.deepEqual(qualityIssues(f.m),[]);
});

test('retry IDs are idempotent even if a retried execution has already failed again',async t=>{
  const f=await fixture(t);await graph(f,[task('A','tech')]);complete(f,actor(f,'A'),'failed');await tick();
  const args={workId:work(f,'A').id,requestId:'one-business-retry',reason:'核查无外部副作用',externalEffectsReviewed:true};await f.service.dynamic(f.m,f.boss,'office_retry',args);await tick();complete(f,actor(f,'A'),'failed');await tick();
  const before=f.bridge.calls.length;assert.equal((await f.service.dynamic(f.m,f.boss,'office_retry',args)).duplicate,true);assert.equal(work(f,'A').retries,1);assert.equal(f.bridge.calls.length,before);
  await f.service.dynamic(f.m,f.boss,'office_retry',{...args,requestId:'second'});await tick();complete(f,actor(f,'A'),'failed');await tick();await assert.rejects(f.service.dynamic(f.m,f.boss,'office_retry',{...args,requestId:'third'}),/两次/);
});

test('unknown start response never frees a slot or permits a duplicate execution',async t=>{
  const f=await fixture(t),original=f.bridge.request.bind(f.bridge);let target;
  f.bridge.request=async(method,params)=>{const r=await original(method,params);if(method==='thread/start'&&params.model==='gpt-6-astra')target=r.thread.id;if(method==='turn/start'&&params.threadId===target)throw new Error('transport response timed out');return r;};
  await graph(f,[task('A','tech'),task('B','tech')]);assert.equal(work(f,'A').status,'waiting');assert.equal(work(f,'A').waitReason.kind,'uncertain');assert.equal(work(f,'B').agentId,null);
  await assert.rejects(f.service.dynamic(f.m,f.boss,'office_retry',{workId:work(f,'A').id,requestId:'unsafe',reason:'没有确认',externalEffectsReviewed:true}),/确认结束/);
  const a=actor(f,'A');f.service.notification({method:'turn/started',params:{threadId:a.threadId,turn:{id:'late-confirmation'}}});assert.equal(a.turnId,'late-confirmation');complete(f,a,'failed');await tick();assert.equal(work(f,'B').status,'waiting'); // B starts, but the fixture also drops its response.
});

test('ZCode graph transport uncertainty retains its known turn ID for cancellation and late events',async()=>{
  const bridge=new ZcodeBridge(),r={id:'fixture',model:'GLM-5.3',instructions:'test',turnId:null,textParts:new Map(),tools:new Map(),graphExecution:true};bridge.sessions.set('fixture',r);bridge.config={provider:{}};bridge.rpc=async()=>{throw new Error('uncertain send');};
  await assert.rejects(bridge.request('turn/start',{threadId:'zcode:fixture',input:[],effort:'high'}),error=>!!error.officeTurnId&&error.officeTurnId===r.turnId);
});

test('claim persistence failure restores an unassigned member without consuming a generation',async t=>{
  const f=await fixture(t),save=f.service.save.bind(f.service);let count=0;f.service.save=()=>++count===1?save():false;await graph(f,[task('A','ops')]);assert.equal(work(f,'A').status,'ready');assert.equal(work(f,'A').generation,0);assert.equal(work(f,'A').agentId,null);assert.equal(f.m.agents.find(a=>a.role==='ops').workId,undefined);f.service.save=save;
});

test('resource waits across missions do not consume planner turns',async t=>{
  const f=await fixture(t);await graph(f,[task('A','tech',{resources:[{name:'shared-browser'}]})]);const other=path.join(f.directory,'other');mkdirSync(other);const m=await f.service.create({prompt:'另一项目',cwd:other});await tick();const f2={...f,m,boss:m.agents[0]};await graph(f2,[task('B','builder',{resources:[{name:'shared-browser'}]})]);complete(f2,f2.boss);await tick();
  assert.equal(f2.boss.status,'completed');assert.equal(work(f2,'B').waitReason.kind,'resource');await finish(f,'A');assert.equal(work(f2,'B').status,'running');assert.equal(f2.boss.status,'completed');
});

test('state accounting records real wait categories without adding parallel task durations',()=>{
  const w={status:'ready',createdAt:new Date(1000).toISOString(),stateSince:new Date(1000).toISOString(),timings:{},generation:0};setWaitReason(w,{kind:'resource',message:'等待端口'},1000);transition(w,'running',null,4000);setWaitReason(w,{kind:'tool',message:'构建',target:'cmd'},5000);setWaitReason(w,null,7000);transition(w,'completed',null,8000);
  assert.equal(w.timings.ready,3000);assert.equal(w.timings.running,4000);assert.equal(w.waitTimings.resource,3000);assert.equal(w.waitTimings.tool,2000);assert.ok(w.timeline.some(e=>e.wait==='resource'));
});

test('graph panel shows unclaimed inputs, pinned versions, waits and escaped task content',async t=>{
  const f=await fixture(t);await graph(f,[task('A','tech',{produces:[{name:'api',version:'v1'}]}),task('B','builder',{task:'<img src=x onerror=bad>',requires:[{name:'api',version:'v1'}]})]);const html=collaborationPanel(f.service.snapshot().missions[0]);assert.match(html,/尚未占用人物/);assert.match(html,/api:v1/);assert.match(html,/输入等待/);assert.match(html,/独立验证通过/);assert.ok(!html.includes('<img'));
});

test('graph token display totals reported attempts, including failed attempts, without counting member totals twice',()=>{
  const result=collaborationUsage({harnessVersion:2,coordinatorId:'boss',agents:[{id:'boss',usage:{totalTokens:10}},{id:'worker',usage:{totalTokens:999}}],workItems:[{protocol:2,attempts:[{status:'failed',usage:{totalTokens:100,cachedInputTokens:50}},{usage:{totalTokens:20,outputTokens:5}}]},{protocol:2,attempts:[{}]}]});
  assert.deepEqual(result,{tasks:2,attempts:3,reported:3,totalTokens:130,cachedInputTokens:50,outputTokens:5});assert.equal(collaborationUsage({}),null);
});

test('a supplement addressed to one graph worker becomes that member own work item instead of being refused',async t=>{
  const f=await fixture(t);await graph(f,[task('A','builder',{scope:scope(['src'],['src'])})]);complete(f,f.boss);await tick();
  await finish(f,'A');
  const builder=actor(f,'A'),before=f.m.workItems.length,previousThread=builder.threadId;
  assert.equal(builder.status,'completed');
  await f.service.sendMessage(f.m.id,{agentId:builder.id,text:'把错误码补齐，并加一条回归测试'});
  assert.equal(f.m.workItems.length,before+1);
  const human=f.m.workItems.at(-1);
  assert.equal(human.protocol,2);assert.equal(human.human,true);assert.equal(human.key,'human-1');
  assert.deepEqual(human.eligibleRoles,['builder']);
  assert.equal(human.task,'把错误码补齐，并加一条回归测试');
  assert.deepEqual(human.scope,{readPaths:['src'],writePaths:['src']});
  assert.deepEqual(human.acceptance,work(f,'A').acceptance);
  assert.ok(human.priority>work(f,'A').priority);
  assert.equal(f.m.messages.at(-1).text,'把错误码补齐，并加一条回归测试');
  assert.equal(f.m.messages.at(-1).to,builder.id);
  assert.equal(f.m.status,'running');
  await tick();
  assert.equal(workFor(f.m,builder).id,human.id);          // the addressed member claimed it, no one else
  assert.equal(builder.status,'running');
  assert.equal(builder.task,human.task);
  assert.notEqual(builder.threadId,previousThread); // a new generation runs the new work item
});

test('a second direct supplement queues another work item for the same member',async t=>{
  const f=await fixture(t);await graph(f,[task('A','ops')]);complete(f,f.boss);await tick();await finish(f,'A');
  const ops=actor(f,'A');
  await f.service.sendMessage(f.m.id,{agentId:ops.id,text:'第一条补充'});
  await tick();
  complete(f,ops);await tick();
  await f.service.sendMessage(f.m.id,{agentId:ops.id,text:'第二条补充'});
  const keys=f.m.workItems.filter(w=>w.human).map(w=>w.key);
  assert.deepEqual(keys,['human-1','human-2']);
  assert.equal(f.m.workItems.find(w=>w.key==='human-1').status,'completed');
  await tick();
  assert.equal(workFor(f.m,ops).key,'human-2');
});

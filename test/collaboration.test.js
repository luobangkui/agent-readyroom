import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MissionService} from '../server/missions.js';
import {normalizeScope,scopesConflict,qualityIssues,workFor} from '../server/collaboration.js';
import {TEAM} from '../src/team.js';
import {sharedTools,bossTools} from '../server/prompts.js';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collaborationPanel} from '../src/collaboration-panel.js';
import {trySymlinkDirSync} from './fs-util.js';

class Bridge extends EventEmitter {
  constructor(){super();this.calls=[];this.seq=0;this.failSteer=false;}
  async request(method,params){
    this.calls.push({method,params});
    if(method==='thread/start'){const value={thread:{id:`thread-${++this.seq}`},model:params.model};if(params.model===this.holdModel)return new Promise(resolve=>{this.release=()=>resolve(value);});return value;}
    if(method==='turn/start')return {turn:{id:`turn-${++this.seq}`}};
    if(method==='turn/steer'&&this.failSteer)throw new Error('turn changed');
    return {};
  }
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t){
  const directory=mkdtempSync(path.join(tmpdir(),'office-collaboration-')),cwd=path.join(directory,'project');mkdirSync(cwd);
  const bridge=new Bridge(),service=new MissionService(bridge,{directory,defaultCwd:cwd});
  service.connection={connected:true,authenticated:true,models:TEAM.map(a=>({id:a.model,efforts:['high']}))};
  t.after(()=>{clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);rmSync(directory,{recursive:true,force:true});});
  const m=await service.create({prompt:'协作测试',mode:'team'});await tick();
  return {service,bridge,m,boss:m.agents[0],directory,cwd};
}
const scope=(readPaths=[],writePaths=[])=>({readPaths,writePaths});
async function assign(f,role,resources=scope(),extra={}){const result=await f.service.dynamic(f.m,f.boss,'office_delegate',{role,task:`${role} 检查`,dependsOn:[],scope:resources,...extra});await tick();return f.service.agent(f.m,result.agentId);}
const report=(f,a,extra={})=>f.service.dynamic(f.m,a,'office_report',{summary:'测试夹具的已核验成果',artifacts:[],checks:workFor(f.m,a).acceptance.length?workFor(f.m,a).acceptance.map((name,criterion)=>({name,criterion,result:'passed',evidence:'测试夹具中的可复现断言'})):[{name:'检查',result:'passed',evidence:'测试夹具中的可复现断言'}],risks:[],verdict:'ready',...extra});
function complete(f,a,status='completed'){f.service.notification({method:'turn/completed',params:{threadId:a.threadId,turn:{id:a.turnId,status,items:[{id:`result-${a.id}-${a.turnId}`,type:'agentMessage',phase:'final_answer',text:'测试成果'}]}}});}

test('three workers run together in disjoint scopes while the boss coordinates',async t=>{
  const f=await fixture(t),tech=await assign(f,'tech',scope(['contracts'],['design'])),builder=await assign(f,'builder',scope(['src/client'],['src/client'])),ops=await assign(f,'ops',scope(['references'],['docs']));
  assert.deepEqual([f.boss,tech,builder,ops].map(a=>a.status),['running','running','running','running']);
  assert.equal(f.bridge.calls.filter(c=>c.method==='turn/start').length,4);
  assert.match(f.bridge.calls.filter(c=>c.method==='turn/start').at(-1).params.input[0].text,/本轮协作工作单/);
});

test('readers can share the project and overlapping reader/writer work is serialized',async t=>{
  const f=await fixture(t),tech=await assign(f,'tech',scope(['src'])),ops=await assign(f,'ops',scope(['src'])),builder=await assign(f,'builder',scope([],['src/app.js']));
  assert.equal(tech.status,'running');assert.equal(ops.status,'running');assert.equal(builder.status,'queued');assert.match(builder.summary,/重叠/);
  complete(f,tech);await tick();assert.equal(builder.status,'queued');complete(f,ops);await tick();assert.equal(builder.status,'running');
});

test('directory prefixes, parent projects, traversal and symbolic links are handled conservatively',async t=>{
  const f=await fixture(t);mkdirSync(path.join(f.cwd,'src'));
  if(!trySymlinkDirSync(path.join(f.cwd,'src'),path.join(f.cwd,'alias'))||!trySymlinkDirSync(f.directory,path.join(f.cwd,'outside'))){t.skip('当前 Windows 环境不允许创建符号链接或 junction');return;}
  assert.deepEqual(normalizeScope(f.m,scope(['alias'],['new/file.js'])),scope(['src'],['new/file.js']));
  for(const p of ['../escape','outside/file','/absolute','src/**'])assert.throws(()=>normalizeScope(f.m,scope([], [p])),error=>error.status===400);
  assert.equal(scopesConflict(f.cwd,scope([],['src']),f.cwd,scope(['src2'])),false);
  assert.equal(scopesConflict(f.cwd,scope([],['src']),f.cwd,scope(['src/app.js'])),true);
  assert.equal(scopesConflict(f.cwd,scope([],['.']),path.join(f.cwd,'nested'),scope(['.'])),true);
  assert.throws(()=>normalizeScope({...f.m,mode:'plan'},scope([],['src'])),/只读/);
});

test('undeclared scope retains the safe whole-project fallback',async t=>{
  const f=await fixture(t),tech=await assign(f,'tech',undefined),builder=await assign(f,'builder',scope([],['docs']));
  // Explicitly exercise omission, not the helper default.
  await f.service.stop(f.m.id);assert.equal(builder.status,'stopped');
  const fresh=await f.service.create({prompt:'旧工具兼容'});await tick();
  const first=await f.service.dynamic(fresh,fresh.agents[0],'office_delegate',{role:'tech',task:'旧格式',dependsOn:[]});
  const second=await f.service.dynamic(fresh,fresh.agents[0],'office_delegate',{role:'builder',task:'旧格式',dependsOn:[]});await tick();
  assert.equal(f.service.agent(fresh,first.agentId).status,'running');assert.equal(f.service.agent(fresh,second.agentId).status,'queued');assert.deepEqual(first.scope,scope(['.'],['.']));
});

test('dependency work IDs remain pinned when a member later receives another assignment',async t=>{
  const f=await fixture(t),tech=await assign(f,'tech',scope()),version=tech.workId;
  const builder=await assign(f,'builder',scope(),{dependsOn:[tech.id]});assert.equal(builder.status,'queued');await report(f,tech);complete(f,tech);await tick();assert.equal(builder.status,'running');
  await f.service.dynamic(f.m,f.boss,'office_continue',{agentId:tech.id,task:'另一项工作',scope:scope()});await tick();
  assert.deepEqual(workFor(f.m,builder).dependsOn,[version]);assert.notEqual(tech.workId,version);
});

test('failed verification prevents dependent work from starting',async t=>{
  const f=await fixture(t),tech=await assign(f,'tech',scope()),builder=await assign(f,'builder',scope(),{dependsOn:[tech.id]});
  await report(f,tech,{checks:[{name:'失败检查',result:'failed',evidence:'可复现失败'}]});complete(f,tech);await tick();assert.equal(builder.status,'failed');assert.equal(workFor(f.m,builder).status,'failed');
});

test('new work without a report blocks downstream work while legacy results still reach new assignments',async t=>{
  const f=await fixture(t),tech=await assign(f,'tech',scope()),builder=await assign(f,'builder',scope(),{dependsOn:[tech.id]});
  complete(f,tech);await tick();assert.equal(builder.status,'failed');assert.match(builder.error,/证据/);
  const ops=f.m.agents.find(a=>a.role==='ops');ops.task='历史调研';ops.status='completed';ops.result='历史接口约束仍需核验';
  await assign(f,'builder',scope(),{dependsOn:[ops.id],replaces:builder.workId});
  assert.match(f.bridge.calls.filter(c=>c.method==='turn/start').at(-1).params.input[0].text,/历史接口约束仍需核验/);
});

test('messages sent to idle members survive and arrive with their first task',async t=>{
  const f=await fixture(t),ops=f.m.agents.find(a=>a.role==='ops');const sent=await f.service.dynamic(f.m,f.boss,'office_message',{agentId:ops.id,message:'重要交接，不要丢失'});
  assert.equal(sent.queued,true);assert.equal(ops.status,'idle');await assign(f,'ops',scope());
  const call=f.bridge.calls.filter(c=>c.method==='turn/start').at(-1);assert.match(call.params.input[0].text,/重要交接，不要丢失/);
  const inbox=await f.service.dynamic(f.m,ops,'office_inbox',{});assert.equal(inbox.messages[0].id,sent.messageId);assert.equal((await f.service.dynamic(f.m,ops,'office_inbox',{})).messages.length,0);
});

test('messages are saved before delivery and storage failure is not reported as success',async t=>{
  const f=await fixture(t),ops=await assign(f,'ops',scope());
  await f.service.dynamic(f.m,f.boss,'office_message',{agentId:ops.id,message:'先落盘再投递'});
  assert.equal(JSON.parse(readFileSync(f.service.file,'utf8'))[0].mailbox[0].text,'先落盘再投递');
  const original=f.service.file,before=f.bridge.calls.filter(c=>c.method==='turn/steer').length;f.service.file=path.join(f.directory,'missing','missions.json');
  await assert.rejects(f.service.dynamic(f.m,f.boss,'office_message',{agentId:ops.id,message:'存储失败不得假称成功'}),/尚未成功保存/);
  assert.equal(f.bridge.calls.filter(c=>c.method==='turn/steer').length,before);f.service.file=original;
});

test('initialization races and failed realtime delivery retain a readable inbox',async t=>{
  const f=await fixture(t);f.bridge.holdModel='GLM-5.3-Flash';const pending=await f.service.dynamic(f.m,f.boss,'office_delegate',{role:'ops',task:'准备任务',dependsOn:[],scope:scope()});
  const ops=f.service.agent(f.m,pending.agentId);assert.equal(ops.status,'starting');await f.service.dynamic(f.m,f.boss,'office_message',{agentId:ops.id,message:'初始化期间的消息'});
  f.bridge.release();await tick();assert.match(f.bridge.calls.filter(c=>c.method==='turn/start').at(-1).params.input[0].text,/初始化期间的消息/);
  f.bridge.failSteer=true;const sent=await f.service.dynamic(f.m,f.boss,'office_message',{agentId:ops.id,message:'实时投递失败也保留'});assert.equal(sent.delivered,false);
  const inbox=await f.service.dynamic(f.m,ops,'office_inbox',{});assert.ok(inbox.messages.some(msg=>msg.id===sent.messageId));
});

test('unread messages persist across restart without automatically starting members',async t=>{
  const f=await fixture(t),ops=f.m.agents.find(a=>a.role==='ops');await f.service.dynamic(f.m,f.boss,'office_message',{agentId:ops.id,message:'重启后交接'});f.service.save();
  const bridge=new Bridge(),restored=new MissionService(bridge,{directory:f.directory,defaultCwd:f.cwd});t.after(()=>{clearTimeout(restored.saveTimer);clearTimeout(restored.broadcastTimer);});
  const m=restored.get(f.m.id);assert.equal(m.mailbox[0].text,'重启后交接');assert.equal(bridge.calls.length,0);assert.equal(m.agents.find(a=>a.id===ops.id).status,'idle');
});

test('revision waits ignore other missions and stop releases the wait',async t=>{
  const f=await fixture(t);await assign(f,'tech',scope());const snapshot=await f.service.dynamic(f.m,f.boss,'office_team',{waitSeconds:0});
  assert.deepEqual(await f.service.dynamic(f.m,f.boss,'office_team',{waitSeconds:0,afterRevision:snapshot.revision}),{changed:false,revision:snapshot.revision,pending:true});
  let resolved=false;const wait=f.service.dynamic(f.m,f.boss,'office_team',{waitSeconds:25,afterRevision:snapshot.revision}).then(r=>{resolved=true;return r;});
  f.service.emit('collaboration-change','another-mission');await tick();assert.equal(resolved,false);await f.service.stop(f.m.id);await wait;assert.equal(f.service.listenerCount('collaboration-change'),0);assert.ok(f.m.workItems.every(w=>w.status==='stopped'));
});

test('a write artifact cannot self-review or be reviewed while it is still running',async t=>{
  const f=await fixture(t),builder=await assign(f,'builder',scope([],['src']));
  await assert.rejects(assign(f,'tech',scope(['src']),{reviewOf:[builder.workId]}),/等待/);await report(f,builder);complete(f,builder);await tick();
  await assert.rejects(assign(f,'builder',scope(['src']),{reviewOf:[builder.workId]}),/作者不能/);
  await assert.rejects(assign(f,'tech',scope(['docs']),{reviewOf:[builder.workId]}),/覆盖/);
  await assert.rejects(assign(f,'tech',scope(['src'],['docs']),{reviewOf:[builder.workId]}),/只读/);
  assert.ok(qualityIssues(f.m).some(issue=>issue.includes('独立复核')));
});

test('delivery succeeds only with reports, passing checks and independent review',async t=>{
  const f=await fixture(t),builder=await assign(f,'builder',scope([],['src']),{acceptance:['可复现验证']});await report(f,builder);complete(f,builder);await tick();
  const tech=await assign(f,'tech',scope(['src']),{reviewOf:[builder.workId]});await report(f,tech);complete(f,tech);await tick();
  assert.deepEqual(qualityIssues(f.m),[]);complete(f,f.boss);await tick();assert.equal(f.m.status,'completed');assert.equal(f.m.quality.status,'passed');
});

test('later overlapping writes invalidate reviews and repairs require fresh independent review',async t=>{
  const f=await fixture(t),builder=await assign(f,'builder',scope([],['src']));await report(f,builder);complete(f,builder);await tick();
  const tech=await assign(f,'tech',scope(['src']),{reviewOf:[builder.workId]});await report(f,tech);complete(f,tech);await tick();const oldReview=tech.workId,oldBuild=builder.workId;
  await f.service.dynamic(f.m,f.boss,'office_continue',{agentId:builder.id,task:'修复',scope:scope([],['src']),replaces:oldBuild});await tick();assert.equal(f.m.workItems.find(w=>w.id===oldReview).stale,true);
  await report(f,builder);complete(f,builder);await tick();assert.ok(qualityIssues(f.m).some(issue=>issue.includes('独立复核')));
  await f.service.dynamic(f.m,f.boss,'office_continue',{agentId:tech.id,task:'重新复核',scope:scope(['src']),reviewOf:[builder.workId],replaces:oldReview});await tick();await report(f,tech);complete(f,tech);assert.deepEqual(qualityIssues(f.m),[]);
});

test('observed writes outside a declared scope block acceptance',async t=>{
  const f=await fixture(t),builder=await assign(f,'builder',scope([],['src']));
  f.service.notification({method:'item/completed',params:{threadId:builder.threadId,item:{id:'edit',type:'fileChange',status:'completed',changes:[{path:'package.json',kind:'update',diff:'test'}]}}});
  await report(f,builder);complete(f,builder);assert.ok(workFor(f.m,builder).violations.length);assert.ok(qualityIssues(f.m).some(issue=>issue.includes('越界')));
});

test('missing evidence triggers at most two quality followups then needs attention',async t=>{
  const f=await fixture(t),ops=await assign(f,'ops',scope());complete(f,ops);await tick();
  for(let i=0;i<3;i++){complete(f,f.boss);await tick();}
  assert.equal(f.m.qualityRounds,2);assert.equal(f.m.status,'needs_attention');assert.throws(()=>f.service.accept(f.m.id),/尚未交付/);
});

test('all workers receive inbox, board and report tools; only boss receives delegation tools',()=>{
  for(const name of ['office_inbox','office_team','office_report'])assert.ok(sharedTools.some(t=>t.name===name));
  assert.ok(!sharedTools.some(t=>t.name==='office_delegate'));assert.equal(bossTools.filter(t=>t.name==='office_team').length,1);
});

test('MCP tool inventory serves current schemas for each role without a model call',()=>{
  for(const role of ['boss','tech','builder','ops']){
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../server/office-mcp.mjs',import.meta.url))],{encoding:'utf8',env:{...process.env,OFFICE_MCP_ROLE:role},input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n',timeout:5000});
    assert.equal(result.status,0);const tools=JSON.parse(result.stdout).result.tools;
    assert.ok(tools.some(t=>t.name==='office_report'));assert.equal(tools.some(t=>t.name==='office_delegate'),role==='boss');
    if(role==='boss')assert.ok(tools.find(t=>t.name==='office_delegate').inputSchema.properties.scope);
  }
});

test('restored Codex sessions receive the current office MCP tools without replacing their thread IDs',async t=>{
  const f=await fixture(t);f.service.save();const bridge=new Bridge(),restored=new MissionService(bridge,{directory:f.directory,defaultCwd:f.cwd});restored.connection=f.service.connection;
  t.after(()=>{clearTimeout(restored.saveTimer);clearTimeout(restored.broadcastTimer);});
  await restored.sendMessage(f.m.id,{text:'继续'});await tick();const resume=bridge.calls.find(c=>c.method==='thread/resume');
  assert.equal(resume.params.threadId,f.boss.threadId);const mcp=resume.params.config['mcp_servers.office'];assert.equal(mcp.required,true);assert.equal(mcp.env.OFFICE_MCP_ROLE,'boss');assert.ok(mcp.args[0].endsWith('office-mcp.mjs'));
});

test('all acceptance criteria must be covered and a changed report invalidates its old review',async t=>{
  const f=await fixture(t),builder=await assign(f,'builder',scope([],['src']),{acceptance:['主路径','边界条件']});
  // 全部通过但缺编号覆盖的 ready 报告在提交时就被拒绝，未编号的边界检查不计入覆盖。
  await assert.rejects(report(f,builder,{checks:[{name:'主路径',criterion:0,result:'passed',evidence:'只有一个检查'}]}),/criterion 1（边界条件）/);
  await assert.rejects(report(f,builder,{checks:[{name:'主路径',criterion:0,result:'passed',evidence:'主路径'},{name:'边界检查',result:'passed',evidence:'没有编号不算覆盖'}]}),/未编号的检查不计入验收覆盖/);
  await report(f,builder,{verdict:'blocked',checks:[{name:'主路径',criterion:0,result:'passed',evidence:'主路径'}]});
  assert.equal(workFor(f.m,builder).report.verdict,'blocked');
  // 含 not_run 的 ready 报告如实落库，由质量门标记验收未覆盖。
  await report(f,builder,{checks:[{name:'主路径',criterion:0,result:'passed',evidence:'主路径'},{name:'边界条件',criterion:1,result:'not_run',evidence:'尚未执行'}]});complete(f,builder);await tick();assert.ok(qualityIssues(f.m).some(i=>i.includes('验收项未覆盖')));
  await report(f,builder);const tech=await assign(f,'tech',scope(['src']),{reviewOf:[builder.workId]});await report(f,tech);complete(f,tech);assert.deepEqual(qualityIssues(f.m),[]);
  await report(f,builder,{summary:'作者修改了交付描述'});assert.equal(workFor(f.m,tech).stale,true);
});

test('a stalled graph blocker still spends its two quality rounds before parking',async t=>{
  const f=await fixture(t),builder=f.m.agents.find(a=>a.role==='builder');
  const work=(id,key,over={})=>({id,protocol:2,key,task:`${key} 任务`,eligibleRoles:['builder'],agentId:null,role:null,scope:scope(['.'],[]),acceptance:['证据留档'],dependsOn:[],requires:[],produces:[],reviewOf:[],resources:[],priority:0,timeoutSeconds:1800,status:'waiting_input',report:null,violations:[],generation:0,retries:0,attempts:[],createdAt:new Date().toISOString(),stateSince:new Date().toISOString(),timings:{},waitReason:{kind:'input',message:'等待检查输入'},...over});
  // 复现图阻塞叠加证据缺项的卡局：补验单已完成但报告缺 criterion 覆盖（下游永远等
  // 证据），旧复核单又依赖已被替代的工作，成为谁也推进不了的死节点。
  const dep=work('work_dep0001','deploy-a-1c',{status:'completed',agentId:builder.id,role:'builder',acceptance:['证据留档','不触碰面板'],report:{summary:'补验完成',artifacts:[],checks:[{name:'主检查',criterion:0,result:'passed',evidence:'证据'},{name:'边界',result:'passed',evidence:'未编号不计入覆盖'}],risks:[],verdict:'ready',createdAt:new Date().toISOString()}});
  const old=work('work_old0003','run-exec',{status:'stopped',replacedBy:'work_new0004'});
  const zombie=work('work_rev0002','review-exec-old',{eligibleRoles:['tech'],dependsOn:['work_old0003'],waitReason:{kind:'failed_input',target:'work_old0003',message:'依赖 run-exec 失败、中断或已替代'}});
  const fresh=work('work_new0004','admin-session-v2',{dependsOn:['work_dep0001'],waitReason:{kind:'evidence',target:'work_dep0001',message:'等待 deploy-a-1c 补齐通过的交付证据'}});
  f.m.harnessVersion=2;f.m.workItems=[dep,old,zombie,fresh];
  complete(f,f.boss);await tick();
  assert.equal(f.boss.status,'running');assert.match(f.boss.task,/程序调度发现以下工作无法推进/);assert.match(f.boss.task,/证据缺项/);assert.equal(f.m.qualityRounds||0,0);
  complete(f,f.boss);await tick();
  assert.equal(f.m.qualityRounds,1);assert.equal(f.boss.status,'running');assert.match(f.boss.task,/证据补全 1\/2/);assert.match(f.boss.task,/work_dep0001 有阻塞/);
  complete(f,f.boss);await tick();
  assert.equal(f.m.qualityRounds,2);assert.match(f.boss.task,/证据补全 2\/2/);
  complete(f,f.boss);await tick();
  assert.equal(f.m.status,'needs_attention');assert.equal(f.m.phase,'blocked');assert.equal(f.boss.status,'completed');
});

test('collaboration panel exposes scope, evidence and missing checks and escapes untrusted content',()=>{
  assert.equal(collaborationPanel({}), '');
  const m={quality:{status:'pending',issues:['缺少 <证据>']},workItems:[{id:'w1',agentId:'a1',task:'<script>bad</script>',status:'completed',scope:scope(['src'],[]),acceptance:['边界'],dependsOn:[],reviewOf:['w0'],stale:true,report:{summary:'检查完成',verdict:'blocked',artifacts:[],checks:[{name:'测试',result:'failed',evidence:'<img onerror=bad>'}],risks:['未完成']}}]};
  const html=collaborationPanel(m,()=>'<角色>');assert.match(html,/独立复核/);assert.match(html,/复核已过期/);assert.match(html,/验收待补全/);assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/读取：src/);
});

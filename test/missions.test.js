import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MissionService} from '../server/missions.js';
import {instructions} from '../server/prompts.js';

class Bridge extends EventEmitter {
  constructor(){super();this.calls=[];this.responses=[];this.seq=0;}
  async start(){}
  async request(method,params){this.calls.push({method,params});if(method==='thread/start')return {thread:{id:'thread-'+(++this.seq)},model:params.model};if(method==='turn/start')return {turn:{id:'turn-'+(++this.seq)}};if(method==='account/read')return {account:{type:'chatgpt'}};if(method==='model/list')return {data:[{model:'gpt-6-astra',displayName:'GPT-6 Astra',provider:'codex',supportedReasoningEfforts:[{reasoningEffort:'low'}]},{model:'gpt-5.6-sol',displayName:'GPT-5.6 Sol',provider:'codex',supportedReasoningEfforts:[{reasoningEffort:'low'}]},{model:'GLM-5.3',displayName:'GLM-5.3',provider:'zcode',supportedReasoningEfforts:[{reasoningEffort:'low'}]},{model:'GLM-5.3-Flash',displayName:'GLM-5.3-Flash',provider:'zcode',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};return {};}
  respond(id,result){this.responses.push({id,result});}
  reject(id,message){this.responses.push({id,error:message});}
}
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(t){const directory=mkdtempSync(path.join(os.tmpdir(),'office-test-'));const bridge=new Bridge();const service=new MissionService(bridge,{directory,defaultCwd:directory});service.connection={connected:true,authenticated:true,providers:{codex:{connected:true,authenticated:true},zcode:{connected:true,authenticated:true}},models:[{id:'gpt-6-astra',efforts:['low']},{id:'gpt-5.6-sol',efforts:['low']},{id:'GLM-5.3',efforts:['low']},{id:'GLM-5.3-Flash',efforts:['low']}]};t.after(()=>{clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);rmSync(directory,{recursive:true,force:true});});return {bridge,service,directory};}
const create=service=>service.create({prompt:'完成一个受限测试任务',mode:'team',model:'gpt-6-astra',effort:'low'});
function complete(service,m,a,status='completed',text='Verified result'){service.notification({method:'turn/completed',params:{threadId:a.threadId,turn:{id:a.turnId,status,items:[{id:'result-'+a.id,type:'agentMessage',phase:'final_answer',text}],error:status==='failed'?{message:'worker failed'}:null}}});}

test('only one writer per directory; reader dependencies start after writer completion',async t=>{const {service,bridge}=fixture(t),m=await create(service);await tick();const boss=m.agents[0];const first=await service.dynamic(m,boss,'office_delegate',{name:'夏禾',role:'builder',task:'创建文件',dependsOn:[]});const second=await service.dynamic(m,boss,'office_delegate',{name:'阿澄',role:'ops',task:'更新文件',dependsOn:[]});const review=await service.dynamic(m,boss,'office_delegate',{name:'小满',role:'reviewer',task:'检查文件',dependsOn:[first.agentId,second.agentId]});await tick();assert.equal(service.agent(m,first.agentId).status,'running');assert.equal(service.agent(m,second.agentId).status,'queued');assert.equal(service.agent(m,review.agentId).status,'queued');await service.dynamic(m,service.agent(m,first.agentId),'office_report',{summary:'模拟检查',artifacts:[],checks:[{name:'检查',result:'passed',evidence:'测试夹具'}],risks:[],verdict:'ready'});complete(service,m,service.agent(m,first.agentId));await tick();assert.equal(service.agent(m,second.agentId).status,'running');assert.equal(service.agent(m,review.agentId).status,'queued');await service.dynamic(m,service.agent(m,second.agentId),'office_report',{summary:'模拟检查',artifacts:[],checks:[{name:'检查',result:'passed',evidence:'测试夹具'}],risks:[],verdict:'ready'});complete(service,m,service.agent(m,second.agentId));await tick();await tick();assert.equal(service.agent(m,review.agentId).status,'running');const reviewerThread=bridge.calls.filter(c=>c.method==='thread/start').at(-1);assert.equal(reviewerThread.params.sandbox,'danger-full-access');assert.equal(reviewerThread.params.approvalPolicy,'never');});

test('cross-mission delegation and messaging cannot address another mission member',async t=>{const {service}=fixture(t),m=await create(service),other=await create(service);await tick();await assert.rejects(service.dynamic(m,m.agents[0],'office_message',{agentId:other.agents[0].id,message:'bad'}),/不属于/);await assert.rejects(service.dynamic(m,m.agents[0],'office_delegate',{name:'检查',role:'reviewer',task:'bad',dependsOn:[other.agents[0].id]}),/不属于/);});

test('stop interrupts active turns and cancels queued work; no late launch',async t=>{const {service,bridge}=fixture(t),m=await create(service);await tick();await service.dynamic(m,m.agents[0],'office_delegate',{name:'执行',role:'builder',task:'工作',dependsOn:[]});await tick();await service.stop(m.id);assert.equal(m.status,'stopped');assert.equal(service.agent(m,m.coordinatorId).status,'stopped');assert.equal(service.agent(m,m.agents.find(a=>a.role==='builder').id).status,'stopped');assert.equal(bridge.calls.filter(c=>c.method==='turn/interrupt').length,2);await assert.rejects(service.dynamic(m,m.agents[0],'office_delegate',{name:'late',role:'builder',task:'late',dependsOn:[]}),/停止/);});

test('new missions always create the four fixed roles with their assigned runtimes',async t=>{const {service}=fixture(t),m=await create(service);assert.deepEqual(m.agents.map(a=>[a.role,a.model,a.provider]),[['boss','gpt-5.6-sol','codex'],['tech','gpt-6-astra','codex'],['builder','GLM-5.3','zcode'],['ops','GLM-5.3-Flash','zcode']]);assert.equal(m.agents.length,4);});
test('role contracts guide routing without blocking legitimate file handoffs',async t=>{const {service}=fixture(t),m=await create(service);await tick();const boss=m.agents.find(a=>a.role==='boss');const tech=m.agents.find(a=>a.role==='tech'),builder=m.agents.find(a=>a.role==='builder'),ops=m.agents.find(a=>a.role==='ops');const prompt=instructions(m,boss);assert.match(prompt,/岗位合同/);assert.match(prompt,/验证与资料支持/);for(const [role,task] of [['tech','技术负责人创建并修改架构说明和必要代码'],['builder','研发工程师实现功能并写测试'],['ops','运营专员创建交接文档并整理资料']]){const result=await service.dynamic(m,boss,'office_delegate',{role,task,dependsOn:[]});assert.equal(result.role,role);const agent={tech,builder,ops}[role];agent.status='idle';}assert.equal(tech.write,true);assert.equal(builder.write,true);assert.equal(ops.write,true);});

test('public URL fallback reads exact pages without allowing local network targets',async t=>{const {service}=fixture(t);const html='<!doctype html><title>Scheduling Demo</title><main>Hello <b>office</b></main>';const fakeFetch=async(url,options)=>{assert.equal(url.href,'https://example.com/demo');assert.equal(options.method,'GET');return {ok:true,status:200,headers:{get:name=>name==='content-type'?'text/html; charset=utf-8':''},text:async()=>html};};const result=await service.fetchPublicUrl('https://example.com/demo',fakeFetch);assert.deepEqual({status:result.status,title:result.title,text:result.text,truncated:result.truncated},{status:200,title:'Scheduling Demo',text:'Scheduling Demo Hello office',truncated:false});await assert.rejects(service.fetchPublicUrl('http://127.0.0.1:4317/'),/本机或内网/);});

test('boss and technical lead have full execution; explicit plan mode stays read-only',async t=>{const {service,bridge}=fixture(t),m=await create(service);await tick();const boss=m.agents.find(a=>a.role==='boss'),tech=m.agents.find(a=>a.role==='tech');assert.equal(boss.fullAccess,true);assert.equal(boss.write,true);assert.equal(tech.fullAccess,true);const bossStart=bridge.calls.find(c=>c.method==='thread/start'&&c.params.model==='gpt-5.6-sol');assert.equal(bossStart.params.sandbox,'danger-full-access');assert.equal(bossStart.params.approvalPolicy,'never');assert.equal(bossStart.params.approvalsReviewer,undefined);assert.match(bossStart.params.developerInstructions,/完全执行模式/);assert.doesNotMatch(bossStart.params.developerInstructions,/直接修改项目文件","代替/);await service.dynamic(m,boss,'office_delegate',{role:'tech',task:'只读审查当前结构',dependsOn:[]});await tick();const techStart=bridge.calls.find(c=>c.method==='thread/start'&&c.params.model==='gpt-6-astra');assert.equal(techStart.params.sandbox,'danger-full-access');assert.equal(techStart.params.approvalPolicy,'never');await service.stop(m.id);const plan=await service.create({prompt:'只出方案',mode:'plan',effort:'low'});await tick();const planStart=bridge.calls.filter(c=>c.method==='thread/start'&&c.params.model==='gpt-5.6-sol').at(-1);assert.equal(planStart.params.sandbox,'read-only');assert.equal(planStart.params.approvalPolicy,'on-request');assert.equal(plan.agents[0].write,false);});

test('ZCode workers use yolo execution for ordinary missions',async t=>{const {service,bridge}=fixture(t),m=await create(service);await tick();const boss=m.agents.find(a=>a.role==='boss');await service.dynamic(m,boss,'office_delegate',{role:'builder',task:'创建或修改实现文件并运行验证',dependsOn:[]});await tick();const worker=bridge.calls.find(c=>c.method==='thread/start'&&c.params.model==='GLM-5.3');assert.equal(worker.params.sandbox,'danger-full-access');assert.equal(worker.params.officeYolo,true);assert.equal(worker.params.approvalPolicy,'never');});

test('mid-turn human input uses steering on the exact active turn',async t=>{const {service,bridge}=fixture(t),m=await create(service);await tick();const a=m.agents[0],turnId=a.turnId;await service.sendMessage(m.id,{text:'增加中文说明'});const call=bridge.calls.at(-1);assert.equal(call.method,'turn/steer');assert.equal(call.params.expectedTurnId,turnId);assert.equal(m.messages.at(-1).text,'增加中文说明');});

test('Codex auth failure interrupts the conversation instead of leaving it falsely running',async t=>{
  const {service,bridge}=fixture(t),m=await create(service);await tick();const a=m.agents[0];
  const error='Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.';
  service.notification({method:'turn/completed',params:{threadId:a.threadId,turn:{id:a.turnId,status:'failed',error:{message:error},items:[]}}});
  bridge.emit('provider-disconnected',{provider:'codex',message:'本地 Codex 连接已失效，请重新登录后点击“重建本地连接”。',authFailed:true});
  assert.equal(a.status,'failed');
  assert.equal(m.status,'interrupted');
  assert.equal(m.finishedAt,null);
  await assert.rejects(service.sendMessage(m.id,{text:'继续对话'}),/需要 GPT-5\.6 Sol|连接/);
});

test('approval stays pending until an explicit answer and only grants the single command',async t=>{const {service,bridge}=fixture(t),m=await create(service);await tick();const a=m.agents[0];await service.handleRequest({id:100,method:'item/commandExecution/requestApproval',params:{threadId:a.threadId,turnId:a.turnId,itemId:'cmd',command:'touch allowed.txt',cwd:m.cwd,reason:'test',availableDecisions:['accept','decline']}});assert.equal(bridge.responses.length,0);assert.equal(a.status,'waiting');await service.answer(m.id,m.requests[0].id,{decision:'accept'});assert.deepEqual(bridge.responses[0],{id:100,result:{decision:'accept'}});await assert.rejects(service.answer(m.id,m.requests[0].id,{decision:'accept'}),/已处理/);});

test('question response has exact protocol shape and secret answers are not persisted',async t=>{const {service,bridge}=fixture(t),m=await create(service);await tick();const a=m.agents[0];await service.handleRequest({id:101,method:'item/tool/requestUserInput',params:{threadId:a.threadId,turnId:a.turnId,itemId:'q',isBlocking:true,questions:[{id:'choice',header:'问题',question:'选择?',isSecret:true}]}});await service.answer(m.id,m.requests[0].id,{answers:{choice:'test-private-answer'}});assert.deepEqual(bridge.responses[0].result,{answers:{choice:{answers:['test-private-answer']}}});assert.ok(!JSON.stringify(m).includes('test-private-answer'));});

test('runtime re-delivery of a pending question merges into one card; one answer replies to every rpc',async t=>{
  const {service,bridge}=fixture(t),m=await create(service);await tick();const a=m.agents[0];
  const ask=(id,question)=>service.handleRequest({id,method:'item/tool/requestUserInput',params:{threadId:a.threadId,turnId:a.turnId,itemId:'q',isBlocking:true,questions:[{id:'q0',header:'GitHub 推送',question,options:[{label:'我自己去建仓库（推荐）',description:''}]}]}});
  await ask(200,'本地 git 仓库已经建好，你想怎么处理？');await ask(201,'本地 git 仓库已经建好，你想怎么处理？');await ask(202,'本地 git 仓库已经建好，你想怎么处理？');
  assert.equal(m.requests.filter(r=>r.status==='pending').length,1);
  assert.deepEqual(m.requests[0].rpcIds,[200,201,202]);
  assert.equal(m.events.filter(e=>e.kind==='request').length,1);
  assert.equal(a.status,'waiting');
  await ask(203,'换一个不同的问题？');
  assert.equal(m.requests.filter(r=>r.status==='pending').length,2);
  await service.answer(m.id,m.requests[0].id,{answers:{q0:'我自己去建仓库'}});
  assert.deepEqual(bridge.responses.map(r=>r.id),[200,201,202]);
  assert.ok(bridge.responses.slice(0,3).every(r=>r.result.answers.q0.answers[0]==='我自己去建仓库'));
  assert.equal(m.requests[0].status,'answered');
  assert.equal(m.requests[1].status,'pending');
});

test('coordinator cannot finish mission while a member is running, then receives final synthesis',async t=>{const {service}=fixture(t),m=await create(service);await tick();const boss=m.agents[0];const delegated=await service.dynamic(m,boss,'office_delegate',{name:'执行',role:'builder',task:'工作',dependsOn:[],scope:{readPaths:['.'],writePaths:[]}});await tick();complete(service,m,boss);assert.equal(m.status,'running');await new Promise(r=>setTimeout(r,3));await service.dynamic(m,service.agent(m,delegated.agentId),'office_report',{summary:'只读检查完成',artifacts:[],checks:[{name:'检查',result:'passed',evidence:'已查看目录结构'}],risks:[],verdict:'ready'});complete(service,m,service.agent(m,delegated.agentId));await tick();assert.equal(boss.status,'running');assert.equal(m.autoSummaries,1);complete(service,m,boss,'completed','最终交付');assert.equal(m.status,'completed');assert.equal(boss.result,'最终交付');});

test('restart marks active work interrupted and only resumes after human continuation',async t=>{const {service,bridge,directory}=fixture(t),m=await create(service);await tick();service.save();const restarted=new MissionService(bridge,{directory,defaultCwd:directory});t.after(()=>{clearTimeout(restarted.saveTimer);clearTimeout(restarted.broadcastTimer);});restarted.connection=service.connection;assert.equal(restarted.missions[0].status,'interrupted');assert.equal(restarted.missions[0].agents[0].turnId,null);const before=bridge.calls.length;assert.equal(bridge.calls.length,before);await restarted.sendMessage(m.id,{text:'继续原任务'});await tick();assert.ok(bridge.calls.slice(before).some(c=>c.method==='thread/resume'));});

test('new coordinators leave room for workers instead of deadlocking concurrency',async t=>{const {service,directory}=fixture(t);const missions=[];for(let i=0;i<4;i++){const cwd=path.join(directory,`project-${i}`);mkdirSync(cwd);missions.push(await service.create({prompt:'测试独立项目并发',mode:'team',effort:'low',cwd}));}await tick();assert.equal(missions.filter(m=>m.agents[0].status==='running').length,2);await service.dynamic(missions[0],missions[0].agents[0],'office_delegate',{name:'调研',role:'researcher',task:'查看',dependsOn:[]});await tick();assert.equal(missions[0].agents[1].status,'running');});

test('full-access bosses serialize across missions but do not block their own delegated workers',async t=>{
  const {service}=fixture(t),first=await create(service),second=await create(service);await tick();
  const boss=first.agents[0],otherBoss=second.agents[0];assert.equal(boss.status,'running');assert.equal(otherBoss.status,'queued');
  const {agentId}=await service.dynamic(first,boss,'office_delegate',{role:'builder',task:'修改项目文件',dependsOn:[]});await tick();
  const child=service.agent(first,agentId);assert.equal(child.status,'running');assert.equal(otherBoss.status,'queued');
  assert.match((await service.dynamic(first,boss,'office_team',{waitSeconds:0})).writeHandoff,/不要同时修改/);
  complete(service,first,child);await tick();assert.equal(otherBoss.status,'queued');
  assert.match((await service.dynamic(first,boss,'office_team',{waitSeconds:0})).writeHandoff,/可以接手/);
  await service.dynamic(first,boss,'office_continue',{agentId,task:'补充测试'});await tick();assert.equal(child.status,'running');
  complete(service,first,child);await tick();complete(service,first,boss);await tick();assert.equal(otherBoss.status,'running');
});

test('saved read-only boss sessions migrate access and contracts without losing their conversation',async t=>{
  const {service,bridge,directory}=fixture(t),m=await create(service);await tick();const boss=m.agents[0],threadId=boss.threadId;
  boss.fullAccess=false;boss.write=false;boss.description='旧只读老板';boss.contract={forbidden:['直接修改项目文件']};service.save();
  const restarted=new MissionService(bridge,{directory,defaultCwd:directory});t.after(()=>{clearTimeout(restarted.saveTimer);clearTimeout(restarted.broadcastTimer);});restarted.connection=service.connection;
  const saved=restarted.get(m.id),updated=saved.agents[0];assert.equal(updated.fullAccess,true);assert.equal(updated.write,true);assert.equal(updated.threadId,threadId);assert.deepEqual(saved.messages,m.messages);assert.ok(updated.contract.allowed.includes('直接实现简单任务'));assert.ok(!updated.contract.forbidden.includes('直接修改项目文件'));
  const before=bridge.calls.length;await restarted.sendMessage(m.id,{text:'继续执行'});await tick();const resume=bridge.calls.slice(before).find(c=>c.method==='thread/resume');assert.equal(resume.params.threadId,threadId);assert.equal(resume.params.sandbox,'danger-full-access');assert.equal(resume.params.approvalPolicy,'never');assert.match(resume.params.developerInstructions,/完全执行模式/);
});

test('plan mode never grants write permission, invalid paths and effort fail at boundary',async t=>{const {service,bridge}=fixture(t);const m=await service.create({prompt:'只出方案',mode:'plan',effort:'low'});await tick();assert.equal(m.agents[0].write,false);assert.equal(bridge.calls.find(c=>c.method==='thread/start').params.sandbox,'read-only');await assert.rejects(service.create({prompt:'x',cwd:'/this/path/does/not/exist',effort:'low'}),/目录不存在/);await assert.rejects(service.create({prompt:'x',effort:'none'}),/不支持/);});

test('plan steps come from explicit real model updates and reject invalid status',async t=>{const {service}=fixture(t),m=await create(service);await tick();const a=m.agents[0];const r=await service.dynamic(m,a,'office_plan',{steps:[{step:'实现',status:'completed'},{step:'检查',status:'inProgress'}],explanation:'正在验证'});assert.equal(r.completed,1);assert.equal(r.total,2);await assert.rejects(service.dynamic(m,a,'office_plan',{steps:[{step:'虚假',status:'90%'}]}),/无效/);});

test('the character selected at creation names the member in prompts, roster and session title',async t=>{
  const {service,bridge}=fixture(t);
  const m=await service.create({prompt:'把名字绑定改对',mode:'team',model:'gpt-6-astra',effort:'low',roleAvatars:{boss:'tsunade-custom',tech:'mizukage-custom',builder:'naruto-custom',ops:'sakura-custom'}});
  const builder=m.agents.find(a=>a.role==='builder');
  assert.equal(builder.avatarId,'naruto-custom');assert.equal(builder.name,'鸣人');
  assert.deepEqual(m.agents.map(a=>a.name),['纲手','水影','鸣人','小樱']);
  const text=instructions(m,builder);
  assert.match(text,/你的名字：鸣人/);assert.doesNotMatch(text,/你的名字：夏禾/);
  assert.match(text,new RegExp(`${builder.id}：鸣人`));
  await tick();
  // The launched coordinator is the boss, who plays the chosen Tsunade here.
  const title=bridge.calls.find(call=>call.method==='thread/name/set')?.params.name;
  assert.equal(title,`待命室 · ${m.title} · 纲手`);
});

test('restarting the service rebinds an already saved mission to the character it chose',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'office-roster-')),bridge=new Bridge(),services=[];
  t.after(()=>{for(const service of services){clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);}rmSync(directory,{recursive:true,force:true});});
  const connected=service=>{service.connection={connected:true,authenticated:true,providers:{codex:{connected:true,authenticated:true},zcode:{connected:true,authenticated:true}},models:[{id:'gpt-6-astra',efforts:['low']},{id:'gpt-5.6-sol',efforts:['low']},{id:'GLM-5.3',efforts:['low']},{id:'GLM-5.3-Flash',efforts:['low']}]};services.push(service);return service;};
  const first=connected(new MissionService(bridge,{directory,defaultCwd:directory}));
  const m=await first.create({prompt:'旧会话',mode:'team',model:'gpt-6-astra',effort:'low',roleAvatars:{builder:'naruto-custom'}});
  const builder=m.agents.find(a=>a.role==='builder');
  builder.name='夏禾'; // a save written before the member followed the chosen character
  assert.equal(first.save(),true);
  const second=connected(new MissionService(bridge,{directory,defaultCwd:directory}));
  const reloaded=second.missions.find(entry=>entry.id===m.id),reloadedBuilder=reloaded.agents.find(a=>a.role==='builder');
  assert.equal(reloadedBuilder.avatarId,'naruto-custom');assert.equal(reloadedBuilder.name,'鸣人');
  assert.match(instructions(reloaded,reloadedBuilder),/你的名字：鸣人/);
});

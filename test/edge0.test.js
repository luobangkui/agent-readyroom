import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Edge0Bridge,EDGE0_PREFIX} from '../server/edge0.js';
import {OfficeRuntimes} from '../server/runtimes.js';
import {MissionService} from '../server/missions.js';

const tick=()=>new Promise(r=>setImmediate(r));
const flush=()=>new Promise(r=>setTimeout(r,60));
const sseBody=chunks=>({getReader(){let index=0;return {read:async()=>index<chunks.length?{done:false,value:new TextEncoder().encode(chunks[index++])}:{done:true}};}});
const GREETING='你好，我是本机日常助手';
const greetingStream=()=>sseBody([
  `data: ${JSON.stringify({choices:[{delta:{content:GREETING},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:6,total_tokens:16}})}\n\n`,
  'data: [DONE]\n\n']);

function fixtureBridge(t,fetchImpl){
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'edge0-test-'));
  const bridge=new Edge0Bridge({dataDir,fetchImpl,spawnProcess:()=>({on(){}})});
  t.after(()=>{bridge.close();rmSync(dataDir,{recursive:true,force:true});});
  return {bridge,dataDir};
}
const healthyFetch=calls=>async(url,options)=>{
  calls?.push({url,options});
  if(String(url).endsWith('/healthz'))return {ok:true,json:async()=>({status:'ok'})};
  if(String(url).endsWith('/chat/completions'))return {ok:true,body:greetingStream()};
  return {ok:false,status:404,body:sseBody([])};
};

test('edge0 bridge lists a single local model and reports readiness through account/read',async t=>{
  const calls=[];const {bridge}=fixtureBridge(t,healthyFetch(calls));
  await bridge.start();
  assert.deepEqual((await bridge.request('model/list')).data.map(m=>[m.model,m.provider]),[['edge0-35b','edge0']]);
  assert.deepEqual(await bridge.request('account/read'),{account:{type:'edge0-local'}});
});

test('a turn streams deltas, records usage and persists the transcript for resume',async t=>{
  const events=[];const requests=[];let started=0;
  const fetchImpl=async(url,options)=>{requests.push({url,options});
    if(String(url).endsWith('/healthz'))return {ok:true,json:async()=>({status:'ok'})};
    if(started++)return {ok:false,status:500,body:sseBody([])};
    return {ok:true,body:sseBody([
      'data: {"choices":[{"delta":{"content":"<think>推理"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"内容</think>你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"，待命室"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13}}\n\n',
      'data: [DONE]\n\n'])};
  };
  const {bridge,dataDir}=fixtureBridge(t,fetchImpl);
  await bridge.start();
  bridge.on('notification',event=>events.push(event));
  const thread=await bridge.request('thread/start',{cwd:'/tmp',model:'edge0-35b',developerInstructions:'你是测试助手'});
  assert.match(thread.thread.id,/^edge0:/);assert.equal(thread.provider,'edge0');
  const turn=await bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'介绍你自己'}]});
  assert.match(turn.turn.id,/^eturn_/);
  await flush();
  const body=JSON.parse(requests.find(r=>String(r.url).endsWith('/chat/completions')).options.body);
  assert.equal(body.max_tokens,2048);assert.equal(body.enable_thinking,false);assert.equal(body.stream,true);
  assert.deepEqual(body.messages.map(m=>m.role),['system','user']);assert.equal(body.messages[0].content,'你是测试助手');
  const deltas=events.filter(e=>e.method==='item/agentMessage/delta').map(e=>e.params.delta).join('');
  assert.equal(deltas,'你好，待命室');assert.ok(!deltas.includes('推理'));
  const completed=events.find(e=>e.method==='turn/completed');
  assert.equal(completed.params.turn.status,'completed');
  assert.equal(completed.params.turn.items[0].text,'你好，待命室');
  const usage=events.find(e=>e.method==='thread/tokenUsage/updated');
  assert.deepEqual(usage.params.tokenUsage.total,{inputTokens:9,outputTokens:4,cachedInputTokens:0,totalTokens:13});
  assert.ok(existsSync(path.join(dataDir,'edge0-sessions.json')));
  const resumed=new Edge0Bridge({dataDir:dataDir,fetchImpl});
  t.after(()=>resumed.close());
  const restored=await resumed.request('thread/resume',{threadId:thread.thread.id,cwd:'/tmp',model:'edge0-35b'});
  assert.equal(restored.thread.id,thread.thread.id);
  const secondRequests=[];resumed.fetchImpl=async(url,options)=>{secondRequests.push(options);
    if(String(url).endsWith('/healthz'))return {ok:true,json:async()=>({status:'ok'})};
    return {ok:true,body:sseBody(['data: {"choices":[{"delta":{"content":"在"},"finish_reason":"stop"}],"usage":{"prompt_tokens":30,"completion_tokens":1,"total_tokens":31}}\n\n','data: [DONE]\n\n'])};};
  await resumed.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'还在吗'}]});
  await flush();
  const secondBody=JSON.parse(secondRequests.find(r=>r.body).body);
  assert.deepEqual(secondBody.messages.map(m=>m.role),['system','user','assistant','user']);
  assert.equal(secondBody.messages[2].content,'你好，待命室');
});

test('steering is refused, interrupts end the turn as interrupted',async t=>{
  let release;
  const fetchImpl=async(url,options)=>{
    if(String(url).endsWith('/healthz'))return {ok:true,json:async()=>({status:'ok'})};
    if(String(url).endsWith('/chat/completions')){await new Promise(r=>{release=r;options.signal?.addEventListener('abort',()=>r(new Error('aborted')));});throw new Error('aborted');}
    return {ok:false,status:404,body:sseBody([])};
  };
  const {bridge}=fixtureBridge(t,fetchImpl);
  await bridge.start();
  const events=[];bridge.on('notification',event=>events.push(event));
  const thread=await bridge.request('thread/start',{cwd:'/tmp',model:'edge0-35b'});
  await assert.rejects(bridge.request('turn/steer',{threadId:thread.thread.id,expectedTurnId:'x',input:[]}),/正在生成/);
  const turn=await bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'慢慢回答'}]});
  await tick();
  await assert.rejects(bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'第二条'}]}),/已有任务/);
  await bridge.request('turn/interrupt',{threadId:thread.thread.id,turnId:turn.turn.id});
  await flush();
  const completed=events.find(e=>e.method==='turn/completed');
  assert.equal(completed.params.turn.status,'interrupted');
});

class RuntimeBridge extends EventEmitter {
  constructor(account,models){super();this.account=account;this.models=models;}
  async start(){}
  async restart(){}
  async request(method){if(method==='account/read')return {account:this.account};if(method==='model/list')return {data:this.models};return {};}
  respond(){}reject(){}close(){}
}

test('runtimes route edge0 threads and models to the local bridge',async t=>{
  const edge0=new Edge0Bridge({dataDir:mkdtempSync(path.join(os.tmpdir(),'edge0-rt-')),fetchImpl:healthyFetch([]),spawnProcess:()=>({on(){}})});
  t.after(()=>{edge0.close();});
  await edge0.start();
  const runtimes=new OfficeRuntimes({
    codex:new RuntimeBridge({type:'codex'},[{model:'gpt-6-astra',displayName:'GPT-6 Astra',supportedReasoningEfforts:[]}]),
    zcode:new RuntimeBridge({type:'zcode'},[{model:'GLM-5.3',displayName:'GLM-5.3',supportedReasoningEfforts:[]}]),
    edge0});
  await runtimes.start();
  assert.equal(runtimes.getFor({provider:'edge0'}),'edge0');
  assert.equal(runtimes.getFor({threadId:'edge0:abc'}),'edge0');
  assert.equal(runtimes.getFor({model:'edge0-35b'}),'edge0');
  assert.equal(runtimes.getFor({model:'gpt-6-astra'}),'codex');
  const list=await runtimes.request('model/list');
  assert.deepEqual(list.data.map(m=>m.provider),['codex','zcode','edge0']);
  assert.equal(runtimes.providers.edge0.authenticated,true);
});

test('edge0 can be assigned per role at creation and streams through the bridge',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'edge0-mission-'));
  const edge0=new Edge0Bridge({dataDir:directory,fetchImpl:healthyFetch([]),spawnProcess:()=>({on(){}})});
  t.after(()=>{edge0.close();rmSync(directory,{recursive:true,force:true});});
  await edge0.start();
  const bridge=new OfficeRuntimes({edge0});
  await bridge.start();
  const service=new MissionService(bridge,{directory,defaultCwd:directory});
  t.after(()=>{clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);bridge.close();});
  service.connection={connected:true,authenticated:true,providers:{codex:{connected:true,authenticated:true},zcode:{connected:true,authenticated:true},edge0:{connected:true,authenticated:true,message:'已连接'}},models:[{id:'edge0-35b',name:'Edge0 35B（本机）',provider:'edge0',efforts:['low','medium','high']},{id:'gpt-6-astra',name:'GPT-6 Astra',provider:'codex',efforts:['low']},{id:'gpt-5.6-sol',name:'GPT-5.6 Sol',provider:'codex',efforts:['low']},{id:'GLM-5.3',name:'GLM-5.3',provider:'zcode',efforts:['low']},{id:'GLM-5.3-Flash',name:'GLM-5.3-Flash',provider:'zcode',efforts:['low']}]};
  await assert.rejects(service.create({kind:'chat',roleModels:{tech:'nope'}}),/不在可用模型列表/);
  await assert.rejects(service.create({kind:'chat',roleModels:{ceo:'edge0-35b'}}),/无效的岗位/);
  const m=await service.create({kind:'chat',roleModels:{tech:'edge0-35b'}});
  assert.deepEqual(m.agents.map(a=>[a.role,a.provider,a.model,a.modelName,a.write]),[['boss','edge0','edge0-35b','Edge0 35B（本机）',true],['tech','edge0','edge0-35b','Edge0 35B（本机）',true],['builder','edge0','edge0-35b','Edge0 35B（本机）',true],['ops','edge0','edge0-35b','Edge0 35B（本机）',true]]);
  assert.equal(m.model,'edge0-35b');
  await service.sendMessage(m.id,{text:'用一句话介绍 MoE'});
  await flush();
  assert.match(m.agents.find(a=>a.role==='tech').threadId,/^edge0:/);
  assert.equal(m.agents.find(a=>a.role==='tech').status,'completed');
  assert.equal(m.status,'completed');
  assert.ok(m.messages.some(msg=>msg.kind==='assistant'&&msg.text.includes('你好')));
  const goal=await service.create({prompt:'本机模型参与的目标',mode:'team',effort:'low',roleModels:{boss:'edge0-35b'}});
  const boss=goal.agents.find(a=>a.role==='boss');
  assert.deepEqual([boss.provider,boss.model],['edge0','edge0-35b']);
  assert.equal(goal.model,'edge0-35b');
  const tech=goal.agents.find(a=>a.role==='tech');
  assert.deepEqual([tech.provider,tech.model],['codex','gpt-6-astra']);
});

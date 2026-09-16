import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DshBridge,DSH_PREFIX,automationOverlay,resolveDshBinary} from '../server/dsh.js';
import {OfficeRuntimes} from '../server/runtimes.js';
import {MissionService} from '../server/missions.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const flush=()=>new Promise(resolve=>setTimeout(resolve,20));
const MODEL_OPTION={id:'model',name:'Model',category:'model',type:'select',currentValue:JSON.stringify(['deepseek-official','deepseek-v4-flash']),options:[
  {group:'deepseek-official',name:'deepseek-official',options:[
    {value:JSON.stringify(['deepseek-official','deepseek-flash']),name:'DeepSeek-V41-Flash',description:'主力模型'},
    {value:JSON.stringify(['deepseek-official','deepseek-v4-flash']),name:'DeepSeek-V4-Flash'},
    {value:JSON.stringify(['deepseek-official','deepseek-v4-pro']),name:'DeepSeek-V4-Pro'}
  ]}
]};
const EFFORT_OPTION={id:'reasoning_effort',name:'Reasoning effort',category:'thought_level',type:'select',currentValue:'provider-default',options:[{value:'off',name:'Off'},{value:'low',name:'Low'},{value:'high',name:'High'},{value:'max',name:'Max'}]};
const CONFIG_OPTIONS=[MODEL_OPTION,EFFORT_OPTION];
const ANSWER='你好，待命室';

// A minimal ACP v1 agent over stdio: it answers the client calls the bridge
// makes and reports the committed updates the real harness emits.
class FakeAcp {
  constructor(options={}){
    Object.assign(this,{needsPermission:false,hold:false,resumeFails:false,cancelled:false},options);
    this.received=[];this.selections=[];this.sessionCount=0;this.promptBodies=[];this.permissionOutcomes=[];
    this.stdin=new PassThrough();this.stdout=new PassThrough();this.stderr=new PassThrough();
    this.child=new EventEmitter();
    Object.assign(this.child,{stdin:this.stdin,stdout:this.stdout,stderr:this.stderr,kill:()=>{this.stdout.end();this.stdin.end();return true;}});
    createInterface({input:this.stdin}).on('line',line=>{let message;try{message=JSON.parse(line);}catch{return;}this.handle(message);});
  }
  send(message){this.stdout.write(JSON.stringify(message)+'\n');}
  result(id,result){this.send({jsonrpc:'2.0',id,result});}
  fail(id,message){this.send({jsonrpc:'2.0',id,error:{code:-32602,message}});}
  notify(method,params){this.send({jsonrpc:'2.0',method,params});}
  update(sessionId,update){this.notify('session/update',{sessionId,update});}
  handle(message){
    if(message.id!==undefined&&message.method===undefined){
      this.received.push(message);
      if(message.id===901)this.permissionResolver?.(message.result.outcome.optionId);
      return;
    }
    this.received.push(message);
    if(message.method==='initialize')return this.result(message.id,{protocolVersion:1,agentInfo:{name:'deepseek-harness-acp',version:'test'}});
    if(message.method==='session/new'){this.sessionCount++;return this.result(message.id,{sessionId:`sess-${this.sessionCount}`,configOptions:CONFIG_OPTIONS});}
    if(message.method==='session/resume')return this.resumeFails?this.fail(message.id,'session is not resumable: stale'):this.result(message.id,{configOptions:CONFIG_OPTIONS});
    if(message.method==='session/set_config_option'){this.selections.push(message.params);return this.result(message.id,{configOptions:CONFIG_OPTIONS});}
    if(message.method==='session/prompt')return this.prompt(message);
    if(message.method==='session/cancel'){this.cancelled=true;if(this.pendingPrompt!==null){const id=this.pendingPrompt;this.pendingPrompt=null;this.result(id,{stopReason:'cancelled'});}return;}
    if(message.id!==undefined)this.result(message.id,{});
  }
  prompt(message){
    this.promptBodies.push(message.params.input?.prompt??message.params.prompt);
    if(this.hold){this.pendingPrompt=message.id;return;}
    void this.run(message);
  }
  async run(message){
    const {sessionId}=message.params;
    if(this.needsPermission){
      const optionId=await this.requestPermission(sessionId);
      this.permissionOutcomes.push(optionId);
      if(optionId!=='allow-once'){this.update(sessionId,{sessionUpdate:'tool_call_update',toolCallId:'call-1',status:'failed',content:[]});return this.result(message.id,{stopReason:'end_turn'});}
    }
    this.update(sessionId,{sessionUpdate:'tool_call',toolCallId:'call-1',title:'Bash',kind:'execute',status:'in_progress',rawInput:{command:'ls -la'}});
    this.update(sessionId,{sessionUpdate:'agent_message_chunk',messageId:'msg-1',content:{type:'text',text:ANSWER}});
    this.update(sessionId,{sessionUpdate:'tool_call_update',toolCallId:'call-1',status:'completed',content:[{type:'content',content:{type:'text',text:'总用量 8'}}]});
    this.update(sessionId,{sessionUpdate:'usage_update',used:1234,size:1000000});
    this.result(message.id,{stopReason:'end_turn'});
  }
  requestPermission(sessionId){
    return new Promise(resolve=>{this.permissionResolver=resolve;this.send({jsonrpc:'2.0',id:901,method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:'call-1',title:'Bash',kind:'execute',rawInput:{command:'git push --force'}},options:[{optionId:'allow-once',name:'Allow once',kind:'allow_once'},{optionId:'reject-once',name:'Reject',kind:'reject_once'}]}});});
  }
  messages(method){return this.received.filter(message=>message.method===method);}
}

function fixture(t,options={}){
  const server=new FakeAcp(options);
  const bridge=new DshBridge({cwd:'/tmp',binary:'dsh-test',overlayClientUi:false,spawnProcess:()=>server.child,requestTimeoutMs:2000,sessionTimeoutMs:2000,restartThrottleMs:0});
  t.after(()=>bridge.close());
  return {server,bridge};
}

test('the bridge advertises the harness DeepSeek catalog and resolves its binary',async t=>{
  const {bridge}=fixture(t);
  await bridge.start();
  const models=(await bridge.request('model/list')).data;
  assert.deepEqual(models.map(m=>m.model),['deepseek-flash','deepseek-v4-flash','deepseek-v4-pro','deepseek-v4-flash-vision-exp']);
  assert.equal(models[0].displayName,'DeepSeek-V41-Flash（DSH）');
  assert.deepEqual(await bridge.request('account/read'),{account:{type:'dsh-acp'}});
  assert.match(resolveDshBinary(['/definitely/missing/dsh']),/dsh$/);
});

test('the home-layer client UI rows are disabled through a generated overlay',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'office-dsh-home-'));
  const patch=path.join(directory,'cordis.patch.yml');
  writeFileSync(patch,[
    '# managed section',
    '- id: ui-skin-ths',
    '  disabled: true',
    '- insert:',
    "    - id: ui-skin-maid-atelier",
    "      name: '@dsh-external/dsh-client-ui-skin-maid-atelier'",
    "    - id: office-tools",
    "      name: '@dsh-external/dsh-plugin-office-tools'",
    "      config:",
    "        name: '@dsh-external/dsh-client-ui-not-a-row'",
    ''
  ].join('\n'));
  const overlay=automationOverlay(patch);
  assert.match(overlay,/- id: ui-skin-maid-atelier\n  disabled: true/);
  assert.ok(!overlay.includes('ui-skin-ths'));
  assert.ok(!overlay.includes('office-tools'));
  assert.equal(automationOverlay(path.join(directory,'missing.yml')),null);
  const clean=path.join(directory,'clean.yml');writeFileSync(clean,'- id: plain\n  disabled: true\n');
  assert.equal(automationOverlay(clean),null);
  rmSync(directory,{recursive:true,force:true});
});

test('a turn selects the requested model, carries the office MCP server and folds committed updates',async t=>{
  const {server,bridge}=fixture(t);
  await bridge.start();
  const events=[];bridge.on('notification',message=>events.push(message));
  const thread=await bridge.request('thread/start',{cwd:'/tmp',model:'deepseek-flash',officeEffort:'high',developerInstructions:'你是测试成员',officeMcpServers:[{name:'office',command:'/usr/bin/node',args:['/tmp/office-mcp.mjs'],env:[{name:'OFFICE_MCP_TOKEN',value:'secret'}],isolation:'session'}]});
  assert.equal(thread.thread.id,`${DSH_PREFIX}sess-1`);assert.equal(thread.provider,'dsh');assert.equal(thread.model,'deepseek-flash');
  const created=server.messages('session/new').at(-1);
  assert.equal(created.params.cwd,'/tmp');
  assert.deepEqual(created.params.mcpServers,[{name:'office',command:'/usr/bin/node',args:['/tmp/office-mcp.mjs'],env:[{name:'OFFICE_MCP_TOKEN',value:'secret'}]}]);
  assert.deepEqual(server.selections.map(selection=>[selection.configId,selection.value]),[['model',JSON.stringify(['deepseek-official','deepseek-flash'])],['reasoning_effort','high']]);
  const turn=await bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'列一下目录'}]});
  assert.match(turn.turn.id,/^dturn_/);
  await flush();
  const prompt=server.promptBodies.at(-1);
  assert.equal(prompt[0].type,'text');
  assert.match(prompt[0].text,/^你是测试成员\n\n本轮任务：\n列一下目录$/);
  const delta=events.find(event=>event.method==='item/agentMessage/delta');
  assert.equal(delta.params.itemId,'msg-1');assert.equal(delta.params.delta,ANSWER);assert.equal(delta.params.turnId,turn.turn.id);
  const started=events.find(event=>event.method==='item/started');
  assert.deepEqual([started.params.item.type,started.params.item.command,started.params.item.status],['commandExecution','ls -la','inProgress']);
  const toolDone=events.find(event=>event.method==='item/completed');
  assert.deepEqual([toolDone.params.item.type,toolDone.params.item.status,toolDone.params.item.aggregatedOutput],['commandExecution','completed','总用量 8']);
  const usage=events.find(event=>event.method==='thread/tokenUsage/updated');
  assert.equal(usage.params.tokenUsage.total.totalTokens,1234);
  const completed=events.find(event=>event.method==='turn/completed');
  assert.equal(completed.params.turn.status,'completed');
  assert.deepEqual(completed.params.turn.items,[{id:'msg-1',type:'agentMessage',phase:'final_answer',text:ANSWER}]);
  await assert.rejects(bridge.request('turn/steer',{threadId:thread.thread.id,expectedTurnId:turn.turn.id,input:[{type:'text',text:'补充'}]}),/等本轮结束后/);
});

test('interrupting cancels the ACP prompt and reports an interrupted turn',async t=>{
  const {server,bridge}=fixture(t,{hold:true});
  await bridge.start();
  const events=[];bridge.on('notification',message=>events.push(message));
  const thread=await bridge.request('thread/start',{cwd:'/tmp',model:'deepseek-v4-pro'});
  const turn=await bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'慢慢回答'}]});
  await tick();
  await assert.rejects(bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'第二条'}]}),/已有任务在执行/);
  await bridge.request('turn/interrupt',{threadId:thread.thread.id,turnId:turn.turn.id});
  await flush();
  assert.equal(server.cancelled,true);
  assert.equal(events.find(event=>event.method==='turn/completed').params.turn.status,'interrupted');
});

test('harness permission prompts surface as office approvals and carry the decision back',async t=>{
  const {server,bridge}=fixture(t,{needsPermission:true});
  await bridge.start();
  const requests=[];bridge.on('request',message=>requests.push(message));
  const thread=await bridge.request('thread/start',{cwd:'/tmp',model:'deepseek-flash'});
  await bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'推送分支'}]});
  await flush();
  const approval=requests.at(-1);
  assert.match(approval.id,/^dreq_/);
  assert.equal(approval.method,'item/commandExecution/requestApproval');
  assert.deepEqual(approval.params.availableDecisions,['accept','decline']);
  assert.equal(approval.params.command,'git push --force');
  assert.match(approval.params.reason,/Bash/);
  bridge.respond(approval.id,{decision:'decline'});
  await flush();
  assert.deepEqual(server.permissionOutcomes,['reject-once']);
});

test('an unresumable harness session is replaced by a fresh one under the same office thread',async t=>{
  const {server,bridge}=fixture(t,{resumeFails:true});
  await bridge.start();
  const events=[];bridge.on('notification',message=>events.push(message));
  const resumed=await bridge.request('thread/resume',{threadId:`${DSH_PREFIX}stale-session`,cwd:'/tmp',model:'deepseek-flash'});
  assert.match(resumed.thread.id,/^dsh:sess-/);
  assert.notEqual(resumed.thread.id,`${DSH_PREFIX}stale-session`);
  assert.equal(server.sessionCount,1);
  assert.match(events.find(event=>event.method==='error').params.error.message,/已新建会话继续/);
  const turn=await bridge.request('turn/start',{threadId:`${DSH_PREFIX}stale-session`,input:[{type:'text',text:'继续'}]});
  assert.match(turn.turn.id,/^dturn_/);
});

test('runtimes route DeepSeek models and dsh threads to the DSH bridge',async t=>{
  const {bridge:dsh}=fixture(t);
  await dsh.start();
  const runtimes=new OfficeRuntimes({dsh});
  await runtimes.start();
  assert.equal(runtimes.getFor({model:'deepseek-flash'}),'dsh');
  assert.equal(runtimes.getFor({provider:'dsh',model:'deepseek-v4-pro'}),'dsh');
  assert.equal(runtimes.getFor({threadId:`${DSH_PREFIX}sess-1`}),'dsh');
  assert.equal(runtimes.getFor({model:'gpt-6-astra'}),'codex');
  const list=await runtimes.request('model/list');
  assert.deepEqual(list.data.map(m=>m.provider),['dsh','dsh','dsh','dsh']);
  assert.ok(list.data.some(m=>m.model==='deepseek-v4-pro'));
  assert.ok(list.data.every(m=>m.displayName.endsWith('（DSH）')));
  assert.equal(runtimes.providers.dsh.authenticated,true);
  runtimes.close();
});

test('a mission member pinned to a DSH model runs through the bridge with office tools',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'office-dsh-'));
  const cwd=path.join(directory,'project');mkdirSync(cwd,{recursive:true});
  const {server,bridge:dsh}=fixture(t);
  await dsh.start();
  const runtimes=new OfficeRuntimes({dsh});await runtimes.start();
  const calls=[],request=runtimes.request.bind(runtimes);
  runtimes.request=(method,params)=>{calls.push({method,params});return request(method,params);};
  const service=new MissionService(runtimes,{directory,defaultCwd:directory});
  t.after(()=>{clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);runtimes.close();rmSync(directory,{recursive:true,force:true});});
  service.connection={connected:true,authenticated:true,providers:{dsh:{connected:true,authenticated:true,message:'已连接'}},models:[{id:'deepseek-flash',name:'DeepSeek-V41-Flash（DSH）',provider:'dsh',efforts:['low','high','max']},{id:'gpt-6-astra',name:'GPT-6 Astra',provider:'codex',efforts:['low']},{id:'gpt-5.6-sol',name:'GPT-5.6 Sol',provider:'codex',efforts:['low']},{id:'GLM-5.3',name:'GLM-5.3',provider:'zcode',efforts:['low']},{id:'GLM-5.3-Flash',name:'GLM-5.3-Flash',provider:'zcode',efforts:['low']}]};
  const m=await service.create({kind:'chat',roleModels:{tech:'deepseek-flash'},cwd});
  assert.deepEqual(m.agents.map(a=>[a.role,a.provider,a.model]),[['boss','dsh','deepseek-flash'],['tech','dsh','deepseek-flash'],['builder','dsh','deepseek-flash'],['ops','dsh','deepseek-flash']]);
  await service.sendMessage(m.id,{text:'打个招呼'});
  await flush();
  const tech=m.agents.find(a=>a.role==='tech');
  assert.match(tech.threadId,/^dsh:sess-/);
  assert.equal(tech.status,'completed');
  assert.ok(m.messages.some(message=>message.kind==='assistant'&&message.text===ANSWER));
  const launch=calls.find(call=>call.method==='thread/start').params;
  assert.equal(launch.config['mcp_servers.office'],undefined);
  assert.equal(launch.officeMcpServers[0].name,'office');
  assert.equal(launch.officeHarnessExecution,false);
  const started=server.messages('session/new').at(-1);
  assert.equal(started.params.cwd,realpathSync(cwd));
  assert.equal(started.params.mcpServers[0].name,'office');
  assert.match(started.params.mcpServers[0].args[0],/office-mcp\.mjs$/);
  assert.ok(started.params.mcpServers[0].env.some(entry=>entry.name==='OFFICE_MCP_TOKEN'&&entry.value));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import {KimiBridge,KIMI_PREFIX,resolveKimiCli} from '../server/kimi.js';
import {OfficeRuntimes} from '../server/runtimes.js';

const flush=()=>new Promise(resolve=>setTimeout(resolve,20));
const ANSWER='你好，待命室';
// Kimi ACP 的 configOptions 是平铺结构，模型值就是纯 id（真实探针实测）。
const CONFIG_OPTIONS=[
  {type:'select',id:'model',name:'Model',category:'model',currentValue:'k2d8-preview',options:[{value:'k2d8-preview',name:'k2d8-preview'},{value:'k3-agent',name:'k3-agent'}]},
  {type:'select',id:'thinking',name:'Thinking',category:'thought_level',currentValue:'on',options:[{value:'off',name:'Thinking Off'},{value:'on',name:'Thinking On'}]},
  {type:'select',id:'mode',name:'Mode',category:'mode',currentValue:'default',options:[{value:'default',name:'Default'},{value:'plan',name:'Plan'},{value:'yolo',name:'YOLO'}]}
];

// 最小 ACP v1 agent：回应桥接发出的调用，并按真实 harness 的格式上报已提交更新。
class FakeAcp {
  constructor(options={}){
    Object.assign(this,{needsPermission:false,hold:false,resumeFails:false,authFails:false,cancelled:false},options);
    this.received=[];this.selections=[];this.sessionCount=0;this.promptBodies=[];this.permissionOutcomes=[];
    this.stdin=new PassThrough();this.stdout=new PassThrough();this.stderr=new PassThrough();
    this.child=new EventEmitter();
    Object.assign(this.child,{stdin:this.stdin,stdout:this.stdout,stderr:this.stderr,kill:()=>{this.stdout.end();this.stdin.end();return true;}});
    createInterface({input:this.stdin}).on('line',line=>{let message;try{message=JSON.parse(line);}catch{return;}this.handle(message);});
  }
  send(message){this.stdout.write(JSON.stringify(message)+'\n');}
  result(id,result){this.send({jsonrpc:'2.0',id,result});}
  fail(id,message){this.send({jsonrpc:'2.0',id,error:{code:-32000,message}});}
  notify(method,params){this.send({jsonrpc:'2.0',method,params});}
  update(sessionId,update){this.notify('session/update',{sessionId,update});}
  handle(message){
    if(message.id!==undefined&&message.method===undefined){
      this.received.push(message);
      if(message.id===901)this.permissionResolver?.(message.result.outcome.optionId);
      return;
    }
    this.received.push(message);
    if(message.method==='initialize')return this.result(message.id,{protocolVersion:1,agentInfo:{name:'Kimi Code CLI',version:'test'}});
    if(message.method==='session/new'){
      if(this.authFails)return this.fail(message.id,'Authentication required');
      this.sessionCount++;return this.result(message.id,{sessionId:`sess-${this.sessionCount}`,configOptions:CONFIG_OPTIONS});
    }
    if(message.method==='session/close')return this.result(message.id,{});
    if(message.method==='session/resume')return this.resumeFails?this.fail(message.id,'session is not resumable: stale'):this.result(message.id,{configOptions:CONFIG_OPTIONS});
    if(message.method==='session/set_config_option'){this.selections.push(message.params);return this.result(message.id,{configOptions:CONFIG_OPTIONS});}
    if(message.method==='session/prompt')return this.prompt(message);
    if(message.method==='session/cancel'){this.cancelled=true;if(this.pendingPrompt!=null){const id=this.pendingPrompt;this.pendingPrompt=null;this.result(id,{stopReason:'cancelled'});}return;}
    if(message.id!==undefined)this.result(message.id,{});
  }
  prompt(message){
    this.promptBodies.push(message.params.prompt);
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
  const bridge=new KimiBridge({cwd:'/tmp',cli:{kind:'binary',path:'kimi-test'},spawnProcess:()=>server.child,requestTimeoutMs:2000,sessionTimeoutMs:2000,restartThrottleMs:0});
  t.after(()=>bridge.close());
  return {server,bridge};
}

test('kimi CLI resolution is OS-agnostic: env, project module, platform candidates, PATH',()=>{
  assert.deepEqual(resolveKimiCli({envValue:'/custom/kimi',moduleEntry:null}),{kind:'binary',path:'/custom/kimi'});
  assert.deepEqual(resolveKimiCli({envValue:'',moduleEntry:'/proj/node_modules/@moonshot-ai/kimi-code/dist/main.mjs',exists:()=>true}),{kind:'module',path:'/proj/node_modules/@moonshot-ai/kimi-code/dist/main.mjs'});
  // Windows 后备：官方安装脚本的默认位置 %USERPROFILE%\.kimi-code\bin\kimi.exe
  const win=resolveKimiCli({envValue:'',moduleEntry:null,home:'C:\\Users\\demo',platform:'win32',exists:file=>file.endsWith('kimi.exe')});
  assert.deepEqual(win,{kind:'binary',path:'C:\\Users\\demo\\.kimi-code\\bin\\kimi.exe'});
  // macOS/Linux 后备：~/.kimi-code/bin/kimi，都找不到时退回 PATH 里的 kimi
  const mac=resolveKimiCli({envValue:'',moduleEntry:null,home:'/Users/demo',platform:'darwin',exists:file=>file==='/Users/demo/.kimi-code/bin/kimi'});
  assert.deepEqual(mac,{kind:'binary',path:'/Users/demo/.kimi-code/bin/kimi'});
  assert.deepEqual(resolveKimiCli({envValue:'',moduleEntry:null,home:'/nope',platform:'linux',exists:()=>false}),{kind:'binary',path:'kimi'});
  // 项目模块入口用当前 Node 直跑，Windows/macOS 行为一致
  const bridge=new KimiBridge({cli:{kind:'module',path:'/x/main.mjs'}});
  assert.deepEqual(bridge.spawnArgs(),{binary:process.execPath,args:['/x/main.mjs','acp']});
});

test('the bridge connects, probes auth with a throwaway session and advertises the Kimi catalog',async t=>{
  const {server,bridge}=fixture(t);
  await bridge.start();
  const models=(await bridge.request('model/list')).data;
  assert.ok(models.some(model=>model.model==='k2d8-preview'&&model.provider==='kimi'));
  assert.ok(models.every(model=>/（Kimi）$/.test(model.displayName)));
  assert.deepEqual(await bridge.request('account/read'),{account:{type:'kimi-acp'}});
  // 探针会话学过实时目录后立刻关闭，不占成员席位
  assert.equal(server.messages('session/new').length,1);
  assert.equal(server.messages('session/close').length,1);
});

test('an unauthenticated CLI fails start with a login hint instead of a stuck member',async t=>{
  const {bridge}=fixture(t,{authFails:true});
  await assert.rejects(bridge.start(),/kimi login/);
  assert.equal(bridge.authenticated,false);
});

test('a turn picks mode, model and thinking, carries the office MCP server and folds committed updates',async t=>{
  const {server,bridge}=fixture(t);
  await bridge.start();
  const events=[];bridge.on('notification',message=>events.push(message));
  const thread=await bridge.request('thread/start',{cwd:'/tmp',model:'k2d8-preview',officeEffort:'high',officeYolo:true,developerInstructions:'你是测试成员',officeMcpServers:[{name:'office',command:'/usr/bin/node',args:['/tmp/office-mcp.mjs'],env:[{name:'OFFICE_MCP_TOKEN',value:'secret'}],isolation:'session'}]});
  assert.equal(thread.thread.id,`${KIMI_PREFIX}sess-2`);assert.equal(thread.provider,'kimi');assert.equal(thread.model,'k2d8-preview');
  const created=server.messages('session/new').at(-1);
  assert.equal(created.params.cwd,'/tmp');
  assert.deepEqual(created.params.mcpServers,[{name:'office',command:'/usr/bin/node',args:['/tmp/office-mcp.mjs'],env:[{name:'OFFICE_MCP_TOKEN',value:'secret'}]}]);
  assert.deepEqual(server.selections.map(selection=>[selection.configId,selection.value]),[['mode','yolo'],['model','k2d8-preview'],['thinking','on']]);
  const turn=await bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'列一下目录'}]});
  assert.match(turn.turn.id,/^kturn_/);
  await flush();
  const prompt=server.promptBodies.at(-1);
  assert.equal(prompt[0].type,'text');
  assert.equal(prompt[0].text,'你是测试成员\n\n本轮任务：\n列一下目录');
  const delta=events.find(event=>event.method==='item/agentMessage/delta');
  assert.equal(delta.params.delta,ANSWER);
  const started=events.find(event=>event.method==='item/started');
  assert.equal(started.params.item.type,'commandExecution');assert.equal(started.params.item.command,'ls -la');
  const completed=events.find(event=>event.method==='item/completed');
  assert.equal(completed.params.item.aggregatedOutput,'总用量 8');
  const done=events.find(event=>event.method==='turn/completed');
  assert.equal(done.params.turn.status,'completed');
  assert.deepEqual(done.params.turn.items.map(item=>item.text),[ANSWER]);
});

test('plan missions map to ACP plan mode and read-only stays read-only',async t=>{
  const {server,bridge}=fixture(t);
  await bridge.start();
  await bridge.request('thread/start',{cwd:'/tmp',model:'k3-agent',sandbox:'read-only',developerInstructions:'',officeMcpServers:[]});
  assert.deepEqual(server.selections.map(selection=>[selection.configId,selection.value]).filter(([id])=>id==='mode'),[['mode','plan']]);
});

test('permission requests become office approval cards and the answer maps back to ACP options',async t=>{
  const {server,bridge}=fixture(t,{needsPermission:true});
  await bridge.start();
  const requests=[];bridge.on('request',message=>requests.push(message));
  const thread=await bridge.request('thread/start',{cwd:'/tmp',model:'k2d8-preview',developerInstructions:'',officeMcpServers:[]});
  const turn=await bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'推送代码'}]});
  await flush();
  assert.equal(requests.length,1);
  assert.match(requests[0].id,/^kreq_/);
  assert.equal(requests[0].method,'item/commandExecution/requestApproval');
  assert.match(requests[0].params.command,/git push --force/);
  bridge.respond(requests[0].id,{decision:'accept'});
  await flush();
  assert.deepEqual(server.permissionOutcomes,['allow-once']);
  const events=[];bridge.on('notification',message=>events.push(message));
  await bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'再试一次'}]});
  assert.equal(turn.turn.id.startsWith('kturn_'),true);
});

test('a stale session resumes as a fresh session under the same office thread id',async t=>{
  const {server,bridge}=fixture(t,{resumeFails:true});
  await bridge.start();
  const events=[];bridge.on('notification',message=>events.push(message));
  const thread=await bridge.request('thread/resume',{threadId:`${KIMI_PREFIX}sess-old`,cwd:'/tmp',model:'k2d8-preview',developerInstructions:'',officeMcpServers:[]});
  assert.match(thread.thread.id,new RegExp(`^${KIMI_PREFIX}sess-\\d+$`));
  const notice=events.find(event=>event.method==='error');
  assert.match(notice.params.error.message,/已新建会话继续/);
  assert.equal(server.messages('session/resume').length,1);
});

test('interrupt sends session/cancel and the turn settles as interrupted',async t=>{
  const {server,bridge}=fixture(t,{hold:true});
  await bridge.start();
  const events=[];bridge.on('notification',message=>events.push(message));
  const thread=await bridge.request('thread/start',{cwd:'/tmp',model:'k2d8-preview',developerInstructions:'',officeMcpServers:[]});
  const turn=await bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'长任务'}]});
  await flush();
  await bridge.request('turn/interrupt',{threadId:thread.thread.id,turnId:turn.turn.id});
  await flush();
  assert.equal(server.cancelled,true);
  const done=events.find(event=>event.method==='turn/completed');
  assert.equal(done.params.turn.status,'interrupted');
});

test('OfficeRuntimes routes kimi threads and models to the kimi backend',async t=>{
  const {bridge}=fixture(t);
  const runtimes=new OfficeRuntimes({kimi:bridge});
  t.after(()=>runtimes.close());
  await runtimes.start();
  assert.equal(runtimes.getFor({provider:'kimi',model:'anything'}),'kimi');
  assert.equal(runtimes.getFor({threadId:`${KIMI_PREFIX}sess-1`}),'kimi');
  assert.equal(runtimes.getFor({model:'k2d8-preview'}),'kimi');
  assert.equal(runtimes.getFor({model:'k3-agent'}),'kimi');
  const list=await runtimes.request('model/list');
  assert.ok(list.data.some(model=>model.provider==='kimi'));
  assert.equal(runtimes.providers.kimi.authenticated,true);
});

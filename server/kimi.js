import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnCli} from './cli.js';

export const KIMI_PREFIX='kimi:';
export const KIMI_ACP_VERSION=1;
// 项目自带的 Kimi Code CLI（npm 依赖 @moonshot-ai/kimi-code）是纯 JS 入口，
// 用当前 Node 直接运行，天然与操作系统无关；用户另外装的独立二进制作为后备。
const projectKimi=fileURLToPath(new URL('../node_modules/@moonshot-ai/kimi-code/dist/main.mjs',import.meta.url));
// 静态目录只作兜底：真实模型目录以 session/new 上报的 configOptions 为准，
// 登录方式（OAuth / config.toml / KIMI_MODEL_* 环境变量）不同目录就不同。
export const KIMI_MODELS=[
  {id:'k2d8-preview',name:'Kimi K2D8 Preview',description:'多模态长上下文预览模型，日常与并行任务的主力。'},
  {id:'k3-agent',name:'Kimi K3 Agent',description:'代理编码与复杂推理。'},
  {id:'k3-agent-swarm',name:'Kimi K3 Agent Swarm',description:'多智能体并行变体。'}
];
const KIMI_EFFORTS=[{reasoningEffort:'off'},{reasoningEffort:'high'}];
// Kimi ACP 的思考档位是 off/on 两档；待命室的 effort 名称沿用 Codex 形状。
const THINKING_NAMES={off:'off',low:'on',medium:'on',high:'on',xhigh:'on',max:'on',ultra:'on'};
const clip=(value,max)=>String(value??'').slice(0,max);
const textOf=content=>typeof content==='string'?content:typeof content?.text==='string'?content.text:Array.isArray(content)?content.map(textOf).join(''):'';
const outputOf=content=>Array.isArray(content)?content.map(part=>part?.type==='content'?textOf(part.content):part?.type==='diff'?`文件变更：${part.path||''}`:'').filter(Boolean).join('\n'):'';
const nativeId=id=>String(id||'').startsWith(KIMI_PREFIX)?String(id).slice(KIMI_PREFIX.length):String(id||'');
const describeError=error=>{
  const detail=error?.data?.details??error?.data?.detail??(typeof error?.data==='string'?error.data:undefined);
  const message=error?.message||`Kimi 返回错误 ${error?.code??'未知'}`;
  return detail&&!String(message).includes(detail)?`${message}：${detail}`:String(message);
};
const isAuthError=value=>/authentication required|no provider configured|unauthori[sz]ed|login required|not logged in/i.test(String(value??''));

// OS 无关的可执行解析：环境变量 > 项目自带 npm 包（Node 直跑 .mjs）>
// 官方安装脚本默认位置（win: %USERPROFILE%\.kimi-code\bin\kimi.exe，
// mac/linux: ~/.kimi-code/bin/kimi）> PATH 里的 kimi。
export function resolveKimiCli({envValue=process.env.OFFICE_KIMI_BIN,moduleEntry=projectKimi,home=homedir(),platform=process.platform,exists=existsSync}={}){
  if(envValue)return {kind:'binary',path:envValue};
  if(moduleEntry&&exists(moduleEntry))return {kind:'module',path:moduleEntry};
  // 候选路径要按目标平台的规则拼接：测试与跨平台打包时宿主不一定是目标平台。
  const joiner=platform==='win32'?path.win32:path.posix;
  const candidates=platform==='win32'?[joiner.join(home,'.kimi-code','bin','kimi.exe')]:[joiner.join(home,'.kimi-code','bin','kimi'),'/usr/local/bin/kimi','/opt/homebrew/bin/kimi'];
  const found=candidates.find(candidate=>exists(candidate));
  return {kind:'binary',path:found||'kimi'};
}

// ACP stdio MCP 条目只收 name/command/args/env 这种形状。
function acpMcpServers(servers=[]){
  return servers.map(server=>({name:server.name,command:server.command,args:server.args||[],env:(server.env||[]).map(({name,value})=>({name,value}))}));
}

// kimi acp（标准 ACP v1，stdio 上按行分隔的 JSON-RPC）到待命室 App Server
// 事件契约的桥接。每张待命室会话对应一条持久 harness 会话；一轮就是一次
// session/prompt，已提交的助手/工具更新折叠回待命室的通知词汇表。
// ACP 没有 steering 面，轮中补充直接拒绝而不是悄悄丢弃。
export class KimiBridge extends EventEmitter {
  constructor({cwd=process.cwd(),cli=resolveKimiCli(),models=KIMI_MODELS,requestTimeoutMs=60000,sessionTimeoutMs=120000,restartThrottleMs=60000,spawnProcess=spawn}={}){
    super();this.cwd=cwd;this.cli=cli;this.models=models;this.requestTimeoutMs=requestTimeoutMs;this.sessionTimeoutMs=sessionTimeoutMs;this.restartThrottleMs=restartThrottleMs;this.spawnProcess=spawnProcess;
    this.pending=new Map();this.clientRequests=new Map();this.sessions=new Map();this.aliases=new Map();this.liveModels=new Map();this.sequence=0;this.ready=false;this.authenticated=false;this.child=null;this.starting=null;this.lastStartAttempt=0;this.stderr='';this.agentInfo=null;
  }
  start(){
    if(this.ready)return Promise.resolve();
    if(this.starting)return this.starting;
    this.lastStartAttempt=Date.now();
    this.starting=this.connect().catch(error=>{this.child?.kill();throw error;}).finally(()=>{this.starting=null;});
    return this.starting;
  }
  restart(){this.close('Kimi 运行环境正在重启');this.ready=false;this.child=null;return this.start();}
  async pollStatus(){
    if(this.ready&&this.child)return {connected:true,authenticated:this.authenticated,message:this.authenticated?'已连接':'请先登录 Kimi'};
    if(!this.child&&!this.starting&&Date.now()-this.lastStartAttempt>this.restartThrottleMs){try{await this.start();}catch{}}
    if(this.ready&&this.child)return {connected:true,authenticated:this.authenticated,message:this.authenticated?'已连接':'请先登录 Kimi'};
    return {connected:!!this.child,authenticated:false,message:this.stderr?`Kimi 启动失败：${clip(this.stderr,300)}`:'Kimi 未连接，等待本机 kimi 运行环境'};
  }
  spawnArgs(){return this.cli.kind==='module'?{binary:process.execPath,args:[this.cli.path,'acp']}:{binary:this.cli.path,args:['acp']};}
  async connect(){
    const {binary,args}=this.spawnArgs();
    if(this.cli.kind==='binary'&&path.isAbsolute(binary)&&!existsSync(binary))throw new Error(`未找到 Kimi 运行程序（${binary}），可设置 OFFICE_KIMI_BIN 指向本机 kimi。`);
    const child=spawnCli(this.spawnProcess,binary,args,{cwd:this.cwd,stdio:['pipe','pipe','pipe'],env:{...process.env}});this.child=child;this.stderr='';
    const disconnected=message=>{
      if(this.child!==child)return;
      this.ready=false;this.authenticated=false;this.child=null;
      for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(new Error(message));}
      this.pending.clear();this.clientRequests.clear();
      for(const session of this.sessions.values()){session.turnId=null;session.prompt=null;}
      this.emit('disconnected',message);
    };
    child.on('error',error=>disconnected(`无法启动 Kimi：${error.message}`));
    child.on('exit',(code,signal)=>disconnected(`Kimi 连接已关闭（${signal||code}）`));
    child.stdin.on('error',()=>{});
    child.stderr.on('data',chunk=>{this.stderr=clip(this.stderr+chunk,4000);});
    createInterface({input:child.stdout}).on('line',line=>this.handleLine(line));
    const handshake=await this.rpc('initialize',{protocolVersion:KIMI_ACP_VERSION,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'readyroom',version:'0.3.0'}},this.sessionTimeoutMs);
    this.agentInfo=handshake?.agentInfo||null;
    this.ready=true;
    // ACP 没有账户查询面：用一次探针会话确认登录态，顺带把实时模型目录
    // 学进来；探针会话立刻关闭，不占成员席位。
    try{
      const probe=await this.rpc('session/new',{cwd:this.cwd,mcpServers:[]},this.sessionTimeoutMs);
      this.learn(probe?.configOptions);
      this.authenticated=true;
      // close 必须等完：kimi 侧的会话槽清理是异步的，立刻建成员会话会被
      // 正在收尾的 close 误删（session not found），实测复现过这个竞态。
      if(probe?.sessionId)await this.rpc('session/close',{sessionId:probe.sessionId}).catch(()=>{});
    }catch(error){
      this.authenticated=false;
      if(isAuthError(error.message)){this.ready=true;this.emit('connected');throw Object.assign(new Error('Kimi 尚未登录：请在终端运行 kimi login（或配置 config.toml / KIMI_MODEL_* 环境变量）后点击「重建本地连接」。'),{authFailed:true});}
      throw error;
    }
    this.emit('connected');
  }
  send(message){if(!this.child?.stdin.writable)throw new Error('Kimi 尚未连接');this.child.stdin.write(JSON.stringify(message)+'\n');}
  rpc(method,params={},timeout=this.requestTimeoutMs){
    return new Promise((resolve,reject)=>{
      const id=++this.sequence,timer=timeout>0?setTimeout(()=>{this.pending.delete(id);reject(new Error(`Kimi 请求超时：${method}`));},timeout):null;
      this.pending.set(id,{resolve,reject,timer});
      try{this.send({jsonrpc:'2.0',id,method,params});}catch(error){if(timer)clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  notify(method,params={}){this.send({jsonrpc:'2.0',method,params});}
  handleLine(line){
    let message;try{message=JSON.parse(line);}catch{return;}
    if(message.method!==undefined){if(message.id!==undefined)this.handleClientRequest(message);else this.handleNotification(message);return;}
    const entry=this.pending.get(message.id);if(!entry)return;
    if(entry.timer)clearTimeout(entry.timer);this.pending.delete(message.id);
    message.error?entry.reject(new Error(describeError(message.error))):entry.resolve(message.result);
  }
  session(id){
    const key=nativeId(id),session=this.sessions.get(key)||this.sessions.get(this.aliases.get(key));
    if(!session)throw new Error('Kimi 会话尚未建立');return session;
  }
  // Kimi 的模型选项是平铺的纯 id；也容忍 DSH 那种分组 + JSON 值写法。
  // KIMI_MODEL_* 环境注入的部署只有一个伪选项 __kimi_env_model__，它的
  // name 才是真实模型 id——目录按 id 展示，选择时映射回原始 value。
  learn(configOptions=[]){
    this.modelValues??=new Map();
    for(const option of configOptions||[]){
      if(option?.id!=='model'||!Array.isArray(option.options))continue;
      const absorb=entries=>{for(const entry of entries||[]){
        if(Array.isArray(entry?.options)){absorb(entry.options);continue;}
        let id=entry?.value;const raw=entry?.value,name=entry?.name;
        if(id==='__kimi_env_model__')id=name;
        else if(typeof id==='string'&&id.startsWith('[')){try{const parsed=JSON.parse(id);if(Array.isArray(parsed)&&parsed.length===2)id=parsed[1];}catch{continue;}}
        if(typeof id==='string'&&id){this.liveModels.set(id,{id,name:name&&name!==id?name:undefined});this.modelValues.set(id,raw||id);}
      }};
      absorb(option.options);
    }
  }
  catalog(){
    const merged=new Map(this.models.map(model=>[model.id,{...model}]));
    for(const [id,model] of this.liveModels)merged.set(id,{...merged.get(id),...(model.name?{name:model.name}:{}),description:merged.get(id)?.description});
    return [...merged.values()].map(model=>({model:model.id,displayName:`${model.name||model.id}（Kimi）`,provider:'kimi',supportedReasoningEfforts:KIMI_EFFORTS}));
  }
  async applyConfig(session,params){
    const options=await this.rpc('session/set_config_option',{sessionId:session.id,configId:'mode',value:params.sandbox==='read-only'?'plan':params.officeYolo?'yolo':'default'},this.sessionTimeoutMs).catch(()=>null);
    if(options)this.learn(options.configOptions);
    if(params.model){
      const value=this.modelValues?.get(params.model)??params.model;
      try{this.learn((await this.rpc('session/set_config_option',{sessionId:session.id,configId:'model',value},this.sessionTimeoutMs))?.configOptions);session.model=params.model;}
      catch(error){throw new Error(`Kimi 无法选择模型 ${params.model}：${error.message}`);}
    }
    const thinking=THINKING_NAMES[params.officeEffort||params.effort];
    if(thinking){try{this.learn((await this.rpc('session/set_config_option',{sessionId:session.id,configId:'thinking',value:thinking},this.sessionTimeoutMs))?.configOptions);}catch{}}
  }
  async request(method,params={}){
    if(method==='account/read')return {account:this.ready&&this.authenticated?{type:'kimi-acp'}:null};
    if(method==='model/list')return {data:this.catalog()};
    if(!this.ready)throw new Error(this.stderr?`Kimi 尚未连接：${clip(this.stderr,300)}`:'Kimi 尚未连接，请确认本机 kimi 可用');
    if(method==='thread/start'||method==='thread/resume')return this.startThread(method,params);
    if(method==='thread/name/set')return {}; // ACP 没有标题面；待命室自己记名字。
    if(method==='turn/start')return this.startTurn(params);
    if(method==='turn/steer')throw new Error('Kimi 正在生成本轮回复；请等本轮结束后再补充要求。');
    if(method==='turn/interrupt')return this.interrupt(params);
    throw new Error(`Kimi 不支持此待命室操作：${method}`);
  }
  async startThread(method,params){
    const cwd=params.cwd;
    if(typeof cwd!=='string'||!path.isAbsolute(cwd))throw new Error('Kimi 会话需要绝对工作目录。');
    const mcpServers=acpMcpServers(params.officeMcpServers||[]);
    let sessionId,configOptions;
    if(method==='thread/start'){
      const created=await this.rpc('session/new',{cwd,mcpServers},this.sessionTimeoutMs);
      sessionId=created.sessionId;configOptions=created.configOptions;
    }else{
      const requested=nativeId(params.threadId);
      if(!requested)throw new Error('Kimi 会话缺少会话 ID，无法恢复。');
      try{
        const resumed=await this.rpc('session/resume',{sessionId:requested,cwd,mcpServers},this.sessionTimeoutMs);
        sessionId=requested;configOptions=resumed?.configOptions;
      }catch(error){
        // 被清理或外来的 harness 会话不能把成员卡死：在同一张待命室会话下
        // 新建会话，并在任务日志里说明，而不是让启动失败。
        const created=await this.rpc('session/new',{cwd,mcpServers},this.sessionTimeoutMs);
        sessionId=created.sessionId;configOptions=created.configOptions;
        this.aliases.set(requested,sessionId);
        this.emit('notification',{method:'error',params:{threadId:KIMI_PREFIX+requested,error:{message:`原 Kimi 会话无法恢复（${clip(error.message,200)}），已新建会话继续；本轮会重新读取任务上下文。`}}});
      }
    }
    const session={id:sessionId,cwd,model:null,instructions:clip(params.developerInstructions||'',24000),turnId:null,prompt:null,stopping:false,messages:new Map(),tools:new Map()};
    this.sessions.set(sessionId,session);
    this.learn(configOptions);
    await this.applyConfig(session,params);
    return {thread:{id:KIMI_PREFIX+sessionId},model:session.model,provider:'kimi'};
  }
  startTurn(params){
    const session=this.session(params.threadId);
    if(session.turnId)throw new Error('该 Kimi 成员已有任务在执行');
    const text=(params.input||[]).filter(item=>item.type==='text').map(item=>item.text).join('\n');
    if(!text.trim())throw new Error('Kimi 收到空消息');
    const turnId='kturn_'+randomUUID();
    session.turnId=turnId;session.stopping=false;session.messages.clear();session.tools.clear();
    const content=`${session.instructions}${session.instructions?'\n\n':''}本轮任务：\n${text}`;
    session.prompt=this.rpc('session/prompt',{sessionId:session.id,prompt:[{type:'text',text:content}]},0)
      .then(result=>this.settle(session,turnId,result))
      .catch(error=>this.settle(session,turnId,null,error));
    return {turn:{id:turnId}};
  }
  settle(session,turnId,result,error){
    if(session.turnId!==turnId)return;
    const stop=result?.stopReason,interrupted=session.stopping||stop==='cancelled';
    const status=interrupted?'interrupted':error||stop==='refusal'?'failed':'completed';
    const message=error?clip(error.message||'Kimi 执行失败',400):stop==='max_tokens'?'达到模型最大输出长度，本轮已结束':null;
    const items=[...session.messages.entries()].filter(([,text])=>text.trim()).map(([id,text])=>({id,type:'agentMessage',phase:'final_answer',text}));
    session.turnId=null;session.prompt=null;session.stopping=false;
    this.emit('notification',{method:'turn/completed',params:{threadId:KIMI_PREFIX+session.id,turnId,turn:{id:turnId,status,error:message?{message}:null,items}}});
  }
  async interrupt(params){
    const key=nativeId(params.threadId),session=this.sessions.get(key)||this.sessions.get(this.aliases.get(key));
    if(!session||!session.turnId||session.turnId!==params.turnId)return {};
    session.stopping=true;this.notify('session/cancel',{sessionId:session.id});return {};
  }
  emitEvent(session,method,params){this.emit('notification',{method,params:{threadId:KIMI_PREFIX+session.id,turnId:session.turnId,...params}});}
  // ACP 上报的是已提交事实而不是增量：一条助手消息通常一次性到达，
  // 工具调用则是开始一次、结束一次。
  handleNotification(message){
    if(message.method!=='session/update')return;
    const {sessionId,update}=message.params||{},session=this.sessions.get(sessionId);
    if(!session||!update)return;
    if(update.sessionUpdate==='agent_message_chunk'){
      const text=textOf(update.content);if(!text)return;
      const itemId=update.messageId||'agent-message';
      session.messages.set(itemId,(session.messages.get(itemId)||'')+text);
      this.emitEvent(session,'item/agentMessage/delta',{itemId,delta:text});return;
    }
    if(update.sessionUpdate==='tool_call'){
      const name=String(update.title||'工具');
      session.tools.set(update.toolCallId,{name,kind:update.kind,input:update.rawInput});
      const item=this.toolItem(update.toolCallId,update,{status:'inProgress'});
      this.emitEvent(session,'item/started',{item});return;
    }
    if(update.sessionUpdate==='tool_call_update'){
      const known=session.tools.get(update.toolCallId)||{name:'工具'};
      const item=this.toolItem(update.toolCallId,{...update,title:update.title||known.name,kind:update.kind||known.kind,rawInput:update.rawInput??known.input},{status:update.status==='failed'?'failed':'completed'});
      item.aggregatedOutput=outputOf(update.content);
      this.emitEvent(session,'item/completed',{item});return;
    }
    if(update.sessionUpdate==='usage_update'&&Number.isFinite(update.used)){
      this.emitEvent(session,'thread/tokenUsage/updated',{tokenUsage:{total:{inputTokens:0,outputTokens:0,cachedInputTokens:0,totalTokens:update.used}}});return;
    }
  }
  toolItem(id,update,{status}){
    const kind=update.kind,name=String(update.title||'工具'),input=update.rawInput;
    const file=['edit','delete','move'].includes(kind);
    const command=kind==='execute'||typeof input?.command==='string';
    const item={id,type:file?'fileChange':command?'commandExecution':'mcpToolCall',tool:name,status};
    if(item.type==='commandExecution')item.command=clip(typeof input==='string'?input:input?.command||name,4000);
    if(item.type==='fileChange')item.changes=[{path:clip(filePath(update)||name,1000),kind:kind==='delete'?'delete':'update',diff:''}];
    return item;
  }
  handleClientRequest(message){
    const params=message.params||{},session=this.sessions.get(params.sessionId);
    if(message.method==='session/request_permission'){
      if(!session){this.send({jsonrpc:'2.0',id:message.id,result:{outcome:{outcome:'cancelled'}}});return;}
      const tool=params.toolCall||{},options=params.options||[],allow=options.find(option=>String(option.kind||'').startsWith('allow')),reject=options.find(option=>String(option.kind||'').startsWith('reject'));
      const id='kreq_'+message.id,input=tool.rawInput;
      const command=typeof input==='string'?input:typeof input?.command==='string'?input.command:JSON.stringify(input??tool.title??'工具调用',null,2);
      this.clientRequests.set(id,{id:message.id,allow:allow?.optionId||'allow-once',reject:reject?.optionId||'reject-once'});
      this.emit('request',{id,method:'item/commandExecution/requestApproval',params:{threadId:KIMI_PREFIX+session.id,turnId:session.turnId,itemId:tool.toolCallId,reason:clip(tool.title||'Kimi 需要你授权这项操作',400),command:clip(command,4000),cwd:session.cwd,availableDecisions:['accept','decline'],isBlocking:true}});return;
    }
    this.send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:`Office host does not provide ${message.method}`}});
  }
  respond(id,result){
    const entry=this.clientRequests.get(id);if(!entry)return;this.clientRequests.delete(id);
    const optionId=result?.decision==='accept'?entry.allow:entry.reject;
    this.send({jsonrpc:'2.0',id:entry.id,result:{outcome:{outcome:'selected',optionId}}});
  }
  reject(id){
    const entry=this.clientRequests.get(id);if(!entry)return;this.clientRequests.delete(id);
    this.send({jsonrpc:'2.0',id:entry.id,result:{outcome:{outcome:'cancelled'}}});
  }
  close(reason){
    this.ready=false;this.authenticated=false;this.sessions.clear();this.aliases.clear();this.clientRequests.clear();
    const child=this.child;this.child=null;child?.kill('SIGTERM');
    if(reason)this.emit('disconnected',reason);
  }
}
function filePath(update){
  const locations=Array.isArray(update.locations)?update.locations:[],input=update.rawInput;
  return locations[0]?.path||(typeof input?.path==='string'?input.path:typeof input?.file_path==='string'?input.file_path:undefined);
}

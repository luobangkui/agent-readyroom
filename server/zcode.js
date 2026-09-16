import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readZcodeConfig,zcodeRuntime} from './zcode-config.js';

export const ZCODE_PREFIX='zcode:';
const workspace=cwd=>({workspaceKey:cwd,workspacePath:cwd});
const nativeId=id=>id.startsWith(ZCODE_PREFIX)?id.slice(ZCODE_PREFIX.length):id;
const noUnmanagedAgents=['Agent','Task','CronCreate','CronDelete'];
const textOf=result=>typeof result==='string'?result:typeof result?.output==='string'?result.output:typeof result?.content==='string'?result.content:Array.isArray(result?.content)?result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'):result?.stdout||result?.message||'';

// Adapter from ZCode Protocol 1 to the small App Server event contract used by
// MissionService. All model calls still run in ZCode's actual session runtime.
export class ZcodeBridge extends EventEmitter {
  constructor({cwd=process.cwd(),binary=process.env.OFFICE_ZCODE_BIN||'/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',configLoader=readZcodeConfig,spawnProcess=spawn}={}){
    super();this.cwd=cwd;this.binary=binary;this.configLoader=configLoader;this.spawnProcess=spawnProcess;this.pending=new Map();this.clientRequests=new Map();this.sessions=new Map();this.sequence=0;this.ready=false;this.child=null;this.starting=null;this.models=[];this.lastStartAttempt=0;this.lastError='';
  }
  scrub(value){let text=String(value??'');for(const secret of Object.values(this.config?.env||{}))if(secret)text=text.split(secret).join('[redacted]');return text;}
  start(){if(this.ready)return Promise.resolve();if(this.starting)return this.starting;this.lastStartAttempt=Date.now();this.starting=this.connect().catch(error=>{this.lastError=this.scrub?this.scrub(error.message):error.message;this.child?.kill();throw error;}).finally(()=>{this.starting=null;});return this.starting;}
  async connect(){
    if(!existsSync(this.binary))throw new Error('未找到 ZCode 运行程序，可设置 OFFICE_ZCODE_BIN 指向本机 zcode.cjs。');
    this.config=await this.configLoader();
    const child=this.spawnProcess(process.execPath,[this.binary,'app-server','--cwd',this.cwd],{cwd:this.cwd,stdio:['pipe','pipe','pipe'],env:{...process.env,...this.config.env}});this.child=child;
    const disconnected=message=>{if(this.child!==child)return;this.ready=false;this.child=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}this.pending.clear();this.clientRequests.clear();this.emit('disconnected',message);};
    child.on('error',error=>disconnected(`无法启动 ZCode：${this.scrub(error.message)}`));child.on('exit',(code,signal)=>disconnected(`ZCode 连接已关闭（${signal||code}）`));
    child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
    createInterface({input:child.stdout}).on('line',line=>{let msg;try{msg=JSON.parse(line);}catch{return;}if(msg.method){if(msg.id!==undefined)this.handleClientRequest(msg);else this.handleNotification(msg);return;}const p=this.pending.get(msg.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(Object.assign(new Error(this.scrub(msg.error.message)),{rpcCode:msg.error.code})):p.resolve(msg.result);});
    this.models=[];
    for(const model of this.config.provider.models){
      const state=await this.rpc('workspace/readState',{workspace:workspace(this.cwd),runtimeModel:zcodeRuntime(this.config.provider,model.modelId,'low')});
      const available=state.settings.model.available.find(m=>m.ref.modelId===model.modelId&&!m.disabledReason);
      if(!available)throw new Error(`ZCode 未能加载 ${model.modelId}`);
      this.models.push({model:available.ref.modelId,displayName:available.label,provider:'zcode',supportedReasoningEfforts:(available.reasoning?.levels||[]).map(e=>({reasoningEffort:e.value}))});
    }
    this.ready=true;this.emit('connected');
  }
  // 和 Codex/DSH 一样参与运行环境的定期 reconcile：ZCode 启动较慢或第一次
  // 启动失败时，不只是显示未连接，而是限流重试一次，连上后自动恢复派发。
  async pollStatus(){
    if(this.ready)return {connected:true,authenticated:true,message:'已连接'};
    if(!this.child&&!this.starting&&Date.now()-(this.lastStartAttempt||0)>60000){
      this.lastStartAttempt=Date.now();
      try{await this.start();}catch{}
    }
    if(this.ready)return {connected:true,authenticated:true,message:'已连接'};
    return {connected:!!this.child,authenticated:false,message:this.lastError?`ZCode 启动失败：${String(this.lastError).slice(0,200)}`:'ZCode 正在连接'};
  }
  send(msg){if(!this.child?.stdin.writable)throw new Error('ZCode 尚未连接');this.child.stdin.write(JSON.stringify(msg)+'\n');}
  rpc(method,params={},timeout=45000){return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`ZCode 请求超时：${method}`));},timeout);this.pending.set(id,{resolve,reject,timer});try{this.send({id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});}
  session(id){const r=this.sessions.get(nativeId(id));if(!r)throw new Error('ZCode 会话尚未恢复');return r;}
  async request(method,params={}){
    if(method==='account/read')return {account:this.ready?{type:'zcode'}:null};
    if(method==='model/list')return {data:this.models};
    if(method==='thread/start'||method==='thread/resume'){
      const runtime=zcodeRuntime(this.config.provider,params.model,params.officeEffort||'high');
      const common={workspace:workspace(params.cwd),runtimeModel:runtime,thoughtLevel:runtime.thoughtLevel,mcpServers:params.officeMcpServers||[],toolDenylist:noUnmanagedAgents};
      // A host preference disables ZCode's timed automatic answers to questions.
      await this.rpc('workspace/updateInteractionPreferences',{workspace:common.workspace,preferences:{askUserQuestionAutoResolutionEnabled:false}});
      const mode=params.sandbox==='read-only'?'plan':params.officeYolo?'yolo':'build';
      const snapshot=method==='thread/start'?await this.rpc('session/create',{...common,model:runtime.model,mode,persistence:'deferred',titleGenerationEnabled:false}):await this.rpc('session/resume',{...common,sessionId:nativeId(params.threadId)});
      const id=snapshot.session.sessionId;
      if(snapshot.settings.model.current.modelId!==params.model)throw new Error(`ZCode 返回模型 ${snapshot.settings.model.current.modelId}，与指定的 ${params.model} 不同。`);
      this.sessions.set(id,{id,cwd:params.cwd,model:params.model,instructions:params.developerInstructions,turnId:null,textParts:new Map(),tools:new Map(),mode,graphExecution:params.officeHarnessExecution===true});
      await this.rpc('session/setMode',{sessionId:id,mode:this.sessions.get(id).mode});
      await this.rpc('session/subscribe',{sessionId:id,deliveryKind:'desktop-continuous',includeSnapshot:false});
      return {thread:{id:ZCODE_PREFIX+id},model:params.model,provider:'zcode'};
    }
    if(method==='thread/name/set'){return this.command(nativeId(params.threadId),'renameSession',{title:params.name});}
    if(method==='turn/start'){
      const r=this.session(params.threadId);if(r.turnId)throw new Error('该 ZCode 成员已有任务在执行');
      const turnId='zturn_'+randomUUID();r.turnId=turnId;r.textParts.clear();r.tools.clear();r.lastTextId=null;r.stopping=false;
      const text=params.input.filter(i=>i.type==='text').map(i=>i.text).join('\n');
      try{await this.rpc('session/send',{sessionId:r.id,inputId:turnId,queryId:turnId,content:`${r.instructions}\n\n本轮任务：\n${text}`,runtimeModel:zcodeRuntime(this.config.provider,r.model,params.effort||'high'),toolDenylist:noUnmanagedAgents});}catch(error){if(r.graphExecution){error.officeTurnId=turnId;}else r.turnId=null;throw error;}
      return {turn:{id:turnId}};
    }
    if(method==='turn/steer'){
      const r=this.session(params.threadId);if(r.turnId!==params.expectedTurnId)throw new Error('ZCode 活动轮次已改变，请重新发送');
      return this.command(r.id,'sendText',{text:params.input.filter(i=>i.type==='text').map(i=>i.text).join('\n'),requestedDelivery:'guide'});
    }
    if(method==='turn/interrupt'){
      const r=this.session(params.threadId);if(!r.turnId||r.turnId!==params.turnId)return {};
      r.stopping=true;await this.rpc('session/stop',{sessionId:r.id});return {};
    }
    throw new Error(`ZCode 不支持此待命室操作：${method}`);
  }
  async command(sessionId,type,payload){const result=await this.rpc('v4/command',{commandId:randomUUID(),clientId:'readyroom',sessionId,type,payload,issuedAt:Date.now()});if(!['accepted','duplicate','noop'].includes(result.status))throw new Error(this.scrub(result.message||result.reasonCode||'ZCode 未接受操作'));return result;}
  emitEvent(r,method,params){this.emit('notification',{method,params:{threadId:ZCODE_PREFIX+r.id,turnId:r.turnId,...params}});}
  handleNotification(msg){
    if(msg.method!=='session/event')return;
    const event=msg.params,r=this.sessions.get(event.sessionId);if(!r||!r.turnId)return;const p=event.payload||{};
    if(event.type==='turn.started'){this.emitEvent(r,'turn/started',{turn:{id:r.turnId}});return;}
    if(event.type==='part.delta'&&p.field==='text'){
      const id=p.partId||p.messageId;r.lastTextId=id;r.textParts.set(id,(r.textParts.get(id)||'')+p.delta);this.emitEvent(r,'item/agentMessage/delta',{itemId:id,delta:this.scrub(p.delta)});return;
    }
    if(['part.started','part.upserted'].includes(event.type)&&p.part?.type==='text'&&p.part.text){
      const id=p.part.id;r.lastTextId=id;r.textParts.set(id,p.part.text);this.emitEvent(r,'item/started',{item:{id,type:'agentMessage',phase:'commentary',text:this.scrub(p.part.text)}});return;
    }
    if(event.type==='tool.updated'&&p.toolCallId){
      if(p.kind==='scheduled')r.tools.set(p.toolCallId,{name:p.toolName,input:p.input});
      const tool=r.tools.get(p.toolCallId)||{name:p.toolName,input:{}},isFile=['Write','Edit','MultiEdit'].includes(tool.name),isCommand=['Bash','Shell'].includes(tool.name);
      const item={id:p.toolCallId,type:isFile?'fileChange':isCommand?'commandExecution':'mcpToolCall',tool:tool.name,command:isCommand?this.scrub(tool.input?.command||tool.name):undefined,status:['result','error'].includes(p.kind)?(p.kind==='error'||p.result?.isError?'failed':'completed'):'inProgress'};
      if(isFile&&tool.input?.file_path)item.changes=[{path:tool.input.file_path,kind:tool.name==='Write'?'add':'update',diff:''}];
      if(p.kind==='result')item.aggregatedOutput=this.scrub(textOf(p.result));if(p.kind==='error')item.aggregatedOutput=this.scrub(p.error?.message||'工具执行失败');
      if(p.kind==='progress')item.aggregatedOutput=this.scrub(p.stdoutTail||p.stderrTail||'');
      this.emitEvent(r,['result','error'].includes(p.kind)?'item/completed':'item/started',{item});return;
    }
    if(event.type==='turn.completed'||event.type==='turn.failed'){
      const success=event.type==='turn.completed'&&p.resultType==='success',interrupted=r.stopping||p.resultType==='cancelled',turnId=r.turnId;
      const text=this.scrub(p.response||[...r.textParts.values()].join('\n')),error=success||interrupted?null:{message:this.scrub(p.error?.message||p.resultType||'ZCode 执行失败')};
      if(p.usage)this.emitEvent(r,'thread/tokenUsage/updated',{tokenUsage:{total:{inputTokens:p.usage.inputTokens||p.usage.input_tokens||0,outputTokens:p.usage.outputTokens||p.usage.output_tokens||0,cachedInputTokens:p.usage.cacheReadTokens||0,totalTokens:p.tokenCount||0}}});
      r.turnId=null;this.emitEvent(r,'turn/completed',{turnId,turn:{id:turnId,status:success?'completed':interrupted?'interrupted':'failed',error,items:text?[{id:r.lastTextId||'final-'+turnId,type:'agentMessage',phase:'final_answer',text}]:[]}});return;
    }
  }
  handleClientRequest(msg){
    const p=msg.params||{},r=this.sessions.get(p.sessionId);
    if(msg.method==='interaction/requestProviderRuntimeHeaders'){this.send({id:msg.id,result:{headersApplied:false,errorMessage:'当前 ZCode 套餐需要在 ZCode 桌面更新授权后重连。'}});return;}
    if(!r){this.send({id:msg.id,error:{code:-32601,message:'Unknown office ZCode session'}});return;}
    const id='zreq_'+msg.id;
    if(msg.method==='interaction/requestPermission'){
      // The user already authorized this mission's in-app collaboration tools.
      if(/^mcp__office__office_(plan|progress|message|fetch_url|team)$/.test(p.toolName)){this.send({id:msg.id,result:{decision:'allow',reason:'Authorized office collaboration tool'}});return;}
      this.clientRequests.set(id,{msg,kind:'permission'});
      this.emit('request',{id,method:'item/commandExecution/requestApproval',params:{threadId:ZCODE_PREFIX+r.id,turnId:r.turnId,itemId:p.toolCallId,reason:this.scrub(p.reason),command:this.scrub(p.input?.command||`${p.toolName}\n${JSON.stringify(p.input||{},null,2)}`),cwd:r.cwd,availableDecisions:['accept','decline']}});return;
    }
    if(msg.method==='interaction/requestUserInput'){
      const questions=(p.questions?.length?p.questions:[{question:p.prompt||'请回复此问题',header:'问题',options:[]}]).map((q,i)=>({id:`q${i}`,header:q.header||'问题',question:q.question,isSecret:false,options:(q.options||[]).map(o=>({label:o.label||o.value,description:o.description||''}))}));
      this.clientRequests.set(id,{msg,kind:'question',questions});this.emit('request',{id,method:'item/tool/requestUserInput',params:{threadId:ZCODE_PREFIX+r.id,turnId:r.turnId,itemId:p.toolCallId,questions}});return;
    }
    this.send({id:msg.id,error:{code:-32601,message:`Office host does not provide ${msg.method}`}});
  }
  respond(id,result){const entry=this.clientRequests.get(id);if(!entry)return;this.clientRequests.delete(id);let reply;
    if(entry.kind==='permission')reply={decision:result.decision==='accept'?'allow':'deny',reason:'Office user decision for this operation only'};
    else{const answers={};for(const q of entry.questions)answers[q.question]=result.answers?.[q.id]?.answers?.join('\n')||'';reply=Object.values(answers).some(Boolean)?{action:'accept',content:{answers}}:{action:'cancel'};}
    this.send({id:entry.msg.id,result:reply});
  }
  reject(id,message){const entry=this.clientRequests.get(id);if(entry){this.clientRequests.delete(id);this.send({id:entry.msg.id,error:{code:-32601,message}});}}
  close(){this.child?.kill('SIGTERM');}
}

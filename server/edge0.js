import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';

export const EDGE0_PREFIX='edge0:';
export const EDGE0_MODEL='edge0-35b';
const nativeId=id=>String(id||'').startsWith(EDGE0_PREFIX)?id.slice(EDGE0_PREFIX.length):id;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clip=(value,max)=>String(value??'').slice(0,max);
const DEFAULT_SYSTEM='你是用户本机上的日常事务助手，用中文自然、简洁、准确地回答问题、整理思路和润色文字。你没有文件、命令或联网能力，只进行对话。';

// Bridge from the local edge0 OpenAI-compatible server (one MLX model, FIFO
// generation queue at 127.0.0.1:8000) to the office App Server event
// contract. A turn is one streamed chat completion over the session
// transcript; edge0 has no tool surface, so mid-turn steering is refused
// instead of silently dropped, and transcripts persist across restarts.
export class Edge0Bridge extends EventEmitter {
  constructor({cwd=process.cwd(),dataDir=path.join(cwd,'.office-data'),baseUrl=process.env.OFFICE_EDGE0_URL||'http://127.0.0.1:8000',model=EDGE0_MODEL,displayName='Edge0 35B（本机）',maxTokens=Number(process.env.OFFICE_EDGE0_MAX_TOKENS)||2048,historyMessages=Number(process.env.OFFICE_EDGE0_HISTORY_MESSAGES)||12,controlPython=process.env.OFFICE_EDGE0_PYTHON||'',controlScript=process.env.OFFICE_EDGE0_CONTROL||'',fetchImpl=globalThis.fetch,spawnProcess=spawn}={}){
    super();this.cwd=cwd;this.baseUrl=baseUrl.replace(/\/$/,'');this.model=model;this.displayName=displayName;this.maxTokens=maxTokens;this.historyMessages=historyMessages;this.controlPython=controlPython;this.controlScript=controlScript;this.fetchImpl=fetchImpl;this.spawnProcess=spawnProcess;
    this.sessions=new Map();this.ready=false;this.lastControlStart=0;
    try{mkdirSync(dataDir,{recursive:true});}catch{}this.storeFile=path.join(dataDir,'edge0-sessions.json');
    this.loadPersisted();
  }
  async health(timeoutMs=1500){
    try{const response=await this.fetchImpl(`${this.baseUrl}/healthz`,{signal:AbortSignal.timeout(timeoutMs)});if(!response.ok)return false;const data=await response.json().catch(()=>null);return data?.status==='ok';}catch{return false;}
  }
  async spawnControl(){
    if(!existsSync(this.controlPython)||!existsSync(this.controlScript))return;
    await new Promise(resolve=>{try{const child=this.spawnProcess(this.controlPython,[this.controlScript,'start'],{stdio:'ignore'});child.on('exit',resolve);child.on('error',resolve);}catch{resolve();}});
  }
  // The control script is idempotent ("Already running" / "Started"); throttle
  // repeated spawns while the model is still loading.
  async ensureApi({waitMs=8000,spawn:maySpawn=true}={}){
    if(await this.health())return true;
    if(maySpawn&&Date.now()-this.lastControlStart>45000){this.lastControlStart=Date.now();await this.spawnControl();}
    const deadline=Date.now()+waitMs;
    while(Date.now()<deadline){await sleep(800);if(await this.health(1000))return true;}
    return false;
  }
  async start(){this.ready=await this.ensureApi({waitMs:6000});return this.ready;}
  restart(){return this.start();}
  // Runtime liveness for the periodic reconcile in OfficeRuntimes: the model
  // catalog stays listed while loading so missions can describe what is missing.
  async pollStatus(){
    const ok=await this.health(1200);
    if(!ok)await this.ensureApi({waitMs:0});
    return ok?{connected:true,authenticated:true,message:'已连接'}:{connected:true,authenticated:false,message:'本机 Edge0 模型加载中，就绪后自动连接'};
  }
  loadPersisted(){
    try{const data=JSON.parse(readFileSync(this.storeFile,'utf8'));for(const [id,s] of Object.entries(data||{}))if(s&&id===s.id)this.sessions.set(id,{...s,turnId:null,controller:null,stopping:false,itemId:null,textParts:null});}catch{}
  }
  persist(){
    try{const entries=[...this.sessions.values()].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))).slice(0,50);
      const data={};for(const s of entries)data[s.id]={id:s.id,title:s.title,cwd:s.cwd,model:s.model,instructions:s.instructions,history:s.history,updatedAt:s.updatedAt};
      const temp=this.storeFile+'.tmp';writeFileSync(temp,JSON.stringify(data),{mode:0o600});renameSync(temp,this.storeFile);}catch{}
  }
  session(id){const s=this.sessions.get(nativeId(id));if(!s)throw new Error('Edge0 会话尚未建立');return s;}
  trimHistory(s){if(s.history.length>this.historyMessages)s.history.splice(0,s.history.length-this.historyMessages);}
  emitEvent(s,method,params){this.emit('notification',{method,params:{threadId:EDGE0_PREFIX+s.id,turnId:s.turnId,...params}});}
  async request(method,params={}){
    if(method==='account/read')return {account:this.ready?{type:'edge0-local'}:null};
    if(method==='model/list')return {data:[{model:this.model,displayName:this.displayName,provider:'edge0',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'},{reasoningEffort:'high'}]}]};
    if(method==='thread/start'||method==='thread/resume'){
      if(params.model&&params.model!==this.model)throw new Error(`Edge0 只提供 ${this.displayName}（${this.model}）`);
      const id=method==='thread/start'?randomUUID():nativeId(params.threadId);
      if(!this.sessions.has(id))this.sessions.set(id,{id,title:'',cwd:params.cwd,model:this.model,instructions:method==='thread/start'?clip(params.developerInstructions||'',12000):'',history:[],turnId:null,controller:null,stopping:false,itemId:null,updatedAt:new Date().toISOString()});
      const s=this.sessions.get(id);
      if(method==='thread/start')this.persist();
      return {thread:{id:EDGE0_PREFIX+s.id},model:this.model,provider:'edge0'};
    }
    if(method==='thread/name/set'){const s=this.sessions.get(nativeId(params.threadId));if(s){s.title=clip(params.name||'',120);this.persist();}return {};}
    if(method==='turn/start')return this.startTurn(params);
    if(method==='turn/steer')throw new Error('Edge0 正在生成本轮回复；请等本轮结束后再补充。');
    if(method==='turn/interrupt'){
      const s=this.sessions.get(nativeId(params.threadId));
      if(!s||!s.turnId||s.turnId!==params.turnId)return {};
      s.stopping=true;s.controller?.abort();return {};
    }
    throw new Error(`Edge0 不支持此待命室操作：${method}`);
  }
  async startTurn(params){
    const s=this.session(params.threadId);
    if(s.turnId)throw new Error('该 Edge0 成员已有任务在执行');
    const turnId='eturn_'+randomUUID();
    const text=(params.input||[]).filter(i=>i.type==='text').map(i=>i.text).join('\n');
    if(!text.trim())throw new Error('Edge0 收到空消息');
    s.turnId=turnId;s.stopping=false;s.itemId='emsg_'+randomUUID();
    // The API may still be loading after a cold start; give it a bounded
    // chance before failing the turn visibly.
    const ready=await this.ensureApi({waitMs:90000,spawn:false});
    if(!s.turnId){return {turn:{id:turnId}};} // interrupted while waiting
    if(!ready){s.turnId=null;throw new Error('本机 Edge0 服务未就绪：已等待模型加载仍不可用，请稍后重试。');}
    const controller=new AbortController();s.controller=controller;
    const session=s;
    void this.generate(session,turnId,text,controller).catch(()=>{});
    return {turn:{id:turnId}};
  }
  // Reasoning blocks are stripped statelessly: the engine streams the think
  // section first and closes it with </think>; visible text is what follows.
  visibleOf(raw){
    if(!raw.includes('<think>'))return raw;
    if(!raw.includes('</think>'))return '';
    return raw.split('</think>').slice(1).join('</think>').replace(/^\s+/,'');
  }
  async generate(s,turnId,text,controller){
    const emit=(method,params)=>{if(s.turnId!==null&&s.turnId!==undefined&&s.turnId!==turnId)return;this.emit('notification',{method,params:{threadId:EDGE0_PREFIX+s.id,turnId,...params}});};
    emit('turn/started',{turn:{id:turnId}});
    let raw='',shown=0,usage=null,status='completed',error=null;
    try{
      const response=await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({model:this.model,max_tokens:this.maxTokens,stream:true,enable_thinking:false,messages:[{role:'system',content:s.instructions||DEFAULT_SYSTEM},...s.history,{role:'user',content:text}]})});
      if(!response.ok||!response.body){const detail=await response.text().catch(()=>'');throw new Error(`Edge0 服务返回 HTTP ${response.status}${detail?`：${clip(detail,300)}`:''}`);}
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      for(;;){
        const {done,value}=await reader.read();if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        let index;
        while((index=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);
          if(!line.startsWith('data:'))continue;
          const payload=line.slice(5).trim();
          if(!payload||payload==='[DONE]')continue;
          let chunk;try{chunk=JSON.parse(payload);}catch{continue;}
          if(chunk.error)throw new Error(`Edge0 生成失败：${chunk.error.message||'未知错误'}`);
          if(chunk.usage)usage=chunk.usage;
          const choice=chunk.choices?.[0];
          if(choice?.delta?.content){
            raw+=choice.delta.content;
            const visible=this.visibleOf(raw);
            if(visible.length>shown){emit('item/agentMessage/delta',{itemId:s.itemId,delta:visible.slice(shown)});shown=visible.length;}
          }
        }
      }
    }catch(exception){
      if(s.stopping||controller.signal.aborted){status='interrupted';}
      else{status='failed';error=clip(exception.message||'Edge0 请求失败',400);}
    }
    const visible=this.visibleOf(raw);
    s.turnId=null;s.controller=null;s.stopping=false;
    if(status==='completed'&&visible.trim()){s.history.push({role:'user',content:clip(text,16000)},{role:'assistant',content:clip(visible,32000)});this.trimHistory(s);s.updatedAt=new Date().toISOString();this.persist();}
    if(usage)emit('thread/tokenUsage/updated',{tokenUsage:{total:{inputTokens:usage.prompt_tokens||0,outputTokens:usage.completion_tokens||0,cachedInputTokens:0,totalTokens:usage.total_tokens||((usage.prompt_tokens||0)+(usage.completion_tokens||0))}}});
    emit('turn/completed',{turn:{id:turnId,status,error:error?{message:error}:null,items:visible.trim()?[{id:s.itemId,type:'agentMessage',phase:'final_answer',text:visible}]:[]}});
  }
  close(){for(const s of this.sessions.values())s.controller?.abort();this.persist();}
}

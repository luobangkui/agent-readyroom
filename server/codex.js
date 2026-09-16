import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const projectCodex=fileURLToPath(new URL('../node_modules/.bin/codex',import.meta.url));
const AUTH_FAILURE=/access token|authentication|authenticated|unauthori[sz]ed|logged out|sign in again|login required|not logged in/i;

export function isAuthenticationFailure(value){return AUTH_FAILURE.test(String(value??''));}

export class CodexBridge extends EventEmitter {
  constructor({binary=process.env.OFFICE_CODEX_BIN || (existsSync(projectCodex)?projectCodex:'codex'),cwd=process.cwd(),webSearch=process.env.OFFICE_CODEX_WEB_SEARCH||'live',spawnProcess=spawn}={}) {
    super();this.binary=binary;this.cwd=cwd;this.webSearch=webSearch;this.spawnProcess=spawnProcess;this.pending=new Map();this.sequence=0;this.ready=false;this.child=null;this.starting=null;
  }
  start(){
    if(this.ready)return Promise.resolve();
    if(this.starting)return this.starting;
    this.starting=this.connect().catch(error=>{this.child?.kill('SIGTERM');throw error;}).finally(()=>{this.starting=null;});return this.starting;
  }
  async restart(){
    // A user re-login changes the credentials read by a new app-server
    // process. Never reuse the old process, even if it still reports ready.
    const starting=this.starting;
    if(starting)await starting.catch(()=>{});
    this.close('本地 Codex 连接正在重建',{notify:true});
    return this.start();
  }
  // Cheap liveness + auth probe for the runtime reconcile loop: a signed-out
  // Codex process stays "connected" forever, so without this the workbench would
  // keep reporting 未登录 until someone clicked 重建本地连接 by hand.
  async pollStatus(){
    if(!this.ready)return {connected:!!this.child,authenticated:false,message:this.child?'Codex 正在连接':'Codex 未连接'};
    try{
      const account=await this.request('account/read',{},10000);
      return {connected:true,authenticated:!!account.account,message:account.account?'已连接':'请先登录 Codex'};
    }catch(error){return {connected:this.ready,authenticated:false,message:`Codex 状态查询失败：${error.message}`};}
  }
  async connect(){
    const child=this.spawnProcess(this.binary,['app-server','--stdio','-c',`web_search=\"${this.webSearch}\"`],{cwd:this.cwd,stdio:['pipe','pipe','pipe'],env:{...process.env,RUST_LOG:'error'}});this.child=child;
    const rejectAll=(error,{kill=false,authFailed=false}={})=>{
      if(this.child!==child)return;
      this.ready=false;this.child=null;
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();
      if(kill)child.kill('SIGTERM');
      this.emit('disconnected',error.message,{authFailed});
    };
    const invalidateAuth=message=>rejectAll(new Error(message),{kill:true,authFailed:true});
    child.on('error',error=>rejectAll(new Error(`无法启动 Codex：${error.message}`)));
    child.on('exit',(code,signal)=>rejectAll(new Error(`Codex 连接已关闭（${signal||code}）`)));
    child.stdin.on('error',()=>{});
    child.stderr.on('data',chunk=>{ // Drain stderr; surface only an auth failure, never credentials.
      const message=String(chunk);if(isAuthenticationFailure(message))invalidateAuth('本地 Codex 连接已失效，请重新登录后点击“重建本地连接”。');
    });
    createInterface({input:child.stdout}).on('line',line=>{
      let msg;try{msg=JSON.parse(line);}catch{return;}
      if(msg.method){this.emit(msg.id!==undefined?'request':'notification',msg);
        const error=msg.params?.turn?.error?.message||msg.params?.error?.message||msg.params?.error;
        if(isAuthenticationFailure(error))invalidateAuth('本地 Codex 连接已失效，请重新登录后点击“重建本地连接”。');
        return;
      }
      const pending=this.pending.get(msg.id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(msg.id);
      if(msg.error){const error=Object.assign(new Error(msg.error.message),{rpcCode:msg.error.code});if(isAuthenticationFailure(msg.error.message))invalidateAuth('本地 Codex 连接已失效，请重新登录后点击“重建本地连接”。');else pending.reject(error);}else pending.resolve(msg.result);
    });
    await this.request('initialize',{clientInfo:{name:'readyroom',title:'Readyroom',version:'0.2.0'},capabilities:{experimentalApi:true}});
    this.send({method:'initialized',params:{}});this.ready=true;this.emit('connected');
  }
  send(message){if(!this.child?.stdin.writable)throw new Error('Codex 尚未连接');this.child.stdin.write(JSON.stringify(message)+'\n');}
  request(method,params={},timeout=45000){
    return new Promise((resolve,reject)=>{const id=++this.sequence;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Codex 请求超时：${method}。请检查本机连接。`));},timeout);this.pending.set(id,{resolve,reject,timer});try{this.send({id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
  }
  respond(id,result){this.send({id,result});}
  reject(id,message){this.send({id,error:{code:-32601,message}});}
  close(reason='Codex 连接已关闭',{notify=false}={}){const child=this.child;if(!child)return;this.ready=false;this.child=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(reason));}this.pending.clear();if(notify)this.emit('disconnected',reason,{authFailed:false});child.kill('SIGTERM');}
}

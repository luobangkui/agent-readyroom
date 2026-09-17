import {EventEmitter} from 'node:events';
import {ZCODE_PREFIX} from './zcode.js';
import {DSH_PREFIX} from './dsh.js';
import {KIMI_PREFIX} from './kimi.js';

const loginHints={codex:'请先登录 Codex',zcode:'请先登录 ZCode',dsh:'本机 DSH 未就绪，就绪后自动连接',kimi:'请先在终端运行 kimi login 完成登录'};
const loginHint=name=>loginHints[name]||`请先登录 ${name}`;
const clientRequestPrefixes={dsh:'dreq_',zcode:'zreq_',kimi:'kreq_'};

export class OfficeRuntimes extends EventEmitter {
  constructor({codex,zcode,dsh,kimi}={}){
    super();this.backends={codex,zcode,dsh,kimi};this.providers={};this.pollTimers=[];
    for(const [provider,bridge] of Object.entries(this.backends)){
      if(!bridge)continue;
      bridge.on('notification',msg=>this.emit('notification',msg));bridge.on('request',msg=>this.emit('request',msg));
      bridge.on('disconnected',(message,details={})=>{this.providers[provider]={connected:false,authenticated:false,message};this.emit('provider-disconnected',{provider,message,authFailed:details.authFailed===true});});
      // Bridges with a cheap liveness probe reconcile themselves: a later
      // connection re-opens scheduling without a manual reconnect.
      if(typeof bridge.pollStatus==='function')this.pollTimers.push(setInterval(()=>{bridge.pollStatus().then(status=>{
        const previous=this.providers[provider];
        if(previous?.connected===status.connected&&previous?.authenticated===status.authenticated)return;
        this.providers[provider]=status;
        if(status.authenticated&&!previous?.authenticated)this.emit('provider-connected',{provider,status});
        else if(!status.authenticated&&previous?.authenticated)this.emit('provider-disconnected',{provider,message:status.message});
      }).catch(()=>{});},15000).unref());
    }
  }
  async start(){
    await Promise.all(Object.entries(this.backends).filter(([,bridge])=>bridge).map(async([provider,bridge])=>{try{await bridge.start();const account=await bridge.request('account/read');this.providers[provider]={connected:true,authenticated:!!account.account,message:account.account?'已连接':loginHint(provider)};}catch(error){this.providers[provider]={connected:false,authenticated:false,message:error.message};}}));
  }
  async reconnect(provider='codex'){
    const names=Array.isArray(provider)?provider:provider?[provider]:Object.keys(this.backends);
    await Promise.all(names.map(async name=>{
      const bridge=this.backends[name];if(!bridge)throw new Error(`未知运行环境：${name}`);
      try{
        if(typeof bridge.restart==='function')await bridge.restart();
        else{bridge.close?.();await bridge.start();}
        const account=await bridge.request('account/read');
        this.providers[name]={connected:true,authenticated:!!account.account,message:account.account?'已连接':loginHint(name)};
      }catch(error){this.providers[name]={connected:false,authenticated:false,message:error.message};}
    }));
    return this.providers;
  }
  // 重建掉线的运行环境（已连接的保持不动，避免白重启进程）。
  // 供「继续推进 / 重建本地连接」在派发前调用：连接没恢复的话，工作单只会
  // 停在"等待模型连接"，看起来像恢复失败。
  async ensureConnected(){
    const broken=Object.entries(this.providers).filter(([,status])=>!status?.connected||!status?.authenticated).map(([name])=>name);
    if(broken.length)await this.reconnect(broken);
    return this.providers;
  }
  getFor(params){
    // Prefer the explicit provider on resumed/host-created requests. Model
    // names remain a compatibility fallback for older persisted missions.
    if(params.provider==='zcode')return 'zcode';
    if(params.provider==='codex')return 'codex';
    if(params.provider==='dsh')return 'dsh';
    if(params.provider==='kimi')return 'kimi';
    if(params.threadId?.startsWith(KIMI_PREFIX)||/^(k2d8|k3-agent|kimi[-.])/i.test(params.model||''))return 'kimi';
    if(params.threadId?.startsWith(DSH_PREFIX)||/^deepseek[-.]/i.test(params.model||''))return 'dsh';
    return params.threadId?.startsWith(ZCODE_PREFIX)||/^glm-/i.test(params.model||'')?'zcode':'codex';
  }
  async request(method,params={}){
    if(method==='account/read')return {account:Object.values(this.providers).some(p=>p.connected&&p.authenticated)?{type:'local-runtimes'}:null,providers:this.providers};
    if(method==='model/list'){
      const data=[];await Promise.all(Object.entries(this.backends).filter(([,bridge])=>bridge).map(async([provider,bridge])=>{if(this.providers[provider]?.connected){const result=await bridge.request('model/list',params);data.push(...result.data.map(m=>({...m,provider})));}}));return {data};
    }
    const provider=this.getFor(params);if(!this.providers[provider]?.connected)throw new Error(this.providers[provider]?.message||`${provider} 尚未连接`);
    if(provider==='codex'){const {officeMcpServers,officeEffort,...clean}=params;return this.backends.codex.request(method,clean);}
    return this.backends[provider].request(method,params);
  }
  respond(id,result){return this.bridgeForRequest(id)?.respond(id,result);}
  reject(id,message){return this.bridgeForRequest(id)?.reject(id,message);}
  bridgeForRequest(id){const key=String(id),name=Object.keys(clientRequestPrefixes).find(provider=>key.startsWith(clientRequestPrefixes[provider]));return this.backends[name]||this.backends.codex;}
  close(){for(const timer of this.pollTimers)clearInterval(timer);this.pollTimers=[];for(const bridge of Object.values(this.backends))bridge?.close();}
}

import {EventEmitter} from 'node:events';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {instructions} from './prompts.js';
import {scanWorkspace,collectArtifacts} from './artifacts.js';
import {TEAM,teamMember,teamRole,teamCanWrite} from '../src/team.js';
import {assignProfile,ensureRoster} from './roster.js';
import {ProjectStore,projectDirectory} from './projects.js';
import {canArchive} from '../src/mission-archive.js';
import {normalizeRoleAvatars} from '../src/mission-avatars.js';
import {effectiveScope,scopeOverlap,scopeConflictMessage,sharedScopeAdvisory,workFor,workDependencies,makeWork,setWorkStatus,invalidateReviews,recordReport,reportReady,qualityIssues,workContext,scopePath} from './collaboration.js';
import {prepareGraph,graphPending,graphRunning,candidates,resourceBlocker,independent,claim,transition,setWaitReason,finishAttempt,prepareArtifact,validateArtifact,artifactContext,artifactKey,requirements,harnessMetrics,digest,humanWork,prepareSplit,callbackWork} from './harness.js';
import {topoLayers,criticalPath} from '../src/work-graph.js';

const ACTIVE=new Set(['starting','running','waiting']);
const TERMINAL=new Set(['idle','completed','failed','stopped','interrupted','needs_attention']);
const toolLabels={office_plan:'更新工作计划',office_progress:'更新任务进展',office_message:'与成员交换信息',office_fetch_url:'读取网页地址',office_delegate:'分配子任务',office_continue:'安排后续工作',office_team:'等待团队结果',office_inbox:'读取协作消息',office_report:'提交交付证据',office_split:'拆分并行子任务',office_watch:'登记回调通知'};
// Watch rules: which durable events a member can subscribe to, and how a fired
// subscription reaches the subscriber.
const WATCH_KINDS=new Set(['work.completed','work.failed','work.settled','artifact.published','artifact.validated','member.idle']);
const MAX_WATCHES=32,MAX_CALLBACKS=6;
const now=()=>new Date().toISOString();
const uid=prefix=>`${prefix}_${randomUUID().slice(0,8)}`;
const clip=(value,max=32000)=>String(value??'').slice(0,max);
const envLimit=(name,fallback,min,max)=>{const value=Number(process.env[name]);return Number.isSafeInteger(value)&&value>=min&&value<=max?value:fallback;};
const restore=(target,state)=>{for(const key of Object.keys(target))delete target[key];Object.assign(target,state);};
export function inputText(value,name,max=20000){if(typeof value!=='string'||!value.trim()||value.length>max)throw Object.assign(new Error(`${name}不能为空，且最多 ${max} 字。`),{status:400});return value.trim();}
export class MissionService extends EventEmitter {
  constructor(bridge,{directory,defaultCwd,memberToolURL='http://127.0.0.1:4317/api/member-tool',maxSessions,maxWorkers,maxBosses}={}){
    super();this.instanceId=randomUUID();this.bridge=bridge;this.directory=directory;this.defaultCwd=defaultCwd;this.missions=[];this.loaded=new Set();this.requests=new Map();this.saveTimer=null;this.broadcastTimer=null;
    // Concurrency stays conservative by default; a deployment that knows its
    // model quota can raise it without touching the scheduler.
    this.limits={sessions:maxSessions??envLimit('OFFICE_MAX_SESSIONS',6,1,24),workers:maxWorkers??envLimit('OFFICE_MAX_WORKERS',3,1,8),bosses:maxBosses??envLimit('OFFICE_MAX_BOSSES',2,1,4)};
    this.connection={connected:false,authenticated:false,models:[],message:'正在连接本机 Codex…'};
    this.memberToolURL=memberToolURL;this.memberCapabilities=new Map();this.memberTokens=new Map();
    this.harnessTimer=setInterval(()=>void this.checkHarnessTimeouts(),10000);this.harnessTimer.unref();
    mkdirSync(directory,{recursive:true});this.file=path.join(directory,'missions.json');
    if(existsSync(this.file)){const saved=readFileSync(this.file,'utf8');this.missions=JSON.parse(saved);if(this.missions.some(m=>m.rosterVersion!==1)&&!existsSync(this.file+'.before-roster-v1'))writeFileSync(this.file+'.before-roster-v1',saved,{mode:0o600});for(const m of this.missions){for(const a of m.agents){if(ACTIVE.has(a.status)||a.status==='queued')a.status='interrupted';a.turnId=null;}for(const r of m.requests??[])if(r.status==='pending')r.status='expired';if(!TERMINAL.has(m.status))m.status='interrupted';}}
    this.projects=new ProjectStore(directory);
    let rosterChanged=this.projects.migrate(this.missions);for(const m of this.missions){for(const w of m.workItems||[])if(ACTIVE.has(w.status)||w.status==='queued'||w.status==='suspending'){w.status='interrupted';w.waitReason={kind:'recovery',message:'服务重启，需明确检查后重试；未自动重放外部操作'};}if(ensureRoster(m,role=>this.makeAgent(m,{role,task:'',status:'idle'})))rosterChanged=true;}if(rosterChanged)this.save();
    bridge.on('notification',msg=>this.notification(msg));
    bridge.on('request',msg=>{this.handleRequest(msg).catch(error=>{try{bridge.respond(msg.id,{success:false,contentItems:[{type:'inputText',text:error.message}]});}catch{}});});
    bridge.on('disconnected',message=>{this.loaded.clear();this.connection={...this.connection,connected:false,message};for(const m of this.missions){if(!TERMINAL.has(m.status)){m.status='interrupted';for(const a of m.agents){if(ACTIVE.has(a.status)||a.status==='queued'){a.status='interrupted';a.turnId=null;setWorkStatus(m,a,'interrupted');}}for(const r of m.requests)if(r.status==='pending')r.status='expired';this.teamChanged(m);}}this.requests.clear();this.touch();this.emit('member-finished');});
    bridge.on('provider-disconnected',({provider,message,authFailed=false})=>{
      const providers={...this.connection.providers,[provider]:{connected:false,authenticated:false,message}};this.connection={...this.connection,providers,connected:Object.values(providers).some(p=>p.connected),message};
      for(const m of this.missions){let affected=false,authAffected=false;for(const a of m.agents)if(a.provider===provider){this.loaded.delete(a.threadId);if(authFailed&&a.error&&/access token|logged out|sign in again|authentication/i.test(a.error))authAffected=true;if(ACTIVE.has(a.status)||a.status==='queued'){a.status='interrupted';a.turnId=null;a.error=message;setWorkStatus(m,a,'interrupted');affected=true;}for(const r of m.requests.filter(r=>r.agentId===a.id&&r.status==='pending')){r.status='expired';this.requests.delete(r.id);}}if(affected||authAffected){m.status=m.agents.some(a=>ACTIVE.has(a.status))?'running':'interrupted';if(authAffected){m.phase='blocked';m.finishedAt=null;m.accepted=false;}this.teamChanged(m);}}
      this.touch();this.emit('member-finished');this.schedule();
    });
    bridge.on('provider-connected',({provider,status})=>{
      const providers={...this.connection.providers,[provider]:status};
      this.connection={...this.connection,connected:Object.values(providers).some(p=>p.connected&&p.authenticated),providers,message:'已连接本机运行环境'};
      this.touch();this.schedule();
    });
  }
  async connect({force=false,provider='codex'}={}){
    try{if(force&&typeof this.bridge.reconnect==='function')await this.bridge.reconnect(provider);else await this.bridge.start();const [account,catalog]=await Promise.all([this.bridge.request('account/read',{}),this.bridge.request('model/list',{includeHidden:false})]);
      this.connection={connected:!!account.account,authenticated:!!account.account,authType:account.account?.type||null,providers:account.providers,models:catalog.data.map(m=>({id:m.model,name:m.displayName,provider:m.provider||'codex',efforts:m.supportedReasoningEfforts.map(e=>e.reasoningEffort)})),message:account.account?'已连接本机运行环境':'请先连接 Codex 或 ZCode'};
      await Promise.all(this.missions.filter(m=>m.status==='completed'&&!m.files.length).map(m=>collectArtifacts(m).catch(()=>{})));
    }catch(error){this.connection={...this.connection,connected:false,message:error.message};}this.touch();return this.connection;
  }
  snapshot(){return {instanceId:this.instanceId,capabilities:{missionArchive:true,creationAvatars:true,scopedCollaboration:true,localFilePreview:true,inputReadyHarness:true},connection:this.connection,team:TEAM,defaultCwd:this.defaultCwd,projects:this.projects.projects,missions:this.missions.map(({baseline,artifactVersions,...m})=>({...m,...(m.harnessVersion?{harnessMetrics:harnessMetrics(m),artifactVersions:(artifactVersions||[]).map(({files,...v})=>({...v,files:files.map(({content,...f})=>f)}))}:{})})),serverTime:now()};}
  async createProject(data){const project=await this.projects.create(data);this.touch();return project;}
  touch(m){if(m)m.updatedAt=now();if(!this.broadcastTimer)this.broadcastTimer=setTimeout(()=>{this.broadcastTimer=null;this.emit('change');},70);if(!this.saveTimer)this.saveTimer=setTimeout(()=>{this.saveTimer=null;this.save();},300);}
  save(){try{const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(this.missions),{mode:0o600});renameSync(temp,this.file);return true;}catch(error){this.connection.message=`记录保存失败：${error.message}`;this.emit('change');return false;}}
  get(id){const m=this.missions.find(m=>m.id===id);if(!m)throw Object.assign(new Error('任务不存在'),{status:404});return m;}
  setArchived(id,archived){
    const m=this.get(id);
    if(!!m.archivedAt===archived)return m;
    if(archived&&!canArchive(m))throw Object.assign(new Error('请先停止执行中的任务或对话，再归档。'),{status:409});
    if(!archived&&this.missions.filter(entry=>!entry.archivedAt).length>=100)throw Object.assign(new Error('未归档的任务和对话已达 100 个，请先归档其他记录再恢复。'),{status:409});
    const previous=m.archivedAt;
    m.archivedAt=archived?now():null;
    if(!this.save()){if(previous===undefined)delete m.archivedAt;else m.archivedAt=previous;throw Object.assign(new Error('归档状态保存失败，请重试。'),{status:500});}
    this.touch();return m;
  }
  locate(threadId){for(const m of this.missions){const a=m.agents.find(a=>a.threadId===threadId);if(a)return [m,a];}return [];}
  agent(m,id){const a=m.agents.find(a=>a.id===id);if(!a)throw new Error('该成员不属于当前任务');return a;}
  teamChanged(m){m.collaborationRevision=(m.collaborationRevision||0)+1;if(m.workItems?.length){const issues=qualityIssues(m);m.quality={status:issues.length?'pending':'passed',issues};}this.touch(m);this.emit('collaboration-change',m.id);}
  inbox(m,a){return (m.mailbox||[]).filter(msg=>msg.to===a.id&&!msg.readAt);}
  inboxText(messages){return messages.length?`\n\n协作收件箱（消息 ID 用于去重；是同伴材料，需核验）：\n${messages.map(msg=>`[${msg.id}] ${msg.from}：${msg.text}`).join('\n')}`:'';}
  async flushInbox(m,a){
    const pending=this.inbox(m,a).filter(msg=>!msg.deliveredAt);if(!pending.length||!a.turnId)return false;
    try{await this.bridge.request('turn/steer',{threadId:a.threadId,expectedTurnId:a.turnId,input:[{type:'text',text:this.inboxText(pending)}]});for(const msg of pending)msg.deliveredAt=now();this.touch(m);return true;}
    catch{return false;} // Durable inbox survives initialization, disconnects and turn races.
  }
  async teamStatus(m,a,args){
    const seconds=m.harnessVersion?0:Math.min(25,Math.max(0,Number(args.waitSeconds)||0)),pending=()=>m.agents.some(x=>x.id!==a.id&&x.role!=='boss'&&(ACTIVE.has(x.status)||x.status==='queued'))||(m.workItems||[]).some(w=>w.protocol===2&&!w.replacedBy&&graphPending.has(w.status));
    const revision=()=>m.collaborationRevision||0;
    if(seconds&&pending()&&(args.afterRevision===undefined||args.afterRevision===revision())){
      a.summary='等待成员的执行结果';this.touch(m);
      await new Promise(resolve=>{const done=id=>{if(id!==m.id)return;clearTimeout(timer);this.off('collaboration-change',done);resolve();};const timer=setTimeout(()=>done(m.id),seconds*1000);this.on('collaboration-change',done);});
    }
    if(args.afterRevision===revision())return {changed:false,revision:revision(),pending:pending()};
    const graph=(()=>{const {layers,cycles}=topoLayers(m),{chain,critical}=criticalPath(m);return {layers:layers.length,cycles:cycles.map(id=>m.workItems.find(w=>w.id===id)?.key||id),criticalPath:chain.map(id=>m.workItems.find(w=>w.id===id)?.key||id),critical:critical.size};})();
    return {changed:true,revision:revision(),pending:pending(),writeHandoff:pending()?'成员尚未结束，老板仅协调和验收证据，不要同时修改共享目录。':m.mode==='plan'?'本任务仅出方案，继续保持只读。':'成员均已结束，可以接手直接修改并验证。',graph,watches:(m.watches||[]).filter(w=>!w.cancelledAt&&w.agentId===a.id).map(w=>({id:w.id,events:w.events,note:w.note,wake:w.wake,fires:w.fires||0,lastEvent:w.lastEvent||null,expiresAt:w.expiresAt})),members:m.agents.filter(x=>x.id!==a.id).map(x=>({agentId:x.id,name:x.name,role:x.role,model:x.model,status:x.status,summary:x.summary,workId:x.workId,...(!m.harnessVersion?{result:clip(x.result,6000)}:{}),error:x.error})),workItems:(m.workItems||[]).filter(w=>!w.replacedBy).map(w=>({id:w.id,key:w.key,agentId:w.agentId,eligibleRoles:w.eligibleRoles,task:clip(w.task,300),scope:w.scope,dependsOn:w.dependsOn,requires:w.requires,produces:w.produces,resources:w.resources,generation:w.generation,waitReason:w.waitReason,reviewOf:w.reviewOf,status:w.status,stale:!!w.stale,splitOf:w.splitOf||null,children:w.children||[],callback:!!w.callback,report:w.report?{summary:w.report.summary,verdict:w.report.verdict,checks:w.report.checks.map(c=>({name:c.name,result:c.result}))}:null})),artifactVersions:(m.artifactVersions||[]).map(({files,checks,validation,...v})=>({...v,validatedBy:validation?.agentId})),metrics:harnessMetrics(m),qualityIssues:qualityIssues(m),pendingHumanRequests:m.requests.filter(r=>r.status==='pending').map(r=>({agentId:r.agentId,kind:r.kind})),messages:this.inbox(m,a).slice(0,20).map(msg=>({id:msg.id,from:msg.from,text:msg.text}))};
  }
  // ---- runtime decomposition --------------------------------------------------
  // A member that finds its claimed work item is really several jobs splits it in
  // place instead of asking the planner and waiting a model round trip. The child
  // items are built off to the side, the whole graph is re-checked for cycles,
  // and only then is anything persisted or dispatched; the parent stays in the
  // graph as the join so downstream consumers never need re-pointing.
  async split(m,a,args){
    if(m.kind==='chat'||m.mode==='solo')throw Object.assign(new Error('当前模式不启用协作任务图。'),{status:400});
    const prepared=prepareSplit(m,a,args),parent=prepared.parent;
    if(prepared.duplicate)return {recorded:true,duplicate:true,parent:{id:parent.id,key:parent.key,status:parent.status},children:(parent.children||[]).map(id=>{const child=m.workItems.find(w=>w.id===id);return {id,key:child?.key,status:child?.status};}),instruction:'这次拆分已经生效，不要重复提交；子任务结束后会自动回到你这里汇总。'};
    const backup=structuredClone(parent),claimed=parent.agentId===a.id&&a.workId===parent.id&&ACTIVE.has(a.status);
    parent.children=prepared.children.map(child=>child.id);
    parent.splitDepth=(parent.splitDepth||0)+1;
    parent.splitRequests=[...(parent.splitRequests||[]),prepared.receipt];
    parent.dependsOn=prepared.parentEdges;
    // The splitting turn is still running: mark the work item so its completion
    // records the attempt without declaring the join finished.
    if(claimed)parent.drain={agentId:a.id,launchId:a.launchId,generation:parent.generation};
    transition(parent,'waiting_input',{kind:'split',message:`已拆成 ${prepared.children.length} 个并行子任务，等待它们结束后汇总`});
    m.workItems=[...m.workItems,...prepared.children];m.harnessVersion=2;
    if(!this.save()){
      m.workItems.splice(-prepared.children.length);restore(parent,backup);
      throw Object.assign(new Error('拆分未保存，没有派发子任务。'),{status:500});
    }
    this.event(m,a,`把 ${parent.key} 拆成 ${prepared.children.length} 个并行子任务：${prepared.children.map(child=>child.key).join('、')}`);
    this.teamChanged(m);this.schedule();
    const advisory=sharedScopeAdvisory(prepared.children);
    if(advisory)this.event(m,a,`提示：拆出的子任务里有 ${advisory.paths.map(entry=>`${entry.path}（${entry.workItems} 单）`).join('、')} 共享写入范围，会互相排队；${advisory.advice}`,'status');
    return {recorded:true,duplicate:false,parent:{id:parent.id,key:parent.key,status:parent.status},children:prepared.children.map(child=>({id:child.id,key:child.key,eligibleRoles:child.eligibleRoles,priority:child.priority})),...(advisory?{sharedWritePaths:advisory}:{}),instruction:claimed?'子任务已进入调度：请立刻给出简短回复并结束本轮，释放名额。全部子任务结束后汇总轮次会回到你（或同岗位成员）手里，等待期间不要轮询。':'子任务已进入调度，由空闲的合适成员领取；无需再逐人派单。'};
  }
  // ---- callback subscriptions -------------------------------------------------
  // Members subscribe to durable events instead of polling the board. A fired
  // subscription is written to the reliable inbox first and only then may wake
  // the subscriber with one real callback work item, so a crash between the two
  // loses the wake but never the notification.
  watchRuleMatches(rule,event){
    if(rule?.kind!==event.kind)return false;
    const target=rule.target;
    if(!target||target==='*')return true;
    return [event.target,event.key,event.workId,event.memberId,event.name].filter(Boolean).includes(target);
  }
  watchEvent(m,event){
    const watches=m.watches||[];let fired=0;
    for(const watch of watches){
      if(watch.cancelledAt||(watch.fires||0)>=(watch.maxFires||1))continue;
      if(watch.expiresAt&&Date.parse(watch.expiresAt)<=Date.now())continue;
      if(!watch.events.some(rule=>this.watchRuleMatches(rule,event)))continue;
      const member=m.agents.find(x=>x.id===watch.agentId);
      const text=`回调通知（${event.kind}）：${event.summary}${watch.note?`\n你登记的关注点：${watch.note}`:''}\n这是调度器按你的订阅发出的通知，不是同伴发言；需要行动就按关注点推进，不需要就结束本轮。`;
      if(!this.queueCallback(m,watch.agentId,text,event))continue;
      watch.fires=(watch.fires||0)+1;watch.firedAt=now();watch.lastEvent=event.kind;watch.lastTarget=event.target;
      if(watch.wake)this.wakeMember(m,member,{text,event});
      this.event(m,member,`回调 ${event.kind} → ${member?.name||watch.agentId}`,'status');
      fired++;
    }
    if(fired)this.teamChanged(m);
    return fired;
  }
  queueCallback(m,agentId,text,event){
    m.mailbox??=[];
    if(m.mailbox.filter(msg=>!msg.readAt).length>=400)return null;
    const message=this.message(m,'harness',text,'collaboration',{to:agentId,callback:event.kind});
    const previous=m.mailbox,entry={id:message.id,from:'harness',to:agentId,text,createdAt:message.createdAt,deliveredAt:null,readAt:null,callback:event.kind};
    m.mailbox=previous.filter(msg=>!msg.readAt).concat(entry);
    if(!this.save()){m.mailbox=previous;m.messages=m.messages.filter(x=>x.id!==message.id);return null;}
    const member=m.agents.find(x=>x.id===agentId);
    if(member)void this.flushInbox(m,member).catch(()=>{});
    return entry;
  }
  wakeMember(m,member,{text,event}){
    if(!member||ACTIVE.has(member.status)||member.status==='queued')return false;
    if((m.workItems||[]).some(w=>w.callback&&w.agentId===member.id&&graphPending.has(w.status)))return false;
    if((m.workItems||[]).filter(w=>w.callback&&w.agentId===member.id).length>=MAX_CALLBACKS)return false;
    const previous=workFor(m,member),status=member.status;
    const work=callbackWork(m,member,`回调工作单（${event.kind}）：${text}`,previous,{priority:6});
    member.status='queued';member.task=work.task;member.error=null;member.finishedAt=null;
    if(!this.save()){m.workItems.pop();member.status=status;return false;}
    this.event(m,member,`订阅回调唤醒：${clip(event.summary,160)}`,'status');
    return true;
  }
  watch(m,a,args){
    if(m.kind!=='goal')throw Object.assign(new Error('只有目标会话支持任务图回调订阅。'),{status:400});
    const raw=Array.isArray(args.events)?args.events:[];
    if(!raw.length||raw.length>8)throw Object.assign(new Error('订阅必须包含 1–8 个事件。'),{status:400});
    const events=raw.map(rule=>{
      const kind=inputText(rule?.kind,'事件类型',60);
      if(!WATCH_KINDS.has(kind))throw Object.assign(new Error(`事件类型必须是 ${[...WATCH_KINDS].join(' / ')}。`),{status:400});
      const target=rule?.target===undefined||rule?.target===null||rule?.target===''?'*':inputText(rule.target,'事件目标',200);
      return {kind,target};
    });
    const note=typeof args.note==='string'?clip(args.note.trim(),2000):'',wake=args.wake!==false,repeat=args.repeat===true;
    const maxFires=repeat?Math.min(5,Math.max(1,Number(args.maxFires)||5)):1;
    const expiresInSeconds=Math.min(86400,Math.max(60,Number(args.expiresInSeconds)||3600));
    m.watches??=[];
    if(m.watches.filter(entry=>!entry.cancelledAt).length>=MAX_WATCHES)throw Object.assign(new Error('本目标订阅已达上限，请先取消不再需要的订阅。'),{status:409});
    const duplicate=m.watches.find(entry=>!entry.cancelledAt&&entry.agentId===a.id&&JSON.stringify(entry.events)===JSON.stringify(events)&&(entry.note||'')===note);
    if(duplicate)return {watchId:duplicate.id,duplicate:true,fires:duplicate.fires||0,expiresAt:duplicate.expiresAt,instruction:'这条订阅已经存在，不会重复登记。'};
    const watch={id:uid('watch'),agentId:a.id,events,note,wake,repeat,maxFires,fires:0,createdAt:now(),expiresAt:new Date(Date.now()+expiresInSeconds*1000).toISOString()};
    m.watches.push(watch);
    if(!this.save()){m.watches.pop();throw Object.assign(new Error('订阅未保存，请重试。'),{status:500});}
    this.event(m,a,`登记回调订阅：${events.map(rule=>`${rule.kind}${rule.target==='*'?'':' '+rule.target}`).join('、')}${wake?'（可唤醒）':''}`);
    this.teamChanged(m);
    return {watchId:watch.id,duplicate:false,wake,expiresAt:watch.expiresAt,instruction:'事件发生时你会收到一条可靠收件箱消息；等待期间不要轮询 office_team，先去领其他就绪工作或结束本轮。'};
  }
  unwatch(m,a,args){
    const watch=(m.watches||[]).find(entry=>entry.id===args.watchId&&entry.agentId===a.id&&!entry.cancelledAt);
    if(!watch)throw Object.assign(new Error('没有这条有效订阅。'),{status:404});
    watch.cancelledAt=now();
    if(!this.save()){delete watch.cancelledAt;throw Object.assign(new Error('取消订阅未保存，请重试。'),{status:500});}
    this.teamChanged(m);return {cancelled:true,watchId:watch.id};
  }
  message(m,agentId,text,kind='assistant',extra={}){const msg={id:uid('msg'),agentId,kind,text:clip(text,64000),createdAt:now(),...extra};m.messages.push(msg);if(m.messages.length>300)m.messages.splice(0,m.messages.length-300);this.touch(m);return msg;}
  event(m,a,text,kind='status',extra={}){m.events.push({id:uid('evt'),agentId:a?.id,text:clip(text,4000),kind,createdAt:now(),...extra});if(m.events.length>300)m.events.shift();this.touch(m);}
  makeAgent(m,{role,task,dependsOn=[],status='queued',override}){const a=assignProfile(m,{id:uid('agent'),task,dependsOn,status,phase:'planning',threadId:null,turnId:null,plan:[],result:'',usage:null,summary:status==='idle'?'等待分配任务':'等待开始',createdAt:now()},role,override);m.agents.push(a);return a;}
  // Creation-time role→model assignment. The role contract and appearance stay
  // bound to the role; only the model/provider move. Models must come from the
  // connected runtime catalog so routing and availability stay truthful.
  normalizeRoleModels(value){
    if(value===undefined||value===null)return null;
    if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(new Error('模型分配必须按岗位指定。'),{status:400});
    const result={};
    for(const [role,model] of Object.entries(value)){
      if(!['boss','tech','builder','ops'].includes(role))throw Object.assign(new Error(`模型分配包含无效的岗位：${role}`),{status:400});
      if(typeof model!=='string')throw Object.assign(new Error('模型分配必须是模型 ID。'),{status:400});
      const info=this.connection.models.find(entry=>entry.id===model);
      if(!info)throw Object.assign(new Error(`${model} 不在可用模型列表中，请重新选择。`),{status:400});
      result[role]={model:info.id,modelName:info.name,provider:info.provider};
    }
    return Object.keys(result).length?result:null;
  }
  modelAvailable(a){const info=this.connection.models.find(m=>m.id===a.model),provider=this.connection.providers?.[a.provider];if(!info||provider&&!provider.authenticated)throw Object.assign(new Error(`${a.position}需要 ${a.modelName}，${provider?.message||'请连接对应运行环境后重试'}`),{status:503});return info;}
  memberMcp(m,a){let token=this.memberTokens.get(a.id);if(!token||!a.threadId||!this.loaded.has(a.threadId)){if(token)this.memberCapabilities.delete(token);token=randomBytes(32).toString('hex');this.memberTokens.set(a.id,token);}this.memberCapabilities.set(token,{m,a,workId:a.workId,generation:workFor(m,a)?.generation,launchId:a.launchId});return [{name:'office',command:process.execPath,args:[fileURLToPath(new URL('./office-mcp.mjs',import.meta.url))],env:[{name:'OFFICE_MCP_URL',value:this.memberToolURL},{name:'OFFICE_MCP_TOKEN',value:token},{name:'OFFICE_MCP_ROLE',value:a.role}],isolation:'session'}];}
  async callMemberTool(token,name,args){const entry=this.memberCapabilities.get(token);if(!entry||!ACTIVE.has(entry.a.status)||entry.launchId!==entry.a.launchId||entry.workId!==entry.a.workId||entry.generation!==workFor(entry.m,entry.a)?.generation)throw Object.assign(new Error('成员会话已结束或执行代次已过期'),{status:403});return this.dynamic(entry.m,entry.a,name,args);}
  async fetchPublicUrl(rawUrl,fetchImpl=fetch){
    let url;try{url=new URL(inputText(rawUrl,'网页地址',2048));}catch{throw Object.assign(new Error('网页地址必须是有效的 http(s) URL。'),{status:400});}
    if(!['http:','https:'].includes(url.protocol))throw Object.assign(new Error('网页读取只允许 http(s) 地址。'),{status:400});
    const host=url.hostname.toLowerCase();if(host==='localhost'||host.endsWith('.localhost')||host==='127.0.0.1'||host==='[::1]'||/^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host))throw Object.assign(new Error('为避免越权，网页读取不访问本机或内网地址。'),{status:403});
    const response=await fetchImpl(url,{method:'GET',redirect:'follow',headers:{accept:'text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1','user-agent':'Little-Office/0.3'},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Object.assign(new Error(`网页返回 HTTP ${response.status}。`),{status:502});
    const type=response.headers.get('content-type')||'';if(!/(text\/html|text\/plain|application\/json|application\/xml|text\/xml)/i.test(type))throw Object.assign(new Error(`网页内容类型不支持：${type||'未知'}。`),{status:415});
    const body=await response.text();if(body.length>2_000_000)throw Object.assign(new Error('网页内容超过 2 MB，已停止读取。'),{status:413});
    const title=(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    const text=body.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/\s+/g,' ').trim().slice(0,30000);
    return {url:url.href,status:response.status,title,text,truncated:body.length>30000};
  }
  async create(data){
    const kind=data.kind??'goal';if(!['goal','chat'].includes(kind))throw Object.assign(new Error('无效的会话类型'),{status:400});
    const roleAvatars=normalizeRoleAvatars(data.roleAvatars);
    if(kind==='goal'&&(!this.connection.connected||!this.connection.authenticated))throw Object.assign(new Error(this.connection.message||'请先连接 Codex'),{status:503});
    if(this.missions.filter(m=>!m.archivedAt).length>=100)throw Object.assign(new Error('未归档的任务和对话已达 100 个，请先归档历史记录。'),{status:409});
    const prompt=kind==='chat'?'':inputText(data.prompt,'任务目标');
    const project=data.projectId!==undefined?this.projects.get(data.projectId):null;
    const cwd=await projectDirectory(project?.cwd||data.cwd||this.defaultCwd);
    if(project&&data.cwd&&await projectDirectory(data.cwd)!==cwd)throw Object.assign(new Error('目标或对话的目录必须与所属项目一致。'),{status:400});
    const mode=kind==='chat'?'chat':['team','solo','plan'].includes(data.mode)?data.mode:'team';
    const effort=data.effort||'high';
    const roleModels=this.normalizeRoleModels(data.roleModels);
    if(kind==='goal')for(const profile of TEAM){const assigned=roleModels?.[profile.role],effective=assigned?{model:assigned.model,modelName:assigned.modelName,provider:assigned.provider,position:profile.position}:profile;const info=this.modelAvailable(effective);if(effective.provider==='codex'&&!info.efforts.includes(effort))throw Object.assign(new Error(`${effective.modelName} 不支持此思考深度。`),{status:400});}
    const leadRole=kind==='chat'?'tech':mode==='solo'?'builder':'boss',model=roleModels?.[leadRole]?.model||teamMember(leadRole).model;
    const baseline=kind==='chat'?null:await scanWorkspace(cwd);
    const owner=project||this.projects.addCanonical(cwd);
    const m={id:uid('mission'),projectId:owner.id,kind,title:clip(data.title||(kind==='chat'?'新对话':prompt.split(/[\n。！？]/)[0]),60),prompt,acceptance:kind==='chat'?'':clip(data.acceptance,4000),cwd,mode,model,effort,rosterVersion:1,roleAvatars,presentationTheme:'styloo',status:kind==='chat'?'idle':'queued',phase:'planning',createdAt:now(),updatedAt:now(),agents:[],messages:[],events:[],requests:[],files:[],baseline,autoSummaries:0,accepted:false};
    // A project chat keeps one conversation, but exposes all four office roles
    // as addressable recipients. When the chat form supplies one model (the
    // normal case), use it for every role so switching recipients never
    // silently falls back to a cloud runtime.
    for(const profile of TEAM)this.makeAgent(m,{role:profile.role,task:'',status:'idle',override:roleModels?.[profile.role]||(kind==='chat'?roleModels?.[leadRole]:undefined)});
    const a=m.agents.find(a=>a.role===leadRole);m.coordinatorId=a.id;this.missions.unshift(m);
    if(kind==='chat'){a.summary='发送第一条消息，开始项目对话';this.touch(m);}
    else{a.task=prompt;a.status='queued';a.summary='等待开始';this.message(m,'human',prompt,'user');this.event(m,a,'任务已下发，正在准备工作空间');this.schedule();}
    return m;
  }
  async launch(m,a,text=a.task){
    let turnRequested=false;
    const launchId=uid('launch');a.launchId=launchId;a.status='starting';setWorkStatus(m,a,'starting');invalidateReviews(m,workFor(m,a));a.summary=`正在准备 ${a.modelName} 会话`;m.status='running';this.teamChanged(m);
    if(a.role==='boss'&&m.harnessVersion){a.graphRevisionSeen=m.graphResultRevision||0;if(a.coordinationOnly)text+='\n\n本轮只处理任务图、共享快照、报告与规划决策，不读写同事正在工作的项目文件。没有需要决策的事就结束本轮；不占模型轮次等待。';}
    try{
      this.modelAvailable(a);
      // Codex leads keep the full local execution surface for research, planning,
      // and review. The plan mode remains an explicit read-only exception.
      const fullAccess=a.fullAccess===true&&m.mode!=='plan';
      const [officeMcp]=this.memberMcp(m,a);
      // ZCode and DSH take the office tools as protocol-level MCP declarations,
      // not as Codex config rows; DSH additionally needs its harness execution
      // flag so a failed graph turn keeps its execution slot.
      const acpProvider=a.provider==='zcode'||a.provider==='dsh';
      // A loaded Codex resume retains its MCP environment; graph generations
      // use fresh sessions. Unloaded legacy sessions get current MCP schemas.
      const config={cwd:m.cwd,model:a.model,sandbox:fullAccess?'danger-full-access':a.write?'workspace-write':'read-only',approvalPolicy:fullAccess?'never':'on-request',...(fullAccess?{}:{approvalsReviewer:'user'}),developerInstructions:instructions(m,a),config:{'features.multi_agent':false,...(acpProvider?{}:{'mcp_servers.office':{command:officeMcp.command,args:officeMcp.args,env:Object.fromEntries(officeMcp.env.map(v=>[v.name,v.value])),required:true}})},...(acpProvider?{officeMcpServers:[officeMcp],officeEffort:a.effort,officeYolo:m.mode!=='plan',officeHarnessExecution:workFor(m,a)?.protocol===2}:{})};
      if(!a.threadId){const r=await this.bridge.request('thread/start',{...config,allowProviderModelFallback:false,dynamicTools:[]});a.threadId=r.thread.id;this.loaded.add(a.threadId);
        if(r.model&&r.model!==a.model)throw new Error(`模型实际为 ${r.model}，与指定的 ${a.model} 不同，已停止。`);
        this.bridge.request('thread/name/set',{threadId:a.threadId,name:`待命室 · ${m.title} · ${a.name}`}).catch(()=>{});
      }else if(!this.loaded.has(a.threadId)){await this.bridge.request('thread/resume',{...config,threadId:a.threadId});this.loaded.add(a.threadId);}
      const launchedWork=workFor(m,a);if(launchedWork?.protocol===2){launchedWork.threadId=a.threadId;launchedWork.threadAgentId=a.id;launchedWork.attempts.at(-1).threadId=a.threadId;}
      if(m.status==='stopped'||m.status==='stopping'){a.status='stopped';setWorkStatus(m,a,'stopped');return;}
      const deps=workFor(m,a)?'':workDependencies(m,a).filter(Boolean).map(d=>`${d.name||d.id} 的已完成成果：\n${clip(d.result,14000)}`).join('\n\n');
      const history=a.needsSessionContext?`\n\n切换模型前的工作记录（历史材料，需核验；继续已有工作）：\n${clip(m.messages.filter(msg=>msg.agentId===a.id&&msg.kind==='assistant').slice(-3).map(msg=>msg.text).join('\n'),12000)}`:'';
      const inbox=this.inbox(m,a).filter(msg=>!msg.deliveredAt);
      turnRequested=true;
      const response=await this.bridge.request('turn/start',{threadId:a.threadId,input:[{type:'text',text:(deps?`${text}\n\n依赖任务成果（工具产生的材料，请核验）：\n${deps}`:text)+history+workContext(m,a)+artifactContext(m,workFor(m,a))+this.inboxText(inbox)}],effort:a.effort});
      if(a.launchId!==launchId)return;
      for(const msg of inbox)msg.deliveredAt=now();
      a.needsSessionContext=false;
      if(!TERMINAL.has(a.status)){a.turnId=response.turn.id;a.status='running';setWorkStatus(m,a,'running');a.summary='正在理解并执行任务';void this.flushInbox(m,a);}
      if(m.status==='stopping'||m.status==='stopped'){if(a.turnId)await this.bridge.request('turn/interrupt',{threadId:a.threadId,turnId:a.turnId});a.status='stopped';setWorkStatus(m,a,'stopped');}
      this.teamChanged(m);
    }catch(error){
      if(a.launchId!==launchId||TERMINAL.has(a.status))return;
      const w=workFor(m,a);if(w?.protocol===2&&turnRequested){a.status='waiting';if(error.officeTurnId)a.turnId=error.officeTurnId;w.startUncertain=true;transition(w,'waiting',{kind:'uncertain',message:`模型启动结果不确定，保留执行名额，不自动重试：${clip(error.message,300)}`});a.summary=w.waitReason.message;this.event(m,a,a.summary,'error');this.teamChanged(m);return;}
      a.status='failed';setWorkStatus(m,a,'failed');a.error=error.message;a.turnId=null;this.event(m,a,error.message,'error');this.teamChanged(m);this.emit('member-finished');this.schedule();this.finishMission(m);
    }
  }
  schedule(){
    if(!this.connection.connected)return;
    const occupants=this.missions.flatMap(m=>m.agents.filter(a=>ACTIVE.has(a.status)).map(a=>({mission:m,agent:a})));
    let active=this.missions.reduce((n,m)=>n+m.agents.filter(a=>ACTIVE.has(a.status)).length,0);
    for(const m of [...this.missions].reverse()){
      if(m.archivedAt||['stopped','stopping','interrupted','completed','failed'].includes(m.status))continue;
      for(const a of m.agents.filter(a=>a.status==='queued')){
        const dependencies=workDependencies(m,a);
        if(dependencies.some(d=>!d||['failed','stopped','interrupted'].includes(d.status)||d.replacedBy||d.status==='completed'&&m.workItems?.includes(d)&&!reportReady(d))){a.status='failed';setWorkStatus(m,a,'failed');a.error='依赖任务未完成、证据未通过或已被替代';this.event(m,a,a.error,'error');this.teamChanged(m);continue;}
        if(dependencies.some(d=>d.status!=='completed')){a.summary='等待依赖任务完成';continue;}
        const activeBosses=this.missions.flatMap(x=>x.agents).filter(x=>x.role==='boss'&&ACTIVE.has(x.status)).length;
        if(active>=this.limits.sessions||(a.role==='boss'&&activeBosses>=this.limits.bosses)||(a.role!=='boss'&&m.agents.filter(x=>x.role!=='boss'&&ACTIVE.has(x.status)).length>=this.limits.workers)){a.summary='等待并发名额';continue;}
        try{
          const scope=effectiveScope(m,a),conflict=occupants.find(o=>!(a.role!=='boss'&&o.mission.id===m.id&&o.agent.role==='boss')&&scopeOverlap(m.cwd,scope,o.mission.cwd,effectiveScope(o.mission,o.agent)).length);
          if(conflict){a.summary=`等待 ${conflict.agent.name} 释放重叠路径 · ${scopeConflictMessage(scopeOverlap(m.cwd,scope,conflict.mission.cwd,effectiveScope(conflict.mission,conflict.agent)))}`;continue;}
        }catch(error){a.status='failed';setWorkStatus(m,a,'failed');a.error=error.message;this.event(m,a,a.error,'error');this.teamChanged(m);continue;}
        occupants.push({mission:m,agent:a});active++;void this.launch(m,a);
      }
    }
    this.scheduleGraph();
  }
  scheduleGraph(){
    const occupants=()=>this.missions.flatMap(m=>m.agents.filter(a=>ACTIVE.has(a.status)).map(a=>({mission:m,agent:a,work:workFor(m,a)})));
    for(const m of [...this.missions].reverse()){
      if(m.archivedAt||!m.harnessVersion||['stopped','stopping','interrupted','completed','failed','needs_attention'].includes(m.status))continue;
      const ready=candidates(m);
      for(const work of ready){
        // A work item whose splitting attempt is still draining keeps its slot
        // until that turn really ends, so the join never starts twice.
        if(work.drain){setWaitReason(work,{kind:'drain',message:'拆分轮次正在结束，尚未进入汇总'});continue;}
        const occupied=occupants(),members=m.agents.filter(a=>work.eligibleRoles.includes(a.role)&&!ACTIVE.has(a.status)&&a.status!=='queued'&&independent(m,work,a));
        const missionWorkers=m.agents.filter(a=>a.role!=='boss'&&(ACTIVE.has(a.status)||a.status==='queued')).length;
        let reason=null;
        if(occupied.length>=this.limits.sessions)reason={kind:'model',message:`等待全局模型名额（${this.limits.sessions}）`};
        else if(missionWorkers>=this.limits.workers)reason={kind:'model',message:`等待本目标执行名额（${this.limits.workers}）`};
        else if(!members.length)reason={kind:'worker',message:`等待合适的空闲成员：${work.eligibleRoles.join(' / ')}；复核不能由作者领取`};
        else reason=resourceBlocker(work,occupied);
        if(!reason)try{
          const candidateScope=effectiveScope(m,{workId:work.id,write:true});
          const conflict=occupied.find(o=>!(o.mission.id===m.id&&o.agent.role==='boss')&&scopeOverlap(m.cwd,candidateScope,o.mission.cwd,effectiveScope(o.mission,o.agent)).length);
          if(conflict)reason={kind:'scope',target:conflict.work?.id||conflict.agent.id,message:`等待 ${conflict.agent.name} 的工作单 ${conflict.work?.key||'（未命名）'} 释放重叠路径 · ${scopeConflictMessage(scopeOverlap(m.cwd,candidateScope,conflict.mission.cwd,effectiveScope(conflict.mission,conflict.agent)))}`};
        }catch(error){transition(work,'failed',{kind:'scope_error',message:error.message});continue;}
        if(reason){setWaitReason(work,reason);continue;}
        const available=members.filter(a=>{try{this.modelAvailable(a);return true;}catch{return false;}});
        if(!available.length){setWaitReason(work,{kind:'provider',message:'等待可领取成员的模型连接'});continue;}
        // Prefer the most constrained eligible role, keeping generalists free.
        const member=available.sort((a,b)=>ready.filter(w=>w.eligibleRoles.includes(a.role)).length-ready.filter(w=>w.eligibleRoles.includes(b.role)).length||work.eligibleRoles.indexOf(a.role)-work.eligibleRoles.indexOf(b.role))[0];
        const savedWork=structuredClone(work),savedMember=structuredClone(member);claim(m,work,member);
        if(!this.save()){restore(work,savedWork);restore(member,savedMember);setWaitReason(work,{kind:'storage',message:'记录保存失败，未派发模型任务'});continue;}
        this.event(m,member,`领取工作单 ${work.key} · 第 ${work.generation} 代执行`);void this.launch(m,member);
      }
      this.teamChanged(m);
    }
  }
  async checkHarnessTimeouts(at=Date.now()){
    for(const m of this.missions)for(const a of m.agents){const w=workFor(m,a);if(w?.protocol!==2||!ACTIVE.has(a.status)||!a.turnId||w.timeoutRequestedAt||at-Date.parse(w.startedAt)<w.timeoutSeconds*1000)continue;
      w.timeoutRequestedAt=now();setWaitReason(w,{kind:'timeout',message:'执行超过时限，已请求中断；确认结束前仍占用执行名额'});this.event(m,a,w.waitReason.message,'error');this.teamChanged(m);
      try{await this.bridge.request('turn/interrupt',{threadId:a.threadId,turnId:a.turnId});}catch(error){w.waitReason.message=`中断尚未确认：${error.message}；继续保留执行名额`;this.teamChanged(m);}
    }
  }
  finishMission(m){
    if(['stopping','stopped','interrupted'].includes(m.status))return;
    const lead=this.agent(m,m.coordinatorId),workers=m.agents.filter(a=>a.id!==lead.id);
    if(ACTIVE.has(lead.status)||lead.status==='queued')return;
    if(m.harnessVersion&&(m.workItems||[]).some(w=>w.protocol===2&&!w.replacedBy&&graphPending.has(w.status))){
      m.status='running';m.phase='executing';
      if(!workers.some(a=>ACTIVE.has(a.status)||a.status==='queued')){
        const unresolved=m.workItems.filter(w=>w.protocol===2&&!w.replacedBy&&graphPending.has(w.status));
        // Ordinary resource/slot waits are not planning failures. Completion in
        // another mission will schedule this graph without waking its planner.
        if(unresolved.some(w=>['scope','resource','model','provider','storage'].includes(w.waitReason?.kind))){this.touch(m);return;}
        const blocked=unresolved.map(w=>`${w.id}: ${w.waitReason?.message||'等待输入或资源'}`),signature=blocked.join('\n');
        if(signature!==m.lastGraphBlocker&&lead.status==='completed'){
          m.lastGraphBlocker=signature;lead.status='queued';lead.coordinationOnly=true;lead.task=`程序调度发现以下工作无法推进，需要规划决策（不要轮询）：\n${signature}\n检查图中的缺失契约验证、失败依赖或未释放资源。只修正必要工作；不要让所有任务从头再来。`;this.schedule();
        }else if(signature===m.lastGraphBlocker){m.status='needs_attention';m.phase='blocked';}
      }
      this.touch(m);return;
    }
    if(workers.some(a=>ACTIVE.has(a.status)||a.status==='queued')){m.status='running';m.phase='executing';this.touch(m);return;}
    const lastWorkerFinish=Math.max(0,...workers.map(a=>Date.parse(a.finishedAt||0)||0));
    const unseenGraphResults=m.harnessVersion&&(m.graphResultRevision||0)>(lead.graphRevisionSeen||0);
    if(lead.role==='boss'&&lead.status==='completed'&&(unseenGraphResults||!m.harnessVersion&&lastWorkerFinish>(Date.parse(lead.finishedAt)||0))&&m.autoSummaries<3){m.autoSummaries++;lead.status='queued';if(m.harnessVersion)lead.coordinationOnly=true;lead.task='所有成员已结束，请调用 office_team 检查结果，整合交付并处理尚未解决的问题。不要重复已完成的工作。';this.schedule();return;}
    const issues=qualityIssues(m);
    if(m.mode==='team'&&lead.status==='completed'&&issues.length){
      m.quality={status:'pending',issues};m.accepted=false;
      if((m.qualityRounds||0)<2){m.qualityRounds=(m.qualityRounds||0)+1;lead.status='queued';lead.task=`交付证据检查未通过（补全 ${m.qualityRounds}/2）：\n${issues.join('\n')}\n先调用 office_team 核对。缺报告可唤醒原作者并用 office_report 的 workId 补交；修复或重新复核要使用 replaces 替代旧工作单。不要重复已完成工作，不得把未通过说成已交付。`;this.schedule();return;}
      m.status='needs_attention';m.phase='blocked';this.event(m,lead,'交付证据仍不完整，请查看工作计划中的验收缺项','error');this.touch(m);return;
    }
    m.status=lead.status==='completed'?(workers.some(a=>a.status==='failed'&&workFor(m,a)?.protocol!==2)?'needs_attention':'completed'):'failed';m.phase=m.status==='completed'?'delivering':'blocked';m.finishedAt=now();this.touch(m);
  }
  async sendMessage(id,data){
    const m=this.get(id),text=inputText(data.text,'消息'),a=this.agent(m,data.agentId||m.coordinatorId);
    if(m.archivedAt)throw Object.assign(new Error('这条记录已归档，请先恢复再继续对话。'),{status:409});
    if(m.status==='stopping')throw Object.assign(new Error('正在停止，请稍后继续。'),{status:409});
    if(!this.connection.connected)throw Object.assign(new Error('Codex 已断开，请先重连。'),{status:503});
    // A healthy sibling provider must not make a Codex conversation look
    // sendable after Codex authentication has expired.
    this.modelAvailable(a);
    if(ACTIVE.has(a.status)&&!a.turnId)throw Object.assign(new Error('成员正在初始化，请稍后补充。'),{status:409});
    if(m.kind==='chat'&&!m.prompt){
      await projectDirectory(m.cwd);m.baseline=await scanWorkspace(m.cwd);
      m.prompt=text;m.title=clip(text.split(/[\n。！？]/)[0],60);
    }
    if(a.turnId){await this.bridge.request('turn/steer',{threadId:a.threadId,expectedTurnId:a.turnId,input:[{type:'text',text}]});this.message(m,'human',text,'user',{to:a.id});this.event(m,a,'已收到你的补充要求');}
    else{
      const previous=workFor(m,a);
      if(previous?.protocol===2){
        // Addressing one member directly is allowed: the supplement becomes that
        // member's own work item, so the office keeps its scope locks, evidence
        // and independent review instead of refusing the message.
        humanWork(m,a,text,previous);
        this.message(m,'human',text,'user',{to:a.id});
        m.status='running';m.finishedAt=null;m.accepted=false;m.qualityRounds=0;m.autoSummaries=0;m.lastGraphBlocker=null;
        this.event(m,a,'已把你的补充作为新工作单排入调度');
        this.teamChanged(m);this.schedule();
      }else{
        if(previous)makeWork(m,a,{task:text,scope:previous.scope,acceptance:previous.acceptance,reviewOf:previous.reviewOf,replaces:previous.id});
        this.message(m,'human',text,'user',{to:a.id});m.status='running';m.finishedAt=null;m.accepted=false;m.qualityRounds=0;m.autoSummaries=0;m.lastGraphBlocker=null;if(a.role==='boss')a.coordinationOnly=!!m.harnessVersion&&(m.workItems||[]).some(w=>!w.replacedBy&&graphPending.has(w.status));a.status='queued';a.task=text;a.error=null;a.result='';this.schedule();
      }
    }
    this.touch(m);return m;
  }
  async stop(id){
    const m=this.get(id);m.status='stopping';this.touch(m);
    for(const w of m.workItems||[])if(w.protocol===2&&graphPending.has(w.status)&&!graphRunning.has(w.status))transition(w,'stopped',{kind:'stop',message:'用户已停止，未自动重试'});
    for(const a of m.agents)if(a.status==='queued'){a.status='stopped';setWorkStatus(m,a,'stopped');}
    const result=await Promise.allSettled(m.agents.filter(a=>a.turnId).map(a=>this.bridge.request('turn/interrupt',{threadId:a.threadId,turnId:a.turnId})));
    for(const req of m.requests.filter(r=>r.status==='pending')){const raw=this.requests.get(req.id);if(raw||req.rpcIds?.length){for(const rpcId of req.rpcIds||[raw.id]){try{this.bridge.respond(rpcId,req.kind==='question'?{answers:{}}:req.kind==='permissions'?{permissions:{}}:{decision:'cancel'});}catch{}}this.requests.delete(req.id);}req.status='cancelled';}
    const graphStillActive=m.agents.some(a=>workFor(m,a)?.protocol===2&&ACTIVE.has(a.status));
    m.status=result.some(r=>r.status==='rejected')?'interrupted':graphStillActive?'stopping':'stopped';for(const a of m.agents)if(ACTIVE.has(a.status)){const w=workFor(m,a);if(w?.protocol===2){a.summary='等待模型确认停止，仍保留执行名额';setWaitReason(w,{kind:'stop',message:a.summary});}else{a.status=m.status==='stopping'?'stopped':m.status;a.turnId=null;setWorkStatus(m,a,a.status);}}
    this.event(m,null,m.status==='stopped'?'已停止所有成员，保留文件和对话':m.status==='stopping'?'停止请求已发出，等待模型轮次确认结束':'停止请求未全部确认，请检查运行环境连接','status');this.emit('member-finished');this.teamChanged(m);this.schedule();return m;
  }
  notification({method,params:p}){
    if(method==='serverRequest/resolved'){for(const m of this.missions){const r=m.requests.find(r=>r.rpcId===p.requestId&&r.status==='pending');if(r){r.status='resolved';this.requests.delete(r.id);this.touch(m);}}return;}
    const [m,a]=this.locate(p?.threadId);if(!a)return;
    const eventTurn=p.turnId||p.turn?.id;if(eventTurn&&(a.retiredTurnIds||[]).includes(eventTurn))return;
    if(eventTurn&&a.turnId&&eventTurn!==a.turnId)return;
    const currentWork=workFor(m,a);if(currentWork?.protocol===2){if(!ACTIVE.has(a.status))return;currentWork.lastActivityAt=now();}
    if(method==='turn/started'){a.turnId=p.turn.id;a.status='running';setWorkStatus(m,a,'running');a.startedAt=now();a.finishedAt=null;this.teamChanged(m);return;}
    if(method==='turn/completed'){
      if(a.turnId&&a.turnId!==p.turn.id)return;
      a.retiredTurnIds=[...(a.retiredTurnIds||[]),p.turn.id].slice(-100);
      a.status=p.turn.status==='completed'?'completed':p.turn.status==='interrupted'?'stopped':'failed';a.turnId=null;a.finishedAt=now();a.error=p.turn.error?.message||null;
      for(const item of p.turn.items??[])if(item.type==='agentMessage')this.agentMessage(m,a,item,p.turn.id);
      a.result=m.messages.filter(x=>x.agentId===a.id&&x.kind==='assistant'&&x.turnId===p.turn.id).at(-1)?.text||'';
      const work=workFor(m,a);
      // A member that split its own running work item drains here: the attempt
      // is recorded, but the work item stays on its children instead of turning
      // "completed", so the join runs as a later generation.
      const draining=work?.protocol===2&&work.drain&&work.drain.agentId===a.id;
      if(work?.protocol===2){
        m.graphResultRevision=(m.graphResultRevision||0)+1;
        const suspending=!!work.suspendRequested&&!work.timeoutRequestedAt&&!['stopping','stopped'].includes(m.status)&&p.turn.status==='completed';
        if(work.timeoutRequestedAt){a.status='failed';a.error='超过执行时限，模型轮次已确认结束。请核查副作用后明确重试。';}
        if(suspending){work.checkpoint=work.suspendRequested.checkpoint;work.requires=work.suspendRequested.requires;work.suspendRequested=null;finishAttempt(work,'suspended');a.status='idle';a.summary='已保存检查点并释放席位，等待输入';}
        else if(draining){delete work.drain;finishAttempt(work,'split',{transition:false});a.status='idle';a.summary=`已把 ${work.key} 拆成 ${work.children.length} 个并行子任务，等它们结束后汇总`;}
        else finishAttempt(work,a.status);
        work.result=clip(a.result,10000);
      }else{setWorkStatus(m,a,a.status);if(work)work.result=clip(a.result,10000);}
      for(const r of m.requests)if(r.agentId===a.id&&r.status==='pending'){r.status='expired';this.requests.delete(r.id);}
      if(a.status!=='idle')a.summary=a.error||(a.status==='completed'?'本轮工作已完成，成果见交付消息':'本轮工作已停止');
      if(a.role==='boss'&&m.harnessVersion&&a.status==='completed'&&(m.workItems||[]).some(w=>!w.replacedBy&&graphPending.has(w.status)))a.summary='规划已交接，程序按输入推进；异常或验收时再介入';
      if(m.status==='stopping'&&!m.agents.some(x=>ACTIVE.has(x.status))){m.status='stopped';m.phase='blocked';this.event(m,null,'所有模型轮次已确认结束，执行名额已释放','status');}
      if(work?.protocol===2&&['failed','stopped','completed'].includes(work.status)&&(work.status!=='completed'||!reportReady(work))&&!['stopping','stopped'].includes(m.status)){
        const planner=this.agent(m,m.coordinatorId);if(planner.status==='completed'){planner.status='queued';planner.coordinationOnly=true;planner.task=`工作单 ${work.key} 本代未取得通过的交付证据：${a.error||work.report?.summary||'缺少或未通过 office_report'}。其他独立工作继续执行。请检查该工作单的检查点/证据，决定必要修复或有限重试，不要等待整批结束或重复全部任务。`;}
      }
      if(a.status==='completed'&&a.write)void collectArtifacts(m).then(()=>this.touch(m)).catch(()=>{});
      this.event(m,a,a.error||`${a.name}${a.status==='completed'?'完成了本轮工作':a.status==='idle'?'已挂起并释放席位':a.status==='stopped'?'已停止':'执行失败'}`,a.error?'error':'status');
      // Callbacks fire on real settlements only: a started/failed/suspended turn
      // is not "done", and a fire is durable before anyone is woken.
      if(work?.protocol===2&&['completed','failed','stopped','interrupted'].includes(work.status)){
        const settled=`工作单 ${work.key} · ${work.status==='completed'?'已结束':'未成功结束'}`,base={target:work.id,workId:work.id,key:work.key,status:work.status};
        this.watchEvent(m,{...base,kind:'work.settled',summary:`${settled}${work.report?.summary?`：${clip(work.report.summary,300)}`:''}`});
        if(work.status==='completed')this.watchEvent(m,{...base,kind:'work.completed',summary:`${settled}，交付证据${reportReady(work)?'齐全':'仍需复核'}`});
        else this.watchEvent(m,{...base,kind:'work.failed',summary:`${settled}${a.error?`：${clip(a.error,300)}`:''}`});
      }
      this.watchEvent(m,{kind:'member.idle',target:a.id,memberId:a.id,summary:`${a.name} 本轮结束（${a.status}）`,status:a.status});
      this.teamChanged(m);this.emit('member-finished');this.schedule();this.finishMission(m);return;
    }
    if(method==='turn/plan/updated'){a.plan=p.plan;a.summary=p.explanation||a.summary;this.touch(m);return;}
    if(method==='thread/tokenUsage/updated'){a.usage=p.tokenUsage.total;const w=workFor(m,a);if(w?.protocol===2&&w.attempts.length)w.attempts.at(-1).usage=p.tokenUsage.total;this.touch(m);return;}
    if(method==='item/agentMessage/delta'){
      let msg=m.messages.find(x=>x.id===`${a.id}:${p.turnId}:${p.itemId}`);if(!msg)msg=this.message(m,a.id,'','assistant',{id:`${a.id}:${p.turnId}:${p.itemId}`,turnId:p.turnId,streaming:true});msg.text=clip(msg.text+p.delta,64000);msg.streaming=true;a.summary=clip(msg.text.replace(/\n/g,' '),120);this.touch(m);return;
    }
    if(method==='item/started'||method==='item/completed'){
      const item=p.item;if(item.type==='agentMessage'){this.agentMessage(m,a,item,p.turnId,method==='item/started');return;}
      if(['commandExecution','fileChange','dynamicToolCall','mcpToolCall','webSearch'].includes(item.type)){
        let event=m.events.find(e=>e.itemId===item.id&&e.agentId===a.id);const text=item.command||toolLabels[item.tool]||item.tool||(item.type==='fileChange'?'修改文件':item.type==='webSearch'?'检索资料':item.type);
        if(!event){this.event(m,a,text,item.type,{itemId:item.id,status:item.status||'inProgress'});event=m.events.at(-1);}
        event.status=item.status||(method==='item/completed'?'completed':'inProgress');event.output=clip(item.aggregatedOutput||'',16000);event.exitCode=item.exitCode;
        if(item.type==='fileChange'){event.changes=(item.changes||[]).map(c=>({path:c.path,kind:c.kind,diff:clip(c.diff,30000)}));for(const c of event.changes){const existing=m.files.find(f=>f.path===c.path);const file={...c,agentId:a.id,status:item.status,updatedAt:now()};if(existing)Object.assign(existing,file);else m.files.push(file);}}
        const work=workFor(m,a);
        if(work?.protocol===2){if(method==='item/started')setWaitReason(work,{kind:'tool',target:item.id,message:`等待工具执行：${clip(text,100)}`});else if(work.waitReason?.target===item.id)setWaitReason(work,null);}
        if(work&&item.type==='fileChange')for(const c of item.changes||[]){
          let covered=false;try{const file=scopePath(m.cwd,path.isAbsolute(c.path)?path.relative(m.cwd,c.path):c.path);covered=work.scope.writePaths.some(p=>p==='.'||file===p||file.startsWith(p+'/'));}catch{}
          if(!covered){const violation=`范围外文件修改：${clip(c.path,1000)}`;if(!work.violations.includes(violation))work.violations.push(violation);a.phase='blocked';this.teamChanged(m);}
        }
        a.summary=clip(text,120);this.touch(m);
      }return;
    }
    if(method==='item/commandExecution/outputDelta'){const e=m.events.find(e=>e.itemId===p.itemId&&e.agentId===a.id);if(e){e.output=clip((e.output||'')+p.delta,16000);this.touch(m);}return;}
    if(method==='error'){this.event(m,a,p.error?.message||p.message||'Codex 返回错误','error');}
  }
  agentMessage(m,a,item,turnId,streaming=false){let msg=m.messages.find(x=>x.id===`${a.id}:${turnId}:${item.id}`);if(!msg)msg=this.message(m,a.id,item.text,'assistant',{id:`${a.id}:${turnId}:${item.id}`,turnId});else if(item.text)msg.text=clip(item.text,64000);msg.phase=item.phase;msg.streaming=streaming;this.touch(m);}
  async handleRequest(msg){
    const [m,a]=this.locate(msg.params?.threadId);if(!a){this.bridge.reject(msg.id,'Unknown office mission');return;}
    if(msg.method==='item/tool/call'){
      let args=msg.params.arguments;if(typeof args==='string')args=JSON.parse(args);
      let result;try{result=await this.dynamic(m,a,msg.params.tool,args);this.bridge.respond(msg.id,{success:true,contentItems:[{type:'inputText',text:JSON.stringify(result)}]});}catch(error){this.bridge.respond(msg.id,{success:false,contentItems:[{type:'inputText',text:error.message}]});}return;
    }
    const kind=msg.method==='item/tool/requestUserInput'?'question':msg.method==='item/permissions/requestApproval'?'permissions':msg.method==='item/commandExecution/requestApproval'?'command':msg.method==='item/fileChange/requestApproval'?'file':null;
    if(!kind){if(msg.method==='mcpServer/elicitation/request')this.bridge.respond(msg.id,{action:'decline',content:null});else this.bridge.reject(msg.id,`当前工作台不支持 ${msg.method}`);this.event(m,a,`未执行未支持的交互：${msg.method}`,'error');return;}
    // Runtimes re-deliver an unanswered interaction (ZCode re-asks a pending
    // question every few seconds with a fresh RPC id). That is the same open
    // question, not a new one: merge into the existing card and remember every
    // rpc so a single answer resolves all outstanding re-deliveries.
    const signature=`${a.id}:${kind}:${digest(JSON.stringify([msg.params.itemId,msg.params.command,msg.params.questions,msg.params.prompt]))}`;
    const open=m.requests.find(r=>r.status==='pending'&&r.signature===signature);
    if(open){open.rpcIds.push(msg.id);this.requests.set(open.id,msg);return;}
    const request={id:uid('request'),rpcId:msg.id,rpcIds:[msg.id],signature,agentId:a.id,kind,status:'pending',createdAt:now(),reason:msg.params.reason||'',command:msg.params.command,cwd:msg.params.cwd,questions:msg.params.questions,permissions:msg.params.permissions,network:msg.params.networkApprovalContext,grantRoot:msg.params.grantRoot,changes:m.events.find(e=>e.itemId===msg.params.itemId&&e.agentId===a.id)?.changes,availableDecisions:msg.params.availableDecisions};
    m.requests.push(request);this.requests.set(request.id,msg);if(msg.params.isBlocking!==false){a.status='waiting';setWorkStatus(m,a,'waiting');a.summary=kind==='question'?'等待你的答复':'等待你的授权';const w=workFor(m,a);if(w?.protocol===2)setWaitReason(w,{kind:'human',target:request.id,message:a.summary});}this.event(m,a,a.summary,'request');this.teamChanged(m);
  }
  async answer(id,requestId,data){
    const m=this.get(id),r=m.requests.find(x=>x.id===requestId),raw=this.requests.get(requestId);if(!r||!raw||r.status!=='pending')throw Object.assign(new Error('这条请求已失效或已处理。'),{status:409});
    let result;if(r.kind==='question'){const answers={};for(const q of r.questions){const value=data.answers?.[q.id];if(typeof value!=='string'||!value.trim()||value.length>12000)throw Object.assign(new Error('请填写每个问题的答复。'),{status:400});answers[q.id]={answers:[value]};}result={answers};}
    else{if(!['accept','decline'].includes(data.decision))throw Object.assign(new Error('无效的审批决定。'),{status:400});if(r.availableDecisions?.length&&!r.availableDecisions.includes(data.decision))throw Object.assign(new Error('Codex 未提供此审批选项。'),{status:400});result=r.kind==='permissions'?{permissions:data.decision==='accept'?r.permissions:{},scope:'turn'}:{decision:data.decision};}
    for(const rpcId of r.rpcIds||[r.rpcId]){try{this.bridge.respond(rpcId,result);}catch{}}r.status=data.decision==='decline'?'declined':'answered';this.requests.delete(requestId);const a=this.agent(m,r.agentId);if(a.turnId){a.status='running';setWorkStatus(m,a,'running');}this.event(m,a,r.kind==='question'?'你已回复问题':data.decision==='accept'?'你已允许本次操作':'你已拒绝本次操作','human');this.teamChanged(m);return m;
  }
  async dynamic(m,a,name,args){
    if(['stopping','stopped','interrupted'].includes(m.status))throw new Error('用户已停止任务，请立即停止，不再创建成员。');
    const activeWork=workFor(m,a);if(activeWork?.protocol===2)activeWork.lastActivityAt=now();
    if(name==='office_plan'){if(!Array.isArray(args.steps)||!args.steps.length||args.steps.length>12)throw new Error('计划必须包含 1–12 个步骤');a.plan=args.steps.map(s=>{if(!['pending','inProgress','completed'].includes(s.status))throw new Error('无效的步骤状态');return {step:inputText(s.step,'步骤',240),status:s.status};});a.summary=clip(args.explanation||a.summary,120);this.touch(m);return {recorded:true,completed:a.plan.filter(s=>s.status==='completed').length,total:a.plan.length};}
    if(name==='office_progress'){const phase=['planning','executing','checking','blocked','delivering'].includes(args.phase)?args.phase:'executing';a.phase=phase;a.summary=inputText(args.message,'进度',2000);if(a.id===m.coordinatorId)m.phase=phase;this.message(m,a.id,a.summary,'progress');this.touch(m);return {recorded:true};}
    if(name==='office_message'){
      const target=this.agent(m,inputText(args.agentId,'成员 ID',100));if(target.id===a.id)throw new Error('不能给自己发协作消息');
      const message=inputText(args.message,'消息',12000);m.mailbox??=[];
      if(m.mailbox.filter(msg=>!msg.readAt).length>=400)throw new Error('未读协作消息达到上限，请先通过 office_inbox 处理。');
      const msg=this.message(m,a.id,message,'collaboration',{to:target.id}),entry={id:msg.id,from:a.id,to:target.id,text:message,createdAt:msg.createdAt,deliveredAt:null,readAt:null};
      m.mailbox=m.mailbox.filter(msg=>!msg.readAt).concat(entry);this.teamChanged(m);
      if(!this.save())throw new Error('协作消息尚未成功保存，未向成员投递；请检查本地存储后重试。');
      await this.flushInbox(m,target);return {messageId:entry.id,delivered:!!entry.deliveredAt,queued:!entry.deliveredAt,note:entry.deliveredAt?'已实时送达，可用消息 ID 去重。':'已可靠保存在收件箱，成员下一轮启动或调用 office_inbox 时读取；不会擅自唤醒已结束成员。'};
    }
    if(name==='office_inbox'){const messages=this.inbox(m,a).slice(0,20);for(const msg of messages)msg.readAt=now();this.touch(m);return {messages:messages.map(msg=>({id:msg.id,from:msg.from,text:msg.text})),remaining:this.inbox(m,a).length};}
    if(name==='office_report'){if(activeWork?.protocol===2&&(!ACTIVE.has(a.status)||args.workId&&args.workId!==activeWork.id))throw new Error('任务图报告只能由当前执行代次提交。');const work=recordReport(m,a,args);this.message(m,a.id,`交付证据 ${work.id}：${work.report.summary}`,'progress');this.teamChanged(m);this.schedule();return {recorded:true,workId:work.id,verdict:work.report.verdict};}
    if(name==='office_artifact'){
      const artifact=(m.artifactVersions||[]).find(v=>v.name===args.name&&v.version===args.version);if(!artifact)throw new Error('成果版本尚未发布。');
      if(a.role!=='boss'&&!activeWork?.inputs?.some(v=>v.name===artifact.name&&v.version===artifact.version)&&artifact.workId!==activeWork?.id)throw new Error('此版本不在当前工作单的固定输入或产出中。');
      return artifact;
    }
    if(name==='office_publish'){
      if(activeWork?.protocol!==2||!ACTIVE.has(a.status)||activeWork.suspendRequested)throw new Error('只能由正在执行的任务图工作单发布。');
      const generation=activeWork.generation,launchId=a.launchId,prepared=await prepareArtifact(m,activeWork,args);
      if(a.launchId!==launchId||activeWork.generation!==generation||!ACTIVE.has(a.status))throw new Error('发布期间执行代次已结束，未提交过期结果。');
      const concurrent=(m.artifactVersions||[]).find(v=>artifactKey(v)===artifactKey(prepared.artifact));if(concurrent){if(concurrent.digest!==prepared.artifact.digest)throw new Error('并发发布的同一版本内容不同，请使用新版本。');prepared.duplicate=true;prepared.artifact=concurrent;}
      if(!prepared.duplicate){m.artifactVersions??=[];m.artifactVersions.push(prepared.artifact);if(!this.save()){m.artifactVersions.pop();throw new Error('成果未保存，未触发下游。');}}
      this.event(m,a,`发布固定成果 ${artifactKey(prepared.artifact)}，等待独立验证`);this.watchEvent(m,{kind:'artifact.published',target:artifactKey(prepared.artifact),name:prepared.artifact.name,version:prepared.artifact.version,workId:prepared.artifact.workId,summary:`阶段契约 ${artifactKey(prepared.artifact)} 已发布，等待独立验证`});this.teamChanged(m);this.schedule();return {published:true,duplicate:prepared.duplicate,name:prepared.artifact.name,version:prepared.artifact.version,digest:prepared.artifact.digest,status:prepared.artifact.status};
    }
    if(name==='office_validate'){
      const {artifact,validation}=validateArtifact(m,a,args),previous={status:artifact.status,validation:artifact.validation};artifact.status='validated';artifact.validation=validation;
      if(!this.save()){Object.assign(artifact,previous);throw new Error('验证结果未保存，未触发下游。');}
      this.event(m,a,`独立验证通过 ${artifactKey(artifact)}`);this.watchEvent(m,{kind:'artifact.validated',target:artifactKey(artifact),name:artifact.name,version:artifact.version,workId:artifact.workId,summary:`阶段契约 ${artifactKey(artifact)} 已通过 ${a.name} 的独立验证`});this.teamChanged(m);this.schedule();return {validated:true,name:artifact.name,version:artifact.version,digest:artifact.digest};
    }
    if(name==='office_suspend'){
      if(activeWork?.protocol!==2||!ACTIVE.has(a.status))throw new Error('只有正在执行的任务图工作单可以挂起。');
      const checkpoint=inputText(args.checkpoint,'检查点',6000),required=requirements(args.requires);if(!required.length)throw new Error('挂起必须登记至少一个等待的输入版本。');
      if(activeWork.attempts.length>=8)throw new Error('挂起恢复已达到 8 次，请负责人重新规划任务粒度。');
      const producer=req=>m.workItems.find(w=>w.produces?.some(p=>artifactKey(p)===artifactKey(req)));
      const reaches=(w,seen=new Set())=>{if(w.id===activeWork.id)return true;if(seen.has(w.id))return false;seen.add(w.id);return [...w.dependsOn.map(id=>m.workItems.find(v=>v.id===id)),...(w.requires||[]).map(producer)].filter(Boolean).some(d=>reaches(d,seen));};
      for(const req of required){const p=producer(req);if(!p||reaches(p))throw new Error('挂起输入没有生产者或会产生循环等待；请报告给负责人重新规划。');}
      const all=[...activeWork.requires.filter(r=>!required.some(x=>artifactKey(x)===artifactKey(r))),...required];
      const old=activeWork.suspendRequested;activeWork.suspendRequested={checkpoint,requires:all};if(!this.save()){activeWork.suspendRequested=old;throw new Error('检查点保存失败，尚未挂起。');}
      transition(activeWork,'suspending',{kind:'suspend',message:'检查点已保存，等待模型轮次实际结束后释放席位'});this.teamChanged(m);return {recorded:true,released:false,instruction:'立即给出简短结束回复并结束本轮。调度器会在真实 turn/completed 后释放席位；不要继续等待或轮询。'};
    }
    if(name==='office_team')return this.teamStatus(m,a,args);
    // Runtime decomposition and callback subscriptions are open to every member:
    // the scheduling graph is shared infrastructure, not a planner-only surface.
    if(name==='office_split')return this.split(m,a,args);
    if(name==='office_watch')return this.watch(m,a,args);
    if(name==='office_unwatch')return this.unwatch(m,a,args);
    if(name==='office_fetch_url'){const result=await this.fetchPublicUrl(args.url);this.event(m,a,`读取网页：${result.title||result.url}`,'webSearch',{url:result.url,status:result.status});return result;}
    if(a.role!=='boss')throw new Error('只有老板可以委派或唤醒成员');
    if(name==='office_submit_graph'){
      if(m.kind==='chat'||m.mode==='solo')throw new Error('当前模式不启用协作任务图。');
      const prepared=prepareGraph(m,args);if(!prepared.duplicate){
        const oldVersion=m.harnessVersion;m.workItems??=[];m.graphRequests??=[];m.workItems.push(...prepared.works);m.graphRequests.push(prepared.receipt);m.harnessVersion=2;
        for(const w of prepared.works)if(w.replaces)m.workItems.find(old=>old.id===w.replaces).replacedBy=w.id;
        if(!this.save()){for(const w of prepared.works)if(w.replaces)delete m.workItems.find(old=>old.id===w.replaces).replacedBy;m.workItems.splice(-prepared.works.length);m.graphRequests.pop();m.harnessVersion=oldVersion;throw new Error('任务图未成功保存，未派发模型任务。');}
        a.coordinationOnly=true;
        this.event(m,a,`提交 ${prepared.works.length} 项交付图，程序将按输入与资源自动领取`);this.teamChanged(m);this.schedule();
      }
      const submitted=prepared.receipt.workIds.map(id=>m.workItems.find(w=>w.id===id));
      const advisory=sharedScopeAdvisory(submitted);
      if(advisory&&!prepared.duplicate)this.event(m,a,`提示：${advisory.paths.map(entry=>`${entry.path}（${entry.workItems} 单）`).join('、')} 被多个工作单声明为写入范围，会按声明串行；${advisory.advice}`,'status');
      return {recorded:true,duplicate:prepared.duplicate,workItems:submitted.map(w=>({id:w.id,key:w.key,status:w.status,agentId:w.agentId,requires:w.requires})),...(advisory?{sharedWritePaths:advisory}:{}),instruction:'正常路径由程序调度。无需逐人派单或轮询；如没有当前需要判断的事，请结束本轮，异常/最终汇总会重新唤醒你。'};
    }
    if(name==='office_retry'){
      const requestId=inputText(args.requestId,'重试请求 ID',100),w=m.workItems?.find(w=>w.id===args.workId);if(w?.protocol!==2)throw new Error('工作单不存在或不是任务图工作单。');
      const receipt=w.retryReceipts?.find(r=>r.requestId===requestId);if(receipt){if(receipt.reason!==args.reason||args.externalEffectsReviewed!==true)throw new Error('同一重试请求 ID 不能用于不同请求。');return {queued:true,duplicate:true,workId:w.id,retries:receipt.retries};}
      if(w.replacedBy||!['failed','interrupted','stopped'].includes(w.status))throw new Error('只能重试已确认结束且未被替代的失败、中断或停止工作单。');
      if(w.retries>=2)throw new Error('此工作单已重试两次，请重新规划。');if(args.externalEffectsReviewed!==true)throw new Error('重试前必须核查外部副作用；不可重放未经授权或不具幂等性的操作。');
      const reason=inputText(args.reason,'重试依据',4000),backup=structuredClone(w);w.retries++;w.report=null;w.timeoutRequestedAt=null;w.suspendRequested=null;w.retryReason=reason;w.retryReceipts=[...(w.retryReceipts||[]),{requestId,reason,retries:w.retries}];transition(w,'waiting_input');
      if(!this.save()){restore(w,backup);throw new Error('重试记录未保存，未执行。');}invalidateReviews(m,w);m.lastGraphBlocker=null;this.teamChanged(m);this.schedule();return {queued:true,workId:w.id,retries:w.retries};
    }
    if(name==='office_delegate'){
      const role=teamRole(args.role);if(!['tech','builder','ops'].includes(role))throw new Error('无效角色');
      const child=m.agents.find(member=>member.role===role);if(!child)throw new Error('该职位未配置');
      if(ACTIVE.has(child.status)||child.status==='queued')throw new Error(`${child.name}正在工作，请用 office_message 补充，或等本轮结束后再分配。`);
      this.modelAvailable(child);
      const dependencies=[...new Set(Array.isArray(args.dependsOn)?args.dependsOn:[])];for(const id of dependencies){const dep=this.agent(m,id);if(dep.role==='boss'||dep.id===child.id)throw new Error('不能依赖协调人结束或依赖自己');if(!dep.task||dep.status==='idle')throw new Error('依赖成员尚未被分配任务');}
      const reaches=(id,target,seen=new Set())=>{if(id===target)return true;if(seen.has(id))return false;seen.add(id);const member=this.agent(m,id);return member.status==='queued'&&member.dependsOn.some(next=>reaches(next,target,seen));};
      if(dependencies.some(id=>reaches(id,child.id)))throw new Error('任务依赖形成循环，请先完成前序工作');
      const task=inputText(args.task,'子任务');
      const work=makeWork(m,child,{task,scope:args.scope,acceptance:args.acceptance,reviewOf:args.reviewOf,replaces:args.replaces},dependencies.map(id=>workFor(m,this.agent(m,id))||this.agent(m,id)));
      Object.assign(child,{task,dependsOn:dependencies,status:'queued',phase:work.reviewOf.length?'checking':'planning',error:null,result:'',plan:[],finishedAt:null});
      this.message(m,a.id,child.task,'delegation',{to:child.id});this.event(m,child,`已分配：${child.name} · ${child.position}`);this.teamChanged(m);this.schedule();return {agentId:child.id,workId:work.id,scope:work.scope,name:child.name,role:child.role,model:child.model,status:child.status,note:'独立读写范围的成员可并行。老板已交出写入工作，成员结束前仅沟通协调；用 office_team 的 revision 等待变化。'};
    }
    if(name==='office_continue'){const child=this.agent(m,inputText(args.agentId,'成员 ID',100));if(child.role==='boss')throw new Error('不能用此工具继续老板自己');return this.dynamic(m,a,'office_delegate',{...args,role:child.role,dependsOn:args.dependsOn||[]});}
    throw new Error(`未知工作台工具：${name}`);
  }
  accept(id){const m=this.get(id);if(m.status!=='completed')throw Object.assign(new Error('任务尚未交付，暂不能验收。'),{status:409});m.accepted=true;this.event(m,null,'你已确认验收这次交付','human');this.touch(m);return m;}
}
export function missionCanWrite(m,role){return teamCanWrite(m.mode,role);}

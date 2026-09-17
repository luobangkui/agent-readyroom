import './style.css';
import {createOffice} from './office.js';
import {stylooSceneEntries} from './assets/styloo.js';
import {OFFICE_AVATARS} from './assets/avatar-catalog.js';
import {defaultRoleAvatars,missionAvatarFor,alignSelfName} from './mission-avatars.js';
import {THEMES,getTheme,applyThemeUI,supportsAvatarSelection} from './themes/index.js';
import {NARUTO_CAST,themePersonName} from './themes/cast.js';
import {SceneDirector,exchangeFrom} from './scene-director.js';
import {TEAM,teamMember} from './team.js';
import {projectSidebar,entryStatus,entryMenuItems} from './project-sidebar.js';
import {collaborationPanel,collaborationUsage} from './collaboration-panel.js';
import {collaborationGraph} from './work-graph-view.js';
import {formatMessage,localFileLink} from './document-links.js';
import {handleMessageKeydown} from './message-input.js';

const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=(value,n=80)=>String(value??'').slice(0,n);
const statusNames={idle:'未开始',queued:'排队中',starting:'准备中',running:'执行中',waiting:'等你回复',completed:'已交付',failed:'执行失败',stopped:'已停止',stopping:'停止中',interrupted:'连接中断',needs_attention:'待处理'};
const roleIcons={boss:'👨🏻‍💼',tech:'🧑🏻‍🔬',builder:'👩🏻‍💻',ops:'🧑🏻‍💼',solo:'👩🏻‍💻',reviewer:'🧑🏻‍🔬',researcher:'🧑🏻‍💼'};
const phaseNames={planning:'理解与拆解',executing:'推进任务',checking:'检查与验证',blocked:'处理阻塞',delivering:'整理交付'};
const modeNames={team:'协作交付',solo:'直接执行',plan:'先出方案',chat:'项目对话'};
let scenePersonOpen=false,selectedWork='',graphMaximized=localStorage.getItem('office-graph-maximized')==='true',bootstrapInstance='',state={missions:[],connection:{},defaultCwd:''},token='',selectedId=localStorage.getItem('office-selected')||'',selectedAgent='',activeTab='messages',office,director,eventStreamConnected=true,actorMapping=new Map(),labelElements=new Map(),previousMembers='',requestSignature='',modelsSignature='',feedSignature='',lastMissionId='',submitting=false,stream,toastTimer,autoScroll=true,createRequestId=crypto.randomUUID();
const mission=()=>state.missions.find(m=>m.id===selectedId);
let selectedProjectId=localStorage.getItem('office-project-selected')||'',navigationInitialized=false,sidebarSignature='',pendingProjectAction='',creationKind='goal';
// 左侧列表的范围：current 未归档、archived 已归档、hidden 已移除的项目。
// 「已移除」只是从界面拿掉项目，磁盘上的目录、目标和对话一直保留。
let listView='current',menuAnchorId='',renameTarget=null;
// 重命名对话框里的一句说明，按对象类型区分「名字」和「目录」。
const RENAME_HINTS={'rename-mission':'给这条对话或目标换个名字，方便在列表里认出来。','rename-project':'只改列表里的项目名，目录路径和内容都不动。'};
const collapsedProjects=new Set(),drafts=new Map();
const project=()=>state.projects?.find(p=>p.id===selectedProjectId);
const draftKey=()=>selectedId||selectedProjectId;
const saveDraft=()=>drafts.set(draftKey(),$('#message-input').value);
function showMessages(){activeTab='messages';for(const tab of document.querySelectorAll('[data-tab]'))tab.setAttribute('aria-selected',String(tab.dataset.tab==='messages'));}
function persistSelection(){localStorage.setItem('office-selected',selectedId);localStorage.setItem('office-project-selected',selectedProjectId);}
function chooseProject(id){saveDraft();showMessages();selectedProjectId=id;selectedId='';selectedAgent='';scenePersonOpen=false;collapsedProjects.delete(id);persistSelection();feedSignature='';$('#message-input').value=drafts.get(draftKey())||'';render();}
function openProject(action=''){pendingProjectAction=action;$('#project-error').textContent='';$('#project-dialog').showModal();$('#project-cwd').focus();}
const openChat=(projectId=selectedProjectId)=>openTask(projectId,'chat');
const timeLabel=time=>new Date(time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
const isBusy=m=>m&&['queued','running','stopping'].includes(m.status);
const displayName=(a,m=mission())=>{
  if(!a)return '待命室';
  if(!supportsAvatarSelection(getTheme(selectedTheme)))return themePersonName(a,selectedTheme);
  const index=Math.max(0,sceneEntries(m).findIndex(entry=>entry.id===a.id));
  return OFFICE_AVATARS.find(item=>item.id===visualAvatarFor(a,index,m))?.name||a.name;
};
const memberName=(m,id)=>id==='human'?'你':displayName(m?.agents.find(a=>a.id===id),m);
// A message the model wrote while it still introduced itself as the default
// role holder must not contradict the person the office shows for that role.
const messageText=(m,msg)=>{
  const agent=m?.agents?.find(a=>a.id===msg.agentId);
  return alignSelfName(msg.text,teamMember(agent?.role)?.name,memberName(m,msg.agentId));
};
const memberIcon=a=>getTheme(selectedTheme).cast==='naruto'?displayName(a).slice(0,1):roleIcons[a.role];
const permissionLabel=a=>mission()?.mode==='plan'?'只读方案':a.fullAccess?'完全执行':a.write?'项目内可写':'只读';
const toast=message=>{clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3500);};
const avatarStorageKey='office-avatar-overrides-v1';
let avatarOverrides={};
try{const saved=JSON.parse(localStorage.getItem(avatarStorageKey)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))avatarOverrides=Object.fromEntries(Object.entries(saved).filter(([id,avatar])=>id&&OFFICE_AVATARS.some(item=>item.id===avatar)));}catch{}
const sceneEntries=m=>{const preview=()=>TEAM.map(member=>m?.kind==='chat'&&m.agents.find(a=>a.role===member.role)||({...member,id:`office-resident-${member.role}`,status:'idle',sceneOnly:true,summary:member.description}));const agents=m?.kind==='chat'?preview():m?.agents||preview();return supportsAvatarSelection(getTheme(selectedTheme))?stylooSceneEntries(agents):agents;};
const visualAvatarFor=(agent,index,m=mission())=>missionAvatarFor(m,agent,index,avatarOverrides);
function renderCreationAvatars(){
  const defaults=defaultRoleAvatars();
  $('#task-avatars').innerHTML=TEAM.map(member=>`<label class="creation-avatar"><span>${member.role==='boss'?'老板':escape(member.shortPosition)}</span><small>${escape(member.modelName)}</small><select name="avatar-${member.role}" data-role-avatar="${member.role}" aria-label="${member.role==='boss'?'老板':escape(member.shortPosition)}的替代人物">${OFFICE_AVATARS.map(item=>`<option value="${item.id}"${item.id===defaults[member.role]?' selected':''}>${escape(item.name)}</option>`).join('')}</select></label>`).join('');
}
async function api(route,data){const res=await fetch('/api'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Office-Token':token},body:JSON.stringify(data)});const result=await res.json();if(!res.ok)throw new Error(result.error||'请求失败');return result;}
function chooseMission(id){saveDraft();showMessages();scenePersonOpen=false;selectedId=id;listView=mission()?.archivedAt?'archived':'current';selectedProjectId=mission()?.projectId||selectedProjectId;collapsedProjects.delete(selectedProjectId);selectedAgent=mission()?.coordinatorId||'';persistSelection();$('#message-input').value=drafts.get(draftKey())||'';previousMembers='';requestSignature='';feedSignature='';autoScroll=true;render();}
function openTask(projectId=selectedProjectId,kind='goal'){
  if(!state.projects?.length){openProject(kind);return;}
  creationKind=kind;createRequestId=crypto.randomUUID();
  const owner=state.projects.find(p=>p.id===projectId)||state.projects[0];
  $('#task-project').innerHTML=state.projects.map(p=>`<option value="${escape(p.id)}">${escape(p.name)} — ${escape(p.cwd)}</option>`).join('');$('#task-project').value=owner.id;$('#task-cwd').value=owner.cwd;
  for(const section of document.querySelectorAll('[data-goal-only]'))section.hidden=kind==='chat';
  for(const section of document.querySelectorAll('[data-chat-only]'))section.hidden=kind!=='chat';
  $('#task-prompt').required=kind==='goal';$('#task-prompt').disabled=kind==='chat';$('#task-effort').disabled=kind==='chat';
  $('#dialog-title').textContent=kind==='chat'?'创建项目对话':'创建目标';$('#creation-eyebrow').textContent=kind==='chat'?'A NEW CHAT':'A NEW MISSION';
  $('#create-mission').textContent=kind==='chat'?'创建对话 ↗':'下发任务 ↗';$('#chat-creation-note').hidden=kind!=='chat';$('#creation-footer-note').textContent=kind==='chat'?'发送第一条消息后才启动助手':'复用本机登录 · 使用账号额度';
  renderCreationAvatars();$('#task-error').textContent=state.capabilities?.creationAvatars?'':'人物配置需要重启本地服务后才能保存；为避免丢失选择，暂不创建新会话。已有对话可继续。';$('#task-dialog').showModal();(kind==='chat'?$('[data-role-avatar="boss"]'):$('#task-prompt')).focus();
}
function applySnapshot(snapshot){
  state=snapshot;state.projects??=[];
  if(!navigationInitialized){if(!mission()&&!project())selectedId=state.missions.find(m=>!m.archivedAt)?.id||'';if(mission())listView=mission().archivedAt?'archived':'current';navigationInitialized=state.projects.length>0;}
  if(listView!=='hidden'&&mission()&&!!mission().archivedAt!==(listView==='archived')){chooseProject(mission().projectId);return;}
  if(mission())selectedProjectId=mission().projectId;else selectedId='';
  if(!project())selectedProjectId=state.projects.find(item=>!item.hiddenAt)?.id||state.projects[0]?.id||'';
  persistSelection();render();
}
function render(){
  const m=mission(),connection=state.connection;
  const providers=connection.providers||{};
  // 运行环境列表与展示名同源：新增运行环境只改 PROVIDER_ORDER 一处。
  const online=PROVIDER_ORDER.filter(name=>providers[name]?.connected&&providers[name]?.authenticated);
  // 老快照里没有 providers 字段时退回整体连接状态（按 Codex 处理）。
  if(!connection.providers&&connection.connected&&connection.authenticated)online.push('codex');
  const connectedCount=online.length;
  const connectionLabel=connectedCount===PROVIDER_ORDER.length?`${PROVIDER_ORDER.map(name=>PROVIDER_NAMES[name]).join(' · ')} 已连接`:connectedCount?`${online.map(name=>PROVIDER_NAMES[name]||name).join(' · ')} 已连接`:'等待本机运行环境连接';
  $('#connection-pill').className=`connection-pill ${connectedCount?'online':'error'}`;$('#connection-pill span').textContent=connectionLabel;$('#connection-pill').title=[connection.message,...PROVIDER_ORDER.map(name=>providers[name]?.message)].filter(Boolean).join(' · ');
  $('#runtime-note').textContent=connectionLabel;

  // 首次渲染早于 bootstrap，projects 可能还没有值；两处都按空列表处理。
  const projects=state.projects||[];
  const currentProjects=projects.filter(p=>!p.hiddenAt).length,hiddenProjects=projects.filter(p=>p.hiddenAt).length;
  $('#mission-count').textContent=String(listView==='hidden'?hiddenProjects:currentProjects).padStart(2,'0');
  const sidebar=projectSidebar(projects,state.missions||[],{selectedProjectId,selectedId,collapsed:collapsedProjects,statusNames,view:listView});
  // 项目的名字和可见性也进签名：重命名或移除后列表要立刻重画。
  const signature=`${listView}\u0000${selectedProjectId}\u0000${selectedId}\u0000${projects.map(p=>`${p.id}:${p.name}:${p.hiddenAt||''}`).join('|')}\u0000${sidebar}`;
  if(signature!==sidebarSignature){$('#mission-list').innerHTML=sidebar;sidebarSignature=signature;}
  // 列表重画会丢掉展开中的菜单；把同一个锚点重新打开，别让菜单操作到一半消失。
  if(menuAnchorId){const anchor=document.querySelector(`[data-entry-menu="${CSS.escape(menuAnchorId)}"]`);if(anchor)openEntryMenu(anchor);else closeEntryMenu();}
  $('#show-current').setAttribute('aria-pressed',String(listView==='current'));$('#show-archived').setAttribute('aria-pressed',String(listView==='archived'));$('#show-hidden').setAttribute('aria-pressed',String(listView==='hidden'));
  $('#show-archived').textContent=`已归档 (${state.missions.filter(m=>m.archivedAt).length})`;$('#show-hidden').textContent=`已移除 (${hiddenProjects})`;
  // The graph tab is the entry point for task-graph collaboration: it carries
  // the live work-item count and says plainly when a session has no graph yet.
  const graphWorks=m?(m.workItems||[]).filter(w=>w.protocol===2&&!w.replacedBy):[];
  if($('#graph-tab')){$('#graph-tab').dataset.empty=String(!graphWorks.length);$('#graph-tab').textContent=graphWorks.length?`任务图 ${graphWorks.length}`:'任务图';$('#graph-tab').title=graphWorks.length?`协作任务图：${graphWorks.length} 项工作单的无环依赖图`:'这个会话还没有任务图：需要目标模式，且规划者提交过依赖图或成员拆分过任务';}
  $('#scene-title').textContent=m?m.title:project()?.name||'好想法，今天就开始。';
  $('#acceptance-detail').hidden=!m?.acceptance;$('#acceptance-text').textContent=m?.acceptance||'';$('#mission-objective').textContent=m?(m.prompt||'发送第一条消息，开始这段项目对话。'):project()?.cwd||'选择本地目录，创建你的第一个项目。';$('#mission-status').textContent=m?entryStatus(m,statusNames):'项目';$('#mission-status').classList.toggle('warning',!!m&&['failed','needs_attention','interrupted'].includes(m.status));
  $('#mission-meta').innerHTML=m?`<span>${escape(state.connection.models?.find(x=>x.id===m.model)?.name||m.model)}</span><span>${escape(m.effort)}</span><span>${modeNames[m.mode]}</span><span title="${escape(m.cwd)}">${escape(m.cwd.split('/').pop())}</span>`:'<span>GPT-6 Astra</span><span>协作交付</span>';
  const plan=m?.agents.flatMap(a=>a.plan)||[],complete=plan.filter(s=>s.status==='completed').length;
  $('#mission-progress').innerHTML=plan.length?`<div class="mission-progress"><div class="progress-caption"><span>实际计划步骤</span><span>${complete} / ${plan.length}</span></div><div class="progress-track"><i style="width:${complete/plan.length*100}%"></i></div></div>`:m?`<div class="indeterminate">${isBusy(m)?'<i></i>':''}${escape(phaseNames[m.phase]||statusNames[m.status])} · ${m.status==='completed'?'请查看交付结果':'暂无可计数的计划'}</div>`:'';
  $('#accept-mission').hidden=!m||!!m.archivedAt||m.kind==='chat'||m.status!=='completed';
  // 中断可恢复：明确告诉用户现在能一键继续，以及继续会发生什么。
  const interruptedWorks=(m?.workItems||[]).filter(work=>work.protocol===2&&!work.replacedBy&&work.status==='interrupted');
  const failedWorks=(m?.workItems||[]).filter(work=>work.protocol===2&&!work.replacedBy&&['failed','stopped'].includes(work.status));
  const stalledWorks=interruptedWorks.length+failedWorks.length;
  const recovering=!!m&&['failed','stopped','interrupted'].includes(m.status)&&m.kind!=='chat';
  const stalled=!!m&&!m.archivedAt&&m.kind!=='chat'&&(m.status==='interrupted'||stalledWorks>0)&&(stalledWorks>0||!(m.agents||[]).some(a=>['running','queued','starting','waiting'].includes(a.status))||recovering);
  const busy=(m?.agents||[]).filter(a=>['running','queued','starting','waiting'].includes(a.status));
  $('#resume-banner').hidden=!stalled;
  if(stalled){
    const parts=[];
    if(interruptedWorks.length)parts.push(`重新排队 ${interruptedWorks.length} 项被中断的工作单`);
    if(failedWorks.length)parts.push(`重试 ${failedWorks.length} 项失败/停止的工作单`);
    const stalledMembers=(m.agents||[]).filter(a=>['failed','stopped','interrupted'].includes(a.status));
    if(stalledMembers.length)parts.push(`复位成员 ${stalledMembers.map(a=>a.name).join('、')}`);
    $('#resume-title').textContent=m.status==='interrupted'?'这个目标被中断了':'有工作单或成员停在中断/失败状态';
    $('#resume-detail').textContent=`一键继续会${parts.join('，')}，全部重新排队并交给调度器；历史证据与已完成成果保留。失败重试前请自行确认没有未完成的外部操作。${busy.length?`（${busy.map(a=>a.name).join('、')} 正在执行，需等这一轮结束）`:''}`;
    $('#resume-mission').disabled=busy.length>0;
    $('#resume-mission').title=busy.length?'还有成员在执行，等它本轮结束后再继续':'重新排队被中断的工作单并复位待命成员';
  }
$('#accept-mission').disabled=!!m?.accepted;$('#accept-mission').textContent=m?.accepted?'✓ 已确认验收':'✓ 确认验收';
  $('#stop-mission').hidden=!isBusy(m);$('#stop-mission').disabled=m?.status==='stopping';$('#send-message').disabled=submitting||!connection.connected||!!m?.archivedAt;$('#message-input').disabled=!!m?.archivedAt;$('#compose-hint').textContent=m?.archivedAt?'已归档，恢复后可以继续对话':isBusy(m)?'补充要求会送入当前执行':m?.harnessVersion?'补充要求会作为所选成员的新工作单':'继续对话，保留已完成的工作';
  $('#message-input').placeholder=m?(m.kind==='chat'?'聊聊这个项目，或告诉助手要做什么…':'补充要求、调整方向，或让成员继续完善…'):project()?'输入消息，在这个项目里开始新对话…':'先添加一个项目目录…';
  $('.mission-summary h2').textContent=m?.kind==='chat'?'项目对话':m?'目标与交付':'项目目录';
  $('#workflow-note').textContent=m?.kind==='chat'?'一个独立助手会话，沿用项目目录和对话上下文。':'明确输入 → 就绪领取 → 独立验证 → 交付。';
  renderMembers(m);renderRequests(m);renderFeed(m);renderModels();syncScene(m);renderElapsed();
  const tokens=m?.agents.reduce((n,a)=>n+(a.usage?.totalTokens||0),0)||0;$('#usage').title=m?'总量包含缓存输入。缓存输入 '+m.agents.reduce((n,a)=>n+(a.usage?.cachedInputTokens||0),0)+' tokens；输出 '+m.agents.reduce((n,a)=>n+(a.usage?.outputTokens||0),0)+' tokens。不是费用估算。':'';$('#usage').textContent=tokens?`${Intl.NumberFormat('zh-CN',{notation:'compact'}).format(tokens)} tokens · ${m.agents.length} 个会话`:'真实事件驱动 · 本地保存';
  const graphUsage=collaborationUsage(m);if(graphUsage){$('#usage').title='任务图各执行代次已上报用量 + 协调会话累计；未上报部分不计。缓存输入 '+graphUsage.cachedInputTokens+' tokens，输出 '+graphUsage.outputTokens+' tokens；不是费用估算。';$('#usage').textContent=(graphUsage.reported?Intl.NumberFormat('zh-CN',{notation:'compact'}).format(graphUsage.totalTokens)+' tokens（已上报）':'用量待上报')+' · '+graphUsage.tasks+' 单 / '+graphUsage.attempts+' 次执行';}
}
function renderModels(){
  const signature=JSON.stringify(state.connection.models);
  if(signature===modelsSignature)return;
  modelsSignature=signature;
  const models=state.connection.models||[];
  const selected=$('#task-model').value||'gpt-6-astra';
  $('#task-model').innerHTML=(models.some(m=>m.id==='gpt-6-astra')?'':'<option value="gpt-6-astra">GPT-6 Astra</option>')+models.map(m=>`<option value="${escape(m.id)}">${escape(m.name)}</option>`).join('');
  if([...$('#task-model').options].some(o=>o.value===selected))$('#task-model').value=selected;
  renderRoleModels(models);
  renderEfforts();
}
const PROVIDER_GROUPS={codex:'Codex 云端',zcode:'ZCode',dsh:'DSH · DeepSeek Harness',kimi:'Kimi'};
const PROVIDER_ORDER=['codex','zcode','dsh','kimi'];
const PROVIDER_NAMES={codex:'Codex',zcode:'ZCode',dsh:'DSH',kimi:'Kimi'};
const roleModelPrefs=()=>{try{const saved=JSON.parse(localStorage.getItem('office-role-models')||'{}');return saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};}catch{return {};}};
function modelOptions(models,current){
  return PROVIDER_ORDER.map(provider=>{
    const group=models.filter(m=>(m.provider||'codex')===provider);if(!group.length)return '';
    return `<optgroup label="${PROVIDER_GROUPS[provider]}">${group.map(m=>`<option value="${escape(m.id)}"${m.id===current?' selected':''}>${escape(m.name)}</option>`).join('')}</optgroup>`;
  }).join('');
}
function renderRoleModels(models){
  const container=$('#role-models');
  if(container){
    const saved=roleModelPrefs();
    container.innerHTML=TEAM.map(member=>{
      const fallback=models.some(m=>m.id===member.model)?member.model:models[0]?.id||member.model;
      const current=saved[member.role]&&models.some(m=>m.id===saved[member.role])?saved[member.role]:fallback;
      return `<label class="role-model"><span>${escape(member.shortPosition)}</span><select data-role-model="${member.role}" aria-label="${escape(member.position)}的模型">${modelOptions(models,current)}</select></label>`;
    }).join('');
  }
  const chat=$('#chat-model');
  if(chat){
    const saved=roleModelPrefs(),fallback=models.some(m=>m.id==='gpt-6-astra')?'gpt-6-astra':models[0]?.id||'gpt-6-astra';
    const current=saved.tech&&models.some(m=>m.id===saved.tech)?saved.tech:fallback;
    chat.innerHTML=modelOptions(models,current);chat.value=[...chat.options].some(o=>o.value===current)?current:(chat.options[0]?.value||'');
  }
}
function renderEfforts(){
  const current=$('#task-effort').value;
  const codexModels=(state.connection.models||[]).filter(model=>model.provider==='codex'&&(/^gpt-5\.6|^gpt-6/i.test(model.id)||/GPT-5\.6|GPT-6/i.test(model.name||'')));
  const effortSets=codexModels.map(model=>new Set(model.efforts||[])).filter(set=>set.size);
  const efforts=(effortSets.length?['low','medium','high','xhigh','max','ultra'].filter(e=>effortSets.every(set=>set.has(e))):['low','medium','high','xhigh','max']).filter(Boolean);
  const allowed=efforts.length?efforts:['low','medium','high'];
  $('#task-effort').innerHTML=allowed.map(e=>`<option value="${escape(e)}">${escape(e.toUpperCase())}${e==='high'?' · 深入处理':e==='medium'?' · 日常任务':e==='low'?' · 快速处理':''}</option>`).join('');
  $('#task-effort').value=allowed.includes(current)?current:allowed.includes('high')?'high':allowed[0];
}
function renderMembers(m){
  const agents=m?.agents||TEAM.map(member=>({...member,id:`office-resident-${member.role}`,status:'idle',sceneOnly:true,summary:member.description,write:member.fullAccess}));
  if(m&&!agents.some(a=>a.id===selectedAgent))selectedAgent=m.coordinatorId;
  $('#member-count').textContent=String(agents.length).padStart(2,'0');
  $('#member-list').innerHTML=agents.map(a=>{const meta=teamMember(a.role)||a;return `<button class="member ${selectedAgent===a.id?'selected':''}" data-agent="${escape(a.id)}"><div class="member-top"><span class="member-avatar ${a.role}">${memberIcon(a)}</span><span class="member-name"><strong>${escape(displayName(a))}</strong><small>${escape(meta.position||meta.shortPosition||'团队成员')}</small><span>${escape(a.modelName||meta.modelName||a.model||meta.model||'')} · ${permissionLabel(a)}${a.dependsOn?.length?' · 有任务依赖':''}</span></span><span class="member-state ${a.status}">${a.status==='completed'?'已完成':statusNames[a.status]||'待命'}</span>${['failed','stopped','interrupted'].includes(a.status)?`<span class="member-retry" role="button" tabindex="0" data-resume-agent="${escape(a.id)}" title="复位这位成员并重新排队它未完成的工作单">↻ 重试</span>`:''}</div><div class="member-summary">${escape(a.error||a.summary||meta.description||'')}</div></button>`;}).join('');
  const signature=selectedTheme+(m?.id||'')+agents.map(a=>a.id+':'+displayName(a,m)).join(',');if(signature!==previousMembers){const selected=$('#message-target').value;$('#message-target').innerHTML=m?agents.map(a=>`<option value="${escape(a.id)}">${escape(displayName(a))}</option>`).join(''):`<option value="">${escape(displayName(agents.find(a=>a.role==='boss')||agents[0],m))}</option>`;$('#message-target').value=m?(agents.some(a=>a.id===selected)?selected:m.coordinatorId):'';previousMembers=signature;}
}
function renderRequests(m){
  const pending=m?.requests.filter(r=>r.status==='pending')||[];$('#attention-section').hidden=!pending.length;$('#attention-count').textContent=String(pending.length);const signature=(m?.id||'')+JSON.stringify(pending.map(r=>[r.id,r.status]));
  const heading=r=>`${memberName(m,r.agentId)} · ${r.kind==='question'?'需要你的答复':'请求本次授权'}`;
  if(signature===requestSignature){
    // Renaming a visible character must not discard an in-progress answer.
    for(const card of $('#requests').querySelectorAll('[data-request]')){const request=pending.find(r=>r.id===card.dataset.request);if(request)card.querySelector('h3').textContent=heading(request);}
    return;
  }
  requestSignature=signature;
  $('#requests').innerHTML=pending.map(r=>`<div class="request-card" data-request="${escape(r.id)}"><h3>${escape(heading(r))}</h3>${r.kind==='question'?r.questions.map(q=>`<label>${escape(q.question)}<div class="question-options">${(q.options||[]).map(o=>`<button type="button" data-answer-option="${escape(o.label)}" data-question="${escape(q.id)}">${escape(o.label)}</button>`).join('')}</div><input data-question-input="${escape(q.id)}" type="${q.isSecret?'password':'text'}" placeholder="填写你的答复…" autocomplete="off"/></label>`).join(''):`<p>${escape(r.reason||'Codex 需要额外权限才能继续。')}</p>${r.network?`<p>访问网络：${escape(r.network.protocol)}://${escape(r.network.host)}</p>`:''}<pre>${escape(r.command||(r.changes?.length?r.changes.map(c=>c.path+'\n'+c.diff).join('\n\n'):r.grantRoot)||JSON.stringify(r.permissions||{},null,2))}</pre>${r.cwd?`<p>目录：${escape(r.cwd)}</p>`:''}`}<div class="request-actions">${r.kind==='question'?'<button data-request-action="answer">回复并继续</button>':'<button data-request-action="accept">仅允许本次</button><button data-request-action="decline">拒绝</button>'}</div></div>`).join('');
}
function renderFeed(m){
  let html='';
  if(!m)html=project()?`<div class="empty-state project-welcome"><span class="empty-icon">▱</span><h2>${escape(project().name)}</h2><p class="project-directory">${escape(project().cwd)}</p><p>把想做的事交给团队，或先和助手聊聊。</p><div><button data-open-task>◎ 新建目标</button><button data-open-chat>◌ 新建对话</button></div></div>`:'<div class="empty-state"><span class="empty-icon">▱</span><h2>从一个项目开始。</h2><p>选择本地目录，集中管理这个项目的目标和对话。</p><button data-open-project>＋ 添加项目目录</button></div>';
  else if(m.kind==='chat'&&!m.messages.length)html=`<div class="empty-state project-welcome"><span class="empty-icon">◌</span><h2>聊聊 ${escape(project()?.name||'这个项目')}</h2><p>可以询问代码、讨论想法，或直接说明要完成的工作。</p><p class="project-directory">${escape(m.cwd)}</p></div>`;
  else if(activeTab==='messages')html=m.messages.map(msg=>{
    const author=memberName(m,msg.agentId),text=messageText(m,msg);
    const head=`<div class="message-head"><span class="avatar-dot">${msg.agentId==='human'?'你':escape(author.slice(0,1))}</span><strong>${escape(author)}</strong>${msg.to?`<span>→ ${escape(memberName(m,msg.to))}</span>`:''}<time>${timeLabel(msg.createdAt)}</time></div>`;
    const body=`<div class="message-body">${formatMessage(text,m.id)}${msg.streaming?'<i class="streaming-cursor"></i>':''}</div>`;
    return `<article class="message ${escape(msg.kind)}" data-message-agent="${escape(msg.agentId)}">${head}${['delegation','collaboration'].includes(msg.kind)?`<details><summary>${msg.kind==='delegation'?'↗ 委派任务':'↔ 协作消息'} · ${escape(short(text.split('\n')[0],64))}</summary>${body}</details>`:body}</article>`;
  }).join('');
  else if(activeTab==='graph'){
    const graph=collaborationGraph(m,id=>memberName(m,id),{selectedId:selectedWork,maximized:graphMaximized});
    const planned=(m?.workItems||[]).filter(w=>w.protocol===2&&!w.replacedBy).length,legacy=(m?.workItems||[]).length-planned;
    html=graph||`<div class="empty-state"><span class="empty-icon">⛬</span><h2>这个会话还没有任务图</h2><p>任务图只出现在<strong>目标</strong>会话里：规划者用 <code>office_submit_graph</code> 提交依赖图、或成员用 <code>office_split</code> 拆分任务后才会出现；对话和旧式临时分工不画图。</p>${legacy?`<p>本会话有 ${legacy} 项旧式分工，可在「工作计划」里查看。</p>`:''}<p>新建目标时选「协作交付」，把复杂工作交给团队即可。</p></div>`;
  }
  else if(activeTab==='plan')html=collaborationPanel(m,id=>memberName(m,id))+m.agents.map(a=>`<section class="plan-agent"><h3>${escape(displayName(a))} ${a.dependsOn.length?` / 依赖 ${a.dependsOn.map(id=>escape(memberName(m,id))).join('、')}`:''}</h3>${a.plan.length?`<ol>${a.plan.map(s=>`<li class="${s.status}"><span>${s.status==='completed'?'✓':s.status==='inProgress'?'◉':'○'}</span>${escape(s.step)}</li>`).join('')}</ol>`:`<p class="no-plan">${escape(a.summary)}。该成员尚未提供步骤清单。</p>`}</section>`).join('');
  else if(activeTab==='events')html=[...m.events].reverse().map(e=>`<details class="event-entry ${e.kind==='error'?'error':''}"><summary><span>${e.kind==='commandExecution'?'⌘ ':e.kind==='fileChange'?'▤ ':''}${escape(short(e.text,160))}</span><small>${escape(memberName(m,e.agentId))} · ${timeLabel(e.createdAt)}</small><small>${escape(e.status||'')}</small></summary><pre>${escape(e.text)}${e.output?'\n\n'+escape(e.output):''}${e.exitCode!==undefined?'\nExit: '+escape(e.exitCode):''}${e.changes?'\n'+escape(e.changes.map(c=>c.path+'\n'+c.diff).join('\n')):''}</pre></details>`).join('');
  else if(activeTab==='files')html='<p class="file-note">点击预览可查看文档；展开文件可查看差异。文件保留在项目目录，较大内容会截断。</p>'+(m.files.length?m.files.map(f=>`<details class="file-entry"><summary>▤ ${escape(f.path)} <small>· ${f.source==='workspace'?'任务期间观察到':({completed:'已修改',inProgress:'修改中',failed:'修改失败'}[f.status]||escape(f.status))}</small> ${localFileLink(m.id,f.path)}</summary><pre>${escape(f.diff||f.content||'无文本内容可展示')}</pre></details>`).join(''):'<div class="empty-state"><span class="empty-icon">▤</span><p>还没有可展示的文件。</p></div>');
  const signature=activeTab+html;if(signature===feedSignature)return;
  const feed=$('#feed'),nearBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<70;const openDetails=[...feed.querySelectorAll('details[open]')].map(d=>d.querySelector('summary')?.textContent);
  const scroll=feed.scrollTop;feed.innerHTML=html;for(const d of feed.querySelectorAll('details'))if(openDetails.includes(d.querySelector('summary')?.textContent))d.open=true;
  if(activeTab==='messages'&&(autoScroll||nearBottom)){feed.scrollTop=feed.scrollHeight;$('#jump-latest').hidden=true;autoScroll=true;}else{feed.scrollTop=scroll;$('#jump-latest').hidden=activeTab!=='messages'||nearBottom;}
  feedSignature=signature;
}
function renderElapsed(){const m=mission();if(!m){$('#elapsed').textContent='准备就绪';return;}if(m.kind==='chat'&&!m.messages.length){$('#elapsed').textContent='等待第一条消息';return;}const end=m.finishedAt&&!isBusy(m)?Date.parse(m.finishedAt):Date.now();const seconds=Math.max(0,Math.floor((end-Date.parse(m.createdAt))/1000));$('#elapsed').textContent=`${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s`;}
function syncScene(m){
  if(!office)return;
  const entries=sceneEntries(m);
  if(lastMissionId!==(m?.id||'preview')){for(const id of Object.keys(office.actors))if(!['boss','employee'].includes(id))office.removeActor(id);lastMissionId=m?.id||'preview';actorMapping.clear();for(const label of labelElements.values())label.hidden=true;}
  actorMapping.clear();let extra=0,employeeUsed=false;const visible=new Set();
  for(const [index,a] of entries.entries()){let key;if(a.role==='boss')key='boss';else if(!employeeUsed&&['builder','solo','researcher'].includes(a.role)){key='employee';employeeUsed=true;}else key=`member-${extra++}`;
    const visualAvatar=supportsAvatarSelection(getTheme(selectedTheme))?visualAvatarFor(a,index):a.avatarId;
    visible.add(key);const actor=office.actors[key]||office.addActor(key,extra-1);actorMapping.set(key,a.id);actor.root.visible=true;actor.setAvatar?.(visualAvatar);
    const working=['running','starting'].includes(a.status);
    actor.ring.visible=a.id===selectedAgent;if(a.id===selectedAgent)office.select(key);
    let label=labelElements.get(key);if(!label){label=document.createElement('div');label.className='character-label';$('#labels').appendChild(label);labelElements.set(key,label);}
    label.hidden=false;label.classList.toggle('selected',a.id===selectedAgent);label.dataset.actor=key;
    const identity=`${a.id}:${selectedTheme}:${visualAvatar||''}`;if(label.dataset.identity!==identity){const meta=teamMember(a.role)||a;label.dataset.identity=identity;label.dataset.member=a.id;const hint=`${meta.position||meta.shortPosition||''} · ${a.modelName||meta.modelName||a.model||meta.model||''}`,caption=`<b>${escape(displayName(a,m))}</b><small class="character-state">待命</small>`;label.innerHTML=a.sceneOnly?`<span class="nameplate" title="${escape(hint)}">${caption}</span>`:`<div class="bubble"></div><button class="nameplate" title="${escape(hint)}" data-select-actor="${escape(key)}" aria-label="查看${escape(displayName(a))}的会话">${caption}</button>`;}
  }
  for(const [key,actor] of Object.entries(office.actors))if(!visible.has(key)){actor.root.visible=false;const label=labelElements.get(key);if(label)label.hidden=true;}
  director?.sync(m?{...m,agents:entries}:{id:'preview',agents:entries,messages:[],events:[],requests:[],status:'idle'},actorMapping,!!state.connection.connected&&eventStreamConnected);
}
function selectSceneMember(id){scenePersonOpen=true;selectedAgent=id;$('#message-target').value=id;renderMembers(mission());syncScene(mission());}
function renderSceneHUD(){
  const m=mission(),a=m?.agents.find(a=>a.id===selectedAgent);
  $('.scene-person-card').hidden=!scenePersonOpen||!a;
  $('#scene-person-name').textContent=a?displayName(a):'';
  const last=m?.messages.findLast(msg=>msg.agentId===selectedAgent&&msg.text);
  $('#scene-person-message').textContent=short(last?.text||'',160);
  $('#scene-person-message').hidden=!last;
  $('#scene-open-session').disabled=!m;
  $('.scene-playback').hidden=!director?.replaying;
  $('#scene-playback-badge').textContent=director?.replaying?`聊天回放 ${director.replayIndex}/${director.replayTotal}`:'';
  const replay=$('#scene-replay-toggle');replay.disabled=!m||isBusy(m)||!director?.connected||!(m.messages||[]).some(msg=>exchangeFrom(msg,m));replay.textContent=director?.replaying?'■ 停止回放':'↻ 回放交流';replay.setAttribute('aria-pressed',String(!!director?.replaying));replay.setAttribute('aria-label',director?.replaying?'停止历史回放':'回放历史交流');replay.title='回放过往聊天';
  const motion=$('#scene-animation-toggle');motion.textContent=director?.enabled?'Ⅱ 暂停动画':'▶ 运行动画';motion.setAttribute('aria-pressed',String(!!director?.enabled));motion.setAttribute('aria-label',director?.enabled?'暂停人物动画':'运行动画');
}
if(localStorage.getItem('office-art-version')!=='styloo-1'){localStorage.setItem('office-theme','styloo');localStorage.setItem('office-art-version','styloo-1');}
if(localStorage.getItem('office-courtyard-version')!=='1'){
  if(localStorage.getItem('office-theme')==='konoha')localStorage.setItem('office-theme','konoha-courtyard');
  localStorage.setItem('office-courtyard-version','1');
}
let selectedTheme=THEMES.some(theme=>theme.id===localStorage.getItem('office-theme'))?localStorage.getItem('office-theme'):'styloo';
localStorage.setItem('office-theme',selectedTheme);
$('#office-theme').innerHTML=THEMES.map(theme=>`<option value="${theme.id}">${escape(theme.label)}</option>`).join('');$('#office-theme').value=selectedTheme;applyThemeUI(selectedTheme,document.body.classList.contains('night'));
try{
  office=createOffice($('#viewport'),key=>{const id=actorMapping.get(key);if(id&&!id.startsWith('office-resident-'))selectSceneMember(id);},{themeId:selectedTheme,onAssetError:toast});
  director=new SceneDirector(office,renderSceneHUD);$('#loading').remove();let last=performance.now(),t=0,labelClock=0;
  function animate(now){const dt=Math.min(.06,(now-last)/1000);last=now;const motionDt=director.enabled&&!document.hidden?dt:0;t+=motionDt;director.update(motionDt);office.update(motionDt,t);labelClock+=dt;
    const refreshLabels=labelClock>.1;if(refreshLabels)labelClock=0;
    for(const [key,label] of labelElements){if(label.hidden||!office.actors[key])continue;const p=office.project(key);label.style.left=p.x+'px';label.style.top=(p.y+$('#viewport').offsetTop)+'px';
      if(refreshLabels){const r=director.record(actorMapping.get(key));if(!r)continue;label.dataset.motion=r.actor.mode;label.dataset.pose=r.actor.assetMotion?.state||r.actor.mode;label.dataset.avatar=r.actor.modelId||'';label.dataset.asset=r.actor.assetState||'';label.style.zIndex=r.bubble?'10':r.id===selectedAgent?'3':'1';const status=label.querySelector('.character-state');if(status&&status.textContent!==r.base.label){status.textContent=r.base.label;label.dataset.state=r.base.mode;label.style.setProperty('--character-state-color',r.base.color);}const bubble=label.querySelector('.bubble');if(bubble){bubble.textContent=short(r.bubble.replace(/\s+/g,' '),65);bubble.title=r.bubble;}}}
    requestAnimationFrame(animate);
  }requestAnimationFrame(animate);
}catch(error){console.error(error);const loading=$('#loading');if(loading)loading.textContent='浏览器未启用 3D 渲染，仍可使用任务与对话。';}
$('#scene-animation-toggle').onclick=()=>director?.setEnabled(!director.enabled);
$('#scene-replay-toggle').onclick=()=>{if(director?.replaying)director.stopReplay();else director?.replay();};
$('#labels').onclick=e=>{const button=e.target.closest('[data-select-actor]');if(button)selectSceneMember(actorMapping.get(button.dataset.selectActor));};
$('#scene-person-close').onclick=()=>{scenePersonOpen=false;renderSceneHUD();};
$('#scene-open-session').onclick=()=>{setMaximized(false);activeTab='messages';document.querySelectorAll('[data-tab]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.tab==='messages')));autoScroll=false;feedSignature='';renderFeed(mission());const messages=[...$('#feed').querySelectorAll('[data-message-agent]')].filter(el=>el.dataset.messageAgent===selectedAgent);messages.at(-1)?.scrollIntoView({block:'nearest'});$('#message-input').focus({preventScroll:true});};
$('#office-theme').onchange=()=>{selectedTheme=getTheme($('#office-theme').value).id;office?.setTheme(selectedTheme);applyThemeUI(selectedTheme,document.body.classList.contains('night'));localStorage.setItem('office-theme',selectedTheme);previousMembers='';requestSignature='';feedSignature='';render();};
$('#scene-focus-person').onclick=()=>{const key=[...actorMapping].find(([,id])=>id===selectedAgent)?.[0]||'boss';director?.setEnabled(false);office?.focusActor(key);};
$('#view-button').onclick=()=>office?.toggleView();$('#reset-view').onclick=()=>office?.resetView();$('#theme-button').onclick=()=>{if(!office)return;const night=office.toggleNight();document.body.classList.toggle('night',night);applyThemeUI(selectedTheme,night);};
let maximized=false,workspaceScroll=0;
function setMaximized(value){
  if(value===maximized)return;
  if(value)workspaceScroll=window.scrollY;
  maximized=value;localStorage.setItem('office-maximized',String(value));document.body.classList.toggle('scene-maximized',value);
  const button=$('#maximize-view');button.textContent=value?'↙ 还原工作台':'⛶ 最大化';button.setAttribute('aria-pressed',String(value));button.setAttribute('aria-label',value?'还原工作台':'最大化待命室视图');button.title=value?'还原工作台（Esc）':'最大化待命室视图（Esc 还原）';
  window.scrollTo(0,value?0:workspaceScroll);button.focus({preventScroll:true});
}
let sceneCollapsed=false;
function setSceneCollapsed(value){
  if(value&&maximized)setMaximized(false);
  sceneCollapsed=value;localStorage.setItem('office-scene-collapsed',String(value));document.body.classList.toggle('scene-collapsed',value);
  const button=$('#collapse-scene');button.textContent=value?'▱ 显示 3D':'▱ 收起 3D';button.setAttribute('aria-pressed',String(value));button.setAttribute('aria-label',value?'显示 3D 待命室':'收起 3D 待命室');button.title=value?'显示 3D 待命室':'收起 3D 待命室';button.focus({preventScroll:true});
}
$('#maximize-view').onclick=()=>setMaximized(!maximized);
$('#collapse-scene').onclick=()=>setSceneCollapsed(!sceneCollapsed);
setSceneCollapsed(localStorage.getItem('office-scene-collapsed')==='true');
setMaximized(localStorage.getItem('office-maximized')==='true');
document.addEventListener('keydown',event=>{if(event.key!=='Escape'||$('#task-dialog').open||$('#project-dialog').open)return;if(graphMaximized){event.preventDefault();setGraphMaximized(false);}else if(maximized){event.preventDefault();setMaximized(false);}else if(sceneCollapsed){event.preventDefault();setSceneCollapsed(false);}});
for(const selector of ['#new-top','#new-mission'])$(selector).onclick=()=>openTask();
$('#new-top').textContent='＋ 新建目标';
$('#new-project').onclick=()=>openProject();$('#new-chat').onclick=()=>openChat();
$('#close-project-dialog').onclick=()=>$('#project-dialog').close();
$('#pick-project-cwd').onclick=async()=>{const button=$('#pick-project-cwd');button.disabled=true;$('#project-error').textContent='';try{const {cwd}=await api('/pick-directory',{});$('#project-cwd').value=cwd;}catch(error){if(error.message!=='选择已取消')$('#project-error').textContent=error.message;}finally{button.disabled=false;}};
$('#project-form').onsubmit=async e=>{e.preventDefault();const button=$('#create-project');if(button.disabled)return;button.disabled=true;$('#project-error').textContent='';try{const {project:p}=await api('/projects',{cwd:$('#project-cwd').value,...($('#project-name').value.trim()?{name:$('#project-name').value.trim()}:{})});state.projects=(state.projects||[]).some(x=>x.id===p.id)?state.projects.map(x=>x.id===p.id?p:x):[...(state.projects||[]),p];navigationInitialized=true;chooseProject(p.id);$('#project-dialog').close();$('#project-cwd').value='';$('#project-name').value='';const action=pendingProjectAction;pendingProjectAction='';if(action==='goal')openTask(p.id);else if(action==='chat')openChat(p.id);else toast('项目已就绪，可以新建目标或对话。');}catch(error){$('#project-error').textContent=error.message;}finally{button.disabled=false;}};
$('#task-cwd').readOnly=true;$('#choose-cwd').hidden=true;
$('#task-project').onchange=()=>{$('#task-cwd').value=state.projects.find(p=>p.id===$('#task-project').value)?.cwd||'';};
$('#close-dialog').onclick=()=>$('#task-dialog').close();$('#task-dialog').addEventListener('click',event=>{if(event.target===$('#task-dialog')){const r=$('#task-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('#task-dialog').close();}});
$('#show-current').onclick=()=>switchView('current');
$('#show-archived').onclick=()=>switchView('archived');
$('#show-hidden').onclick=()=>switchView('hidden');
// 一个共享 popover 承载所有行的「⋯」菜单：按钮只带 id，内容按当前数据即时生成。
function openEntryMenu(anchor){
  const menu=$('#entry-menu'),project=state.projects.find(p=>p.id===anchor.dataset.entryMenu),entry=project?{...project,entries:state.missions.filter(m=>m.projectId===project.id&&!m.archivedAt)}:state.missions.find(m=>m.id===anchor.dataset.entryMenu);
  if(!entry)return;
  const items=entryMenuItems(entry,{archived:listView==='archived',hidden:listView==='hidden'});
  if(!items.length){closeEntryMenu();return;}
  menu.replaceChildren(...items.map(item=>{
    const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.dataset.menuAction=item.action;button.dataset.menuEntry=entry.id;button.disabled=!!item.disabled;
    const label=document.createElement('strong');label.textContent=item.label;button.append(label);
    if(item.hint){const hint=document.createElement('small');hint.textContent=item.hint;button.append(hint);}
    return button;
  }));
  menuAnchorId=anchor.dataset.entryMenu;
  if(!menu.matches(':popover-open'))menu.showPopover();
  placeEntryMenu(menu,anchor);
}
// 菜单贴在「⋯」按钮旁边，并在视口边缘内翻转、收敛：靠近顶部的行也能看全菜单。
function placeEntryMenu(menu,anchor){
  const box=anchor.getBoundingClientRect(),size=menu.getBoundingClientRect();
  const gap=6,width=size.width||236,height=size.height||120;
  const below=box.bottom+gap,top=below+height<=innerHeight-8?below:Math.max(8,box.top-gap-height);
  const left=Math.max(8,Math.min(box.right-width,innerWidth-width-8));
  menu.style.cssText=`position:fixed;inset:auto;margin:0;z-index:60;top:${top}px;left:${left}px;`;
}
function closeEntryMenu(){menuAnchorId='';const menu=$('#entry-menu');if(menu.matches(':popover-open'))menu.hidePopover();}
function switchView(view){
  if(listView===view)return;
  listView=view;const claimed=view==='archived'?'archived':'current';
  if(mission()&&listView!=='hidden'&&(!!mission().archivedAt?'archived':'current')!==claimed){chooseProject(mission().projectId);return;}
  if(mission()&&listView==='hidden'){chooseProject(selectedProjectId);return;}
  render();
}
async function renameEntry(target,value){
  const button=$('#submit-rename'),project=target.kind==='project';
  button.disabled=true;$('#rename-error').textContent='';
  try{
    const result=project?await api(`/projects/${target.id}/rename`,{name:value}):await api(`/missions/${target.id}/rename`,{title:value});
    if(project)state.projects=state.projects.map(p=>p.id===result.project.id?result.project:p);else state.missions=state.missions.map(m=>m.id===result.mission.id?result.mission:m);
    $('#rename-dialog').close();render();toast(project?'项目已重命名，目录没有变动。':'已重命名。');
  }catch(error){$('#rename-error').textContent=error.message;}
  finally{button.disabled=false;}
}
async function runMenuAction(action,id){
  closeEntryMenu();
  if(action==='rename-mission'||action==='rename-project'){
    const project=action==='rename-project',entry=project?state.projects.find(p=>p.id===id):state.missions.find(m=>m.id===id);
    if(!entry)return;
    renameTarget={kind:project?'project':'mission',id,previous:entry.name||entry.title};
    $('#rename-eyebrow').textContent=project?'RENAME PROJECT':'RENAME';
    $('#rename-title').textContent=project?'重命名项目':'重命名';
    $('#rename-hint').textContent=RENAME_HINTS[action]||'';
    // 只有项目允许留空（回到目录名），会话名必须非空——服务端也会再挡一次。
    $('#rename-note').hidden=!project;$('#rename-note').textContent=`项目留空 = 回到目录名（${entry.cwd?.split('/').pop()||''}）`;
    $('#rename-input').placeholder=project?'留空回到目录名':'输入新的名称';
    $('#rename-input').value=renameTarget.previous;
    $('#rename-error').textContent='';$('#rename-dialog').showModal();
    $('#rename-input').select();
    return;
  }
  if(action==='hide-project'||action==='restore-project'){
    const hiding=action==='hide-project',entry=state.projects.find(p=>p.id===id);
    try{
      const {project}=await api(`/projects/${id}/${hiding?'hide':'restore'}`,{});
      state.projects=state.projects.map(p=>p.id===project.id?project:p);
      if(selectedProjectId===project.id&&hiding)chooseProject(state.projects.find(p=>!p.hiddenAt)?.id||'');
      render();
      toast(hiding?`「${project.name}」已从列表移除，目录和对话都还在；在「已移除」里可以放回。`:`「${project.name}」已放回列表。`);
    }catch(error){toast(error.message);}
    return;
  }
  if(action==='archive'||action==='restore'){
    try{const {mission:m}=await api(`/missions/${id}/${action}`,{});state.missions=state.missions.map(entry=>entry.id===id?m:entry);if(selectedId===id)chooseProject(m.projectId);else render();toast(action==='archive'?'已归档，可在「已归档」中查看和恢复。':'已恢复到当前列表。');}catch(error){toast(error.message);}
  }
}
$('#entry-menu').onclick=event=>{const item=event.target.closest('[data-menu-action]');if(item&&!item.disabled)void runMenuAction(item.dataset.menuAction,item.dataset.menuEntry);};
// popover 会在 light dismiss（点到别处、Esc）时自己关闭，这里只同步锚点状态。
$('#entry-menu').addEventListener('toggle',event=>{if(event.newState==='closed')menuAnchorId='';});
$('#close-rename-dialog').onclick=()=>$('#rename-dialog').close();
$('#rename-dialog').addEventListener('click',event=>{if(event.target===$('#rename-dialog'))$('#rename-dialog').close();});
// 对话框用 novalidate：留空对项目是合法输入（回到目录名），对会话则在这里说清楚。
$('#rename-form').onsubmit=event=>{
  event.preventDefault();if(!renameTarget)return;
  const value=$('#rename-input').value;
  if(renameTarget.kind==='mission'&&!value.trim()){$('#rename-error').textContent='会话名称不能为空。';$('#rename-input').focus();return;}
  void renameEntry(renameTarget,value);
};
$('#mission-list').onclick=async e=>{
  const menuButton=e.target.closest('[data-entry-menu]');
  if(menuButton){e.stopPropagation();if(menuAnchorId===menuButton.dataset.entryMenu)closeEntryMenu();else openEntryMenu(menuButton);return;}
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.mission)chooseMission(button.dataset.mission);
  else if(button.dataset.project)chooseProject(button.dataset.project);
  else if(button.dataset.toggleProject){const id=button.dataset.toggleProject;if(collapsedProjects.has(id))collapsedProjects.delete(id);else collapsedProjects.add(id);render();}
  else if(button.dataset.newGoal)openTask(button.dataset.newGoal);
  else if(button.dataset.newChat)openChat(button.dataset.newChat);
};
$('#member-list').onclick=async e=>{
  const retry=e.target.closest('[data-resume-agent]');
  if(retry){
    e.stopPropagation();retry.textContent='…';
    const m=mission();
    try{
      const result=await api(`/missions/${m.id}/resume`,{agentId:retry.dataset.resumeAgent});
      toast(`已恢复 ${result.revived.join('、')}${result.requeued.length?`，重新排队 ${result.requeued.join('、')}`:''}。`);
    }catch(error){toast(error.message);retry.textContent='↻ 重试';}
    return;
  }
  const button=e.target.closest('[data-agent]');if(button){selectedAgent=button.dataset.agent;$('#message-target').value=selectedAgent;renderMembers(mission());syncScene(mission());}};
$('.work-tabs').onclick=e=>{const button=e.target.closest('[data-tab]');if(!button)return;activeTab=button.dataset.tab;document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b===button)));autoScroll=activeTab==='messages';feedSignature='';renderFeed(mission());};
function setGraphMaximized(value){
  graphMaximized=value;localStorage.setItem('office-graph-maximized',String(value));document.body.classList.toggle('graph-maximized',value);
  feedSignature='';renderFeed(mission());
}
$('#feed').onclick=e=>{
  if(e.target.closest('[data-dag-expand]')){setGraphMaximized(!graphMaximized);return;}
  if(e.target.closest('[data-dag-close]')){selectedWork='';feedSignature='';renderFeed(mission());return;}
  const node=e.target.closest('[data-dag-node]');
  if(node){selectedWork=selectedWork===node.dataset.dagNode?'':node.dataset.dagNode;feedSignature='';renderFeed(mission());return;}
  if(e.target.closest('[data-open-task]'))openTask();else if(e.target.closest('[data-open-chat]'))openChat();else if(e.target.closest('[data-open-project]'))openProject();};$('#feed').onscroll=()=>{autoScroll=$('#feed').scrollHeight-$('#feed').scrollTop-$('#feed').clientHeight<70;$('#jump-latest').hidden=autoScroll||activeTab!=='messages';};$('#jump-latest').onclick=()=>{autoScroll=true;$('#feed').scrollTop=$('#feed').scrollHeight;$('#jump-latest').hidden=true;};
$('#task-model').onchange=renderEfforts;
$('#role-models').addEventListener('change',()=>{const prefs=roleModelPrefs();for(const select of document.querySelectorAll('[data-role-model]'))prefs[select.dataset.roleModel]=select.value;localStorage.setItem('office-role-models',JSON.stringify(prefs));});
$('#chat-model').addEventListener('change',e=>{const prefs=roleModelPrefs();prefs.tech=e.target.value;localStorage.setItem('office-role-models',JSON.stringify(prefs));});
const examples={todo:'请制作一个无依赖的待办清单网页：支持新增、完成、删除任务，并用 localStorage 保存。界面使用中文，兼容手机。请让执行员工实现，再由独立检查员工验收，最后给我文件路径和验证结果。',research:'请只读分析这个项目，说明目录结构、核心模块、启动方式和最值得改进的三个点。先安排调研，再独立核实关键结论。不要修改任何文件。',smoke:'请验证待命室的真实协作：委派一位执行员工在当前目录创建 TEAM_HELLO.md，内容简短介绍这个待命室；再委派一位检查员工，依赖执行员工完成后只读核对文件。最后汇总两位员工的结果和实际文件路径。保持任务很小，勿联网、勿修改其他文件。'};
$('.example-row').onclick=e=>{const b=e.target.closest('[data-example]');if(b){$('#task-prompt').value=examples[b.dataset.example];if(b.dataset.example==='research')document.querySelector('[name=mode][value=plan]').checked=true;else document.querySelector('[name=mode][value=team]').checked=true;}};
$('#choose-cwd').onclick=async()=>{const button=$('#choose-cwd');button.disabled=true;try{const {cwd}=await api('/pick-directory',{});$('#task-cwd').value=cwd;}catch(error){if(error.message!=='选择已取消')$('#task-error').textContent=error.message;}finally{button.disabled=false;}};
$('#task-form').onsubmit=async e=>{
  e.preventDefault();const button=$('#create-mission');if(button.disabled)return;
  if(!state.capabilities?.creationAvatars){$('#task-error').textContent='人物配置需要重启本地服务后才能保存；为避免丢失选择，暂不创建新会话。已有对话可继续。';return;}
  button.disabled=true;$('#task-error').textContent='';
  const kind=creationKind,projectId=$('#task-project').value,chatDraft=!mission()&&selectedProjectId===projectId?$('#message-input').value:drafts.get(projectId)||'';
  const roleAvatars=Object.fromEntries([...document.querySelectorAll('[data-role-avatar]')].map(select=>[select.dataset.roleAvatar,select.value]));
  try{
    const roleModels=kind==='chat'?{tech:$('#chat-model').value}:Object.fromEntries([...document.querySelectorAll('[data-role-model]')].map(select=>[select.dataset.roleModel,select.value]));
    const {mission:m}=await api('/missions',{clientRequestId:createRequestId,kind,projectId,roleAvatars,roleModels,...(kind==='goal'?{presentationTheme:selectedTheme,prompt:$('#task-prompt').value,acceptance:$('#task-acceptance').value,mode:document.querySelector('[name=mode]:checked').value,effort:$('#task-effort').value}:{})});
    state.missions=[m,...state.missions.filter(x=>x.id!==m.id)];chooseMission(m.id);$('#task-dialog').close();createRequestId=crypto.randomUUID();
    if(kind==='chat'){drafts.set(m.id,chatDraft);$('#message-input').value=chatDraft;$('#message-input').focus();toast('对话已创建，发送第一条消息即可开始。');}
    else{$('#task-prompt').value='';toast('目标已创建，团队开始工作。');}
  }catch(error){$('#task-error').textContent=error.message;}finally{button.disabled=false;}
};
$('#message-form').onsubmit=async e=>{
  e.preventDefault();const text=$('#message-input').value.trim();if(!text||submitting)return;
  const target=mission();if(target?.archivedAt){toast('请先恢复，再继续对话。');return;}if(!target){if(!project()){openProject('chat');return;}openChat();return;}
  const agentId=$('#message-target').value||target.coordinatorId;submitting=true;$('#send-message').disabled=true;
  try{await api(`/missions/${target.id}/message`,{text,agentId});drafts.delete(target.id);if(selectedId===target.id){$('#message-input').value='';autoScroll=true;}}
  catch(error){toast(error.message);}finally{submitting=false;$('#send-message').disabled=!state.connection.connected||!!mission()?.archivedAt;}
};
$('#message-input').addEventListener('keydown',e=>handleMessageKeydown(e,{canSend:!$('#send-message').disabled&&!!$('#message-input').value.trim(),send:()=>$('#message-form').requestSubmit()}));
$('#resume-mission').onclick=async()=>{
  const m=mission();if(!m)return;
  const button=$('#resume-mission');button.disabled=true;
  try{
    const result=await api(`/missions/${m.id}/resume`,{retryFailed:true});
    const parts=[];
    if(result.reconnected?.length)parts.push(`重建 ${result.reconnected.join('、')} 连接`);
    if(result.stillOffline?.length)parts.push(`${result.stillOffline.join('、')} 仍未连接，工作单会等它`);
    if(result.requeued?.length)parts.push(`重新排队 ${result.requeued.length} 项`);
    if(result.retried?.length)parts.push(`重试失败 ${result.retried.length} 项`);
    if(result.revived?.length)parts.push(`复位 ${result.revived.length} 位成员`);
    if(result.needsPlanner?.length)parts.push(`${result.needsPlanner.length} 项交给规划者`);
    if(result.held?.length)parts.push(`${result.held.length} 项需要你先确认副作用`);
    toast(parts.length?`已继续：${parts.join('，')}。`:'没有需要继续的工作单。');
  }catch(error){toast(error.message);}
  finally{button.disabled=false;}
};
$('#stop-mission').onclick=async()=>{const m=mission();if(!m)return;$('#stop-mission').disabled=true;try{await api(`/missions/${m.id}/stop`,{});toast('已请求停止，文件和对话会保留。');}catch(error){toast(error.message);$('#stop-mission').disabled=false;}};
$('#accept-mission').onclick=async()=>{try{await api(`/missions/${mission().id}/accept`,{});toast('这次交付已验收。');}catch(error){toast(error.message);}};
$('#requests').onclick=async e=>{const option=e.target.closest('[data-answer-option]');if(option){const card=option.closest('[data-request]');[...card.querySelectorAll('[data-question-input]')].find(input=>input.dataset.questionInput===option.dataset.question).value=option.dataset.answerOption;return;}const button=e.target.closest('[data-request-action]');if(!button)return;const card=button.closest('[data-request]'),action=button.dataset.requestAction;button.disabled=true;try{const answers=Object.fromEntries([...card.querySelectorAll('[data-question-input]')].map(input=>[input.dataset.questionInput,input.value]));await api(`/missions/${mission().id}/answer`,{requestId:card.dataset.request,decision:action,answers});}catch(error){toast(error.message);button.disabled=false;}};
$('#reconnect').onclick=async()=>{
  const button=$('#reconnect');button.disabled=true;
  try{
    const snapshot=await api('/connect',{force:true});
    applySnapshot(snapshot);
    const providers=snapshot.connection.providers||{};
    const offline=Object.entries(providers).filter(([,status])=>!status.connected||!status.authenticated).map(([name])=>name);
    toast(offline.length?`已重建本地连接；${offline.join('、')} 仍未就绪：${offline.map(name=>providers[name].message).join('；')}`:`本地运行环境已全部重建：${PROVIDER_ORDER.map(name=>PROVIDER_NAMES[name]).join(' · ')}。`);
  }catch(error){toast(error.message);}
  finally{button.disabled=false;}
};
async function connect(){try{const response=await fetch('/api/bootstrap');if(!response.ok)throw new Error('服务尚未就绪');const data=await response.json();token=data.token;bootstrapInstance=data.instanceId;applySnapshot(data);stream?.close();stream=new EventSource('/api/events');stream.addEventListener('snapshot',event=>{const snapshot=JSON.parse(event.data);if(snapshot.instanceId!==bootstrapInstance){stream.close();void connect();return;}eventStreamConnected=true;applySnapshot(snapshot);$('#sync-status').textContent='◉ 实时同步';});stream.onerror=()=>{eventStreamConnected=false;syncScene(mission());$('#sync-status').textContent='◌ 正在恢复同步';};}catch(error){state.connection={connected:false,message:error.message};render();$('#runtime-note').textContent='本地服务未启动';setTimeout(connect,4000);}}
setInterval(renderElapsed,1000);render();void connect();

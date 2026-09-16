import './demo.css';
import {createOffice} from './office.js';
import {OfficeSimulation} from './simulation.js';

const $=s=>document.querySelector(s);
let selected='boss',simulation,office,lastUI=0,toastTimer;
const names={boss:'老罗',employee:'小林'};
const labels={};
for(const id of ['boss','employee']){const el=document.createElement('div');el.className=`character-label ${id==='boss'?'selected':''}`;el.innerHTML=`<div class="bubble"></div><div class="nameplate"><i></i><b>${names[id]}</b><small>${id==='boss'?'老板':'员工'}</small></div>`;$('#labels').appendChild(el);labels[id]=el;}
function log(message){const li=document.createElement('li'),span=document.createElement('span'),time=document.createElement('time');span.textContent=message;time.textContent=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});li.append(span,time);$('#activity-list').prepend(li);while($('#activity-list').children.length>4)$('#activity-list').lastChild.remove();}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2200);}
function select(id){selected=id;office?.select(id);document.querySelectorAll('[data-person]').forEach(el=>el.classList.toggle('selected',el.dataset.person===id));Object.entries(labels).forEach(([key,el])=>el.classList.toggle('selected',key===id));if(simulation)renderUI(simulation.state,true);}
function renderUI(state,force=false){
  const now=performance.now();if(!force&&now-lastUI<80&&state.stage==='working')return;lastUI=now;
  const boss=selected==='boss';$('#detail-role').textContent=boss?'THE BOSS':'THE TEAMMATE';$('#detail-name').innerHTML=`${names[selected]}<span>的工作日</span>`;
  $('#detail-status').textContent=state[`${selected}Status`];$('#detail-location').textContent=state[`${selected}Location`];
  $('#detail-description').innerHTML=boss?'好想法需要一个好搭档。<br>负责方向，也负责为团队鼓劲。':'把抽象的想法变成具体的小成果。<br>认真工作，也认真享受一杯咖啡。';
  $('#energy-label').textContent=boss?'灵感在线':state.activity==='coffee'?'正在充电':'干劲满满';$('#energy-fill').style.width=boss?'88%':state.activity==='coffee'?'100%':'82%';
  $('#task-title').textContent=state.title;$('#task-status').textContent=state.description;$('#task-progress').style.width=`${state.progress}%`;$('#completed-count').textContent=`完成 ${state.completed}`;
  document.querySelectorAll('[data-stage]').forEach(el=>el.classList.toggle('active',el.dataset.stage===state.stage));
  for(const id of ['boss','employee'])labels[id].querySelector('.bubble').textContent=state[`${id}Bubble`];
  for(const id of ['assign','meeting','coffee'])$(`#${id}-button`).disabled=state.activity!=='idle';
}
try {
  office=createOffice($('#viewport'),select);
  simulation=new OfficeSimulation(office.actors,renderUI,log);
  $('#loading').remove();log('小林已到岗，今天也请多关照');log('老罗打开了待命室，新的工作日开始了');
  document.querySelectorAll('[data-person]').forEach(el=>el.addEventListener('click',()=>select(el.dataset.person)));
  for(const id of ['assign','meeting','coffee'])$(`#${id}-button`).addEventListener('click',()=>{if(simulation[id]())toast({assign:'任务已派发，看看小林怎么完成它。',meeting:'聊一聊，让好点子发生。',coffee:'休息一下，灵感正在路上。'}[id]);});
  $('#auto-button').addEventListener('click',()=>{simulation.auto=!simulation.auto;simulation.autoWait=2;$('#auto-button').setAttribute('aria-pressed',String(simulation.auto));$('#auto-button').innerHTML=simulation.auto?'<span>Ⅱ</span> 停止自动':'<span>▷</span> 自动演示';toast(simulation.auto?'自动演示：派任务 → 喝咖啡 → 碰个头':'自动演示已关闭，当前动作会自然结束。');});
  $('#reset-view').addEventListener('click',()=>{office.resetView();$('#view-button').classList.remove('active');});
  $('#view-button').addEventListener('click',()=>$('#view-button').classList.toggle('active',office.toggleView()));
  $('#theme-button').addEventListener('click',()=>{const night=office.toggleNight();document.body.classList.toggle('night',night);$('#room-mode').textContent=night?'加班有盏灯':'午后时光';$('#theme-button').textContent=night?'☾':'☼';$('#theme-button').setAttribute('aria-label',night?'切换白天':'切换夜晚');});
  $('#restart-button').addEventListener('click',()=>{simulation.reset();$('#activity-list').replaceChildren();$('#auto-button').setAttribute('aria-pressed','false');$('#auto-button').innerHTML='<span>▷</span> 自动演示';log('待命室已重置，新的一天开始了');renderUI(simulation.state,true);toast('新的工作日，准备就绪。');});
  addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select')||e.metaKey||e.ctrlKey||e.altKey)return;const action={'1':'assign','2':'meeting','3':'coffee'}[e.key];if(action){e.preventDefault();if(!simulation.busy)$(`#${action}-button`).click();}});
  let last=performance.now(),time=0;
  function animate(now){const dt=Math.min((now-last)/1000,.06);last=now;time+=dt;simulation.update(dt);office.update(dt,time);for(const id of ['boss','employee']){const point=office.project(id),el=labels[id];el.style.left=`${point.x}px`;el.style.top=`${point.y+$('#viewport').offsetTop}px`;el.style.visibility=point.visible?'visible':'hidden';}requestAnimationFrame(animate);}
  requestAnimationFrame(animate);
}catch(error){console.error(error);$('#loading').innerHTML='这台浏览器暂时没有开启 3D 渲染<span>请使用开启硬件加速的 Chrome 或 Edge 重新打开。</span>';}

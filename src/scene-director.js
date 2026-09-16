// Visual choreography reads real mission snapshots. It never starts or changes a Codex task.
import {ROOM,WORKSTATIONS,WORK_ISLAND,FURNITURE,LEISURE} from './room-layout.js';
import {actorEnvelope,occupiedBy} from './actor-clearance.js';
const rectangle=(point,width,depth,padding=.2)=>{const c=Math.abs(Math.cos(point.rotation||0)),s=Math.abs(Math.sin(point.rotation||0)),x=(width*c+depth*s)/2+padding,z=(width*s+depth*c)/2+padding;return [point.x-x,point.x+x,point.z-z,point.z+z];};
export const OBSTACLES=[
  rectangle(WORK_ISLAND,WORK_ISLAND.width,WORK_ISLAND.depth),
  rectangle(FURNITURE.sofa,2.56,1.04),rectangle(FURNITURE.table,1.1,1.1),
  rectangle(FURNITURE.coffee,2.16,1.04),rectangle(FURNITURE.shelf,1.74,.62),
  rectangle(FURNITURE.storage,2.5,.72),rectangle(FURNITURE.partition,.08,2.7),
  ...FURNITURE.plants.map(plant=>rectangle(plant,.7,.7))
];
// Chairs are physical obstacles while their legal seat point remains usable.
// Keep the footprint tight around the actual chair body: the station home is
// just in front of the seat and must remain reachable.
export const CHAIR_OBSTACLES=WORKSTATIONS.map(station=>rectangle({
  x:station.x,
  z:station.z+(station.rotation?-1.64:1.64),
},.84,.58,0));
OBSTACLES.push(...CHAIR_OBSTACLES);
const blocked=(p,obstacles)=>obstacles.some(([x1,x2,z1,z2])=>p.x>x1&&p.x<x2&&p.z>z1&&p.z<z2);
export const walkable=(p,dynamicObstacles=[])=>(p.x>=ROOM.minX&&p.x<=ROOM.maxX&&p.z>=ROOM.minZ&&p.z<=ROOM.maxZ&&!blocked(p,OBSTACLES)&&!blocked(p,dynamicObstacles));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function clearSegment(a,b,dynamicObstacles=[]){const obstacles=dynamicObstacles;const steps=Math.ceil(distance(a,b)/.075);for(let i=0;i<=steps;i++){const t=i/Math.max(1,steps);if(!walkable({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},obstacles))return false;}return true;}
export function findRoute(start,end,dynamicObstacles=[]){
  const from={x:start.x,z:start.z},to={x:end.x,z:end.z};if(!walkable(from,dynamicObstacles)||!walkable(to,dynamicObstacles))return [];
  if(clearSegment(from,to,dynamicObstacles))return [to];
  const obstacles=[...OBSTACLES,...dynamicObstacles];
  const corners=obstacles.flatMap(([x1,x2,z1,z2])=>[{x:x1-.035,z:z1-.035},{x:x1-.035,z:z2+.035},{x:x2+.035,z:z1-.035},{x:x2+.035,z:z2+.035}]).filter(p=>walkable(p,dynamicObstacles));
  const points=[from,to,...corners],cost=points.map(()=>Infinity),prev=[],visited=new Set();cost[0]=0;
  while(visited.size<points.length){let current=-1;for(let i=0;i<points.length;i++)if(!visited.has(i)&&(current<0||cost[i]<cost[current]))current=i;if(current<0||!Number.isFinite(cost[current]))break;if(current===1){const route=[];for(let i=1;i!==0;i=prev[i])route.unshift(points[i]);return route;}visited.add(current);
    for(let i=0;i<points.length;i++){if(visited.has(i))continue;const candidate=cost[current]+distance(points[current],points[i]);if(candidate<cost[i]&&clearSegment(points[current],points[i],dynamicObstacles)){cost[i]=candidate;prev[i]=current;}}
  }return [];
}
export function activityFor(agent,mission,connected=true){
  if(agent.sceneOnly)return {mode:'idle',label:'待命',color:'#a1ac93'};
  if(!connected)return {mode:'paused',label:'连接中断',color:'#a08e78'};
  if(agent.status==='failed')return {mode:'blocked',label:'遇到问题',color:'#c88758'};
  if(agent.status==='completed')return {mode:'idle',label:'已完成',color:'#8ca374'};
  if(agent.status==='idle')return {mode:'idle',label:'待命',color:'#a1ac93'};
  if(mission.status==='interrupted'||agent.status==='interrupted')return {mode:'paused',label:'已中断',color:'#a08e78'};
  if(mission.status==='stopping')return {mode:'paused',label:'停止中',color:'#a7a48e'};
  if(mission.status==='stopped'||agent.status==='stopped')return {mode:'paused',label:agent.threadId?'已停止':'尚未启动',color:'#a7a48e'};
  const request=(mission.requests||[]).find(r=>r.agentId===agent.id&&r.status==='pending');
  if(request)return {mode:'waiting',label:request.kind==='question'?'等你答复':'等待授权',color:'#c39351'};
  if(agent.status==='queued')return {mode:'waiting',label:agent.dependsOn?.length?'等待前序任务':'排队中',color:'#adad85'};
  if(agent.status==='waiting')return {mode:'waiting',label:'等待回复',color:'#c39351'};
  if(agent.status==='starting')return {mode:'thinking',label:'准备中',color:'#a6ad7e'};
  if(agent.status!=='running')return {mode:'idle',label:'待命',color:'#a1ac93'};
  if(agent.phase==='blocked')return {mode:'blocked',label:'处理阻塞',color:'#c88758'};
  const event=(mission.events||[]).findLast(e=>e.agentId===agent.id&&e.status==='inProgress');
  if(['dynamicToolCall','mcpToolCall'].includes(event?.kind)&&/等待|office_team/.test(event.text))return {mode:'thinking',label:'等待团队',color:'#a1aa7b'};
  const speaking=(mission.messages||[]).some(m=>m.agentId===agent.id&&m.kind==='assistant'&&m.streaming&&m.text);
  if(speaking)return {mode:'talking',label:'正在交流',color:'#c39360'};
  if(agent.role==='reviewer'||agent.phase==='checking')return {mode:'reading',label:'检查成果',color:'#7e9ca2'};
  if(event&&['commandExecution','fileChange'].includes(event.kind))return {mode:'working',label:event.kind==='fileChange'?'修改文件':'执行命令',color:'#829e69'};
  if(event?.kind==='webSearch')return {mode:'reading',label:'查阅资料',color:'#7e9ca2'};
  if(agent.phase==='planning')return {mode:'thinking',label:'思考中',color:'#a5a176'};
  return {mode:agent.role==='researcher'?'reading':'working',label:agent.role==='researcher'?'查阅资料':'专注执行',color:'#829e69'};
}
export function exchangeFrom(message,mission){
  if(!message.text?.trim()||message.streaming)return null;
  const ids=new Set(mission.agents.map(a=>a.id));
  if(['delegation','collaboration'].includes(message.kind)&&ids.has(message.agentId)&&ids.has(message.to)&&message.agentId!==message.to)return {...message,from:message.agentId,kind:message.kind};
  if(message.kind==='assistant'&&message.phase==='final_answer'&&message.agentId!==mission.coordinatorId&&ids.has(mission.coordinatorId))return {...message,from:message.agentId,to:mission.coordinatorId,kind:'report'};
  return null;
}
const activeMission=m=>['queued','running','stopping'].includes(m.status);
export const AMBIENT_CADENCE={firstDelay:12,interval:45,stagger:6,cooldown:10,maxConcurrent:1};
const PASTIMES=[
  {mode:'gazing',spot:LEISURE.window,rotation:Math.PI,duration:12},
  {mode:'gazing',spot:LEISURE.reading,rotation:0,duration:10}
];
const seedFor=id=>[...id].reduce((seed,c)=>Math.imul(seed^c.charCodeAt(0),16777619)>>>0,2166136261);
const between=(record,min,max)=>{record.seed=(Math.imul(record.seed,1664525)+1013904223)>>>0;return min+(max-min)*record.seed/4294967296;};
export class SceneDirector {
  constructor(office,onChange=()=>{},options={}){this.office=office;this.onChange=onChange;this.records=new Map();this.seen=new Set();this.queue=[];this.current=null;this.clock=0;this.enabled=true;this.replaying=false;this.connected=true;this.mission=null;this.replayTotal=0;this.replayIndex=0;this.ambientTiming={...AMBIENT_CADENCE,...options.ambient};this.nextAmbientAllowedAt=0;}
  sync(mission,bindings,connected=true){
    const fresh=this.mission?.id!==mission.id;this.mission=mission;this.connected=connected;
    if(fresh){this.clear();this.records.clear();this.seen=new Set((mission.messages||[]).map(m=>m.id));}
    const attached=new Set(bindings.values());for(const [id,record] of this.records)if(!attached.has(id)){if(this.current&&[this.current.mover,this.current.host].includes(record))this.clear();this.records.delete(id);}
    for(const [key,id] of bindings){const agent=mission.agents.find(a=>a.id===id),actor=this.office.actors[key];if(!agent||!actor)continue;let record=this.records.get(id);
      if(!record){const index=this.records.size;record={id,key,actor,agent,base:null,route:[],destination:null,routeRetryAt:0,blockedSince:null,bubble:'',bubbleUntil:0,celebrateUntil:0,ambient:null,ambientCount:index,seed:seedFor(id),desk:null,nextAmbientAt:this.clock+this.ambientTiming.firstDelay+index*this.ambientTiming.stagger};this.records.set(id,record);actor.root.position.copy(actor.home);actor.targetRotation=actor.homeRotation??(key==='boss'?0:Math.PI);}
      const previous=record.agent.status;record.agent=agent;record.base=activityFor(agent,mission,connected);actor.setRole?.(agent.role);
      if(record.ambient&&!this.canRelax(record)){record.ambient=null;if(['waiting','blocked'].includes(record.base.mode)){record.route=[];record.destination=null;}else this.setDestination(record,actor.home);}
      if(!fresh&&previous!=='completed'&&agent.status==='completed'&&connected&&!['stopped','interrupted'].includes(mission.status)){record.celebrateUntil=this.clock+2.2;record.nextAmbientAt=this.clock+this.ambientTiming.interval;}
    }
    if(!connected||(!this.replaying&&['stopped','stopping','interrupted'].includes(mission.status)))this.clear(false);
    if(this.replaying&&activeMission(mission))this.clear();
    if(this.current&&!this.replaying&&[this.current.mover,this.current.host].some(r=>['waiting','blocked','paused'].includes(r.base.mode)))this.clear();
    const exchanges=[];
    for(const message of mission.messages||[]){const event=exchangeFrom(message,mission);if(!event||this.seen.has(message.id))continue;this.seen.add(message.id);if(!fresh&&connected&&Date.now()-Date.parse(message.createdAt)<30000)exchanges.push(event);}
    if(exchanges.length){if(this.replaying)this.clear();if(!['stopped','stopping','interrupted'].includes(mission.status))this.queue.push(...exchanges);this.queue=this.queue.slice(-8);}
    this.onChange();
  }
  setEnabled(value){this.enabled=value;this.onChange();}
  peerObstacles(exclude){const radius=actorEnvelope(exclude.actor).radius;return [...this.records.values()].filter(record=>record!==exclude&&record.actor.root.visible!==false).map(record=>occupiedBy(record.actor,radius));}
  routeFor(record,start,end){return findRoute(start,end,this.peerObstacles(record));}
  setDestination(record,point,plannedRoute){
    if(distance(record.actor.root.position,point)<.04){record.route=[];record.destination=null;record.blockedSince=null;return;}
    if(!record.destination||distance(record.destination,point)>.01)record.blockedSince=null;
    record.destination={x:point.x,z:point.z};record.route=plannedRoute??this.routeFor(record,record.actor.root.position,point);record.routeRetryAt=this.clock+.5;
    if(record.route.length)record.blockedSince=null;else record.blockedSince??=this.clock;
  }
  clear(ambient=true){this.queue=[];this.current=null;this.replaying=false;for(const r of this.records.values()){if(ambient||!r.ambient){r.route=[];r.destination=null;r.blockedSince=null;}if(ambient)r.ambient=null;r.bubble='';r.bubbleUntil=0;r.celebrateUntil=0;}this.office.clearExchanges?.();}
  canRelax(record){
    if((this.mission.requests||[]).some(r=>r.agentId===record.id&&r.status==='pending'))return false;
    return !this.connected||['stopped','interrupted','completed','idle'].includes(this.mission.status)||['idle','completed','stopped','interrupted','queued'].includes(record.agent.status);
  }
  updateAmbient(record){
    if(!this.canRelax(record)||this.replaying||this.current&&[this.current.mover,this.current.host].includes(record))return;
    if(!record.ambient&&!record.route.length&&!record.destination&&this.clock>=record.nextAmbientAt){
      if(this.current||this.clock<this.nextAmbientAllowedAt)return;
      const peers=[...this.records.values()];
      if(peers.filter(r=>r.ambient).length>=this.ambientTiming.maxConcurrent)return;
      const next=peers.filter(r=>!r.ambient&&!r.route.length&&!r.destination&&this.canRelax(r)&&this.clock>=r.nextAmbientAt).sort((a,b)=>a.nextAmbientAt-b.nextAmbientAt)[0];if(next!==record)return;
      const activity=PASTIMES[record.ambientCount%PASTIMES.length];
      if(activity.spot&&[...this.records.values()].some(r=>r!==record&&r.ambient?.activity===activity)){record.nextAmbientAt=this.clock+2;return;}
      const route=activity.spot?this.routeFor(record,record.actor.root.position,activity.spot):[];record.ambientCount++;
      if(activity.spot&&!route.length&&distance(record.actor.root.position,activity.spot)>.04){record.nextAmbientAt=this.clock+2;return;}
      record.ambient={activity,phase:'walking',until:0};if(activity.spot)this.setDestination(record,activity.spot,route);
    }
    const ambient=record.ambient;if(!ambient)return;
    if(ambient.phase==='walking'&&!record.route.length&&!record.destination){ambient.phase='resting';ambient.until=this.clock+ambient.activity.duration;record.actor.targetRotation=ambient.activity.rotation??(record.actor.homeRotation??(record.key==='boss'?0:Math.PI));}
    if(ambient.phase==='resting'&&this.clock>=ambient.until){ambient.phase='returning';this.setDestination(record,record.actor.home);}
    if(ambient.phase==='returning'&&!record.route.length&&!record.destination){record.ambient=null;record.nextAmbientAt=this.clock+this.ambientTiming.interval+between(record,0,35);this.nextAmbientAllowedAt=this.clock+this.ambientTiming.cooldown;record.actor.targetRotation=record.actor.homeRotation??(record.key==='boss'?0:Math.PI);}
  }
  updateDesk(record,eligible){
    const actor=record.actor;actor.deskTyping=false;actor.deskActivity=null;
    if(!eligible||this.replaying||(this.current&&[this.current.mover,this.current.host].includes(record))||(this.mission.requests||[]).some(r=>r.agentId===record.id&&r.status==='pending')){record.desk=null;return;}
    const relaxed=this.canRelax(record),working=['working','thinking'].includes(record.base?.mode);
    if(!relaxed&&!working){record.desk=null;return;}
    let desk=record.desk;
    if(!desk||desk.relaxed!==relaxed)desk=record.desk={kind:relaxed?'rest':'focus',relaxed,until:this.clock+between(record,relaxed?16:32,relaxed?32:52)};
    if(this.clock>=desk.until){desk.kind=desk.kind==='focus'?'rest':'focus';desk.until=this.clock+between(record,desk.kind==='rest'?5:26,desk.kind==='rest'?10:52);}
    actor.deskActivity=desk.kind==='rest'?'resting':null;actor.deskTyping=desk.kind==='focus'&&working;
  }

  replay(){
    if(!this.mission||activeMission(this.mission)||!this.connected)return false;
    const events=(this.mission.messages||[]).map(m=>exchangeFrom(m,this.mission)).filter(Boolean).slice(-6);if(!events.length)return false;
    this.clear();for(const r of this.records.values()){r.actor.root.position.copy(r.actor.home);r.actor.targetRotation=r.actor.homeRotation??(r.key==='boss'?0:Math.PI);}
    this.queue=events.map(e=>({...e,historical:true}));this.replaying=true;this.replayTotal=events.length;this.replayIndex=0;this.enabled=true;this.onChange();return true;
  }
  stopReplay(){this.clear();let index=0;for(const r of this.records.values()){r.actor.root.position.copy(r.actor.home);r.actor.targetRotation=r.actor.homeRotation??(r.key==='boss'?0:Math.PI);r.nextAmbientAt=this.clock+this.ambientTiming.firstDelay+index++*this.ambientTiming.stagger;}this.nextAmbientAllowedAt=this.clock+this.ambientTiming.cooldown;this.onChange();}
  face(record,target){const p=record.actor.root.position,t=target.actor.root.position;record.actor.targetRotation=Math.atan2(t.x-p.x,t.z-p.z);}
  startExchange(event){
    const source=this.records.get(event.from),target=this.records.get(event.to);if(!source||!target)return;
    const mover=event.kind==='delegation'?target:source,host=event.kind==='delegation'?source:target;
    for(const record of [mover,host]){record.ambient=null;record.route=[];record.destination=null;record.blockedSince=null;record.nextAmbientAt=this.clock+this.ambientTiming.interval;}
    const p=host.actor.root.position,from=mover.actor.root.position;
    const distance=Math.max(1.5,actorEnvelope(mover.actor).radius+actorEnvelope(host.actor).radius+.4);
    const options=[[distance,0],[-distance,0],[0,distance],[0,-distance],[distance*.8,distance*.8],[-distance*.8,distance*.8],[distance*.8,-distance*.8],[-distance*.8,-distance*.8]].map(([x,z])=>this.routeFor(mover,from,{x:p.x+x,z:p.z+z})).filter(route=>route.length);
    options.sort((a,b)=>routeLength(from,a)-routeLength(from,b));const route=options[0];if(route)this.setDestination(mover,route.at(-1),route);
    this.current={event,mover,host,source,target,remote:!route,phase:route?'approaching':'talking',until:route?0:this.clock+3.4};if(event.historical)this.replayIndex++;
    this.office.exchange?.(source.key,target.key,event.kind==='delegation'?'#d49a65':'#8ba8a1');
    source.bubble=event.text;source.bubbleUntil=this.clock+8;this.onChange();
  }
  finishExchange(){const c=this.current;for(const r of [c.mover,c.host])r.nextAmbientAt=this.clock+this.ambientTiming.interval;this.nextAmbientAllowedAt=this.clock+this.ambientTiming.cooldown;this.current=null;this.onChange();}
  update(dt){
    if(!this.enabled)return;
    this.clock+=dt;
    if(!this.current&&this.queue.length){const event=this.queue.shift();if(event.historical||Date.now()-Date.parse(event.createdAt)<45000)this.startExchange(event);}
    for(const r of this.records.values()){
      let mode=this.canRelax(r)?'idle':r.base?.mode||'idle';if(this.replaying)mode='idle';
      this.updateAmbient(r);
      if(r.route.length&&!r.destination)r.destination={...r.route.at(-1)};
      if(r.destination&&!r.route.length&&this.clock>=r.routeRetryAt)this.setDestination(r,r.destination);
      if(r.route.length){const position=r.actor.root.position,next=r.route[0],dist=distance(position,next),step=dt*(r.actor.modelMeta?.walkSpeed??(r.actor.assetMotion?1.2:2.5)),ready=r.actor.prepareWalk?.()??true;
        const candidate=dist<=step?next:{x:position.x+(next.x-position.x)/Math.max(dist,Number.EPSILON)*step,z:position.z+(next.z-position.z)/Math.max(dist,Number.EPSILON)*step};
        if(ready&&clearSegment(position,candidate,this.peerObstacles(r))){if(dist<=step){position.x=next.x;position.z=next.z;r.route.shift();}else{position.x=candidate.x;position.z=candidate.z;r.actor.targetRotation=Math.atan2(next.x-position.x,next.z-position.z);}r.blockedSince=null;if(!r.route.length)r.destination=null;}
        else if(ready){r.route=[];r.routeRetryAt=this.clock+.5;r.blockedSince??=this.clock;
          if(r.ambient?.phase==='walking'&&this.clock-r.blockedSince>8){r.ambient.phase='returning';r.destination=null;r.route=[];r.blockedSince=null;this.setDestination(r,r.actor.home);}
        }
        mode=r.blockedSince!==null?'waiting':'walking';
      }else if(r.destination)mode='waiting';
      else if(r.ambient?.phase==='resting')mode=r.ambient.activity.mode;
      else if(r.celebrateUntil>this.clock)mode='celebrating';
      r.actor.mode=mode;if(r.bubbleUntil<=this.clock)r.bubble='';
      const atHome=distance(r.actor.root.position,r.actor.home)<.08,inExchange=this.current&&!this.current.remote&&[this.current.mover,this.current.host].includes(r);
      if(atHome&&!r.route.length&&!inExchange)r.actor.targetRotation=r.actor.homeRotation??(r.key==='boss'?0:Math.PI);
      r.actor.wantsSeat=Boolean(r.actor.hasSeat)&&!r.route.length&&atHome&&!inExchange&&!['walking','stretching','celebrating'].includes(mode);
      this.updateDesk(r,r.actor.wantsSeat&&!r.ambient&&!r.destination&&!r.route.length&&!inExchange);
    }
    const c=this.current;
    if(c){
      if(c.phase==='approaching'&&c.mover.blockedSince!==null&&this.clock-c.mover.blockedSince>4){c.remote=true;c.phase='talking';c.until=this.clock+3.4;c.mover.route=[];c.mover.destination=null;c.mover.blockedSince=null;this.onChange();}
      if(c.phase==='approaching'&&!c.mover.route.length&&!c.mover.destination){c.phase='talking';c.until=this.clock+3.4;this.face(c.mover,c.host);this.face(c.host,c.mover);c.source.bubble=c.event.text;c.source.bubbleUntil=c.until;this.onChange();}
      if(c.phase==='talking'){c.source.actor.mode='talking';c.target.actor.mode='listening';if(this.clock>=c.until){this.setDestination(c.mover,c.mover.actor.home);c.host.actor.targetRotation=c.host.actor.homeRotation??(c.host.key==='boss'?0:Math.PI);if(c.remote)this.finishExchange();else{c.phase='returning';this.onChange();}}}
      if(this.current&&c.phase==='returning'&&(!c.mover.route.length&&!c.mover.destination||c.mover.blockedSince!==null&&this.clock-c.mover.blockedSince>4)){c.mover.actor.targetRotation=c.mover.actor.homeRotation??(c.mover.key==='boss'?0:Math.PI);this.finishExchange();}
    }else if(this.replaying&&!this.queue.length){this.replaying=false;this.onChange();}
  }
  record(id){return this.records.get(id);}
}
function routeLength(from,route){let length=0;for(const p of route){length+=distance(from,p);from=p;}return length;}

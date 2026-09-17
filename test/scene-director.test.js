import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Group,Mesh,Vector3} from 'three';
import {ROOM,WORKSTATIONS,WORK_ISLAND,LEISURE,OVERFLOW_HOMES,FURNITURE,extraHome} from '../src/room-layout.js';
import {SceneDirector,activityFor,findRoute,clearSegment,walkable,exchangeFrom,CHAIR_OBSTACLES,AMBIENT_CADENCE} from '../src/scene-director.js';

const agent=(id,role,status='running')=>({id,role,status,threadId:`thread-${id}`,phase:'executing',dependsOn:[]});
const mission=()=>({id:'m1',status:'running',coordinatorId:'boss-id',agents:[agent('boss-id','boss'),agent('worker-id','builder')],messages:[],events:[],requests:[]});
const FAST_AMBIENT={firstDelay:.8,interval:5,stagger:1.6,cooldown:0,maxConcurrent:9};
function fixture(options={ambient:FAST_AMBIENT}){const actor=(x,z)=>({home:new Vector3(x,.02,z),root:{position:new Vector3(x,.02,z)},targetRotation:0,mode:'idle'});const office={actors:{boss:actor(WORKSTATIONS[0].home.x,WORKSTATIONS[0].home.z),employee:actor(WORKSTATIONS[1].home.x,WORKSTATIONS[1].home.z)},effects:[],exchange(...args){this.effects.push(args);},clearExchanges(){this.effects=[];}};return {office,director:new SceneDirector(office,()=>{},options),bindings:new Map([['boss','boss-id'],['employee','worker-id']])};}
const advance=(director,seconds)=>{for(let i=0;i<seconds*60;i++)director.update(1/60);};

test('route crosses only walkable floor, avoiding both desks and furniture',()=>{const points=[...WORKSTATIONS.map(s=>s.home),...Object.values(LEISURE),...OVERFLOW_HOMES];for(const from of points)for(const to of points){const route=findRoute(from,to);assert.ok(route.length,JSON.stringify([from,to]));let previous=from;for(const step of route){assert.ok(walkable(step));assert.ok(clearSegment(previous,step));previous=step;}}});

test('four workstations keep valid homes when a fifth or later member appears',()=>{assert.equal(WORKSTATIONS.length,4);assert.equal(extraHome(0),WORKSTATIONS[2]);assert.equal(extraHome(1),WORKSTATIONS[3]);for(let index=2;index<8;index++){const home=extraHome(index);assert.ok(home&&Number.isFinite(home.x)&&Number.isFinite(home.z));assert.ok(walkable(home));assert.equal(home.home,undefined);}});

test('navigation respects the rotated sofa while leaving its side aisle clear',()=>{assert.equal(walkable({x:FURNITURE.sofa.x,z:FURNITURE.sofa.z+1.05}),false);assert.equal(walkable({x:FURNITURE.sofa.x-1.05,z:FURNITURE.sofa.z-.9}),true);});

test('chair footprints are solid while their assigned seat points remain walkable',()=>{
  for(const [index,station] of WORKSTATIONS.entries()){
    const chair=CHAIR_OBSTACLES[index];
    assert.equal(walkable({x:(chair[0]+chair[1])/2,z:(chair[2]+chair[3])/2}),false);
    assert.equal(walkable(station.home),true);
  }
});

test('dynamic peer footprints force a detour instead of crossing a person',()=>{
  const from={x:-2.4,z:3.15},to={x:2.4,z:3.15},peer=[[-.42,.42,2.72,3.58]];
  assert.equal(clearSegment(from,to,peer),false);
  const route=findRoute(from,to,peer);assert.ok(route.length);
  let previous=from;for(const step of route){assert.ok(clearSegment(previous,step,peer));previous=step;}
});

test('two oncoming walkers yield and both reach their destinations',()=>{
  for(const goals of [[{x:1.2,z:3.25},{x:-1.2,z:3.25}],[{x:2.5,z:3.25},{x:-2.5,z:3.25}]])for(const reversed of [false,true]){
    const starts=[{x:-2.5,z:3.25},{x:2.5,z:3.25}];
    const actors=Object.fromEntries(starts.map((p,i)=>[`p${i}`,{home:new Vector3(p.x,0,p.z),root:{position:new Vector3(p.x,0,p.z)},mode:'idle'}]));
    const director=new SceneDirector({actors},()=>{},{ambient:{firstDelay:1000}}),order=reversed?[1,0]:[0,1];
    director.sync({id:'head-on',status:'running',agents:order.map(i=>agent(`a${i}`,'builder')),messages:[],events:[],requests:[]},new Map(order.map(i=>[`p${i}`,`a${i}`])));
    for(const i of order)director.setDestination(director.record(`a${i}`),goals[i]);
    for(let frame=0;frame<20*60;frame++){
      director.update(1/60);
      const a=actors.p0.root.position,b=actors.p1.root.position;
      assert.ok(Math.max(Math.abs(a.x-b.x),Math.abs(a.z-b.z))>=.96-1e-6,'walkers entered each other’s reserved footprint');
    }
    for(const i of order){const p=actors[`p${i}`].root.position,r=director.record(`a${i}`);
      assert.ok(Math.hypot(p.x-goals[i].x,p.z-goals[i].z)<.05,JSON.stringify({reversed,actor:i,position:p.toArray(),destination:r.destination,blockedSince:r.blockedSince}));
      assert.equal(r.destination,null);
    }
  }
});

test('a stationary coworker is not pushed aside by an unreachable destination',()=>{
  const actors={moving:{home:new Vector3(-2.5,0,3.25),root:{position:new Vector3(-2.5,0,3.25)}},standing:{home:new Vector3(1.2,0,3.25),root:{position:new Vector3(1.2,0,3.25)}}};
  const director=new SceneDirector({actors},()=>{},{ambient:{firstDelay:1000}});
  director.sync({id:'occupied',status:'running',agents:[agent('a','builder'),agent('b','builder')],messages:[],events:[],requests:[]},new Map([['moving','a'],['standing','b']]));
  director.setDestination(director.record('a'),actors.standing.home);
  advance(director,12);
  assert.equal(director.record('b').yielding,null);
  assert.ok(actors.standing.root.position.equals(actors.standing.home));
  assert.ok(director.record('a').destination,'occupied goal must stay pending');
});

test('larger walking bodies can take turns without clipping a peer or the room edge',()=>{
  const starts=[-2.7,2.7],goals=[1.2,-1.2],actors={};
  starts.forEach((x,i)=>{const root=new Group(),body=new Mesh(new BoxGeometry(.8,1,.8));root.add(body);root.position.set(x,0,2.2);actors[`p${i}`]={home:root.position.clone(),root,body};});
  const director=new SceneDirector({actors},()=>{},{ambient:{firstDelay:1000}});
  director.sync({id:'large-walkers',status:'running',agents:[agent('a0','builder'),agent('a1','builder')],messages:[],events:[],requests:[]},new Map([['p0','a0'],['p1','a1']]));
  starts.forEach((_,i)=>director.setDestination(director.record(`a${i}`),{x:goals[i],z:2.2}));
  for(let frame=0;frame<20*60;frame++){
    director.update(1/60);
    const a=actors.p0.root.position,b=actors.p1.root.position;
    assert.ok(Math.max(Math.abs(a.x-b.x),Math.abs(a.z-b.z))>=1.37-1e-6,'larger bodies intersected');
    for(const p of [a,b])assert.ok(p.z<=ROOM.maxZ-.4&&p.z>=ROOM.minZ+.4,JSON.stringify({position:p.toArray(),yielding:director.record(p===a?'a0':'a1').yielding,route:director.record(p===a?'a0':'a1').route}));
  }
  for(let i=0;i<2;i++){const r=director.record(`a${i}`);assert.ok(Math.abs(actors[`p${i}`].root.position.x-goals[i])<.05,JSON.stringify({actor:i,positions:Object.values(actors).map(a=>a.root.position.toArray()),destination:r.destination,route:r.route,yielding:r.yielding,blockedSince:r.blockedSince}));}
});

test('an ambient return is not treated as complete at a temporary yielding spot',()=>{
  const starts=[-2.5,2.5],homes=[1.2,-1.2],actors={};
  homes.forEach((x,i)=>{actors[`p${i}`]={home:new Vector3(x,0,3.25),root:{position:new Vector3(x,0,3.25)}};});
  const director=new SceneDirector({actors},()=>{},{ambient:{firstDelay:1000}});
  director.sync({id:'returns',status:'stopped',agents:[agent('a0','builder','stopped'),agent('a1','builder','stopped')],messages:[],events:[],requests:[]},new Map([['p0','a0'],['p1','a1']]));
  starts.forEach((x,i)=>{actors[`p${i}`].root.position.set(x,0,3.25);const r=director.record(`a${i}`);r.ambient={activity:{mode:'gazing'},phase:'returning'};r.destination={x:homes[i],z:3.25};r.route=[r.destination];});
  let parked=false,yielded=false;
  for(let frame=0;frame<20*60;frame++){
    director.update(1/60);
    const r=director.record('a1');if(r.yielding){yielded=true;assert.equal(r.ambient?.phase,'returning');}if(r.yielding&&!r.route.length&&!r.destination)parked=true;
  }
  assert.ok(parked,JSON.stringify({yielded,positions:Object.values(actors).map(a=>a.root.position.toArray()),records:[director.record('a0'),director.record('a1')].map(r=>({route:r.route,destination:r.destination,blockedSince:r.blockedSince,ambient:r.ambient}))}));
  for(let i=0;i<2;i++){assert.ok(actors[`p${i}`].root.position.distanceTo(actors[`p${i}`].home)<.05);assert.equal(director.record(`a${i}`).ambient,null);}
});

test('facing workstations keep routes outside the shared bench, glass and storage',()=>{assert.equal(WORKSTATIONS[0].facing,0);assert.equal(WORKSTATIONS[1].facing,Math.PI);assert.equal(WORKSTATIONS[2].facing,0);assert.equal(WORKSTATIONS[3].facing,Math.PI);assert.equal(walkable(WORK_ISLAND),false);assert.equal(walkable(FURNITURE.partition),false);assert.equal(walkable(FURNITURE.storage),false);});

test('default office staggers short outings and permits only one at a time',()=>{
  const {director,office,bindings}=fixture({}),m=mission();m.status='stopped';const original=JSON.stringify(m);director.sync(m,bindings);advance(director,AMBIENT_CADENCE.firstDelay-1);
  assert.ok([...director.records.values()].every(r=>!r.ambient&&r.actor.mode==='idle'));
  const starts=[];let previous=null;
  for(let frame=0;frame<360*60;frame++){director.update(1/60);const active=[...director.records.values()].filter(r=>r.ambient);assert.ok(active.length<=1);const id=active[0]?.id;if(id&&!previous)starts.push(director.clock);previous=id;}
  assert.ok(starts.length>=2);assert.ok(starts[0]>=AMBIENT_CADENCE.firstDelay);for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=AMBIENT_CADENCE.cooldown);assert.equal(JSON.stringify(m),original);assert.equal(office.effects.length,0);
});

test('idle coworkers rest at their seats and pause freezes their independent routines',()=>{
  const {director,office,bindings}=fixture({}),m=mission();m.status='stopped';
  for(const actor of Object.values(office.actors))actor.hasSeat=true;
  const original=JSON.stringify(m);director.sync(m,bindings);advance(director,2);
  assert.equal(office.actors.boss.deskTyping,false);assert.equal(office.actors.employee.deskTyping,false);assert.equal(office.actors.boss.mode,'idle');assert.equal(office.actors.boss.deskActivity,'resting');assert.notEqual(director.record('boss-id').desk.until,director.record('worker-id').desk.until);
  director.setEnabled(false);advance(director,20);assert.equal(office.actors.boss.deskTyping,false);assert.ok(director.clock<2.1);
  director.setEnabled(true);advance(director,10);assert.equal(office.actors.boss.deskTyping,false);assert.equal(office.actors.employee.deskTyping,false);
  m.requests=[{agentId:'worker-id',kind:'question',status:'pending'}];director.sync(m,bindings);advance(director,.1);assert.equal(office.actors.employee.deskTyping,false);
  m.requests=[];assert.equal(JSON.stringify(m),original);assert.equal(office.effects.length,0);
});

test('stopping a replay starts a fresh quiet interval instead of immediately wandering',()=>{
  const {director,bindings}=fixture({}),m=mission();m.status='stopped';m.messages=[{id:'history',kind:'collaboration',agentId:'worker-id',to:'boss-id',text:'Saved result',createdAt:'2026-09-01T00:00:00Z'}];director.sync(m,bindings);advance(director,130);director.replay();advance(director,1);director.stopReplay();advance(director,AMBIENT_CADENCE.firstDelay-1);assert.ok([...director.records.values()].every(r=>!r.ambient&&r.actor.mode==='idle'));
});

test('actual execution, review, permission, stop, and disconnect map to different states',()=>{const m=mission(),a=m.agents[1];assert.equal(activityFor(a,m).mode,'working');m.events=[{agentId:a.id,kind:'commandExecution',status:'inProgress',text:'npm test'}];assert.equal(activityFor(a,m).label,'执行命令');a.role='reviewer';assert.equal(activityFor(a,m).mode,'reading');m.requests=[{agentId:a.id,status:'pending',kind:'command'}];assert.equal(activityFor(a,m).label,'等待授权');m.status='stopped';assert.equal(activityFor(a,m).mode,'paused');assert.equal(activityFor(a,m,false).label,'连接中断');});

test('head labels distinguish idle, queued, working, waiting, completion and interruption',()=>{
  const m=mission(),a=m.agents[0];
  for(const [status,label] of [['idle','待命'],['queued','排队中'],['starting','准备中'],['running','专注执行'],['waiting','等待回复'],['completed','已完成'],['failed','遇到问题'],['interrupted','已中断'],['stopped','已停止']]){a.status=status;assert.equal(activityFor(a,m).label,label);}
  a.status='running';m.requests=[{agentId:a.id,status:'pending',kind:'question'}];assert.equal(activityFor(a,m).label,'等你答复');m.requests=[];
  m.events=[{agentId:a.id,kind:'dynamicToolCall',status:'inProgress',text:'office_team'}];assert.equal(activityFor(a,m).label,'等待团队');
  m.events=[{agentId:a.id,kind:'fileChange',status:'inProgress',text:'edit'}];assert.equal(activityFor(a,m).label,'修改文件');
  m.status='stopping';assert.equal(activityFor(a,m).label,'停止中');a.status='completed';assert.equal(activityFor(a,m).label,'已完成');
  a.sceneOnly=true;assert.equal(activityFor(a,m,false).label,'待命');
});

test('live head status updates while animation is paused and ignores ambient or replay motion',()=>{
  const {director,bindings}=fixture(),m=mission();m.status='stopped';m.agents.forEach(a=>a.status='stopped');director.sync(m,bindings);advance(director,2);
  assert.ok(director.record('boss-id').ambient);assert.equal(director.record('boss-id').base.label,'已停止');
  director.setEnabled(false);m.status='running';m.agents[0].status='running';m.events=[{agentId:'boss-id',kind:'commandExecution',status:'inProgress',text:'npm test'}];director.sync(m,bindings);
  assert.equal(director.record('boss-id').base.label,'执行命令');m.requests=[{agentId:'boss-id',kind:'question',status:'pending'}];director.sync(m,bindings);assert.equal(director.record('boss-id').base.label,'等你答复');
});

test('existing history is not presented as a new exchange after attach or reconnect',()=>{const {director,office,bindings}=fixture(),m=mission();m.messages=[{id:'old',kind:'delegation',agentId:'boss-id',to:'worker-id',text:'Existing task',createdAt:new Date().toISOString()}];director.sync(m,bindings);advance(director,1);assert.equal(office.effects.length,0);director.sync(structuredClone(m),bindings);advance(director,1);assert.equal(office.effects.length,0);});

test('a real new delegation walks toward the right session, exchanges once, and returns home',()=>{const {director,office,bindings}=fixture(),m=mission();director.sync(m,bindings);m.messages.push({id:'new',kind:'delegation',agentId:'boss-id',to:'worker-id',text:'Create a guide',createdAt:new Date().toISOString()});director.sync(structuredClone(m),bindings);advance(director,.5);assert.equal(office.effects.length,1);assert.equal(office.actors.employee.mode,'walking');assert.ok(office.actors.employee.root.position.distanceTo(office.actors.employee.home)>.1);director.sync(structuredClone(m),bindings);advance(director,16);assert.equal(office.effects.length,1);assert.ok(office.actors.employee.root.position.distanceTo(office.actors.employee.home)<.001);assert.equal(director.current,null);});

test('stop cancels work exchanges while people can relax without changing task state',()=>{const {director,office,bindings}=fixture(),m=mission();director.sync(m,bindings);m.messages.push({id:'new',kind:'collaboration',agentId:'worker-id',to:'boss-id',text:'An update',createdAt:new Date().toISOString()});director.sync(structuredClone(m),bindings);advance(director,.3);m.status='stopped';director.sync(structuredClone(m),bindings);const original=JSON.stringify(m);advance(director,.1);assert.equal(director.queue.length,0);assert.equal(director.current,null);assert.equal(office.actors.employee.mode,'idle');advance(director,12);assert.ok(director.record('worker-id').ambient);assert.equal(JSON.stringify(m),original);director.sync(structuredClone(m),bindings,false);assert.equal(director.current,null);assert.equal(director.queue.length,0);});

test('historical replay is explicit, preserves server state, and can be cancelled',()=>{const {director,office,bindings}=fixture(),m=mission();m.status='stopped';m.agents.forEach(a=>a.status='stopped');m.messages=[{id:'history',kind:'collaboration',agentId:'worker-id',to:'boss-id',text:'Saved message',createdAt:'2026-09-01T00:00:00Z'}];const original=JSON.stringify(m);director.sync(m,bindings);assert.equal(director.replay(),true);advance(director,.5);assert.equal(director.replaying,true);assert.equal(director.current.event.historical,true);assert.equal(JSON.stringify(m),original);assert.equal(office.effects.length,1);director.stopReplay();advance(director,1);assert.equal(director.replaying,false);assert.equal(office.actors.employee.mode,'idle');});

test('animation pause does not pause or mutate the model task',()=>{const {director,office,bindings}=fixture(),m=mission();director.sync(m,bindings);director.setEnabled(false);const original=JSON.stringify(m),position=office.actors.employee.root.position.clone();advance(director,4);assert.equal(JSON.stringify(m),original);assert.ok(position.equals(office.actors.employee.root.position));assert.equal(director.clock,0);});

test('only real linked messages and finished member reports produce exchanges',()=>{const m=mission();assert.equal(exchangeFrom({kind:'assistant',phase:'commentary',agentId:'worker-id',text:'Thinking'},m),null);assert.equal(exchangeFrom({kind:'collaboration',agentId:'worker-id',to:'unrelated-session',text:'x'},m),null);assert.equal(exchangeFrom({kind:'assistant',phase:'final_answer',agentId:'worker-id',text:'Done',streaming:false},m).to,'boss-id');});

test('resuming real work cancels historical replay before showing live status',()=>{const {director,bindings}=fixture(),m=mission();m.status='stopped';m.messages=[{id:'history',kind:'collaboration',agentId:'worker-id',to:'boss-id',text:'Saved message',createdAt:'2026-09-01T00:00:00Z'}];director.sync(m,bindings);director.replay();advance(director,.5);const resumed=structuredClone(m);resumed.status='running';director.sync(resumed,bindings);assert.equal(director.replaying,false);assert.equal(director.current,null);assert.equal(director.queue.length,0);});

test('permission request interrupts social motion and exposes the waiting state',()=>{const {director,office,bindings}=fixture(),m=mission();director.sync(m,bindings);m.messages=[{id:'new',kind:'collaboration',agentId:'worker-id',to:'boss-id',text:'Working',createdAt:new Date().toISOString()}];director.sync(structuredClone(m),bindings);advance(director,.4);m.requests=[{agentId:'worker-id',kind:'command',status:'pending'}];director.sync(structuredClone(m),bindings);advance(director,.1);assert.equal(director.current,null);assert.equal(office.actors.employee.mode,'waiting');});

test('without any messages people stroll, sip coffee and return, with no agent calls',()=>{const {director,office,bindings}=fixture(),m=mission();m.status='stopped';m.agents.forEach(a=>a.status='stopped');director.sync(m,bindings);const original=JSON.stringify(m),poses=new Set();for(let i=0;i<45*60;i++){director.update(1/60);poses.add(office.actors.boss.mode);if(i%30===0)director.sync(structuredClone(m),bindings);}assert.ok(poses.has('walking'));assert.ok(poses.has('gazing'));assert.ok(poses.has('idle'));assert.equal(office.effects.length,0);assert.equal(JSON.stringify(m),original);});

test('real work takes priority over coffee and sends the person back to work',()=>{const {director,office,bindings}=fixture(),m=mission();m.status='stopped';m.agents.forEach(a=>a.status='stopped');director.sync(m,bindings);advance(director,8);assert.ok(director.record('worker-id').ambient);const working=structuredClone(m);working.status='running';working.agents.forEach(a=>a.status='running');director.sync(working,bindings);assert.equal(director.record('worker-id').ambient,null);advance(director,15);assert.equal(office.actors.employee.mode,'working');assert.ok(office.actors.employee.root.position.distanceTo(office.actors.employee.home)<.001);});

test('pausing freezes an ambient walk and its current pose',()=>{const {director,office,bindings}=fixture(),m=mission();m.status='stopped';director.sync(m,bindings);advance(director,2);const r=director.record('boss-id');assert.ok(r.ambient);director.setEnabled(false);const point=office.actors.boss.root.position.clone(),mode=office.actors.boss.mode,clock=director.clock;advance(director,10);assert.ok(office.actors.boss.root.position.equals(point));assert.equal(office.actors.boss.mode,mode);assert.equal(director.clock,clock);});


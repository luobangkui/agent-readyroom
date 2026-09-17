import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {SceneDirector} from '../src/scene-director.js';
import {WORKSTATIONS,LEISURE} from '../src/room-layout.js';
import {createCharacter} from '../src/themes/character.js';
import {getTheme} from '../src/themes/index.js';
import {primitives} from '../src/office.js';
import {updateCharacterPose} from '../src/character-motion.js';
import {OFFICE_AVATARS} from '../src/assets/avatar-catalog.js';
import {actorEnvelope} from '../src/actor-clearance.js';

const assets=new Map(),motions=new Map();
const local=url=>new URL('../public'+new URL(url,'http://office.test').pathname,import.meta.url);
async function loader(url){
  if(!assets.has(url))assets.set(url,(async()=>{const bytes=await readFile(local(url));return new GLTFLoader().register(()=>({name:'route-test-texture',loadTexture:()=>Promise.resolve(new THREE.Texture())})).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');})());
  return assets.get(url);
}
async function motionLoader(url){if(!motions.has(url))motions.set(url,readFile(local(url),'utf8').then(JSON.parse));return motions.get(url);}
async function resident(t,id,index,avatar,seated){
  const station=WORKSTATIONS[index],actor=createCharacter(new THREE.Group(),id,station.home.x,station.home.z,primitives,getTheme('konoha'),{loader,motionLoader});
  Object.assign(actor,{stationId:station.id,hasSeat:true,wantsSeat:seated,homeRotation:station.facing,targetRotation:station.facing,mode:seated?'working':'walking'});actor.root.rotation.y=station.facing;actor.setAvatar(avatar);await actor.modelReady;
  updateCharacterPose(actor,0,0);actor.root.updateMatrixWorld(true);t.after(()=>actor.disposeAppearance());return actor;
}
function visibleBounds(actor){
  actor.root.updateMatrixWorld(true);const bounds=new THREE.Box3(),vertex=new THREE.Vector3();
  actor.modelRoot.traverse(mesh=>{if(!mesh.isMesh)return;for(let node=mesh;node;node=node.parent)if(node.visible===false)return;mesh.skeleton?.update();for(let i=0;i<mesh.geometry.attributes.position.count;i++)bounds.expandByPoint(mesh.getVertexPosition(i,vertex).applyMatrix4(mesh.matrixWorld));});
  return bounds;
}
function firstIntrusion(from,route,box){
  for(const to of route){const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.02));for(let i=0;i<=steps;i++){const p={x:from.x+(to.x-from.x)*i/steps,z:from.z+(to.z-from.z)*i/steps};if(p.x>box.min.x&&p.x<box.max.x&&p.z>box.min.z&&p.z<box.max.z)return p;}from=to;}
  return null;
}
test('a walk to coffee keeps the moving body out of the visible seated coworker envelope',async t=>{
  const mover=await resident(t,'boss',0,'tsunade-custom',false),peer=await resident(t,'peer',2,'student',true);
  const office={actors:{boss:mover,peer}},director=new SceneDirector(office),m={id:'clearance',status:'idle',agents:[{id:'moving',role:'boss',status:'idle'},{id:'seated',role:'tech',status:'idle'}],messages:[],events:[],requests:[]};
  director.sync(m,new Map([['boss','moving'],['peer','seated']]));
  const moving=visibleBounds(mover),occupied=visibleBounds(peer),radius=(moving.max.x-moving.min.x)/2;
  // The root is not a point: include the walking body's half-width and a
  // small visible gap around the seated person's actual rendered envelope.
  occupied.expandByVector(new THREE.Vector3(radius+.08,0,radius+.08));
  const route=director.routeFor(director.record('moving'),mover.home,LEISURE.coffee);
  assert.ok(route.length,'expected a usable route around the seated colleague');
  const intrusion=firstIntrusion(mover.home,route,occupied);
  assert.equal(intrusion,null,`route enters occupied seat/body envelope: ${JSON.stringify({intrusion,route,radius,seat:[occupied.min.toArray(),occupied.max.toArray()]})}`);
});

function simpleScene(points,ambient={firstDelay:1000}){
  const actors=Object.fromEntries(points.map((p,i)=>[`p${i}`,{root:{position:new THREE.Vector3(p.x,0,p.z)},home:new THREE.Vector3(p.x,0,p.z),homeRotation:0,mode:'idle'}]));
  const director=new SceneDirector({actors},()=>{},{ambient}),m={id:'simple',status:'stopped',agents:points.map((_,i)=>({id:`a${i}`,role:i?'builder':'boss',status:'stopped'})),messages:[],requests:[],events:[]};
  director.sync(m,new Map(points.map((_,i)=>[`p${i}`,`a${i}`])));return {director,actors,m};
}
test('a stale route cannot jump through a peer even when one update takes a large step',()=>{
  const {director,actors}=simpleScene([{x:-1.6,z:3.25},{x:0,z:3.25}]);director.record('a0').route=[{x:1.6,z:3.25}];director.update(2);
  assert.ok(actors.p0.root.position.x<-.9,'crossed the occupied region because only the endpoint was checked');
});
test('an occupied leisure destination does not turn a failed route into a fake arrival',()=>{
  const {director,actors}=simpleScene([WORKSTATIONS[0].home,LEISURE.coffee],{firstDelay:0,stagger:100,interval:10,maxConcurrent:1});
  director.update(.1);assert.notEqual(actors.p0.mode,'coffee','must not drink at the desk when the coffee destination is occupied');
});

test('all eight seated avatars in both desk rows get body-sized clearance',async t=>{
  const mover=await resident(t,'moving',0,'tsunade-custom',false),radius=actorEnvelope(mover).radius;
  for(const row of [0,1])for(const avatar of OFFICE_AVATARS){
    const peer=await resident(t,`peer-${row}-${avatar.id}`,row+2,avatar.id,true),station=WORKSTATIONS[row];
    mover.home.set(station.home.x,.02,station.home.z);mover.root.position.copy(mover.home);mover.homeRotation=mover.targetRotation=mover.root.rotation.y=station.facing;
    const director=new SceneDirector({actors:{moving:mover,peer}}),m={id:avatar.id,status:'idle',agents:[{id:'a',role:'boss',status:'idle'},{id:'b',role:'tech',status:'idle'}],messages:[],events:[],requests:[]};director.sync(m,new Map([['moving','a'],['peer','b']]));
    const occupied=visibleBounds(peer).expandByVector(new THREE.Vector3(radius+.02,0,radius+.02)),goal=row?LEISURE.reading:LEISURE.coffee,route=director.routeFor(director.record('a'),mover.home,goal);
    assert.ok(route.length,`${avatar.id}, row ${row}: no route`);assert.equal(firstIntrusion(mover.home,route,occupied),null,`${avatar.id}, row ${row}: entered seated geometry`);
  }
});

test('real four-person walks and returns stay outside every other occupied seat',async t=>{
  const actors={},agents=[],bindings=new Map();
  for(const [index,avatar] of ['tsunade-custom','student','archer','ninja'].entries()){const key=`p${index}`;actors[key]=await resident(t,key,index,avatar,true);agents.push({id:key,role:index?'builder':'boss',status:'running'});bindings.set(key,key);}
  const director=new SceneDirector({actors}),m={id:'four',status:'running',agents,messages:[],events:[],requests:[]};director.sync(m,bindings);const original=JSON.stringify(m);
  const mover=actors.p0,record=director.record('p0'),radius=actorEnvelope(mover).radius,occupied=Object.values(actors).slice(1).map(a=>visibleBounds(a).expandByVector(new THREE.Vector3(radius,0,radius)));
  const advance=seconds=>{for(let frame=0;frame<seconds*60;frame++){const from={x:mover.root.position.x,z:mover.root.position.z};director.update(1/60);Object.values(actors).forEach(a=>updateCharacterPose(a,1/60,director.clock));for(const box of occupied)assert.equal(firstIntrusion(from,[mover.root.position],box),null,'walk entered another seated body');}};
  director.setDestination(record,LEISURE.coffee);advance(24);assert.ok(mover.root.position.distanceTo(new THREE.Vector3(LEISURE.coffee.x,.02,LEISURE.coffee.z))<.05,JSON.stringify({position:mover.root.position,route:record.route,destination:record.destination,blocked:record.blockedSince,state:mover.assetMotion.state}));
  director.setDestination(record,mover.home);advance(24);assert.ok(mover.root.position.distanceTo(mover.home)<.05);assert.equal(record.destination,null);assert.equal(JSON.stringify(m),original);
});

test('a blocked return keeps its destination and resumes only when the seat clears',()=>{
  const {director,actors}=simpleScene([WORKSTATIONS[0].home,{x:4,z:3.25}]),record=director.record('a0');actors.p0.root.position.set(LEISURE.coffee.x,0,LEISURE.coffee.z);actors.p1.root.position.copy(actors.p0.home);
  director.setDestination(record,actors.p0.home);director.update(.1);assert.ok(record.destination);assert.equal(actors.p0.mode,'waiting');
  actors.p1.root.position.set(4,0,3.25);for(let i=0;i<25*60;i++)director.update(1/60);
  assert.equal(record.destination,null);assert.ok(actors.p0.root.position.distanceTo(actors.p0.home)<.05);
});

test('body measurements remain local after moving and rotating an animated model',async t=>{
  const actor=await resident(t,'body',0,'tsunade-custom',false),first=actorEnvelope(actor);
  actor.root.position.set(5,.02,4);actor.root.rotation.y=Math.PI/2;actor.assetMotion.play('idle',0);actor.assetMotion.mixer.update(0);
  const second=actorEnvelope(actor);assert.ok(Math.max(Math.abs(second.minX),Math.abs(second.maxX),Math.abs(second.minZ),Math.abs(second.maxZ))<1.5);assert.ok(second.radius<1.5);assert.ok(first.radius<1.5);
});

test('an unreachable meeting stays in place instead of forcing a walk through occupied seats',()=>{
  const {director,actors}=simpleScene([WORKSTATIONS[0].home,WORKSTATIONS[1].home]);for(const actor of Object.values(actors))actor.hasSeat=actor.wantsSeat=true;
  director.routeFor=()=>[];director.startExchange({id:'blocked-meet',from:'a0',to:'a1',kind:'delegation',text:'协作消息'});
  assert.equal(director.current.remote,true);director.update(.1);assert.equal(actors.p0.wantsSeat,true);assert.equal(actors.p1.wantsSeat,true);
  director.update(4);assert.equal(director.current,null);for(const actor of Object.values(actors))assert.ok(actor.root.position.equals(actor.home));
});

test('walking bodies clear furniture corners along the whole route',()=>{
  const {director,actors}=simpleScene([LEISURE.window]);
  const route=director.routeFor(director.record('a0'),actors.p0.home,LEISURE.reading);
  assert.ok(route.length);
  // The work island is 5.58 x 2.58; reserve a whole body, not only its root.
  const radius=actorEnvelope(actors.p0).radius,box=new THREE.Box3(new THREE.Vector3(-1.69-2.79-radius,0,-1.29-radius),new THREE.Vector3(-1.69+2.79+radius,3,1.29+radius));
  assert.equal(firstIntrusion(actors.p0.home,route,box),null,'walking body clips the work island corner');
});

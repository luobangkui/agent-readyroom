import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createRiggedModel} from '../src/assets/rigged-model.js';
import {loadOfficeModel} from '../src/assets/office-model.js';
import {officeAvatar} from '../src/assets/avatar-catalog.js';
import {createCharacter} from '../src/themes/character.js';
import {getTheme} from '../src/themes/index.js';
import {primitives} from '../src/office.js';
import {DESK_ERGONOMICS as D} from '../src/desk-ergonomics.js';
import {SceneDirector} from '../src/scene-director.js';
import {WORKSTATIONS,LEISURE} from '../src/room-layout.js';

const root=new URL('../public/',import.meta.url);
const item=officeAvatar('mizukage-custom');
const path=url=>new URL(url.replace(/^\//,''),root);
const loader=async url=>{const bytes=await readFile(path(url));return new GLTFLoader().register(()=>({name:'node-texture-placeholder',loadTexture:()=>Promise.resolve(new THREE.Texture())})).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
const step=(motion,seconds)=>{for(let i=0;i<Math.ceil(seconds*60);i++)motion.update(1/60);};

 test('Mizukage is the supplied 41-bone GLB with walk, sit and agree animations',async()=>{
  const bytes=await readFile(path(item.url)),manifest=JSON.parse(await readFile(new URL('../public/assets/characters/custom/mizukage-custom-manifest.json',import.meta.url),'utf8'));
  const gltf=await loader(item.url);let mesh;gltf.scene.traverse(node=>{if(node.isSkinnedMesh)mesh=node;});
  assert.ok(mesh,'Mizukage output must contain a skinned mesh');
  assert.equal(mesh.skeleton.bones.length,41);
  assert.equal(manifest.bytes,bytes.length);
  assert.equal(manifest.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(item.modelRevision,manifest.sha256.slice(0,12));
  assert.equal(item.motionURL,null);
  assert.equal(item.officeMeta.scale,3);
  assert.deepEqual(gltf.animations.map(clip=>clip.name),['preset:biped:sit','preset:biped:walk','preset:biped:agree']);
  for(const clip of gltf.animations){assert.ok(clip.tracks.length>0,`${clip.name} must have keyframes`);assert.ok(clip.duration>0);}
 });

 test('Mizukage maps only sitting, walking and agree while keeping walk in place',async()=>{
  const gltf=await loadOfficeModel(item,{loader}),walk=gltf.animations.find(clip=>clip.name==='preset:biped:walk'),hip=walk.tracks.find(track=>track.name==='Hip.position');
  const stride=hip.getValueSize(),forward=[];for(let i=1;i<hip.values.length;i+=stride)forward.push(hip.values[i]);
  assert.ok(forward.every(value=>value===forward[0]),'walk root translation must be removed before office pathing');
  const model=createRiggedModel(gltf);
  try{
   assert.ok(model.motion.request('sitting'));step(model.motion,.9);assert.equal(model.motion.state,'sitting');
   assert.equal(model.motion.request('typing'),false);
   assert.ok(model.motion.request('agree'));step(model.motion,.9);assert.equal(model.motion.state,'agree');
   assert.ok(model.motion.request('walking'));step(model.motion,.3);assert.equal(model.motion.state,'walking');assert.equal(model.motion.canMove,true);
  }finally{model.dispose();}
 });

test('Mizukage seated hips make contact with the office chair instead of floating in front of it',async t=>{
  const actor=createCharacter(new THREE.Group(),'boss',0,0,primitives,getTheme('styloo'),{loader});t.after(()=>actor.disposeAppearance());
  actor.hasSeat=actor.wantsSeat=true;actor.mode='idle';actor.setAvatar('mizukage-custom');await actor.modelReady;
  for(let i=0;i<30;i++)actor.updateAssetPose(1/60);
  const seatTop=.645*(actor.modelMeta.chairScaleY??1),chairCenterZ=D.chairZ;
  const contact=[];
  for(let frame=0;frame<=60;frame++){
    actor.assetMotion.mixer.setTime(actor.assetMotion.action.getClip().duration*frame/60);actor.root.updateMatrixWorld(true);
    const hip=actor.modelRoot.getObjectByName('Hip').getWorldPosition(new THREE.Vector3());contact.push({hipY:hip.y,hipZ:hip.z});
  }
  const maxY=Math.max(...contact.map(hip=>Math.abs(hip.hipY-seatTop))),maxZ=Math.max(...contact.map(hip=>Math.abs(hip.hipZ-chairCenterZ)));
  assert.ok(maxY<.08&&maxZ<.28,`Mizukage misses the chair: ${JSON.stringify({maxY,maxZ,seatTop,chairCenterZ})}`);
});

test('Mizukage office movement keeps the authored walking pace',async()=>{
  const source=await loader(item.url),walk=source.animations.find(clip=>clip.name==='preset:biped:walk');
  const hip=walk.tracks.find(track=>track.name==='Hip.position'),stride=hip.getValueSize();
  const distance=Math.abs(hip.values.at(-stride+1)-hip.values[1])*item.officeMeta.scale;
  const duration=hip.times.at(-1)-hip.times[0],authoredSpeed=distance/duration;
  assert.ok(Math.abs(item.officeMeta.walkSpeed-authoredSpeed)/authoredSpeed<.08,`walk speed ${item.officeMeta.walkSpeed} does not match authored ${authoredSpeed}`);
});

test('Mizukage leaves the chair before translating across the office',async()=>{
  const gltf=await loadOfficeModel(item,{loader}),model=createRiggedModel(gltf);
  try{
    model.motion.request('sitting');step(model.motion,.9);model.motion.request('walking');model.motion.update(1/60);
    assert.equal(model.motion.canMove,false,'Mizukage starts translating while still blended with the seated pose');
    step(model.motion,.8);assert.equal(model.motion.canMove,true,'Mizukage never starts walking after clearing the chair');
  }finally{model.dispose();}
});

test('Mizukage follows an office route with a visible walk after the stand-up transition',async t=>{
  const station=WORKSTATIONS[0],actor=createCharacter(new THREE.Group(),'boss',station.home.x,station.home.z,primitives,getTheme('konoha'),{loader});t.after(()=>actor.disposeAppearance());
  actor.hasSeat=actor.wantsSeat=true;actor.homeRotation=actor.targetRotation=actor.root.rotation.y=station.facing;actor.mode='idle';actor.setAvatar('mizukage-custom');await actor.modelReady;
  for(let i=0;i<60;i++)actor.updateAssetPose(1/60);
  const director=new SceneDirector({actors:{boss:actor}}),mission={id:'mizukage-walk',status:'running',agents:[{id:'mizukage',role:'boss',status:'running'}],messages:[],events:[],requests:[]};
  director.sync(mission,new Map([['boss','mizukage']]));const record=director.record('mizukage'),start=actor.root.position.clone();
  director.setDestination(record,LEISURE.coffee);assert.ok(record.route.length,'expected a real route to the coffee area');
  for(let frame=0;frame<40;frame++){director.update(1/60);actor.updateAssetPose(1/60);assert.ok(actor.root.position.distanceTo(start)<1e-6,'actor moved before clearing the chair');}
  for(let frame=0;frame<80;frame++){director.update(1/60);actor.updateAssetPose(1/60);}
  assert.equal(actor.assetMotion.state,'walking');assert.ok(actor.root.position.distanceTo(start)>1.5,'actor did not make visible walking progress');
});

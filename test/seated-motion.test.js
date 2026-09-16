import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {primitives} from '../src/office.js';
import {createCharacter} from '../src/themes/character.js';
import {getTheme} from '../src/themes/index.js';
import {updateCharacterPose} from '../src/character-motion.js';
import {SceneDirector} from '../src/scene-director.js';
import {WORKSTATIONS} from '../src/room-layout.js';

async function assetLoader(url){const bytes=await readFile(new URL(`../public${url}`,import.meta.url));return new GLTFLoader().register(()=>({name:'node-textures',loadTexture:()=>Promise.resolve(new THREE.Texture())})).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
const motionLoader=async url=>JSON.parse(await readFile(new URL(`../public${url}`,import.meta.url),'utf8'));
const assetOptions={loader:assetLoader,motionLoader};

test('an office actor working at an assigned chair uses the real seated skeleton',async()=>{
  const actor=createCharacter(new THREE.Group(),'employee',0,2.8,primitives,getTheme('konoha'),assetOptions);actor.setAvatar('naruto');actor.hasSeat=true;actor.wantsSeat=true;actor.mode='working';await actor.modelReady;
  for(let frame=0;frame<120;frame++)updateCharacterPose(actor,1/60,frame/60);
  assert.equal(actor.assetMotion.state,'typing');assert.equal(actor.body.visible,false);actor.root.updateMatrixWorld(true);
  const hip=actor.modelRoot.getObjectByName('LeftUpperLeg').getWorldPosition(new THREE.Vector3()),knee=actor.modelRoot.getObjectByName('LeftLowerLeg').getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(hip.y-knee.y)<.04,'thigh must be horizontal instead of hanging down');
  const saved=actor.root.position.clone();actor.setTheme(getTheme('cozy'));assert.equal(actor.assetMotion,null);assert.equal(actor.body.visible,true);actor.setTheme(getTheme('konoha'));assert.equal(actor.assetMotion.state,'typing');assert.ok(actor.root.position.equals(saved));
  actor.disposeAppearance();
});

test('switching away while a model loads cannot attach a stale theme or remove the fallback',async()=>{
  const gltf=await assetLoader('/assets/characters/custom/naruto_chibi_custom.glb');let finish;const actor=createCharacter(new THREE.Group(),'employee',0,2.8,primitives,getTheme('konoha'),{loader:()=>new Promise(resolve=>{finish=resolve;}),motionLoader});
  const pending=actor.modelReady;actor.setTheme(getTheme('cozy'));finish(gltf);await pending;assert.equal(actor.body.visible,true);assert.equal(actor.assetMotion,null);actor.disposeAppearance();
});

test('real session exchange stands before moving, returns to its chair and sits again',async()=>{
  const actors=Object.fromEntries(['boss','employee'].map((key,index)=>{const station=WORKSTATIONS[index];const actor=createCharacter(new THREE.Group(),key,station.home.x,station.home.z,primitives,getTheme('konoha'),assetOptions);actor.hasSeat=actor.wantsSeat=true;actor.homeRotation=station.facing;return [key,actor];}));
  await Promise.all(Object.values(actors).map(actor=>actor.modelReady));
  const director=new SceneDirector({actors}),mission={id:'test',status:'running',coordinatorId:'boss-session',agents:[{id:'boss-session',role:'boss',status:'running'},{id:'worker-session',role:'builder',status:'running'}],messages:[],requests:[],events:[]},bindings=new Map([['boss','boss-session'],['employee','worker-session']]);
  director.sync(mission,bindings);let time=0;const advance=seconds=>{for(let i=0;i<seconds*60;i++){time+=1/60;director.update(1/60);Object.values(actors).forEach(actor=>updateCharacterPose(actor,1/60,time));}};advance(1);
  mission.messages.push({id:'exchange',kind:'delegation',agentId:'boss-session',to:'worker-session',text:'Check this',createdAt:new Date().toISOString()});director.sync(structuredClone(mission),bindings);
  for(let frame=0;frame<120&&actors.employee.assetMotion.state!=='standUp';frame++)advance(1/60);
  assert.equal(actors.employee.assetMotion.state,'standUp');assert.ok(actors.employee.root.position.distanceTo(actors.employee.home)<.001);
  advance(actors.employee.assetMotion.action.getClip().duration+.5);assert.ok(actors.employee.root.position.distanceTo(actors.employee.home)>.1);
  advance(35);assert.equal(director.current,null);assert.ok(actors.employee.root.position.distanceTo(actors.employee.home)<.001);assert.equal(actors.employee.assetMotion.state,'typing');assert.equal(actors.employee.targetRotation,actors.employee.homeRotation);
  Object.values(actors).forEach(actor=>actor.disposeAppearance());
});

test('session avatar identity selects the matching Naruto GLB regardless of workflow role',async()=>{
  const actor=createCharacter(new THREE.Group(),'employee',0,2.8,primitives,getTheme('konoha'),assetOptions);await actor.modelReady;actor.setAvatar('hiruzen');actor.setRole('reviewer');await actor.modelReady;
  assert.equal(actor.modelId,'hiruzen-custom');assert.ok(actor.modelRoot.getObjectByName('Head'));
  actor.setRole('builder');assert.equal(actor.modelId,'hiruzen-custom');actor.setTheme(getTheme('cozy'));actor.setTheme(getTheme('konoha'));assert.equal(actor.modelId,'hiruzen-custom');actor.disposeAppearance();
  assert.equal(getTheme('kaykit').id,'konoha','obsolete trial preference must return to the requested Naruto theme');
});

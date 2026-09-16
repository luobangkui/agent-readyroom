import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {STYLOO_MODELS,loadStylooModel,stylooSceneEntries,stylooPersonName} from '../src/assets/styloo.js';
import {createRiggedModel} from '../src/assets/rigged-model.js';
import {createCharacter} from '../src/themes/character.js';
import {primitives} from '../src/office.js';
import {getTheme} from '../src/themes/index.js';
import {updateCharacterPose} from '../src/character-motion.js';
import {DESK_ERGONOMICS as D} from '../src/desk-ergonomics.js';
import {fingertipVertices,posedPad} from '../scripts/styloo-typing.mjs';
import {SceneDirector} from '../src/scene-director.js';

const loader=async url=>{const bytes=await readFile(new URL(`../public${url}`,import.meta.url));return new GLTFLoader().register(()=>({name:'node-textures',loadTexture:()=>Promise.resolve(new THREE.Texture())})).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
const motionLoader=async url=>JSON.parse(await readFile(new URL(`../public${url}`,import.meta.url),'utf8'));
const advance=(motion,t)=>{for(let i=0;i<t*60;i++)motion.update(1/60);};

test('all four original models load their own walk/idle and added chair clips',async()=>{
  for(const entry of STYLOO_MODELS){const gltf=await loadStylooModel(entry,{loader,motionLoader}),model=createRiggedModel(gltf);for(const state of ['idle','walking','sitting','typing','sitDown','standUp'])assert.ok(model.motion.has(state),`${entry.id}: ${state}`);
    assert.equal(model.root.getObjectByName('hat'),undefined);assert.equal(model.root.getObjectByName('bag'),undefined);
    model.motion.request('sitting');advance(model.motion,2);assert.equal(model.motion.state,'sitting');model.root.updateMatrixWorld(true);const p=name=>model.root.getObjectByName(name).getWorldPosition(new THREE.Vector3()),thigh=p('DEF-thighL'),knee=p('DEF-shinL');assert.ok(Math.abs(thigh.y-knee.y)<.10,`${entry.id}: thigh is not seated`);assert.ok(knee.z>thigh.z+.2);
    assert.ok(p('DEF-handL').x>.14&&p('DEF-handR').x<-.14,`${entry.id}: A/T pose mismatch folds hands into torso`);
    assert.ok(model.motion.action.getEffectiveTimeScale()<1,'passive seated motion should be calm');
    model.motion.request('walking');advance(model.motion,.25);assert.equal(model.motion.canMove,false);advance(model.motion,1.2);assert.equal(model.motion.canMove,true);model.dispose();
  }
});

test('office seat calibration puts the original rig on the lowered chair and footrest',async()=>{
  const actor=createCharacter(new THREE.Group(),'employee',0,2.8,primitives,getTheme('styloo'),{loader,motionLoader});actor.hasSeat=actor.wantsSeat=true;actor.setAvatar('student');actor.mode='working';await actor.modelReady;
  for(let i=0;i<150;i++)updateCharacterPose(actor,1/60,i/60);assert.equal(actor.modelId,'student');assert.equal(actor.assetMotion.state,'typing');assert.equal(actor.body.visible,false);
  actor.root.updateMatrixWorld(true);const hip=actor.modelRoot.getObjectByName('DEF-spine').getWorldPosition(new THREE.Vector3()),foot=actor.modelRoot.getObjectByName('DEF-footL').getWorldPosition(new THREE.Vector3());assert.ok(Math.abs(hip.y-.571)<.025);assert.ok(Math.abs(foot.y-.055-.23)<.03);
  actor.disposeAppearance();
});

test('four visual coworkers never fabricate or mutate backend sessions',()=>{
  const agents=[{id:'a',role:'boss'},{id:'b',role:'builder'},{id:'c',role:'reviewer'}],before=JSON.stringify(agents),scene=stylooSceneEntries(agents);assert.equal(scene.length,4);assert.equal(scene[3].sceneOnly,true);assert.equal(scene[3].status,'idle');assert.equal(JSON.stringify(agents),before);assert.equal(stylooSceneEntries([...agents,{id:'d'}]).filter(a=>a.sceneOnly).length,0);
});

test('new character names are consistent while original session IDs and history stay intact',()=>{
  const agents=[{id:'a',name:'老罗'},{id:'b',name:'小林'},{id:'c',name:'小周'},{id:'d',name:'待命'}],before=JSON.stringify(agents);
  assert.deepEqual(agents.map(a=>stylooPersonName(a,agents)),['可可','小满','夏禾','阿澄']);assert.equal(JSON.stringify(agents),before);
});

test('all four typing loops keep visible fingertips above the keys and feet still',async()=>{
  for(const entry of STYLOO_MODELS){
    const gltf=await loadStylooModel(entry,{loader,motionLoader}),model=createRiggedModel(gltf);
    model.motion.target='typing';model.motion.play('typing',0);model.motion.typingBlend=1;
    model.root.position.set(0,gltf.officeMeta.seatOffsetY+D.actorY,gltf.officeMeta.seatOffsetZ+D.typingPull);
    const pads=['L','R'].map(side=>fingertipVertices(model.root,side));
    const samples=[];let footStart;
    for(let i=0;i<=180;i++){
      model.motion.mixer.setTime(i/30);model.root.updateMatrixWorld(true);
      const foot=model.root.getObjectByName('DEF-footL').getWorldPosition(new THREE.Vector3());
      if(!footStart)footStart=foot.clone();assert.ok(foot.distanceTo(footStart)<1e-5,`${entry.id}: typing moves the feet`);
      for(const hand of pads){
        const points=hand.map(posedPad),minY=Math.min(...points.map(p=>p.y));
        assert.ok(minY>D.keyTop-.002&&minY<D.keyTop+.012,`${entry.id}: fingertips miss keyboard height (${minY})`);
        for(const p of points){assert.ok(Math.abs(p.x)<D.keyboardWidth/2);assert.ok(Math.abs(p.z-(D.deskZ-D.keyboardZ))<D.keyboardDepth/2);assert.ok(p.y<D.keyTop+.04);}
      }
      samples.push(model.root.getObjectByName('DEF-f_index02L').quaternion.clone().normalize());
    }
    assert.ok(samples.some(q=>q.angleTo(samples[0])>.04),`${entry.id}: fingers never tap`);
    assert.ok(samples[0].angleTo(samples.at(-1))<.001,`${entry.id}: loop has a seam`);
    model.dispose();
  }
});

test('typing stops in the chair, then clears the desk before a walk can begin',async()=>{
  const model=createRiggedModel(await loadStylooModel(STYLOO_MODELS[0],{loader,motionLoader})),motion=model.motion;
  motion.request('typing');advance(motion,.2);assert.equal(motion.state,'sitDown');advance(motion,2);assert.equal(motion.state,'typing');assert.ok(motion.typingBlend>.99);
  motion.request('sitting');advance(motion,.1);assert.equal(motion.state,'sitting');advance(motion,.5);assert.ok(motion.typingBlend<.01);
  motion.request('typing');advance(motion,.5);motion.request('walking');advance(motion,.2);
  assert.equal(motion.canMove,false);assert.equal(motion.state,'sitting');
  advance(motion,.4);assert.equal(motion.state,'standUp');assert.equal(motion.canMove,false);
  advance(motion,1.1);assert.equal(motion.canMove,true);model.dispose();
});

test('interrupted typing requests settle to the latest seated state',async()=>{
  const model=createRiggedModel(await loadStylooModel(STYLOO_MODELS[1],{loader,motionLoader})),motion=model.motion;
  motion.request('typing');advance(motion,.1);motion.request('walking');advance(motion,.1);motion.request('sitting');advance(motion,2);
  assert.equal(motion.state,'sitting');assert.ok(motion.typingBlend<.01);
  motion.request('walking');advance(motion,.3);assert.equal(motion.state,'standUp');motion.request('typing');advance(motion,3);
  assert.equal(motion.state,'typing');assert.equal(motion.canMove,false);model.dispose();
});

test('office execution types at either facing seat; pause freezes and inactive states retract',async()=>{
  for(const facing of [0,Math.PI]){
    const actor=createCharacter(new THREE.Group(),'employee',-3.13,1.97,primitives,getTheme('styloo'),{loader,motionLoader});
    actor.hasSeat=actor.wantsSeat=true;actor.targetRotation=facing;actor.root.rotation.y=facing;actor.setAvatar('student');actor.mode='working';await actor.modelReady;
    for(let i=0;i<120;i++)updateCharacterPose(actor,1/60,i/60);
    assert.equal(actor.assetMotion.state,'typing');assert.ok(Math.abs(actor.deskPullIn-D.typingPull)<.001);
    actor.root.updateMatrixWorld(true);
    for(const side of ['L','R'])for(const pad of fingertipVertices(actor.modelRoot,side)){
      const p=actor.root.worldToLocal(posedPad(pad));assert.ok(Math.abs(p.z-(D.deskZ-D.keyboardZ))<D.keyboardDepth/2);
    }
    const before={time:actor.assetMotion.action.time,pull:actor.deskPullIn};updateCharacterPose(actor,0,5);
    assert.equal(actor.assetMotion.action.time,before.time);assert.equal(actor.deskPullIn,before.pull);
    for(const mode of ['paused','waiting','idle','thinking','reading']){
      actor.mode='working';for(let i=0;i<60;i++)updateCharacterPose(actor,1/60,6+i/60);
      actor.mode=mode;for(let i=0;i<60;i++)updateCharacterPose(actor,1/60,7+i/60);
      assert.equal(actor.assetMotion.state,mode==='thinking'?'typing':'sitting',mode);assert.ok(actor.deskPullIn<(mode==='thinking'?D.typingPull+.001:.001),mode);
    }
    actor.disposeAppearance();
  }
});

test('the main office frame loop rests instead of typing for a stopped task',async()=>{
  const actor=createCharacter(new THREE.Group(),'boss',0,0,primitives,getTheme('styloo'),{loader,motionLoader});actor.hasSeat=actor.wantsSeat=true;await actor.modelReady;
  const director=new SceneDirector({actors:{boss:actor}}),mission={id:'idle-office',status:'stopped',agents:[{id:'a',role:'boss',status:'stopped'}],requests:[],messages:[],events:[]};
  const original=JSON.stringify(mission);director.sync(mission,new Map([['boss','a']]));
  const frames=seconds=>{for(let i=0;i<seconds*60;i++){director.update(1/60);updateCharacterPose(actor,1/60,director.clock);}};
  frames(3);assert.equal(actor.mode,'idle');assert.equal(actor.assetMotion.state,'sitting');assert.ok(actor.deskPullIn<.001);
  frames(10);assert.equal(actor.assetMotion.state,'sitting');assert.ok(actor.deskPullIn<.001);
  assert.equal(JSON.stringify(mission),original);actor.disposeAppearance();
});

test('the lead animates work while planning instead of freezing in a seated idle pose',async()=>{
  const actor=createCharacter(new THREE.Group(),'boss',0,0,primitives,getTheme('styloo'),{loader,motionLoader});actor.hasSeat=actor.wantsSeat=true;await actor.modelReady;
  actor.mode='thinking';for(let i=0;i<150;i++)updateCharacterPose(actor,1/60,i/60);
  assert.equal(actor.assetMotion.state,'typing');assert.ok(Math.abs(actor.deskPullIn-actor.modelMeta.typingPull)<.001);actor.disposeAppearance();
});

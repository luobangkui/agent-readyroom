import test from 'node:test';
import {existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {OFFICE_AVATARS,DEFAULT_BOSS_AVATAR,officeAvatar} from '../src/assets/avatar-catalog.js';
import {CUSTOM_CHARACTERS} from '../src/assets/custom-cast.js';
import {loadOfficeModel} from '../src/assets/office-model.js';
import {createCharacter} from '../src/themes/character.js';
import {getTheme,supportsAvatarSelection} from '../src/themes/index.js';
import {primitives} from '../src/office.js';
import {updateCharacterPose} from '../src/character-motion.js';
import {DESK_ERGONOMICS as D} from '../src/desk-ergonomics.js';

const sourceFixture=relative=>{try{return existsSync(new URL(relative,import.meta.url));}catch{return false;}};

const customIds=['naruto','hiruzen','tsunade','sakura','mizukage'];
// Hiruzen imports the complete sandaimu2 mesh with an 18-joint typing rig;
// its geometry/contact checks live in hiruzen-import.test.js.
// Imported Tsunade uses an 18-joint rig; see tsunade-import.test.js.
const newIds=['sakura'];
const baseClips=['Idle','Walk','Sitting','SitDown','StandUp','Typing'];
const officeClips=['office_sitting','office_typing','office_sit_down','office_stand_up'];
const assetCache=new Map(),motionCache=new Map();
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const pathname=url=>new URL(url,'http://office.test').pathname;
const publicFile=url=>new URL(`../public${pathname(url)}`,import.meta.url);
const finite=(values,label)=>assert.ok(values.every(Number.isFinite),`${label} contains a nonfinite value`);

function source(url){
  const key=pathname(url);
  if(!assetCache.has(key))assetCache.set(key,readFile(publicFile(url)).then(async bytes=>{
    assert.equal(bytes.toString('ascii',0,4),'glTF');
    assert.equal(bytes.readUInt32LE(4),2);
    assert.equal(bytes.readUInt32LE(8),bytes.length);
    const document=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));
    const binaryStart=20+bytes.readUInt32LE(12)+8;
    // Only browser image decoding is replaced. Geometry, skinning, UVs and
    // animation are all loaded from the shipping GLB; PNG bytes are checked too.
    const loader=new GLTFLoader().register(()=>({name:'office-test-textures',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
    const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');
    return {bytes,document,binary:bytes.subarray(binaryStart),gltf};
  }));
  return assetCache.get(key);
}
const loader=async url=>(await source(url)).gltf;
function motionLoader(url){
  const key=pathname(url);
  if(!motionCache.has(key))motionCache.set(key,readFile(publicFile(url),'utf8').then(JSON.parse));
  return motionCache.get(key);
}
function actorFor(t,id='boss',state={},options={}){
  const actor=createCharacter(new THREE.Group(),id,0,0,primitives,getTheme('styloo'),{loader,motionLoader,...options});
  Object.assign(actor,state);
  actor.root.rotation.y=actor.targetRotation=0;
  t.after(()=>actor.disposeAppearance());
  return actor;
}
const choose=async(actor,id)=>{actor.setAvatar(id);await actor.modelReady;assert.equal(actor.assetState,'ready');assert.equal(actor.modelId,id);};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function bones(root){const result=[];root.traverse(object=>{if(object.isBone)result.push(object);});return result;}
function vertices(root,predicate){
  const points=[];
  root.traverse(mesh=>{if(mesh.isSkinnedMesh)for(let i=0;i<mesh.geometry.attributes.position.count;i++)if(predicate(mesh,i))points.push({mesh,index:i});});
  assert.ok(points.length,'no rendered vertices match the contact region');
  return points;
}
const worldVertex=({mesh,index})=>mesh.getVertexPosition(index,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
const bounds=points=>points.reduce((box,point)=>box.expandByPoint(worldVertex(point)),new THREE.Box3());

test('Konoha supports every current avatar and keeps the selected rig and activity across scenery changes',async t=>{
  const actor=actorFor(t,'boss',{hasSeat:true,wantsSeat:true,mode:'working'});
  actor.setTheme(getTheme('konoha'));await actor.modelReady;
  assert.equal(supportsAvatarSelection(getTheme('konoha')),true);
  assert.equal(actor.modelId,DEFAULT_BOSS_AVATAR);
  const home=actor.root.position.clone(),rotation=actor.root.rotation.y;
  for(const item of OFFICE_AVATARS){
    await choose(actor,item.id);actor.setRole('boss');
    const root=actor.modelRoot,motion=actor.assetMotion;
    updateCharacterPose(actor,1/60,1);const elapsed=motion.action.time;
    for(const themeId of ['styloo','konoha']){
      actor.setTheme(getTheme(themeId));await actor.modelReady;
      assert.equal(actor.modelRoot,root);assert.equal(actor.assetMotion,motion);
      assert.equal(actor.modelId,item.id);assert.equal(motion.state,item.id==='mizukage-custom'?'sitting':'typing');
      assert.equal(motion.action.time,elapsed,'changing scenery restarted the animation');
      assert.ok(actor.root.position.equals(home));assert.equal(actor.root.rotation.y,rotation);
      assert.equal(actor.labelHeight,actor.modelMeta.labelHeight);
      assert.equal(getTheme(themeId).footrestHeight,.23);
    }
  }
});

test('legacy Naruto and Hiruzen identities load only their current custom assets in Konoha',async t=>{
  const requested=[],actor=actorFor(t,'boss',{}, {loader:url=>{requested.push(pathname(url));return loader(url);}});
  actor.setTheme(getTheme('konoha'));await actor.modelReady;
  for(const id of ['naruto','hiruzen']){
    assert.equal(officeAvatar(id).id,`${id}-custom`);
    actor.setAvatar(id);await actor.modelReady;
    assert.equal(actor.modelId,`${id}-custom`);assert.equal(actor.assetState,'ready');
    actor.setRole('boss');assert.equal(actor.modelId,`${id}-custom`);
  }
  assert.ok(requested.every(url=>url.startsWith('/assets/characters/custom/')));
});

test('an in-flight avatar selection survives a switch between anime and Konoha scenery',async t=>{
  const waiting=deferred();let loads=0;
  const actor=actorFor(t,'boss',{}, {loader:url=>{if(pathname(url).includes('naruto_chibi')){loads++;return waiting.promise;}return loader(url);}});
  await actor.modelReady;
  actor.setAvatar('naruto-custom');const pending=actor.modelReady;
  actor.setTheme(getTheme('konoha'));actor.setTheme(getTheme('styloo'));actor.setTheme(getTheme('konoha'));
  assert.equal(actor.modelReady,pending);assert.equal(loads,1);
  waiting.resolve(await loader(officeAvatar('naruto-custom').url));await pending;
  assert.equal(actor.themeId(),'konoha');assert.equal(actor.modelId,'naruto-custom');assert.equal(actor.assetState,'ready');
});

test('the nine office options default the boss to Tsunade and respect explicit choices for every role',async t=>{
  assert.equal(DEFAULT_BOSS_AVATAR,'tsunade-custom');
  assert.deepEqual(OFFICE_AVATARS.map(item=>item.id).sort(),[...customIds.map(id=>`${id}-custom`),'merchant','student','archer','ninja'].sort());
  const boss=actorFor(t);await boss.modelReady;
  assert.equal(boss.modelId,'tsunade-custom');assert.equal(boss.modelMeta.scale,1);
  assert.ok(boss.modelRoot.scale.distanceTo(new THREE.Vector3(1,1,1))<1e-8);
  for(const id of ['merchant','tsunade-custom','sakura-custom','hiruzen-custom']){
    await choose(boss,id);const root=boss.modelRoot;
    boss.setRole('boss');await boss.modelReady;
    assert.equal(boss.modelId,id,'assigning the boss role overwrote the selected model');
    assert.equal(boss.modelRoot,root,'an unchanged selection unnecessarily replaced its skeleton');
  }
  const coworker=actorFor(t,'employee');await coworker.modelReady;
  for(const id of customIds.map(id=>`${id}-custom`)){
    await choose(coworker,id);coworker.setRole('reviewer');await coworker.modelReady;assert.equal(coworker.modelId,id);
  }
});

test('rapid asynchronous selections attach only the newest model and ignore an expired failure',async t=>{
  const waits=new Map(),errors=[];
  const actor=actorFor(t,'boss',{}, {loader:url=>waits.get(pathname(url))?.promise??loader(url),onError:message=>errors.push(message)});
  await actor.modelReady;
  const oldChoice=officeAvatar('tsunade-custom'),latestChoice=officeAvatar('sakura-custom');
  const old=deferred(),latest=deferred();waits.set(pathname(oldChoice.url),old);waits.set(pathname(latestChoice.url),latest);
  actor.setAvatar(oldChoice.id);const oldReady=actor.modelReady;
  actor.setAvatar(latestChoice.id);const latestReady=actor.modelReady;
  latest.resolve(await loader(latestChoice.url));await latestReady;
  const latestRoot=actor.modelRoot;assert.equal(actor.modelId,latestChoice.id);
  old.resolve(await loader(oldChoice.url));await oldReady;
  assert.equal(actor.modelRoot,latestRoot);assert.equal(actor.modelId,latestChoice.id);
  const staleFailure=deferred();waits.set(pathname(oldChoice.url),staleFailure);
  actor.setAvatar(oldChoice.id);const failedReady=actor.modelReady;
  await choose(actor,'hiruzen-custom');const finalRoot=actor.modelRoot;
  staleFailure.reject(new Error('expired model request'));await failedReady;
  assert.equal(actor.modelRoot,finalRoot);assert.equal(actor.modelId,'hiruzen-custom');
  assert.equal(actor.assetState,'ready');assert.equal(actor.body.visible,false);assert.deepEqual(errors,[]);
});

test('a failed load affects only its actor and the same selection can recover',async t=>{
  const failure=new Error('asset unavailable'),errors=[];let fail=false;
  const actor=actorFor(t,'boss',{}, {loader:url=>fail&&pathname(url).includes('tsunade')?Promise.reject(failure):loader(url),onError:message=>errors.push(message)});
  const neighbor=actorFor(t,'employee',{hasSeat:true,wantsSeat:true,mode:'working'});
  await Promise.all([actor.modelReady,neighbor.modelReady]);
  const neighborRoot=neighbor.modelRoot,neighborMotion=neighbor.assetMotion,neighborTime=neighborMotion.action.time;
  const errorLog=t.mock.method(console,'error',()=>{});
  await choose(actor,'naruto-custom'); // the boss now defaults to Tsunade; step away so reselecting her reloads
  fail=true;actor.setAvatar('tsunade-custom');await actor.modelReady;
  assert.equal(actor.assetState,'error');assert.equal(actor.body.visible,true);assert.equal(actor.assetMotion,null);assert.equal(errors.length,1);
  assert.ok(errorLog.mock.calls.some(call=>call.arguments[0]===failure));
  assert.equal(neighbor.modelRoot,neighborRoot);assert.equal(neighbor.assetMotion,neighborMotion);assert.equal(neighbor.assetState,'ready');
  updateCharacterPose(neighbor,1/60,1);assert.ok(neighborMotion.action.time>neighborTime);
  fail=false;await choose(actor,'tsunade-custom');assert.equal(actor.body.visible,false);
});

test('changing the model preserves seated, typing and walking activity without restarting entrance poses',async t=>{
  const actor=actorFor(t,'boss',{hasSeat:true,wantsSeat:true,mode:'idle'});await actor.modelReady;
  for(const [id,mode,wantsSeat,expected] of [
    ['hiruzen-custom','idle',true,'sitting'],
    ['tsunade-custom','working',true,'typing'],
    ['sakura-custom','thinking',true,'typing'],
    ['merchant','walking',false,'walking'],
    ['naruto-custom','walking',false,'walking']
  ]){
    actor.mode=mode;actor.wantsSeat=wantsSeat;const position=actor.root.position.clone();
    await choose(actor,id);
    assert.equal(actor.mode,mode);assert.equal(actor.assetMotion.state,expected);assert.equal(actor.assetMotion.target,expected);
    assert.ok(actor.root.position.equals(position),'selection moved the actor between workstations');
    assert.equal(actor.assetMotion.canMove,expected==='walking');
    assert.equal(actor.seatBlend,expected==='walking'?0:1);
    assert.ok(Math.abs(actor.deskPullIn-(expected==='typing'?actor.modelMeta.typingPull:0))<1e-8);
    updateCharacterPose(actor,1/60,1);assert.equal(actor.assetMotion.state,expected);
  }
});

test('actors sharing a GLB have independent skeletons, motion and scale',async t=>{
  const seated=actorFor(t,'boss',{hasSeat:true,wantsSeat:true,mode:'working'});seated.setAvatar('naruto-custom');
  const walking=actorFor(t,'employee',{mode:'walking'});walking.setAvatar('naruto-custom');
  await Promise.all([seated.modelReady,walking.modelReady]);
  const sourceBones=bones((await loader(officeAvatar('naruto-custom').url)).scene);
  const seatedBones=bones(seated.modelRoot),walkingBones=bones(walking.modelRoot);
  assert.equal(seatedBones.length,18);assert.equal(walkingBones.length,18);
  for(const bone of seatedBones){
    assert.notEqual(bone,walkingBones.find(other=>other.name===bone.name));
    assert.notEqual(bone,sourceBones.find(other=>other.name===bone.name));
  }
  assert.notEqual(seated.assetMotion.mixer,walking.assetMotion.mixer);
  const before=walkingBones.map(bone=>bone.matrix.toArray()),walkingScale=walking.modelRoot.scale.clone();
  for(let i=0;i<12;i++)updateCharacterPose(seated,1/60,i/60);
  assert.deepEqual(walkingBones.map(bone=>bone.matrix.toArray()),before,'animating one actor changed another rig');
  await choose(seated,'merchant');assert.ok(walking.modelRoot.scale.equals(walkingScale));
  assert.equal(seated.modelRoot.scale.x,1);assert.equal(walking.modelRoot.scale.x,1);
  await choose(seated,'sakura-custom');assert.equal(seated.modelRoot.scale.x,1);
  assert.equal(walking.modelId,'naruto-custom');assert.equal(walking.assetMotion.state,'walking');
});

test('imported Sakura preserves the complete source mesh, PBR textures and a weighted rig',async t=>{
  if(!sourceFixture('../assets/imports/sakura-20260914/base_basic_pbr.glb'))return t.skip('公开版不含第三方原始素材 assets/imports/，本用例只在本地素材齐全时运行');
  for(const id of newIds){
    const item=CUSTOM_CHARACTERS.find(item=>item.id===id),{bytes,document,binary,gltf}=await source(item.url);
    const manifest=JSON.parse(await readFile(new URL(`../public/assets/characters/custom/${id}-custom-manifest.json`,import.meta.url),'utf8'));
    const sourceHash=sha256(bytes);
    assert.equal(manifest.bytes,bytes.length);assert.equal(manifest.sha256,sourceHash);
    assert.equal(item.modelRevision,sourceHash.slice(0,12),'catalog points at a stale model revision');
    assert.equal(document.buffers.length,1);assert.equal(document.buffers[0].uri,undefined);
    assert.equal(bones(gltf.scene).length,18);assert.equal(manifest.info.boneCount,18);
    assert.deepEqual(gltf.animations.map(clip=>clip.name).sort(),baseClips.toSorted());
    const skinned=[];gltf.scene.traverse(mesh=>{if(mesh.isSkinnedMesh)skinned.push(mesh);});
    assert.equal(skinned.length,manifest.skinnedMeshCount);assert.ok(skinned.length>0);
    for(const mesh of skinned){
      const weights=mesh.geometry.attributes.skinWeight,indices=mesh.geometry.attributes.skinIndex;
      assert.ok(weights&&indices);assert.equal(mesh.skeleton.bones.length,18);
      finite(weights.array,`${id}/${mesh.name} weights`);
      for(let v=0;v<weights.count;v++){
        let sum=0;
        for(let c=0;c<4;c++){
          const weight=weights.getComponent(v,c),joint=indices.getComponent(v,c);sum+=weight;
          assert.ok(weight>=0&&weight<=1,`${id}/${mesh.name} invalid weight`);
          assert.ok(Number.isInteger(joint)&&joint>=0&&joint<18,`${id}/${mesh.name} invalid joint`);
        }
        assert.ok(Math.abs(sum-1)<1e-5,`${id}/${mesh.name} weights do not sum to one`);
      }
    }
    const original=await readFile(new URL('../assets/imports/sakura-20260914/base_basic_pbr.glb',import.meta.url));
    const originalEnd=20+original.readUInt32LE(12),originalDoc=JSON.parse(original.subarray(20,originalEnd)),originalBin=original.subarray(originalEnd+8);
    assert.equal(manifest.sourceSha256,sha256(original));assert.equal(manifest.sourceArchive,'xiaoyingglf.zip');
    assert.equal(document.meshes.length,1);assert.equal(document.meshes[0].primitives.length,1);
    assert.deepEqual(document.materials,originalDoc.materials);assert.deepEqual(document.textures,originalDoc.textures);
    const imageBytes=(doc,bin)=>doc.images.map(image=>{
      assert.equal(image.mimeType,'image/png');assert.equal(image.uri,undefined);
      const view=doc.bufferViews[image.bufferView];return bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
    });
    assert.equal(document.images.length,3);
    assert.deepEqual(imageBytes(document,binary),imageBytes(originalDoc,originalBin),'PBR images changed during import');
    assert.deepEqual(manifest.textureSha256,imageBytes(document,binary).map(sha256));
    const originalGLTF=await new GLTFLoader().register(()=>({name:'source-textures',loadTexture:()=>Promise.resolve(new THREE.Texture())})).parseAsync(original.buffer.slice(original.byteOffset,original.byteOffset+original.byteLength),'');
    const originalGeometry=originalGLTF.scene.children[0].geometry,importedGeometry=skinned[0].geometry;
    assert.equal(importedGeometry.attributes.position.count,19875);assert.equal(importedGeometry.index.count/3,34658);
    assert.deepEqual(importedGeometry.index.array,originalGeometry.index.array,'source topology changed');
    for(const name of ['normal','uv'])assert.deepEqual(importedGeometry.attributes[name].array,originalGeometry.attributes[name].array,`${name} changed`);
    for(let v=0;v<19875;v++)for(let axis=0;axis<3;axis++){
      const offset=axis===0?manifest.info.sourceCenterX:axis===2?manifest.info.sourceCenterZ:0;
      const expected=(originalGeometry.attributes.position.getComponent(v,axis)-offset)*manifest.info.sourceScale;
      assert.ok(Math.abs(importedGeometry.attributes.position.getComponent(v,axis)-expected)<1e-6,'source shape changed');
    }
    const motion=await motionLoader(item.motionURL),prepared=await loadOfficeModel(officeAvatar(`${id}-custom`),{loader,motionLoader});
    assert.deepEqual(motion.clips.map(clip=>clip.name).sort(),officeClips.toSorted());
    assert.equal(prepared.animations.length,10);
    assert.equal(item.motionRevision,createHash('sha256').update(bytes).update(JSON.stringify(motion)).digest('hex').slice(0,12),'office motion was baked against a different model');
  }
});

test('all ten clips of each new character keep bones and representative deformed vertices finite',async()=>{
  for(const id of newIds){
    const gltf=await loadOfficeModel(officeAvatar(`${id}-custom`),{loader,motionLoader});
    const root=clone(gltf.scene),jointList=bones(root),meshes=[];
    root.traverse(mesh=>{if(mesh.isSkinnedMesh)meshes.push(mesh);});
    for(const clip of gltf.animations){
      assert.ok(clip.duration>0&&Number.isFinite(clip.duration));assert.ok(clip.tracks.length);
      for(const track of clip.tracks){finite(track.times,`${id}/${clip.name} key times`);finite(track.values,`${id}/${clip.name} key values`);}
      const mixer=new THREE.AnimationMixer(root),action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;
      for(let sample=0;sample<=8;sample++){
        action.reset().play();mixer.setTime(clip.duration*sample/8);root.updateMatrixWorld(true);
        for(const bone of jointList)finite(bone.matrixWorld.elements,`${id}/${clip.name}/${bone.name}`);
        for(const mesh of meshes){
          const last=mesh.geometry.attributes.position.count-1;
          for(const index of [0,Math.floor(last/2),last])finite(worldVertex({mesh,index}).toArray(),`${id}/${clip.name}/${mesh.name} deformed vertex`);
        }
      }
      mixer.stopAllAction();mixer.uncacheRoot(root);
    }
  }
});

test('imported Sakura keeps her soles on the footrest and her closed hands near the keyboard',async t=>{
  for(const id of newIds)for(const typing of [false,true]){
    const actor=actorFor(t,'boss',{hasSeat:true,wantsSeat:true,mode:typing?'working':'idle'});
    await choose(actor,`${id}-custom`);
    const feet=[-1,1].map(sign=>vertices(actor.modelRoot,(mesh,i)=>mesh.geometry.attributes.position.getY(i)<.1053&&Math.sign(mesh.geometry.attributes.position.getX(i))===sign));
    const hands=typing?['Left','Right'].map(side=>vertices(actor.modelRoot,(mesh,i)=>{
      const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
      return position.getY(i)<.8073&&[0,1,2,3].some(c=>skinWeight.getComponent(i,c)>.999&&mesh.skeleton.bones[skinIndex.getComponent(i,c)].name===`${side}Hand`);
    })):[];
    const clearances=[[],[]];
    for(let frame=0;frame<=180;frame++){
      actor.assetMotion.mixer.setTime(frame/30);actor.root.updateMatrixWorld(true);
      for(const foot of feet){
        const box=bounds(foot);assert.ok(Math.abs(box.min.y-.23)<.001,`${id}: rendered sole misses the footrest (${box.min.y})`);
        assert.ok(box.min.x>=-.34&&box.max.x<=.34);
        const supportZ=actor.deskPullIn+(actor.modelMeta.footrestOffsetZ??0);
        assert.ok(box.min.z-supportZ>=-.191&&box.max.z-supportZ<=.191);
      }
      for(let side=0;side<hands.length;side++){
        const points=hands[side].map(worldVertex).filter(p=>Math.abs(p.x)<=D.keyboardWidth/2&&Math.abs(p.z-(D.deskZ-D.keyboardZ))<=D.keyboardDepth/2);
        assert.ok(points.length,`${id}: rendered hand misses keyboard bounds`);
        const clearance=Math.min(...points.map(p=>p.y))-D.keyTop;clearances[side].push(clearance);
        assert.ok(clearance>=.002&&clearance<=.033,`${id}: hand contact is ${clearance} away from keys`);
        const center=bounds(hands[side]).getCenter(new THREE.Vector3());
        assert.ok(Math.abs(center.x)<D.keyboardWidth/2&&Math.abs(center.z-(D.deskZ-D.keyboardZ))<D.keyboardDepth/2,`${id}: closed hands miss keyboard`);
      }
    }
    if(typing)for(const samples of clearances)assert.ok(Math.max(...samples)-Math.min(...samples)>.008,`${id}: hands never tap`);
  }
});

test('Sakura switches the actual clip from sitting to alternating typing, then stands before walking',async t=>{
  const actor=actorFor(t,'boss',{hasSeat:true,wantsSeat:true,mode:'idle'});
  await choose(actor,'sakura-custom');
  const advance=seconds=>{for(let i=0;i<Math.ceil(seconds*60);i++)actor.updateAssetPose(1/60);};
  assert.equal(actor.assetMotion.action.getClip().name,'office_sitting');
  actor.deskTyping=true;advance(2); // Let the chair finish pulling toward the desk.
  assert.equal(actor.assetMotion.state,'typing');
  assert.equal(actor.assetMotion.action.getClip().name,'office_typing','state changes must switch the actual animation, not reuse sitting');
  const mesh=actor.modelRoot.getObjectByName('Sakura_Imported_Body');
  const hands=['Left','Right'].map(side=>vertices(actor.modelRoot,(mesh,i)=>{
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
    return position.getY(i)<.8073&&[0,1,2,3].some(c=>skinWeight.getComponent(i,c)>.999&&mesh.skeleton.bones[skinIndex.getComponent(i,c)].name===side+'Hand');
  }));
  const samples=[[],[]],feet=[];
  for(let frame=0;frame<120;frame++){
    advance(1/60);actor.root.updateMatrixWorld(true);
    hands.forEach((hand,side)=>{const box=bounds(hand);samples[side].push(box.min.y);assert.ok(box.min.y>=1.030&&box.min.y<1.066,`hand misses key height: ${box.min.y}`);});
    feet.push(mesh.skeleton.bones.find(b=>b.name==='LeftFoot').getWorldPosition(new THREE.Vector3()));
  }
  for(const hand of samples)assert.ok(Math.max(...hand)-Math.min(...hand)>.02,'hand taps should be visible');
  assert.ok(samples[0].some((v,i)=>v-samples[1][i]>.015)&&samples[1].some((v,i)=>v-samples[0][i]>.015),'hands should alternate');
  assert.ok(feet.every(p=>p.distanceTo(feet[0])<1e-5),'typing moves the feet');
  actor.mode='walking';actor.wantsSeat=false;advance(.2);assert.equal(actor.assetMotion.canMove,false);
  advance(2.5);assert.equal(actor.assetMotion.canMove,true);assert.equal(actor.assetMotion.action.getClip().name,'Walk');
  actor.mode='working';actor.wantsSeat=true;advance(2);
  assert.equal(actor.assetMotion.action.getClip().name,'office_typing');
});

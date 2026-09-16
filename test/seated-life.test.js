import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {officeAvatar} from '../src/assets/avatar-catalog.js';
import {loadOfficeModel} from '../src/assets/office-model.js';
import {createRiggedModel} from '../src/assets/rigged-model.js';
import {seatedLifeClip} from '../src/assets/seated-life.js';

const file=url=>new URL('../public'+new URL(url,'http://office.test').pathname,import.meta.url);
const loader=async url=>{const bytes=await readFile(file(url));return new GLTFLoader().register(()=>({name:'test-textures',loadTexture:()=>Promise.resolve(new T.Texture())})).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');};
const motionLoader=async url=>JSON.parse(await readFile(file(url),'utf8'));
const bones=root=>{const result=[];root.traverse(o=>{if(o.isBone)result.push(o);});return result;};
const pose=root=>bones(root).flatMap(bone=>[...bone.position.toArray(),...bone.quaternion.toArray()]);
const world=(root,name)=>root.getObjectByName(name).getWorldPosition(new T.Vector3());

for(const id of ['naruto','hiruzen','tsunade','sakura'])test(`${id}: seated rest has readable glances, stable contact, seamless loops and independent timing`,async()=>{
  const item=officeAvatar(id+'-custom'),gltf=await loader(item.url),source=gltf.animations.find(clip=>clip.name==='Sitting');
  const before=source.tracks.map(track=>Array.from(track.values)),clip=seatedLifeClip(source,id);
  assert.equal(clip.duration,36);assert.notEqual(clip.uuid,source.uuid);
  assert.deepEqual(source.tracks.map(track=>Array.from(track.values)),before,'cached source animation was mutated');
  for(const other of gltf.animations.filter(c=>c.name!=='Sitting'))assert.equal(seatedLifeClip(other,id),other,'working or transition animation changed');
  const base=createRiggedModel(gltf),live=createRiggedModel({...gltf,animations:[clip]});
  const a=base.motion.mixer,b=live.motion.mixer;a.stopAllAction();b.stopAllAction();
  const original=a.clipAction(source),enhanced=b.clipAction(clip);original.play();enhanced.play();
  const heads=[];
  for(let i=0;i<360;i++){
    const time=i/10;a.setTime(time);b.setTime(time);base.root.updateMatrixWorld(true);live.root.updateMatrixWorld(true);
    for(const name of ['Hips','LeftFoot','RightFoot','LeftLowerLeg','RightLowerLeg'])assert.ok(world(base.root,name).distanceTo(world(live.root,name))<1e-5,`${name} moved away from its calibrated contact`);
    for(const name of ['LeftHand','RightHand'])assert.ok(world(base.root,name).distanceTo(world(live.root,name))<.035,`${name} drifts off the lap`);
    heads.push(live.root.getObjectByName('Head').quaternion.clone());
  }
  const angles=heads.map(q=>heads[0].angleTo(q));assert.ok(Math.max(...angles)>.1,'head still looks frozen');assert.ok(Math.max(...angles)<.3,'head turn is excessive');
  assert.ok(heads.every((q,i)=>!i||q.angleTo(heads[i-1])<.025),'gaze snaps between frames');
  b.setTime(3);const paused=pose(live.root);b.update(0);assert.deepEqual(pose(live.root),paused,'zero delta changes the paused pose');
  b.setTime(0);const start=pose(live.root);b.setTime(36);const end=pose(live.root);assert.ok(start.every((v,i)=>Math.abs(v-end[i])<1e-5),'loop seam');
  for(const track of clip.tracks){const stride=track.getValueSize();for(let i=0;i<stride;i++)assert.ok(Math.abs(track.values[i]-track.values[track.values.length-stride+i])<1e-5,'clip endpoints differ');}
  base.dispose();live.dispose();
  const prepared=await loadOfficeModel(item,{loader:async()=>gltf,motionLoader});
  const first=createRiggedModel(prepared),second=createRiggedModel(prepared);
  first.motion.phaseOffset=.15;second.motion.phaseOffset=.55;
  for(const model of [first,second]){model.motion.target='sitting';model.motion.play('sitting',0);model.motion.update(0);}
  assert.ok(first.root.getObjectByName('Head').quaternion.angleTo(second.root.getObjectByName('Head').quaternion)>.02,'coworkers move in lockstep');
  for(let i=0;i<300;i++)first.motion.update(1/60);
  const still=pose(first.root);first.motion.update(0);assert.deepEqual(pose(first.root),still);
  first.motion.request('typing');for(let i=0;i<90;i++)first.motion.update(1/60);assert.equal(first.motion.state,'typing');
  first.motion.request('walking');for(let i=0;i<240;i++)first.motion.update(1/60);assert.equal(first.motion.canMove,true);
  first.dispose();second.dispose();
});

test('unknown and legacy character packs retain their authored animations',()=>{
  const clip=new T.AnimationClip('Sitting',1,[]);assert.equal(seatedLifeClip(clip,'student'),clip);assert.equal(seatedLifeClip(clip,'kakashi'),clip);
});

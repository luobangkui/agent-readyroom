import test from 'node:test';
import {existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createRiggedModel} from '../src/assets/rigged-model.js';
import {loadOfficeModel} from '../src/assets/office-model.js';
import {officeAvatar} from '../src/assets/avatar-catalog.js';
import {createCharacter} from '../src/themes/character.js';
import {getTheme} from '../src/themes/index.js';
import {primitives} from '../src/office.js';

const sourceFixture=relative=>{try{return existsSync(new URL(relative,import.meta.url));}catch{return false;}};

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const item=officeAvatar('naruto-custom');
const path=url=>new URL(`../public${new URL(url,'http://office.test').pathname}`,import.meta.url);
const loader=async url=>{const bytes=await readFile(path(url));return new GLTFLoader().register(()=>({name:'node-textures',loadTexture:()=>Promise.resolve(new T.Texture())})).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');};
const motionLoader=async url=>JSON.parse(await readFile(path(url),'utf8'));
const prepared=loadOfficeModel(item,{loader,motionLoader});
const step=(motion,seconds)=>{for(let i=0;i<Math.ceil(seconds*60);i++)motion.update(1/60);};
function unpack(bytes){const end=20+bytes.readUInt32LE(12);return {doc:JSON.parse(bytes.subarray(20,end)),bin:bytes.subarray(end+8)};}
function images({doc,bin}){return doc.images.map(image=>{assert.equal(image.uri,undefined);assert.equal(image.mimeType,'image/png');const v=doc.bufferViews[image.bufferView];return bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);});}

test('Naruto is a single character from the supplied GLB with all three original PBR textures',async t=>{
  if(!sourceFixture('../assets/imports/naruto-mingren-20260914/base_basic_pbr.glb'))return t.skip('公开版不含第三方原始素材 assets/imports/，本用例只在本地素材齐全时运行');
  const sourceBytes=await readFile(new URL('../assets/imports/naruto-mingren-20260914/base_basic_pbr.glb',import.meta.url));
  const bytes=await readFile(path(item.url)),source=unpack(sourceBytes),output=unpack(bytes);
  const manifest=JSON.parse(await readFile(new URL('../public/assets/characters/custom/naruto-custom-manifest.json',import.meta.url),'utf8'));
  assert.equal(bytes.readUInt32LE(8),bytes.length);assert.equal(manifest.sha256,hash(bytes));assert.equal(manifest.bytes,bytes.length);
  assert.equal(manifest.sourceArchive,'mingren.zip');assert.equal(manifest.sourceSha256,hash(sourceBytes));assert.equal(item.modelRevision,hash(bytes).slice(0,12));
  assert.equal(output.doc.meshes.length,2);assert.equal(output.doc.meshes[0].primitives.length,1);
  const primitive=output.doc.meshes[0].primitives[0];
  assert.equal(output.doc.accessors[primitive.indices].count/3,37492-manifest.removedArmBridgeTriangles.length,'only the recorded fused-contact faces may be removed');
  assert.equal(output.doc.accessors[primitive.attributes.POSITION].count,21081);
  assert.equal(output.doc.accessors[primitive.attributes.TEXCOORD_0].count,output.doc.accessors[primitive.attributes.POSITION].count);
  const sourcePrimitive=source.doc.meshes[0].primitives[0];
  const accessorBytes=({doc,bin},index)=>{const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],start=(v.byteOffset||0)+(a.byteOffset||0);return bin.subarray(start,start+v.byteLength);};
  const indexValues=(data,index)=>{const a=data.doc.accessors[index],b=accessorBytes(data,index),size=a.componentType===5123?2:4;return Array.from({length:a.count},(_,i)=>size===2?b.readUInt16LE(i*size):b.readUInt32LE(i*size));};
  const removed=new Set(manifest.removedArmBridgeTriangles),sourceIndices=indexValues(source,sourcePrimitive.indices);
  assert.deepEqual(indexValues(output,primitive.indices),sourceIndices.filter((_,i)=>!removed.has(Math.floor(i/3))),'unrelated source triangles changed');
  assert.ok(removed.size>0&&removed.size<400);assert.ok(manifest.repairTriangles>0);

  for(const name of ['NORMAL','TEXCOORD_0'])assert.deepEqual(accessorBytes(output,primitive.attributes[name]),accessorBytes(source,sourcePrimitive.attributes[name]),name+' changed');
  assert.deepEqual(images(output).map(hash),images(source).map(hash),'PBR texture pixels changed');
  assert.deepEqual(output.doc.materials,source.doc.materials);assert.equal(output.doc.buffers[0].uri,undefined);
  const gltf=await prepared,mesh=gltf.scene.getObjectByName('Naruto_Imported_Body');
  assert.ok(mesh.isSkinnedMesh);assert.equal(mesh.skeleton.bones.length,18);
  const box=new T.Box3().setFromObject(gltf.scene),size=box.getSize(new T.Vector3());
  assert.ok(size.x<1.6&&size.y>2.2&&size.y<2.3);assert.ok(Math.abs(box.getCenter(new T.Vector3()).x)<.001);
  const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
  for(let i=0;i<weights.count;i++){
    let sum=0;for(let c=0;c<4;c++){const w=weights.getComponent(i,c),joint=indices.getComponent(i,c);assert.ok(Number.isFinite(w)&&w>=0&&w<=1);assert.ok(Number.isInteger(joint)&&joint>=0&&joint<18);sum+=w;}
    assert.ok(Math.abs(sum-1)<1e-5);
  }
  const motion=await motionLoader(item.motionURL);
  assert.equal(item.motionRevision,createHash('sha256').update(bytes).update(JSON.stringify(motion)).digest('hex').slice(0,12));
  assert.equal(item.animationLabels.Typing,'打字 · Typing');
});

test('all imported Naruto clips animate finite vertices, and loops meet at their endpoints',async()=>{
  const gltf=await prepared,model=createRiggedModel(gltf),mesh=model.root.getObjectByName('Naruto_Imported_Body');
  const joints=mesh.skeleton.bones;
  for(const clip of gltf.animations){
    const mixer=new T.AnimationMixer(model.root),action=mixer.clipAction(clip).setLoop(T.LoopOnce,1);action.clampWhenFinished=true;
    const poses=[];
    for(let frame=0;frame<=30;frame++){
      action.reset().play();mixer.setTime(clip.duration*frame/30);model.root.updateMatrixWorld(true);
      poses.push(joints.map(j=>[...j.position.toArray(),...j.quaternion.toArray()]));
      for(const bone of joints)assert.ok(bone.matrixWorld.elements.every(Number.isFinite));
      for(let v=0;v<mesh.geometry.attributes.position.count;v+=Math.max(47,Math.floor(mesh.geometry.attributes.position.count/300))){const point=mesh.getVertexPosition(v,new T.Vector3());assert.ok(point.toArray().every(Number.isFinite));assert.ok(point.length()<4,'mesh explodes during a transition');}
    }
    if(!/Down|Up|down|up/.test(clip.name)){
      for(let j=0;j<joints.length;j++)for(let c=0;c<7;c++)assert.ok(Math.abs(poses[0][j][c]-poses.at(-1)[j][c])<1e-5,`${clip.name} has a loop seam`);
      assert.ok(poses.some(row=>row.some((joint,j)=>joint.some((value,c)=>Math.abs(value-poses[0][j][c])>.001))),`${clip.name} is frozen`);
    }
    mixer.stopAllAction();mixer.uncacheRoot(model.root);
  }
  model.dispose();
});

test('seated soles rest on the extended footrest throughout sitting and working loops',async t=>{
  const actor=createCharacter(new T.Group(),'boss',0,0,primitives,getTheme('styloo'),{loader,motionLoader});t.after(()=>actor.disposeAppearance());
  actor.hasSeat=actor.wantsSeat=true;actor.setAvatar('naruto-custom');await actor.modelReady;
  for(const mode of ['idle','working']){
    actor.mode=mode;for(let i=0;i<120;i++)actor.updateAssetPose(1/60);
    assert.equal(actor.assetMotion.state,mode==='working'?'typing':'sitting');assert.ok(Math.abs(actor.deskPullIn-(mode==='working'?.35:0))<1e-6);
    const mesh=actor.modelRoot.getObjectByName('Naruto_Imported_Body'),p=mesh.geometry.attributes.position,meta=actor.modelMeta;
    const feet=[-1,1].map(sign=>Array.from({length:p.count},(_,i)=>i).filter(i=>p.getY(i)<.126&&Math.sign(p.getX(i))===sign));
    for(let frame=0;frame<=60;frame++){
      actor.assetMotion.mixer.setTime(frame/5);actor.root.updateMatrixWorld(true);
      for(const indices of feet){
        const box=new T.Box3().setFromPoints(indices.map(i=>mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld)));
        assert.ok(Math.abs(box.min.y-meta.footrestTop)<1e-4,'sole loses footrest contact');
        assert.ok(box.min.x>=-.34&&box.max.x<=.34);
        assert.ok(box.min.z>=meta.footrestOffsetZ+actor.deskPullIn-.19*meta.footrestDepthScale&&box.max.z<=meta.footrestOffsetZ+actor.deskPullIn+.19*meta.footrestDepthScale,'foot misses its support');
      }
    }
  }
  actor.setTheme(getTheme('konoha'));await actor.modelReady;assert.equal(actor.modelId,'naruto-custom');assert.equal(actor.assetMotion.state,'typing');
});

test('two imported Naruto actors have separate rigs and finish standing before walking',async()=>{
  const gltf=await prepared,a=createRiggedModel(gltf),b=createRiggedModel(gltf);
  const bHead=b.root.getObjectByName('Head'),bPose=bHead.quaternion.clone();
  assert.notEqual(a.root.getObjectByName('Hips'),b.root.getObjectByName('Hips'));
  a.motion.request('typing');step(a.motion,1.7);assert.equal(a.motion.state,'typing');
  a.motion.request('walking');step(a.motion,.2);assert.equal(a.motion.canMove,false);step(a.motion,2);assert.equal(a.motion.canMove,true);assert.equal(a.motion.state,'walking');
  assert.ok(bHead.quaternion.equals(bPose));assert.equal(b.motion.action.time,0);
  a.motion.request('sitting');step(a.motion,.1);a.motion.request('walking');step(a.motion,.1);a.motion.request('sitting');step(a.motion,3);assert.equal(a.motion.state,'sitting');
  a.dispose();b.dispose();
});

test('Naruto alternates visible hand taps at the keyboard while seated, including idle desk work',async t=>{
  const actor=createCharacter(new T.Group(),'boss',0,0,primitives,getTheme('styloo'),{loader,motionLoader});t.after(()=>actor.disposeAppearance());
  actor.hasSeat=actor.wantsSeat=true;actor.mode='idle';actor.deskTyping=true;actor.setAvatar('naruto-custom');await actor.modelReady;
  assert.equal(actor.assetMotion.state,'typing');
  const mesh=actor.modelRoot.getObjectByName('Naruto_Imported_Body'),skin=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
  const hands=['Left','Right'].map(side=>{
    const bone=mesh.skeleton.bones.findIndex(b=>b.name===side+'Hand');assert.ok(bone>=0,'typing needs independent wrists');
    return Array.from({length:skin.count},(_,i)=>i).filter(i=>[0,1,2,3].some(c=>skin.getComponent(i,c)===bone&&weights.getComponent(i,c)>.999));
  });
  const samples=[[],[]],feet=[];
  for(let frame=0;frame<=120;frame++){
    actor.assetMotion.mixer.setTime(frame/60);actor.root.updateMatrixWorld(true);
    hands.forEach((indices,side)=>{
      assert.ok(indices.length>10,'rendered fingers must follow the wrist');
      const box=new T.Box3().setFromPoints(indices.map(i=>mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld)));
      samples[side].push(box.min.y);
      assert.ok(box.min.y>=1.030&&box.min.y<1.066,`hand pierces or floats over keys: ${box.min.y}`);
      assert.ok(box.min.x>-.325&&box.max.x<.325,'hand is outside keyboard width');
      assert.ok(box.max.z>.52&&box.max.z<.79,'fingers miss the key rows');
    });
    feet.push(mesh.skeleton.bones.find(b=>b.name==='LeftFoot').getWorldPosition(new T.Vector3()));
  }
  for(const samplesForHand of samples)assert.ok(Math.max(...samplesForHand)-Math.min(...samplesForHand)>.02,'hand is motionless');
  assert.ok(samples[0].some((v,i)=>v-samples[1][i]>.015)&&samples[1].some((v,i)=>v-samples[0][i]>.015),'hands should alternate');
  assert.ok(feet.every(p=>p.distanceTo(feet[0])<1e-5),'typing moves the feet');
  actor.mode='walking';actor.wantsSeat=false;for(let i=0;i<180;i++)actor.updateAssetPose(1/60);
  assert.equal(actor.assetMotion.canMove,true,JSON.stringify({state:actor.assetMotion.state,target:actor.assetMotion.target,clip:actor.assetMotion.action.getClip().name,duration:actor.assetMotion.action.getClip().duration,time:actor.assetMotion.action.time,blend:actor.assetMotion.typingBlend}));
});


test('replaced Naruto models, textures and generators are removed',async()=>{
  for(const name of ['assets/textures/naruto-face-albedo-v2.png','public/assets/characters/custom/naruto-face-albedo-v2.png','scripts/build-custom-naruto.mjs','scripts/naruto-body-v2.mjs','scripts/naruto-head-v2.mjs','scripts/build-naruto-office-motion.mjs'])await assert.rejects(access(new URL('../'+name,import.meta.url)),{code:'ENOENT'});
});

test('Naruto contact repairs follow their limbs without reattaching hands to the thigh pouches',async()=>{
  const gltf=await prepared,model=createRiggedModel(gltf),patch=model.root.getObjectByName('Naruto_Contact_Repairs');
  assert.ok(patch?.isSkinnedMesh);const p=patch.geometry.attributes.position,index=patch.geometry.index;
  for(const clip of gltf.animations){
    const mixer=new T.AnimationMixer(model.root),action=mixer.clipAction(clip).setLoop(T.LoopOnce,1);action.clampWhenFinished=true;
    for(let frame=0;frame<=20;frame++){
      action.reset().play();mixer.setTime(clip.duration*frame/20);model.root.updateMatrixWorld(true);
      const points=Array.from({length:p.count},(_,i)=>patch.getVertexPosition(i,new T.Vector3()));assert.ok(points.every(v=>v.toArray().every(Number.isFinite)));
      for(let i=0;i<index.count;i+=3)for(let j=0;j<3;j++){
        const a=index.getX(i+j),b=index.getX(i+(j+1)%3),restLength=new T.Vector3().fromBufferAttribute(p,a).distanceTo(new T.Vector3().fromBufferAttribute(p,b));
        assert.ok(points[a].distanceTo(points[b])<Math.max(.04,restLength*2.5),`${clip.name} stretches a contact repair between hand and pouch`);
      }
    }
    mixer.stopAllAction();mixer.uncacheRoot(model.root);
  }
  model.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MODEL_CATALOG,createRiggedModel} from '../src/assets/rigged-model.js';

// Texture pixels are checked in the browser; Node exercises the actual imported
// skeleton and authored keyframes rather than a fabricated substitute rig.
const loader=new GLTFLoader().register(()=>({name:'node-texture-placeholder',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
async function load(file){const bytes=await readFile(new URL(`../public/assets/characters/konoha/${file}.glb`,import.meta.url));return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
const step=(motion,seconds)=>{for(let i=0;i<Math.ceil(seconds*60);i++)motion.update(1/60);};
const world=(root,name)=>{root.updateMatrixWorld(true);return root.getObjectByName(name).getWorldPosition(new THREE.Vector3());};

test('every shipped model has an actual skinned mesh, sitting clips and tucked weapons',async()=>{
  for(const entry of MODEL_CATALOG){const model=createRiggedModel(await load(entry.file));let skinned=0;model.root.traverse(o=>{if(o.isSkinnedMesh)skinned++;if(o.name.startsWith('handslot'))assert.equal(o.visible,false);});assert.ok(skinned>0);for(const action of ['idle','walking','sitting','sitDown','standUp'])assert.ok(model.motion.has(action),`${entry.file}: ${action}`);model.dispose();}
});

test('seated keyframes bend the thighs horizontally and rest both feet on the footrest',async()=>{
  const model=createRiggedModel(await load('kakashi'));model.motion.request('sitting');step(model.motion,1.1);assert.equal(model.motion.state,'sitting');
  for(const side of ['l','r']){const hip=world(model.root,`upperleg${side}`),knee=world(model.root,`lowerleg${side}`);assert.ok(Math.abs(hip.y-knee.y)<.04);assert.ok(knee.z-hip.z>.18);}
  const left=world(model.root,'footl'),right=world(model.root,'footr');assert.ok(Math.abs(left.y-right.y)<.01);assert.ok(left.y>.39&&left.y<.42);model.dispose();
});

test('walking cannot translate a seated model until its stand-up clip finishes',async()=>{
  const model=createRiggedModel(await load('kakashi'));model.motion.request('sitting');step(model.motion,1);model.motion.request('walking');step(model.motion,.2);assert.equal(model.motion.state,'standUp');assert.equal(model.motion.canMove,false);step(model.motion,.9);assert.equal(model.motion.state,'walking');assert.equal(model.motion.canMove,true);model.dispose();
});

test('rapid sit/walk/sit requests settle into the last requested pose',async()=>{
  const model=createRiggedModel(await load('kakashi'));model.motion.request('sitting');step(model.motion,.15);model.motion.request('walking');step(model.motion,.15);model.motion.request('sitting');step(model.motion,2);assert.equal(model.motion.state,'sitting');assert.equal(model.motion.target,'sitting');model.dispose();
});

test('two copies never share bone pose or animation time',async()=>{
  const gltf=await load('kakashi'),a=createRiggedModel(gltf),b=createRiggedModel(gltf);a.motion.request('sitting');step(a.motion,1.2);step(b.motion,.2);assert.notEqual(a.root.getObjectByName('hips'),b.root.getObjectByName('hips'));assert.ok(Math.abs(world(a.root,'hips').z-world(b.root,'hips').z)>.3);a.dispose();b.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createCharacter} from '../src/themes/character.js';
import {getTheme} from '../src/themes/index.js';
import {primitives} from '../src/office.js';
import {WORKSTATIONS} from '../src/room-layout.js';
import {protectActorView} from '../src/office-camera.js';

const path=url=>new URL('../public'+new URL(url,'http://office.test').pathname,import.meta.url);
const loader=async url=>{const b=await readFile(path(url));return new GLTFLoader().register(()=>({name:'camera-test-textures',loadTexture:()=>Promise.resolve(new T.Texture())})).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'');};
const motionLoader=async url=>JSON.parse(await readFile(path(url),'utf8'));
const baseDistance=Math.hypot(4,2.4);
function orbit(camera,target,azimuth,polar){camera.position.copy(target).add(new T.Vector3().setFromSphericalCoords(baseDistance,polar,azimuth));camera.lookAt(target);camera.updateMatrixWorld();}
function corners(box){return [box.min.x,box.max.x].flatMap(x=>[box.min.y,box.max.y].flatMap(y=>[box.min.z,box.max.z].map(z=>new T.Vector3(x,y,z))));}
function depth(camera,point){return -point.clone().applyMatrix4(camera.matrixWorldInverse).z;}

async function cast(t){
  const scene=new T.Group(),actors={},boxes={};
  for(const [index,id] of ['hiruzen','tsunade','naruto','sakura'].entries()){
    const station=WORKSTATIONS[index],actor=createCharacter(scene,id,station.home.x,station.home.z,primitives,getTheme('konoha'),{loader,motionLoader});
    Object.assign(actor,{hasSeat:true,wantsSeat:true,mode:'working',targetRotation:station.facing});actor.root.rotation.y=station.facing;
    actor.setAvatar(id+'-custom');await actor.modelReady;t.after(()=>actor.disposeAppearance());
    for(let i=0;i<120;i++)actor.updateAssetPose(1/60);
    actor.root.updateMatrixWorld(true);const box=new T.Box3();
    actor.modelRoot.traverse(mesh=>{if(!mesh.isMesh)return;for(let i=0;i<mesh.geometry.attributes.position.count;i++)box.expandByPoint(mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld));});
    actors[id]=actor;boxes[id]=box;
  }
  return {actors,boxes};
}

test('close orbit keeps coworkers in front of the near plane without changing orthographic framing',async t=>{
  const {actors,boxes}=await cast(t),camera=new T.OrthographicCamera(-10,10,8,-8,.1,100);camera.zoom=3.1;camera.updateProjectionMatrix();
  const target=actors.naruto.root.position.clone().add(new T.Vector3(0,1.4,0));
  orbit(camera,target,-.63,Math.PI/2.25);
  assert.ok(corners(boxes.tsunade).some(p=>depth(camera,p)<camera.near),'baseline must reproduce camera cutting into the coworker');
  const landmarks=Object.values(boxes).map(b=>b.getCenter(new T.Vector3())),before=landmarks.map(p=>p.clone().project(camera));
  protectActorView(camera,target,actors,baseDistance);
  for(const box of Object.values(boxes))assert.ok(corners(box).every(p=>depth(camera,p)>camera.near),'camera still cuts a rendered character');
  landmarks.forEach((p,i)=>{const after=p.clone().project(camera);assert.ok(Math.abs(before[i].x-after.x)<1e-10&&Math.abs(before[i].y-after.y)<1e-10,'safety adjustment changes the composition');});
  assert.equal(camera.zoom,3.1);

  for(const focus of Object.values(actors))for(const polar of [.13,.7,Math.PI/2.25])for(let angle=-Math.PI;angle<Math.PI;angle+=Math.PI/12){
    target.copy(focus.root.position).add(new T.Vector3(0,1.4,0));orbit(camera,target,angle,polar);protectActorView(camera,target,actors,baseDistance);
    for(const [id,box] of Object.entries(boxes))assert.ok(corners(box).every(p=>depth(camera,p)>camera.near),`${focus.id} orbit clips ${id} at ${angle}/${polar}`);
  }
});

test('orbit clearance follows movement and ignores hidden actors without accumulating distance',()=>{
  const camera=new T.OrthographicCamera(-5,5,5,-5,.1,100),target=new T.Vector3(0,1.4,0);
  const root=new T.Group();root.position.set(0,0,6);const actors={coworker:{root,labelHeight:2.4}};
  orbit(camera,target,0,Math.PI/2.25);protectActorView(camera,target,actors,baseDistance);const protectedDistance=camera.position.distanceTo(target);
  assert.ok(protectedDistance>baseDistance);
  for(let i=0;i<10;i++)protectActorView(camera,target,actors,baseDistance);
  assert.ok(Math.abs(camera.position.distanceTo(target)-protectedDistance)<1e-8);
  root.position.z=0;protectActorView(camera,target,actors,baseDistance);assert.ok(Math.abs(camera.position.distanceTo(target)-baseDistance)<1e-8);
  root.position.z=8;root.visible=false;protectActorView(camera,target,actors,baseDistance);assert.ok(Math.abs(camera.position.distanceTo(target)-baseDistance)<1e-8);
});

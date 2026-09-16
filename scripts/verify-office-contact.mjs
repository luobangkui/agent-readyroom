// Measure the seated contact of an imported office character.
//
// Reproduces exactly how src/assets/office-avatar.js positions a model (actor
// root, root offset, runtime scale) and reports the numbers the office cares
// about: sole height against the footrest, hand height against the key tops and
// hand travel across the keyboard.  Used to calibrate a rebuilt rig against the
// same chair, desk and keyboard the demo ships.
//
//   node scripts/verify-office-contact.mjs [characterId]
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {primitives} from '../src/office.js';
import {createCharacter} from '../src/themes/character.js';
import {getTheme} from '../src/themes/index.js';
import {updateCharacterPose} from '../src/character-motion.js';
import {DESK_ERGONOMICS as D} from '../src/desk-ergonomics.js';
import {ROOM, WORKSTATIONS} from '../src/room-layout.js';

const id=process.argv[2]??'mizukage';
const loader=async url=>{
  const bytes=await readFile(new URL(`../public${url}`,import.meta.url));
  return new GLTFLoader().register(()=>({name:'measure-textures',loadTexture:()=>Promise.resolve(new THREE.Texture())}))
    .parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
};
const motionLoader=async url=>JSON.parse(await readFile(new URL(`../public${url}`,import.meta.url),'utf8'));

const actor=createCharacter(new THREE.Group(),'boss',0,0,primitives,getTheme('konoha'),{loader,motionLoader});
actor.hasSeat=true;actor.wantsSeat=true;actor.mode='working';actor.setAvatar(id);
await actor.modelReady;

const world=({mesh,index})=>mesh.getVertexPosition(index,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
// Select contact geometry by dominant bone rather than by a height threshold:
// this character's hair reaches to ankle height, so a y < .1053 filter would
// measure the hair tips instead of the soles.
function dominantVertices(boneName){
  const points=[];
  actor.modelRoot.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
    for(let i=0;i<position.count;i++){
      let best=-1,bestWeight=0;
      for(let c=0;c<4;c++){
        const w=skinWeight.getComponent(i,c);
        if(w>bestWeight){bestWeight=w;best=skinIndex.getComponent(i,c);}
      }
      if(bestWeight>0.5&&mesh.skeleton.bones[best]?.name===boneName)points.push({mesh,index:i});
    }
  });
  return points;
}
function vertices(predicate){
  const points=[];
  actor.modelRoot.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    for(let i=0;i<mesh.geometry.attributes.position.count;i++)if(predicate(mesh,i))points.push({mesh,index:i});
  });
  return points;
}
const box=points=>points.reduce((bounds,point)=>bounds.expandByPoint(world(point)),new THREE.Box3());
const bone=name=>actor.modelRoot.getObjectByName(name)?.getWorldPosition(new THREE.Vector3());

const advance=seconds=>{for(let i=0;i<Math.ceil(seconds*60);i++)updateCharacterPose(actor,1/60,i/60);};

const report={id,modelId:actor.modelId,meta:actor.modelMeta,walkSpeed:actor.modelMeta?.walkSpeed??null,frames:{}};
const soleZ=[],handLow=[],handTravel=[],hipZs=[],kneeZs=[],footZs=[];

for(let frame=0;frame<=180;frame++){
  actor.assetMotion.mixer.setTime(frame/30);actor.root.updateMatrixWorld(true);
  const feet=['LeftFoot','RightFoot'].map(name=>dominantVertices(name));
  const hands=['Left','Right'].map(side=>dominantVertices(`${side}Hand`));
  const footBoxes=feet.map(box);
  const handBoxes=hands.map(box);
  soleZ.push(...footBoxes.map(b=>b.min.y));
  footZs.push(...footBoxes.map(b=>b.min.z));
  handLow.push(...handBoxes.map(b=>b.min.y));
  handTravel.push(handBoxes.map(b=>({x:(b.min.x+b.max.x)/2,z:(b.min.z+b.max.z)/2})));
  const hips=bone('Hips'),kneeL=bone('LeftLowerLeg'),kneeR=bone('RightLowerLeg');
  if(hips&&kneeL){hipZs.push(hips.y);kneeZs.push((kneeL.y+kneeR.y)/2);}
}

const flat=handTravel.flat();
report.seated={
  soleMinY:[Math.min(...soleZ),Math.max(...soleZ)],
  footrestTop:0.23,
  soleError:Math.min(...soleZ)-0.23,
  hipsY:hipZs[0],kneeY:kneeZs[0],thighDrop:hipZs[0]-kneeZs[0],
  handMinY:[Math.min(...handLow),Math.max(...handLow)],
  keyTop:D.keyTop,
  handClearance:[Math.min(...handLow)-D.keyTop,Math.max(...handLow)-D.keyTop],
  handTapRange:Math.max(...handLow)-Math.min(...handLow),
  handX:[Math.min(...flat.map(p=>p.x)),Math.max(...flat.map(p=>p.x))],
  handZ:[Math.min(...flat.map(p=>p.z)),Math.max(...flat.map(p=>p.z))],
  keyboardXLimit:D.keyboardWidth/2,
  keyboardZ:D.deskZ-D.keyboardZ,
  keyboardZLimit:D.keyboardDepth/2,
  rootPosition:actor.root.position.toArray().map(n=>+n.toFixed(4)),
  modelRootPosition:actor.modelRoot.position.toArray().map(n=>+n.toFixed(4)),
  modelScale:actor.modelRoot.scale.x,
};
report.seated.solesOnFootrest=Math.abs(report.seated.soleError)<0.001;
report.seated.handsOverKeys=report.seated.handX.every(v=>Math.abs(v)<=D.keyboardWidth/2)&&
  flat.every(p=>Math.abs(p.z-(D.deskZ-D.keyboardZ))<=D.keyboardDepth/2);

// walking: foot travel and root speed the scene director will actually use
actor.mode='walking';actor.wantsSeat=false;advance(3);
const walkFoot=[];
for(let frame=0;frame<90;frame++){
  updateCharacterPose(actor,1/60,frame/60);actor.root.updateMatrixWorld(true);
  const foot=bone('LeftFoot');if(foot)walkFoot.push(foot.clone());
}
report.walking={
  state:actor.assetMotion.state,
  canMove:actor.assetMotion.canMove,
  clip:actor.assetMotion.action?.getClip().name,
  footY:[Math.min(...walkFoot.map(p=>p.y)),Math.max(...walkFoot.map(p=>p.y))],
  footZ:[Math.min(...walkFoot.map(p=>p.z)),Math.max(...walkFoot.map(p=>p.z))],
  stride:Math.max(...walkFoot.map(p=>p.z))-Math.min(...walkFoot.map(p=>p.z)),
  roomBounds:{minX:ROOM.minX,maxX:ROOM.maxX,minZ:ROOM.minZ,maxZ:ROOM.maxZ},
};

actor.disposeAppearance();
console.log(JSON.stringify(report,null,1));

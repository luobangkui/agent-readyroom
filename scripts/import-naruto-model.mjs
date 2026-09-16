// Import the complete user-supplied Naruto GLB as an office actor.
// Preserve geometry, UVs and PBR pixels; retain the sculpted sleeves and hands.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {smoothImportedArmWeights} from './smooth-imported-arm-weights.mjs';
import {capMeshCuts} from './cap-mesh-cuts.mjs';
import {typingTap,officeClipJSON} from './office-typing.mjs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.();});}
};
const sourceURL=new URL('../assets/imports/naruto-mingren-20260914/base_basic_pbr.glb',import.meta.url);
const out=new URL('../public/assets/characters/custom/',import.meta.url);
const bytes=await readFile(sourceURL),hash=data=>createHash('sha256').update(data).digest('hex');
function unpack(data){const length=data.readUInt32LE(12),header=20+length;return {doc:JSON.parse(data.subarray(20,header)),bin:data.subarray(header+8,header+8+data.readUInt32LE(header))};}
const source=unpack(bytes);
const gltf=await new GLTFLoader().register(()=>({name:'geometry-only',loadTexture:()=>Promise.resolve(new T.Texture())})).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');
const geometry=gltf.scene.children[0].geometry,position=geometry.attributes.position;
const ids=Array.from({length:position.count},(_,i)=>i),triangles=Array.from(geometry.index.array);
if(triangles.length/3!==37492)throw new Error('Unexpected Naruto source topology');
const handRegion=JSON.parse(await readFile(new URL('../assets/imports/naruto-mingren-20260914/hand-region.json',import.meta.url),'utf8'));
if(handRegion.sourceSha256!==hash(bytes))throw new Error('Re-run python scripts/classify-naruto-hand.py for this source');
const bareHands=new Set(handRegion.handVertices),removedBridges=[];
// The static source fuses the fingertips to the thigh pouches. Remove only
// triangles crossing that albedo boundary so the hands can lift independently.
const detached=[];
for(let i=0;i<triangles.length;i+=3){
  const t=triangles.slice(i,i+3),hands=t.filter(v=>bareHands.has(v)).length;
  const bridge=hands>0&&hands<3&&t.every(v=>position.getY(v)<.635&&Math.abs(position.getX(v))>.215);
  if(bridge)removedBridges.push(i/3);else detached.push(...t);
}
const sourceBounds=new T.Box3().setFromBufferAttribute(position);
const centerX=(sourceBounds.min.x+sourceBounds.max.x)/2,scale=1.18;
const meshGeometry=new T.BufferGeometry();
for(const [name,attribute] of Object.entries(geometry.attributes)){
  const values=[];
  for(const index of ids)for(let axis=0;axis<attribute.itemSize;axis++){
    let value=attribute.getComponent(index,axis);
    if(name==='position')value=(value-(axis===0?centerX:0))*scale;
    values.push(value);
  }
  meshGeometry.setAttribute(name,new T.Float32BufferAttribute(values,attribute.itemSize));
}
meshGeometry.setIndex(detached);
const root=new T.Group();root.name='Naruto_Imported_20260914';
root.userData={source:'mingren.zip / base_basic_pbr.glb',sourceSha256:hash(bytes),extraction:'Complete single character; original topology, PBR textures and UVs',motion:'Added office rig; articulated shoulders, elbows and wrists'};
const bones={},joints=[],rest=new Map();
function joint(name,parent,xyz){
  const bone=new T.Bone();bone.name=name;const world=new T.Vector3(...xyz).multiplyScalar(scale);
  bone.position.copy(world);if(parent)bone.position.sub(rest.get(parent));
  (parent?bones[parent]:root).add(bone);bones[name]=bone;joints.push(bone);rest.set(name,world);return bone;
}
joint('Root',null,[0,0,0]);joint('Hips','Root',[0,.62,0]);
joint('Spine','Hips',[0,.79,0]);joint('Chest','Spine',[0,1.02,0]);
joint('Neck','Chest',[0,1.15,0]);joint('Head','Neck',[0,1.40,.025]);
for(const [side,s] of [['Left',1],['Right',-1]]){
  joint(`${side}UpperLeg`,'Hips',[s*.145,.62,0]);
  joint(`${side}LowerLeg`,`${side}UpperLeg`,[s*.16,.31,-.015]);
  joint(`${side}Foot`,`${side}LowerLeg`,[s*.175,.105,-.025]);
}
for(const [side,s] of [['Left',1],['Right',-1]]){
  joint(`${side}UpperArm`,'Chest',[s*.215,1.035,.015]);
  joint(`${side}ForeArm`,`${side}UpperArm`,[s*.28,.85,.01]);
  joint(`${side}Hand`,`${side}ForeArm`,[s*.33,.685,.05]);
}
const smooth=(a,b,x)=>T.MathUtils.smoothstep(x,a,b);
// UV islands isolate the exposed forearms/hands from the overlapping robe.
// Classify complete islands so coincident sleeve/skin surfaces move together.
const parents=Array.from({length:position.count},(_,i)=>i);
function component(i){return parents[i]===i?i:parents[i]=component(parents[i]);}
for(let i=0;i<triangles.length;i+=3)for(let j=1;j<3;j++)parents[component(triangles[i+j])]=component(triangles[i]);
const islands=new Map();
for(let i=0;i<position.count;i++){const id=component(i);if(!islands.has(id))islands.set(id,new T.Box3());islands.get(id).expandByPoint(new T.Vector3(position.getX(i)-centerX,position.getY(i),position.getZ(i)));}
const armIslands=new Set([...islands].filter(([,b])=>b.min.y>.51&&b.max.y<1.075&&(b.min.x>.16||b.max.x<-.16)).map(([id])=>id));
const hairIslands=new Set([...islands].filter(([,b])=>b.min.y>.90&&b.max.y>1.20).map(([id])=>id));
const skinIndices=[],skinWeights=[],footVertices={Left:[],Right:[]},handVertices={Left:[],Right:[]};
for(const [vertex,index] of ids.entries()){
  const x=position.getX(index)-centerX,y=position.getY(index),z=position.getZ(index),side=x>=0?'Left':'Right';
  let weights;
  if(y>=1.19)weights={Head:1};
  else if(y>=1.10){const h=smooth(1.10,1.19,y);weights={Chest:1-h,Head:h};}
  else if(y>=.64){const h=smooth(.50,1.02,y);weights={Hips:1-h,Chest:h};}
  else {
    const upper=`${side}UpperLeg`,lower=`${side}LowerLeg`,foot=`${side}Foot`;
    const hip=smooth(.43,.64,y),knee=smooth(.24,.37,y),ankle=smooth(.10,.16,y);
    // The long robe overlaps both thighs. Blend it into the pelvis around the
    // waist, while keeping the two trouser legs free to stride independently.
    weights={Hips:hip,[upper]:(1-hip)*knee,[lower]:(1-hip)*(1-knee)*ankle,[foot]:(1-hip)*(1-knee)*(1-ankle)};
    if(y<.09)footVertices[side].push(vertex);
  }
  // Separate sleeves from the torso with a soft shoulder seam.
  const arm=bareHands.has(index)?1:y<.635?0:hairIslands.has(component(index))?0:armIslands.has(component(index))?1:smooth(.23,.29,Math.abs(x))*(1-smooth(1.0,1.13,y));
  if(arm>0){
    for(const key of Object.keys(weights))weights[key]*=1-arm;
    const elbow=smooth(.78,.93,y),wrist=1-smooth(.61,.68,y);
    weights[`${side}UpperArm`]=arm*elbow;
    weights[`${side}ForeArm`]=arm*(1-elbow)*(1-wrist);
    weights[`${side}Hand`]=arm*(1-elbow)*wrist;
  }
  if(y>.36&&y<.62&&Math.abs(x)>.255&&!bareHands.has(index))weights={[`${side}UpperLeg`]:1};
  const entries=Object.entries(weights).filter(([,w])=>w>1e-8).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const total=entries.reduce((sum,[,w])=>sum+w,0);
  for(let i=0;i<4;i++){skinIndices.push(entries[i]?joints.indexOf(bones[entries[i][0]]):0);skinWeights.push(entries[i]?entries[i][1]/total:0);}
}
meshGeometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(skinIndices,4));
meshGeometry.setAttribute('skinWeight',new T.Float32BufferAttribute(skinWeights,4));
smoothImportedArmWeights(meshGeometry,joints,ids.map(i=>bareHands.has(i)?1:0),true);
for(const side of ['Left','Right']){
  const jointIndex=joints.indexOf(bones[side+'Hand']),indices=meshGeometry.attributes.skinIndex,weights=meshGeometry.attributes.skinWeight;
  for(let i=0;i<position.count;i++)for(let c=0;c<4;c++)if(indices.getComponent(i,c)===jointIndex&&weights.getComponent(i,c)>.999)handVertices[side].push(i);
  if(!handVertices[side].length)throw new Error('Missing rigid fingertip contact vertices: '+side);
}
const mesh=new T.SkinnedMesh(meshGeometry,new T.MeshStandardMaterial({name:'Naruto_Imported_PBR'}));
mesh.name='Naruto_Imported_Body';root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new T.Skeleton(joints));
const repairs=capMeshCuts(meshGeometry,triangles,ids.map(i=>bareHands.has(i)?1:0)),repairMesh=new T.SkinnedMesh(repairs.geometry,mesh.material);repairMesh.name='Naruto_Contact_Repairs';root.add(repairMesh);root.updateMatrixWorld(true);repairMesh.bind(mesh.skeleton);
const restPose=joints.map(bone=>({bone,p:bone.position.clone(),q:bone.quaternion.clone()}));
const rotation=(x=0,y=0,z=0)=>new T.Quaternion().setFromEuler(new T.Euler(x,y,z));
const P=bone=>bone.getWorldPosition(new T.Vector3()),Q=bone=>bone.getWorldQuaternion(new T.Quaternion());
function restore(){for(const {bone,p,q} of restPose){bone.position.copy(p);bone.quaternion.copy(q);}root.updateMatrixWorld(true);}
function worldQ(bone,q){bone.quaternion.copy(Q(bone.parent).invert().multiply(q));root.updateMatrixWorld(true);}
function aim(bone,child,target){const origin=P(bone),q=new T.Quaternion().setFromUnitVectors(P(child).sub(origin).normalize(),target.clone().sub(origin).normalize());worldQ(bone,q.multiply(Q(bone)));}
function reach(upper,middle,end,target,pole){
  const origin=P(upper),a=origin.distanceTo(P(middle)),b=P(middle).distanceTo(P(end));
  const direction=target.clone().sub(origin),distance=T.MathUtils.clamp(direction.length(),Math.abs(a-b)+1e-5,a+b-1e-5);direction.normalize();
  const bend=pole.clone().addScaledVector(direction,-pole.dot(direction)).normalize();
  const along=(a*a-b*b+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,a*a-along*along));
  aim(upper,middle,origin.clone().addScaledVector(direction,along).addScaledVector(bend,height));aim(middle,end,target);
}
const footBounds=side=>{root.updateMatrixWorld(true);return new T.Box3().setFromPoints(footVertices[side].map(i=>mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld)));};
const meta={scale:1,seatOffsetY:.055,standingOffsetY:.055,seatOffsetZ:-.22,typingPull:.35,labelHeight:2.38,actorY:.02,footrestTop:.23,footrestOffsetZ:.285,footrestDepthScale:1.35,seatedHipY:.625,adapter:'Imported single-character PBR mesh; 18-joint office rig',contact:'Articulated shoulders, elbows and wrists; alternating keyboard taps with planted feet.'};
function idle(time=0){
  restore();const phase=time*Math.PI/2;
  bones.Chest.quaternion.copy(rotation(.004*Math.sin(phase),0,.003*Math.sin(phase)));
  bones.Head.quaternion.copy(rotation(.008*Math.sin(phase),.017*Math.sin(phase),0));root.updateMatrixWorld(true);
}
function seated(blend=1,time=0,working=false){
  restore();const phase=time*Math.PI/3;
  bones.Hips.position.y=T.MathUtils.lerp(rest.get('Hips').y,meta.seatedHipY-.075,blend);
  bones.Chest.quaternion.copy(rotation((working?.032:.006)*blend+.005*Math.sin(phase)*blend));
  bones.Head.quaternion.copy(rotation((working?.018:0)*blend+.008*Math.sin(phase)*blend,.014*Math.sin(phase)*blend));
  root.updateMatrixWorld(true);
  for(const [side,s] of [['Left',1],['Right',-1]]){
    const upper=bones[`${side}UpperLeg`],lower=bones[`${side}LowerLeg`],foot=bones[`${side}Foot`];
    const target=rest.get(foot.name).clone().lerp(new T.Vector3(s*.17,.23-.075+rest.get(foot.name).y,.37),blend);
    target.y+=.07*Math.sin(Math.PI*blend);
    const soleY=(.23-.075)*blend+.07*Math.sin(Math.PI*blend);
    for(let pass=0;pass<3;pass++){
      reach(upper,lower,foot,target,new T.Vector3(0,.05,1));worldQ(foot,rotation());
      const box=footBounds(side);target.y+=soleY-box.min.y;
    }
  }
  if(working){
    for(const [side,sign] of [['Left',1],['Right',-1]]){
      // A six-second seamless loop: short alternating taps and a small wrist roll.
      const {beat,lift}=typingTap(time,sign);
      const hand=bones[`${side}Hand`];
      const contact=new T.Vector3(sign*.155,1.034-.075+lift,.64-meta.seatOffsetZ-meta.typingPull);
      const target=contact.clone().add(new T.Vector3(0,.055,-.09));
      for(let pass=0;pass<3;pass++){
        reach(bones[`${side}UpperArm`],bones[`${side}ForeArm`],hand,target,new T.Vector3(sign,0,-.35));
        worldQ(hand,rotation(-Math.PI/2+.04*Math.sin(beat)).premultiply(rotation(0,0,sign*Math.PI/2)));
        root.updateMatrixWorld(true);
        const bounds=new T.Box3().setFromPoints(handVertices[side].map(i=>mesh.getVertexPosition(i,new T.Vector3()))),center=bounds.getCenter(new T.Vector3());
        target.add(new T.Vector3(contact.x-center.x,contact.y-bounds.min.y,contact.z-center.z));
      }
    }
  }
  root.updateMatrixWorld(true);
}
function walk(time=0){
  restore();const phase=time*Math.PI*2/1.4;
  bones.Hips.position.y+=.007*(1-Math.cos(phase*2));
  bones.Chest.quaternion.copy(rotation(0,.018*Math.sin(phase),.008*Math.sin(phase)));
  bones.Head.quaternion.copy(rotation(0,-.014*Math.sin(phase)));
  for(const [side,s] of [['Left',1],['Right',-1]]){
    const p=phase+(s===1?0:Math.PI),foot=bones[`${side}Foot`],target=rest.get(foot.name).clone();
    target.z+=.12*Math.sin(p);target.y+=.055*Math.max(0,Math.cos(p));
    reach(bones[`${side}UpperLeg`],bones[`${side}LowerLeg`],foot,target,new T.Vector3(0,0,1));worldQ(foot,rotation());
  }
  root.updateMatrixWorld(true);
}
const ease=t=>t*t*(3-2*t);
function clip(name,duration,pose){
  const count=Math.round(duration*30),times=Array.from({length:count+1},(_,i)=>duration*i/count),samples=[];
  for(const t of times){pose(t,t/duration);samples.push(joints.map(b=>({p:b.position.toArray(),q:b.quaternion.toArray()})));}
  const tracks=[];
  for(const [index,bone] of joints.entries()){
    tracks.push(new T.VectorKeyframeTrack(`${bone.name}.position`,times,samples.flatMap(row=>row[index].p)));
    tracks.push(new T.QuaternionKeyframeTrack(`${bone.name}.quaternion`,times,samples.flatMap(row=>row[index].q)));
  }
  return new T.AnimationClip(name,duration,tracks);
}
const animations=[clip('Idle',4,time=>idle(time)),clip('Walk',1.4,time=>walk(time)),clip('Sitting',6,time=>seated(1,time)),clip('SitDown',1.2,(_,t)=>seated(ease(t))),clip('StandUp',1.2,(_,t)=>seated(1-ease(t))),clip('Typing',6,time=>seated(1,time,true))];
restore();
const exported=unpack(Buffer.from(await new GLTFExporter().parseAsync(root,{binary:true,animations})));
// GLTFExporter handles geometry, weights and animation. Repack the original PNG
// bytes afterwards, so no canvas conversion can alter color, normals or UVs.
const chunks=[exported.bin],doc=exported.doc;let offset=exported.bin.length;
doc.materials=structuredClone(source.doc.materials);doc.textures=structuredClone(source.doc.textures);doc.samplers=structuredClone(source.doc.samplers||[]);
doc.images=source.doc.images.map(image=>{
  const view=source.doc.bufferViews[image.bufferView],png=source.bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength),pad=(4-offset%4)%4;
  if(pad){chunks.push(Buffer.alloc(pad));offset+=pad;}
  const index=doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:png.length})-1;
  chunks.push(png);offset+=png.length;return {...image,bufferView:index};
});
doc.buffers[0].byteLength=offset;const bin=Buffer.concat([...chunks,Buffer.alloc((4-offset%4)%4)]);
const json=Buffer.from(JSON.stringify(doc)),jsonPad=Buffer.alloc((json.length+3)&~3,32);json.copy(jsonPad);
const output=Buffer.alloc(28+jsonPad.length+bin.length);output.write('glTF');output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);
output.writeUInt32LE(jsonPad.length,12);output.writeUInt32LE(0x4e4f534a,16);jsonPad.copy(output,20);
const h=20+jsonPad.length;output.writeUInt32LE(bin.length,h);output.writeUInt32LE(0x004e4942,h+4);bin.copy(output,h+8);
const officeNames={Sitting:'office_sitting',Typing:'office_typing',SitDown:'office_sit_down',StandUp:'office_stand_up'};
// AnimationClip.parse preserves JSON UUIDs, and AnimationMixer caches by UUID.
// Omitting them makes sitting/typing/transitions reuse the first cached action.
const motion={clips:animations.filter(c=>officeNames[c.name]).map(c=>officeClipJSON(c,'naruto',officeNames[c.name])),meta};
const serialized=JSON.stringify(motion),modelRevision=hash(output).slice(0,12),motionRevision=createHash('sha256').update(output).update(serialized).digest('hex').slice(0,12);
const manifest={version:2,bytes:output.length,sha256:hash(output),sourceSha256:hash(bytes),sourceArchive:'mingren.zip',sourceFile:'base_basic_pbr.glb',sourceTriangles:37492,triangles:detached.length/3+repairs.triangles,repairTriangles:repairs.triangles,repairLoops:repairs.loops,removedArmBridgeTriangles:removedBridges,sourceVertices:ids.length,repairVertices:repairs.geometry.attributes.position.count,vertices:ids.length+repairs.geometry.attributes.position.count,meshCount:2,skinnedMeshCount:2,textureSha256:source.doc.images.map(i=>{const v=source.doc.bufferViews[i.bufferView];return hash(source.bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength));}),info:{boneCount:joints.length,forward:'+Z',height:sourceBounds.max.y*scale,extraction:'Single character; hand/pouch fused contacts separated and capped',sourceScale:scale,sourceCenterX:centerX,motionLimit:meta.contact},animations:animations.map(c=>({name:c.name,duration:c.duration})),modelRevision,motionRevision};
await mkdir(out,{recursive:true});await writeFile(new URL('naruto_chibi_custom.glb',out),output);await writeFile(new URL('naruto-office.json',out),serialized+'\n');await writeFile(new URL('naruto-custom-manifest.json',out),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));

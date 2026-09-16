// Bake the CC0 Quaternius sitting motions onto Styloo's original rigs.
// Original mesh/texture GLBs are copied unchanged; this writes animation JSON only.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {bakeTyping} from './styloo-typing.mjs';

globalThis.ProgressEvent=class{constructor(type,data){this.type=type;Object.assign(this,data);}};
const loader=new GLTFLoader().register(()=>({name:'offline-texture-placeholder',loadTexture:()=>Promise.resolve(new T.Texture())}));
async function model(path){const b=await readFile(path);return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const sourcePath=new URL('../public/assets/animations/quaternius/',import.meta.url),json=JSON.parse(await readFile(new URL('AnimationLibrary_Godot_Standard.gltf',sourcePath),'utf8'));
for(const b of json.buffers)b.uri='data:application/octet-stream;base64,'+(await readFile(new URL(b.uri,sourcePath))).toString('base64');
const source=await loader.parseAsync(JSON.stringify(json),'');
const worldP=object=>object.getWorldPosition(new T.Vector3()),worldQ=object=>object.getWorldQuaternion(new T.Quaternion());
const sourceBones=new Map();source.scene.updateMatrixWorld(true);source.scene.traverse(o=>{if(o.isBone)sourceBones.set(o.name,{bone:o,restQ:worldQ(o),restP:worldP(o)});});
const sourceHip=sourceBones.get('DEF-hips');if(!sourceHip)throw new Error('Missing source pelvis');
const names={'DEF-spine':'DEF-hips','DEF-spine001':'DEF-spine001','DEF-spine002':'DEF-spine002','DEF-spine003':'DEF-spine003','DEF-spine004':'DEF-neck','DEF-spine006':'DEF-head'};
for(const side of ['L','R'])for(const part of ['shoulder','upper_arm','forearm','hand','thigh','shin','foot','toe'])names[`DEF-${part}${side}`]=`DEF-${part}${side}`;
const outputNames={'Sitting_Enter':'office_sit_down','Sitting_Idle_Loop':'office_sitting','Sitting_Exit':'office_stand_up','Sitting_Talking_Loop':'office_sitting_talk'};
const revisions={},metadata={};
for(const id of ['merchant','student','archer','ninja']){
  const url=new URL(`../public/assets/characters/styloo/${id}pr.glb`,import.meta.url),bytes=await readFile(url),g=await model(url);
  g.scene.updateMatrixWorld(true);const targetBones=[];g.scene.traverse(o=>{if(o.isBone)targetBones.push({bone:o,position:o.position.clone(),quaternion:o.quaternion.clone(),worldQ:worldQ(o),worldP:worldP(o)});});
  const targetHip=targetBones.find(x=>x.bone.name==='DEF-spine'),foot=g.scene.getObjectByName('DEF-footL');
  const targetLeg=worldP(g.scene.getObjectByName('DEF-thighL')).distanceTo(worldP(foot)),sourceLeg=sourceBones.get('DEF-thighL').restP.distanceTo(sourceBones.get('DEF-footL').restP),ratio=targetLeg/sourceLeg;
  const mapped=targetBones.filter(x=>sourceBones.has(names[x.bone.name]));const clips=[];
  for(const [sourceName,name] of Object.entries(outputNames)){
    const clip=source.animations.find(c=>c.name===sourceName),mixer=new T.AnimationMixer(source.scene),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const frames=Math.ceil(clip.duration*30),times=[],values=new Map(mapped.map(x=>[x.bone.name,[]])),hipValues=[];
    for(let frame=0;frame<=frames;frame++){
      const t=frame/frames*clip.duration;times.push(t);mixer.setTime(Math.min(t,clip.duration-1e-6));source.scene.updateMatrixWorld(true);
      for(const info of targetBones){info.bone.position.copy(info.position);info.bone.quaternion.copy(info.quaternion);}g.scene.updateMatrixWorld(true);
      const hipWorld=targetHip.worldP.clone().add(worldP(sourceHip.bone).sub(sourceHip.restP).multiplyScalar(ratio));targetHip.bone.position.copy(targetHip.bone.parent.worldToLocal(hipWorld));
      for(const info of mapped){
        const src=sourceBones.get(names[info.bone.name]),alignment=src.restQ.clone().invert().multiply(info.worldQ);
        // The target is A-posed, the source T-posed. Preserve bone roll while
        // matching limb direction, otherwise the arms fold through the torso.
        if(/DEF-(shoulder|upper_arm|forearm|hand|thigh|shin|foot|toe)/.test(info.bone.name))alignment.set(0,alignment.y,0,alignment.w).normalize();
        const desired=worldQ(src.bone).multiply(alignment);info.bone.quaternion.copy(worldQ(info.bone.parent).invert().multiply(desired));info.bone.updateMatrixWorld(true);values.get(info.bone.name).push(...info.bone.quaternion.toArray());
      }
      hipValues.push(...targetHip.bone.position.toArray());
    }
    const tracks=mapped.map(x=>new T.QuaternionKeyframeTrack(`${x.bone.name}.quaternion`,times,values.get(x.bone.name)));tracks.push(new T.VectorKeyframeTrack('DEF-spine.position',times,hipValues));
    const baked=new T.AnimationClip(name,clip.duration,tracks);clips.push(baked);mixer.stopAllAction();mixer.uncacheRoot(source.scene);
  }
  const mixer=new T.AnimationMixer(g.scene);mixer.clipAction(clips.find(c=>c.name==='office_sitting')).play();mixer.update(.5);g.scene.updateMatrixWorld(true);
  const hp=worldP(targetHip.bone),kp=worldP(g.scene.getObjectByName('DEF-shinL')),fp=worldP(foot),seatTop=.516,seatOffsetY=seatTop+.055-.02-hp.y;
  const bounds=new T.Box3().setFromObject(g.scene);
  const meta={seatedHipY:hp.y,seatedHipZ:hp.z,seatOffsetY,seatOffsetZ:-.34-hp.z,footrestTop:fp.y+seatOffsetY+.02-.055,labelHeight:id==='merchant'?3.2:2.6,ratio};
  console.log(id,JSON.stringify({hip:hp.toArray(),knee:kp.toArray(),foot:fp.toArray(),meta}));
  clips.push(bakeTyping(g.scene,meta));
  const serialized=JSON.stringify({clips:clips.map(T.AnimationClip.toJSON),meta});await writeFile(new URL(`../public/assets/characters/styloo/${id}-office.json`,import.meta.url),serialized);
  revisions[id]=createHash('sha256').update(bytes).update(serialized).digest('hex').slice(0,12);metadata[id]=meta;
}
await writeFile(new URL('../src/assets/styloo-revisions.js',import.meta.url),`// Generated by scripts/build-styloo-seating.mjs.\nexport default ${JSON.stringify(revisions,null,2)};\n`);

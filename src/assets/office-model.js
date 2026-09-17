import * as THREE from 'three';
import {loadModel} from './rigged-model.js';
import {loadStylooModel,loadMotion} from './styloo.js';
import {seatedLifeClip} from './seated-life.js';

const prepared=new Map();
function prepareAnimations(item,animations){
  if(!item.inPlaceWalk)return animations;
  const prepared=animations.map(clip=>{
    if(clip.name!==item.clips.walking)return clip;
    const tracks=clip.tracks.map(track=>{
      if(track.name!==item.inPlaceWalk.track)return track;
      const next=track.clone(),stride=next.getValueSize();
      for(const axis of item.inPlaceWalk.axes){const value=next.values[axis];for(let i=axis;i<next.values.length;i+=stride)next.values[i]=value;}
      return next;
    });
    return new THREE.AnimationClip(clip.name,clip.duration,tracks,clip.blendMode);
  });
  if(item.poseTransitions){
    // The supplied sit/agree clips are pose loops, not sit-down/stand-up
    // motions. Blend their matching endpoints without speeding up the loops.
    const standing=prepared.find(clip=>clip.name===item.clips.idle),seated=prepared.find(clip=>clip.name===item.clips.sitting);
    const duration=item.officeMeta.transitionDuration;
    for(const [name,from,to] of [[item.clips.sitDown,standing,seated],[item.clips.standUp,seated,standing]]){
      const tracks=from.tracks.map(track=>{
        const target=to.tracks.find(other=>other.name===track.name);if(!target)return track.clone();
        const start=track.createInterpolant().evaluate(0),end=target.createInterpolant().evaluate(0),times=[],values=[];
        for(let frame=0;frame<=30;frame++){
          const t=frame/30,blend=t*t*(3-2*t);times.push(t*duration);
          if(track.ValueTypeName==='quaternion'){
            const q=new THREE.Quaternion().fromArray(start).slerp(new THREE.Quaternion().fromArray(end),blend);values.push(...q.toArray());
          }else for(let axis=0;axis<track.getValueSize();axis++)values.push(THREE.MathUtils.lerp(start[axis],end[axis],blend));
        }
        return new track.constructor(track.name,times,values);
      });
      prepared.push(new THREE.AnimationClip(name,duration,tracks));
    }
  }
  return prepared;
}
export function loadOfficeModel(item,{loader=loadModel,motionLoader=loadMotion}={}){
  if(item.kind==='styloo')return loadStylooModel(item,{loader,motionLoader});
  const cache=loader===loadModel&&motionLoader===loadMotion,key=`${item.url}:${item.motionURL}`;
  if(cache&&prepared.has(key))return prepared.get(key);
  const promise=Promise.all([loader(item.url),item.motionURL?motionLoader(item.motionURL):Promise.resolve({clips:[],meta:{}})]).then(([gltf,data])=>({
    ...gltf,animations:prepareAnimations(item,[...gltf.animations,...data.clips.map(clip=>THREE.AnimationClip.parse(clip))].map(clip=>seatedLifeClip(clip,item.id))),
    officeClipNames:item.clips,officeMeta:{...item.officeMeta,...data.meta,seatedLife:Boolean(item.motionURL)},officeHiddenMeshes:[]
  })).catch(error=>{if(cache)prepared.delete(key);throw error;});
  if(cache)prepared.set(key,promise);return promise;
}

import * as THREE from 'three';
import {loadModel} from './rigged-model.js';
import {loadStylooModel,loadMotion} from './styloo.js';
import {seatedLifeClip} from './seated-life.js';

const prepared=new Map();
function prepareAnimations(item,animations){
  if(!item.inPlaceWalk)return animations;
  return animations.map(clip=>{
    if(clip.name!==item.clips.walking)return clip;
    const tracks=clip.tracks.map(track=>{
      if(track.name!==item.inPlaceWalk.track)return track;
      const next=track.clone(),stride=next.getValueSize();
      for(const axis of item.inPlaceWalk.axes){const value=next.values[axis];for(let i=axis;i<next.values.length;i+=stride)next.values[i]=value;}
      return next;
    });
    return new THREE.AnimationClip(clip.name,clip.duration,tracks,clip.blendMode);
  });
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

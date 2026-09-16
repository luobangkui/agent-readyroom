import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {NARUTO_CAST} from '../themes/cast.js';
import revisions from './konoha-revisions.js';

export const MODEL_CATALOG=Object.entries(NARUTO_CAST).filter(([id])=>Object.hasOwn(revisions,id)).map(([id,style])=>({id,name:style.name,file:id,color:style.shirt,url:`/assets/characters/konoha/${id}.glb?v=${revisions[id]}`}));

const cache=new Map();
export function loadModel(url){
  if(!cache.has(url))cache.set(url,new GLTFLoader().loadAsync(url).catch(error=>{cache.delete(url);throw error;}));
  return cache.get(url);
}

export const KAYKIT_CLIPS={idle:'Idle',walking:'Walking_A',sitting:'Sit_Chair_Idle',sitDown:'Sit_Chair_Down',standUp:'Sit_Chair_StandUp'};
export const isSeatedMotion=state=>state==='sitting'||state==='typing';

// One mixer per cloned skeleton. Model files, clip names and seat dimensions are
// independent of session identities; a new art pack supplies a new adapter.
export function createRiggedModel(gltf){
  const scene=clone(gltf.scene),offsetY=gltf.officeMeta?.modelOffsetY??0;
  const root=offsetY?new THREE.Group():scene;
  if(offsetY){scene.position.y+=offsetY;root.add(scene);}
  for(const name of gltf.officeHiddenMeshes||[])root.getObjectByName(name)?.removeFromParent();
  root.traverse(object=>{
    if(object.name.startsWith('handslot'))object.visible=false;
    if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}
  });
  const motion=new RiggedMotion(root,gltf.animations,gltf.officeClipNames);
  motion.seatedLife=!!gltf.officeMeta?.seatedLife;
  return {root,motion,dispose(){motion.dispose();root.removeFromParent();}};
}

export class RiggedMotion {
  constructor(root,clips,names=KAYKIT_CLIPS){
    this.root=root;this.names=names;this.clips=new Map(clips.map(clip=>[clip.name,clip]));
    this.mixer=new THREE.AnimationMixer(root);this.state='idle';this.target='idle';this.action=null;this.typingBlend=0;
    this.onFinished=event=>{
      if(event.action!==this.action)return;
      if(this.state==='sitDown')this.play(isSeatedMotion(this.target)?this.target:'sitting');
      else if(this.state==='standUp')this.play(isSeatedMotion(this.target)?'idle':this.target);
    };
    this.mixer.addEventListener('finished',this.onFinished);
    this.play('idle',0);
    this.mixer.update(0);
  }
  has(state){return this.clips.has(this.names[state]);}
  request(target){
    if(!['idle','walking','sitting','typing','agree'].includes(target)||!this.has(target))return false;
    this.target=target;return true;
  }
  play(state,fade=.18){
    const clip=this.clips.get(this.names[state]);if(!clip)return false;
    const previous=this.action,next=this.mixer.clipAction(clip);
    next.reset().setEffectiveTimeScale(state==='typing'?(this.typingRate??1):['idle','sitting'].includes(state)?.65:1).setEffectiveWeight(1);
    next.setLoop(['sitDown','standUp'].includes(state)?THREE.LoopOnce:THREE.LoopRepeat,Infinity);
    next.clampWhenFinished=['sitDown','standUp'].includes(state);
    if(state==='typing'||state==='sitting'&&this.seatedLife)next.time=(this.phaseOffset??0)*clip.duration;
    next.play();if(previous&&previous!==next)next.crossFadeFrom(previous,fade,false);
    this.action=next;this.state=state;return true;
  }
  update(dt){
    const transition=['sitDown','standUp'].includes(this.state);
    if(!transition&&this.state!==this.target){
      if(isSeatedMotion(this.state)&&isSeatedMotion(this.target))this.play(this.target,.4);
      else if(isSeatedMotion(this.state)){
        // Pull away from the desk before standing so knees clear the desktop.
        if(this.state==='typing')this.play('sitting',.4);
        else if(this.typingBlend<.01)this.play(this.has('standUp')?'standUp':this.target);
      }
      else if(isSeatedMotion(this.target))this.play(this.has('sitDown')?'sitDown':this.target);
      else this.play(this.target);
    }
    this.mixer.update(dt);
    this.typingBlend=THREE.MathUtils.damp(this.typingBlend,this.state==='typing'?1:0,10,dt);
  }
  get canMove(){return this.state==='walking'&&this.target==='walking';}
  dispose(){this.mixer.removeEventListener('finished',this.onFinished);this.mixer.stopAllAction();this.mixer.uncacheRoot(this.root);}
}

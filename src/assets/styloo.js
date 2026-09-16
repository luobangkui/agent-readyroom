import * as THREE from 'three';
import {loadModel} from './rigged-model.js';
import revisions from './styloo-revisions.js';

export const STYLOO_MODELS=[
  {id:'merchant',name:'可可',archetype:'商人',color:'#967251'},
  {id:'student',name:'小满',archetype:'学生',color:'#596d98'},
  {id:'archer',name:'夏禾',archetype:'弓箭手',color:'#86a353'},
  {id:'ninja',name:'阿澄',archetype:'忍者',color:'#915c63'}
].map(item=>({...item,url:`/assets/characters/styloo/${item.id}pr.glb?v=${revisions[item.id]}`,motionURL:`/assets/characters/styloo/${item.id}-office.json?v=${revisions[item.id]}`,clips:{idle:item.id==='ninja'?'iddleanim_':'anim_iddle',walking:item.id==='ninja'?'walkanim_':'anim_walk',sitting:'office_sitting',typing:'office_typing',sitDown:'office_sit_down',standUp:'office_stand_up'}}));

// Standalone boss asset supplied by the user. Its GLB carries its own clips,
// while the four original Styloo entries retain their authored office motion.
export const RUKIA_MODEL={id:'rukia',name:'露琪亚',archetype:'死神',color:'#26334d',scale:1.92,url:'/assets/characters/styloo/rukia_chibi.glb?v=e59769e9a90f',motionURL:null,clips:{idle:'Idle',walking:'Walk',sitting:'Sit',typing:'Sit',sitDown:'Sit',standUp:'Sit'}};

export const loadMotion=async url=>{const response=await fetch(url);if(!response.ok)throw new Error('无法加载办公动作');return response.json();};
const prepared=new Map();
export async function loadStylooModel(item,{loader=loadModel,motionLoader=loadMotion}={}){
  const key=item.id,canCache=loader===loadModel&&motionLoader===loadMotion;
  if(canCache&&prepared.has(key))return prepared.get(key);
  const promise=Promise.all([loader(item.url),item.motionURL?motionLoader(item.motionURL):Promise.resolve({clips:[],meta:{}})]).then(([gltf,data])=>{
    const materials=new Map();
    gltf.scene.traverse(object=>{if(!object.isMesh)return;const convert=m=>{if(m.isMeshBasicMaterial)return m;if(!materials.has(m))materials.set(m,new THREE.MeshBasicMaterial({name:m.name,map:m.map,color:m.color,alphaMap:m.alphaMap,alphaTest:m.alphaTest,transparent:m.transparent,opacity:m.opacity,side:m.side,vertexColors:m.vertexColors}));return materials.get(m);};object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);});
    return {...gltf,animations:[...gltf.animations,...data.clips.map(clip=>THREE.AnimationClip.parse(clip))],officeClipNames:item.clips,officeHiddenMeshes:['hat','bag'],officeMeta:{...data.meta,labelHeight:data.meta.labelHeight??2.65}};
  }).catch(error=>{if(canCache)prepared.delete(key);throw error;});
  if(canCache)prepared.set(key,promise);return promise;
}

export function stylooSceneEntries(agents){
  const entries=[...agents];
  for(let index=entries.length;index<4;index++)entries.push({id:`office-resident-${index}`,role:'resident',name:STYLOO_MODELS[index].name,status:'idle',sceneOnly:true});
  return entries;
}

export function stylooPersonName(agent,agents=[]){
  const index=agents.findIndex(a=>a.id===agent.id);
  if(index>=0)return STYLOO_MODELS[index%STYLOO_MODELS.length].name;
  if(agent.id==='preview-boss')return STYLOO_MODELS[0].name;
  if(agent.id==='preview-worker')return STYLOO_MODELS[1].name;
  return agent.name;
}

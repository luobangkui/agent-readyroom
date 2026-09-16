import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const cache=new Map();
export const COURTYARD_PROPS={plant:'potted_plant_02',teaTable:'chinese_tea_table'};
export function loadCourtyardProp(kind,{loader=url=>new GLTFLoader().loadAsync(url)}={}){
  const id=COURTYARD_PROPS[kind];if(!id)throw new Error('Unknown courtyard prop');
  if(!cache.has(id))cache.set(id,loader(`/assets/courtyard/${id}/model.gltf`).catch(error=>{cache.delete(id);throw error;}));
  return cache.get(id);
}

export function placeCourtyardProp(gltf,parent,{name,width,depth,height,x,y,z,rotation=0}){
  const root=new T.Group();root.name=name;const model=gltf.scene.clone(true);root.add(model);
  model.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(model),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
  const scale=Math.min(width/size.x,depth/size.z,height/size.y);model.scale.setScalar(scale);model.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);
  root.position.set(x,y,z);root.rotation.y=rotation;root.userData={source:'Poly Haven CC0',importedProp:true};
  model.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;}});parent.add(root);return root;
}

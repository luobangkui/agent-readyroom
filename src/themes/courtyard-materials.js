import * as T from 'three';

export const COURTYARD_MATERIALS={
  wood:{asset:'oak_veneer_01',size:1.8,normal:.22,roughness:.86,ao:.22,grainAxis:'v'},
  timber:{asset:'coated_pine',size:.7,normal:.22,roughness:.9,ao:.22,grainAxis:'u'},
  plaster:{asset:'white_plaster_02',size:1,normal:.13,roughness:1,ao:.15},
  fabric:{asset:'cotton_jersey',size:.3,normal:.35,roughness:1,ao:.24}
};
let shared;
export function createCourtyardMaterials(){
  if(shared)return shared;
  const textures=new Map(),materials=new Map(),pending=[];
  function maps(kind){
    if(textures.has(kind))return textures.get(kind);
    const config=COURTYARD_MATERIALS[kind],result={};
    if(typeof document!=='undefined')for(const [channel,name] of Object.entries({map:'color',normalMap:'normal',roughnessMap:'roughness',aoMap:'ao'})){
      const url=`/assets/courtyard/${config.asset}/${name}.jpg`;
      let texture;const promise=new Promise((resolve,reject)=>{texture=new T.TextureLoader().load(url,resolve,()=>{},()=>reject(new Error('庭院材质加载失败：'+url)));});
      texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.anisotropy=4;texture.colorSpace=channel==='map'?T.SRGBColorSpace:T.NoColorSpace;
      result[channel]=texture;pending.push(promise);
    }
    textures.set(kind,result);return result;
  }
  function material(kind,color,extra={}){
    const key=kind+color+JSON.stringify(extra);if(materials.has(key))return materials.get(key);
    const config=COURTYARD_MATERIALS[kind],tint=new T.Color(color);
    if(kind==='wood')tint.lerp(new T.Color('#ffffff'),.55);
    if(kind==='timber')tint.lerp(new T.Color('#ffffff'),.35);
    const result=new T.MeshStandardMaterial({color:tint,...maps(kind),normalScale:new T.Vector2(config.normal,config.normal),roughness:config.roughness,metalness:0,aoMapIntensity:config.ao,...extra});
    result.userData={courtyardMaterial:kind,source:config.asset};materials.set(key,result);return result;
  }
  shared={material,apply(object,kind,color,extra={}){projectMaterialUV(object,kind);object.material=material(kind,color,extra);return object;},ready(){return Promise.all(pending);}};
  return shared;
}

// Respect physical scale and the long axis of timber. Scaling the same square
// image to every board/beam stretches grain and makes architectural parts toy-like.
export function projectMaterialUV(object,kind){
  const g=object.geometry;if(!g.attributes.uv||!g.attributes.normal)return;
  if(!/Box|Plane/.test(g.type))return;
  if(g.userData.courtyardUV===kind)return;
  const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv,unit=COURTYARD_MATERIALS[kind].size;
  g.computeBoundingBox();const size=g.boundingBox.getSize(new T.Vector3()).toArray(),long=size.indexOf(Math.max(...size));
  const phase=(Math.sin(object.position.x*19.17+object.position.z*7.23)*437.3)%1;
  for(let i=0;i<p.count;i++){
    const normal=[Math.abs(n.getX(i)),Math.abs(n.getY(i)),Math.abs(n.getZ(i))],face=normal.indexOf(Math.max(...normal));
    const axes=[0,1,2].filter(axis=>axis!==face);
    if(COURTYARD_MATERIALS[kind].grainAxis==='v'&&axes[0]===long)axes.reverse();
    if(COURTYARD_MATERIALS[kind].grainAxis==='u'&&axes[1]===long)axes.reverse();
    uv.setXY(i,p.getComponent(i,axes[0])/unit+phase,p.getComponent(i,axes[1])/unit+phase*.31);
  }
  uv.needsUpdate=true;g.userData.courtyardUV=kind;
}

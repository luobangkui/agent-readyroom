// Reproducible fan-art adaptations of the CC0 KayKit rigged base meshes.
// Geometry/material edits only; no game extraction or private viewer downloads.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {hairCap,lockGeometry} from '../src/themes/sculpt.js';
import {NARUTO_CAST} from '../src/themes/cast.js';
import {refineFemale} from './konoha-female.mjs';

globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onloadend?.();});}};
const loader=new GLTFLoader().register(()=>({name:'palette-replaced-at-build',loadTexture:()=>Promise.resolve(new T.Texture())}));
async function load(name){const bytes=await readFile(new URL(`../public/assets/characters/kaykit/${name}.glb`,import.meta.url));return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
const sources={Rogue:await load('Rogue'),Mage:await load('Mage'),Barbarian:await load('Barbarian')};
const clips=new Set(['Idle','Walking_A','Sit_Chair_Idle','Sit_Chair_Down','Sit_Chair_StandUp','Interact','Use_Item','Cheer','PickUp','T-Pose']);
const mat=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.78,...extra});
const slot=(uv,i)=>`${Math.floor(uv.getX(i)*8)},${Math.floor(uv.getY(i)*4)}`;
function recolor(mesh,palette,keep=()=>true){
  const g=mesh.geometry.clone(),uv=g.attributes.uv,idx=g.index.array,selected=[];
  for(let i=0;i<idx.length;i+=3)if(keep(slot(uv,idx[i]),[idx[i],idx[i+1],idx[i+2]],g))selected.push(idx[i],idx[i+1],idx[i+2]);
  g.setIndex(selected);const colors=[];
  for(let i=0;i<uv.count;i++){const color=new T.Color(palette[slot(uv,i)]||'#3d4549');color.multiplyScalar(.82+.22*(1-uv.getY(i)*4%1));colors.push(color.r,color.g,color.b);}
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  if(mesh.name.includes('Face')||mesh.name.includes('Scalp')){
    const normals=new Map(),p=g.attributes.position,a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
    const key=i=>`${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)},${slot(uv,i)}`;
    for(let i=0;i<selected.length;i+=3){a.fromBufferAttribute(p,selected[i]);b.fromBufferAttribute(p,selected[i+1]);c.fromBufferAttribute(p,selected[i+2]);const normal=b.sub(a).cross(c.sub(a));for(const v of selected.slice(i,i+3)){const k=key(v);if(!normals.has(k))normals.set(k,new T.Vector3());normals.get(k).add(normal);}}
    for(let i=0;i<p.count;i++){const normal=normals.get(key(i));if(normal){normal.normalize();g.attributes.normal.setXYZ(i,normal.x,normal.y,normal.z);}}
  }
  g.deleteAttribute('uv');mesh.geometry=g;mesh.material=mat('#ffffff',{vertexColors:true});mesh.castShadow=mesh.receiveShadow=true;
}
function surfaceZ(mesh,x,y){
  const g=mesh.geometry,p=g.attributes.position,idx=g.index.array;let max=.2;
  for(let i=0;i<idx.length;i+=3){const [a,b,c]=[idx[i],idx[i+1],idx[i+2]],ax=p.getX(a),ay=p.getY(a),bx=p.getX(b),by=p.getY(b),cx=p.getX(c),cy=p.getY(c),d=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(d)<1e-8)continue;const u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/d,v=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/d;if(u>=0&&v>=0&&u+v<=1)max=Math.max(max,u*p.getZ(a)+v*p.getZ(b)+(1-u-v)*p.getZ(c));}return max;
}

function build(id,style){
  const base=id==='hiruzen'?'Mage':'Rogue',gltf=sources[base],root=clone(gltf.scene);root.name=`Konoha_${id}`;root.userData={character:id,source:'KayKit CC0 base; custom Konoha fan-art adaptation',official:false};
  const rig=root.getObjectByName('Rig'),headBone=root.getObjectByName('head'),chest=root.getObjectByName('chest');
  const shirt=id==='naruto'?'#ee8629':id==='kakashi'?'#657950':style.shirt,pants=style.pants,skin=style.skin;
  root.traverse(o=>{
    if(o.isMesh&&!o.isSkinnedMesh)o.visible=false;
    if(!o.isSkinnedMesh)return;
    if(o.name.endsWith('_Head')){o.visible=false;return;}
    if(o.name.includes('_Arm'))recolor(o,base==='Mage'?{'0,1':shirt,'7,2':skin,'4,0':'#a8574a'}:{'0,1':style.vest?'#2f4248':shirt,'1,1':id==='naruto'?'#263745':shirt,'5,0':style.vest?'#2f4248':shirt,'5,2':skin});
    else if(o.name.endsWith('_Body'))recolor(o,base==='Mage'?{'0,1':'#eee4d0','4,0':'#a55343','7,1':'#e8decd','5,0':'#eee4d0','3,0':'#ddd5bd','2,2':'#eee4d0','0,2':'#d3bf9c'}:{'0,1':shirt,'1,1':id==='naruto'?'#263745':shirt,'7,1':pants,'5,0':shirt,'6,0':shirt,'3,0':'#626b64'});
    else recolor(o,{'7,1':pants,'3,2':'#303c43','0,0':id==='naruto'?pants:skin});
  });
  const sourceHead=id==='hiruzen'?sources.Barbarian.scene.getObjectByName('Barbarian_Head'):sources.Rogue.scene.getObjectByName('Rogue_Head');
  const face=new T.SkinnedMesh(sourceHead.geometry,mat('#fff'));face.name=`${id}_Face`;
  face.position.copy(sourceHead.position);face.quaternion.copy(sourceHead.quaternion);face.scale.copy(sourceHead.scale);
  const skeleton=new T.Skeleton(sourceHead.skeleton.bones.map(b=>root.getObjectByName(b.name)),sourceHead.skeleton.boneInverses.map(m=>m.clone()));face.bind(skeleton,sourceHead.bindMatrix.clone());rig.add(face);
  recolor(face,{'0,0':skin,'1,0':'#a6a7a0','2,0':'#202d35'},key=>id==='hiruzen'||['0,0','2,0'].includes(key));
  if(id!=='hiruzen'){
    const source=sources.Barbarian.scene.getObjectByName('Barbarian_Head'),scalp=new T.SkinnedMesh(source.geometry,mat(skin));scalp.name=`${id}_Scalp`;scalp.position.copy(source.position);scalp.position.z-=.008;scalp.quaternion.copy(source.quaternion);scalp.scale.copy(source.scale);scalp.bind(new T.Skeleton(source.skeleton.bones.map(b=>root.getObjectByName(b.name)),source.skeleton.boneInverses.map(m=>m.clone())),source.bindMatrix.clone());rig.add(scalp);
    recolor(scalp,{'0,0':skin},key=>key==='0,0');scalp.geometry.scale(.987,1,.987);
  }
  const decor=new T.Group();decor.name=`${id}_Head_Details`;root.add(decor);
  const add=(geometry,color,x=0,y=0,z=0,parent=decor,extra={})=>{const o=new T.Mesh(geometry,mat(color,extra));o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;parent.add(o);return o;};
  const box=(w,h,d,color,x,y,z,parent=decor,r=.02)=>add(new RoundedBoxGeometry(w,h,d,3,Math.min(r,w/3,h/3,d/3)),color,x,y,z,parent);
  const line=(points,color,r=.009,parent=decor)=>{const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));return add(new T.TubeGeometry(curve,Math.max(8,points.length*6),r,8,false),color,0,0,0,parent);};
  const faceLine=(points,color,r=.008)=>line(points.map(([x,y])=>[x,y,surfaceZ(face,x,y)+.012]),color,r);
  const hair=new T.Group();hair.position.set(0,1.73,-.015);hair.scale.setScalar(1.48);decor.add(hair);
  add(hairCap(['hinata','itachi'].includes(id)),style.hair,0,0,0,hair);
  const lock=(a,b,c,w=.09)=>add(lockGeometry(a,b,c,w),style.hair,0,0,0,hair);
  if(['naruto','kakashi','gaara'].includes(id)){
    for(let i=0;i<9;i++){const x=-.31+i*.077,lean=id==='kakashi'?.15:0;lock([x,.20,.01],[x+lean,.34,-.035],[x*1.35+lean,.43+.055*Math.sin(i*1.8),-.08],.075);}
    for(const side of [-1,1])for(let i=0;i<3;i++)lock([side*.27,.12-i*.055,-.01],[side*.37,.16-i*.055,-.04],[side*(.43-i*.03),.12-i*.07,-.07],.065);
    for(let i=0;i<5;i++){const x=(i-2)*.095;lock([x,.27,.19],[x,.22,.30],[x*1.2,.13,.31],.055);}
  }else if(id==='sasuke'){
    for(const side of [-1,1]){lock([side*.05,.30,.18],[side*.20,.21,.33],[side*.26,-.20,.22],.105);for(let i=0;i<4;i++)lock([side*.24,.18-i*.06,-.18],[side*.36,.24-i*.06,-.28],[side*.43,.23-i*.08,-.39],.09);}
  }else if(['sakura','hinata','itachi'].includes(id)){
    for(const side of [-1,1]){lock([side*.03,.31,.17],[side*.18,.22,.32],[side*.26,.02,.30],.11);for(let i=0;i<3;i++)lock([side*(.25+i*.025),.14,-.08+i*.06],[side*.35,-.10,-.02+i*.02],[side*.29,id==='sakura'?-.25:-.46,.08],.082);}
    if(id==='hinata')for(let i=0;i<5;i++){const x=(i-2)*.08;lock([x,.29,.20],[x,.22,.30],[x,.12,.323],.059);}
  }else if(id==='shikamaru'){
    for(let i=0;i<7;i++)lock([0,.22,-.29],[(i-3)*.05,.40,-.37],[(i-3)*.11,.56,-.40],.07);
  }
  // Authored face mesh supplies the nose, cheeks and eye sockets. Details follow
  // its surface instead of hovering on a flat face card.
  if(id!=='hiruzen')for(const side of [-1,1]){
    if(!(id==='kakashi'&&side===1)){
      const x=side*.181,y=1.59,z=surfaceZ(face,x,y)+.023;
      const iris=add(new T.SphereGeometry(.044,20,16),style.iris,x,y,z);iris.scale.set(.80,1,.22);
      const pupil=add(new T.SphereGeometry(.023,16,12),'#18252c',x,y,z+.011);pupil.scale.z=.25;
      add(new T.SphereGeometry(.012,12,8),'#fff8df',x-.011,y+.014,z+.019);
    }
    faceLine([[side*.12,1.73],[side*.20,1.75],[side*.28,1.73]],id==='naruto'?'#ad752e':style.hair,.012);
  }
  if(id==='naruto')for(const side of [-1,1])for(let i=0;i<3;i++)faceLine([[side*.285,1.57-i*.065],[side*.42,1.60-i*.07]],'#8b6546',.008);
  if(id==='itachi')for(const side of [-1,1])faceLine([[side*.16,1.49],[side*.21,1.41],[side*.29,1.36]],'#ae8773',.006);
  if(id==='hiruzen')for(const side of [-1,1])for(let i=0;i<2;i++)faceLine([[side*.30,1.61-i*.08],[side*.39,1.59-i*.08]],'#a58369',.006);
  function badge(parent,x,y,z,size=.20){const spiral=[];for(let i=0;i<=45;i++){const t=i/45*Math.PI*3.4,r=.018+.045*i/45;spiral.push([x+Math.cos(t)*r*size/.2,y+Math.sin(t)*r*size/.2,z]);}spiral.push([x+.092*size/.2,y+.044*size/.2,z],[x+.068*size/.2,y+.09*size/.2,z],[x+.042*size/.2,y+.041*size/.2,z]);line(spiral,'#445158',.007,parent);}
  if(style.headband){
    const band=add(new T.CylinderGeometry(.536,.536,.15,64,1,true),'#2a3946',0,1.855,-.015);band.scale.z=.92;
    const plate=box(.57,.205,.036,'#afbfc3',id==='kakashi'?.06:0,id==='kakashi'?1.82:1.86,.487);if(id==='kakashi')plate.rotation.z=-.21;
    badge(decor,id==='kakashi'?.06:0,id==='kakashi'?1.81:1.86,.510);
    for(const side of [-1,1])add(new T.SphereGeometry(.016,12,8),'#566c73',side*.245,1.86,.515);
    for(const side of [-1,1])line([[side*.08,1.86,-.51],[side*.15,1.69,-.56],[side*.19,1.43,-.54]],'#263946',.024);
  }
  if(id==='kakashi'){
    const positions=[],indices=[],rows=10,cols=32;
    for(let row=0;row<=rows;row++)for(let col=0;col<=cols;col++){const t=row/rows,x=(col/cols-.5)*(.53+.35*t),y=1.285+t*.30+Math.pow(Math.abs(x)/.44,2)*.05*(1-t),z=surfaceZ(face,x,y)+.014;positions.push(x,y,z);if(row<rows&&col<cols){const k=row*(cols+1)+col;indices.push(k,k+1,k+cols+1,k+1,k+cols+2,k+cols+1);}}
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();add(geo,'#30424c',0,0,0,decor,{side:T.DoubleSide});
    box(.22,.24,.03,'#a7b8be',.19,1.71,.465).rotation.z=-.21;
  }
  if(id==='hiruzen'){
    const hat=new T.Group();hat.position.set(0,2.12,0);decor.add(hat);
    add(new T.CylinderGeometry(.73,.73,.055,64),'#f1e7d1',0,0,0,hat);
    add(new T.ConeGeometry(.705,.44,64),'#b6533f',0,.232,0,hat);
    const panel=add(new T.ConeGeometry(.712,.445,32,1,true,-.42,.84),'#f5edd8',0,.234,.002,hat,{side:T.DoubleSide});
    // Four simple raised strokes form 火 on the white front panel.
    const fire=new T.Group();fire.position.set(0,.195,.432);fire.rotation.x=-1.012;hat.add(fire);
    for(const p of [[[-.02,.12,0],[.01,.04,0],[-.035,-.07,0],[-.12,-.14,0]],[[-.02,-.03,0],[.05,-.10,0],[.13,-.14,0]],[[-.11,.07,0],[-.13,-.01,0]],[[.11,.10,0],[.07,.035,0]]])line(p,'#a84032',.013,fire);
    for(const side of [-1,1])box(.23,.60,.045,'#eee4d1',side*.44,1.78,-.17);
  }
  const outfit=new T.Group();outfit.name=`${id}_Outfit_Details`;root.add(outfit);
  if(id==='naruto')box(.035,.58,.04,'#293e4b',0,.83,.321,outfit,.006);
  if(style.vest){for(const side of [-1,1])for(let i=0;i<2;i++)box(.23,.19,.07,'#7d8d59',side*.16,.76+i*.22,.327,outfit,.025);}
  if(id==='sasuke'){
    const rope=add(new T.TorusGeometry(.335,.042,10,48),'#8b78a6',0,.57,0,outfit);rope.rotation.x=Math.PI/2;line([[.3,.57,-.03],[.48,.50,.04],[.3,.40,.10]],'#8b78a6',.036,outfit);
    for(const side of [-1,1])box(.22,.21,.07,'#e9e3d7',side*.17,1.21,.20,outfit,.035).rotation.z=side*.23;
  }
  if(id==='gaara'){
    const gourd=add(new T.SphereGeometry(.25,28,20),'#b59a68',0,.70,-.43,outfit);gourd.scale.set(1,1.1,.8);add(new T.SphereGeometry(.18,24,16),'#b59a68',0,1.04,-.40,outfit);box(.16,.09,.13,'#856941',0,1.24,-.40,outfit);
  }
  if(id==='itachi'){
    for(const side of [-1,1])box(.27,.30,.07,'#293944',side*.15,1.22,.22,outfit,.03).rotation.z=side*.19;
    for(const [x,y] of [[-.16,.87],[.15,.58]]){for(const [dx,dy,r] of [[0,0,.064],[-.062,-.015,.05],[.06,.022,.048]]){const cloud=add(new T.SphereGeometry(r,20,12),'#c24f50',x+dx,y+dy,.33,outfit);cloud.scale.set(1,.7,.18);}}
  }
  if(id==='hiruzen'){
    box(.12,.72,.038,'#a85d4c',0,.78,.337,outfit,.008);
    for(const side of [-1,1])box(.17,.25,.08,'#eee5d1',side*.12,1.23,.24,outfit,.026).rotation.z=side*.25;
  }
  root.updateMatrixWorld(true);headBone.attach(decor);chest.attach(outfit);root.updateMatrixWorld(true);
  if(style.feminine)refineFemale(root,id);
  return {root,animations:gltf.animations.filter(clip=>clips.has(clip.name))};
}

const out=new URL('../public/assets/characters/konoha/',import.meta.url),revisions={};await mkdir(out,{recursive:true});
// Naruto and Hiruzen use the current custom assets; do not regenerate retired GLBs.
for(const [id,style] of Object.entries(NARUTO_CAST).filter(([id])=>!['naruto','hiruzen'].includes(id))){const {root,animations}=build(id,style);const data=await new GLTFExporter().parseAsync(root,{binary:true,animations,onlyVisible:true});await writeFile(new URL(`${id}.glb`,out),Buffer.from(data));revisions[id]=createHash('sha256').update(Buffer.from(data)).digest('hex').slice(0,12);console.log(`${id}: ${(data.byteLength/1024).toFixed(0)} KB / ${animations.length} clips`);}
await writeFile(new URL('../src/assets/konoha-revisions.js',import.meta.url),`// Generated by scripts/build-konoha-models.mjs.\nexport default ${JSON.stringify(revisions,null,2)};\n`);
await writeFile(new URL('CREDITS.txt',out),'Konoha Q-style fan-art adaptations for the local Office project.\nBase character mesh and skeleton: Kay Lousberg / KayKit Adventurers 1.0, CC0.\nhttps://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0\nCustom modeled hair, outfit details, symbols and vertex palettes generated by scripts/build-konoha-models.mjs.\nNaruto characters belong to their respective rights holders. This is unofficial fan art, not a licensed official model pack.\nOriginal CC0 declaration: ../kaykit/LICENSE.txt\n');

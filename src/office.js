import * as THREE from 'three';
import {protectActorView} from './office-camera.js';
import {DESK_ERGONOMICS as D} from './desk-ergonomics.js';
import {updateCharacterPose} from './character-motion.js';
import {getTheme,supportsAvatarSelection} from './themes/index.js';
import {createCharacter} from './themes/character.js';
import {createEnvironment} from './themes/environment.js';
import {createCourtyardMaterials} from './themes/courtyard-materials.js';
import {ROOM,WORKSTATIONS,WORK_ISLAND,FURNITURE,extraHome} from './room-layout.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const C = { wood:'#c99b6b', edge:'#b8895c', cream:'#eee8d8', wall:'#e4e4d5', sage:'#95a487', dark:'#424f45', metal:'#536257', terracotta:'#c77e59', leaf:'#718b57', skin:'#ecc39f', hair:'#484237' };
const mats = new Map();
function material(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: .78, ...extra }));
  return mats.get(key);
}
function mesh(parent, geometry, color, x=0, y=0, z=0, extra={}) {
  const object = new THREE.Mesh(geometry, material(color, extra));
  object.position.set(x,y,z); object.castShadow=true; object.receiveShadow=true; parent.add(object); return object;
}
function box(parent,w,h,d,color,x=0,y=0,z=0,r=.04) {
  return mesh(parent,r ? new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/3,h/3,d/3)) : new THREE.BoxGeometry(w,h,d),color,x,y,z);
}
function sphere(parent,r,color,x=0,y=0,z=0,sx=1,sy=1,sz=1) {
  const object=mesh(parent,new THREE.SphereGeometry(r,16,12),color,x,y,z); object.scale.set(sx,sy,sz);return object;
}
function cylinder(parent,rt,rb,h,color,x=0,y=0,z=0) { return mesh(parent,new THREE.CylinderGeometry(rt,rb,h,24),color,x,y,z); }
function group(parent,x=0,y=0,z=0) { const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);return g; }
function textPanel(parent,text,width,height,x,y,z,{bg='#e9e6d7',fg='#64745c',size=44}={}) {
  if(typeof document==='undefined')return mesh(parent,new THREE.PlaneGeometry(width,height),bg,x,y,z);
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=Math.round(1024*height/width);
  const ctx=canvas.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle=fg;
  ctx.font=`600 ${size}px "Hiragino Sans", "PingFang SC", Arial, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  text.split('\n').forEach((line,i,arr)=>ctx.fillText(line,512,canvas.height/2+(i-(arr.length-1)/2)*(size*1.6)));
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const obj=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshStandardMaterial({map:texture,roughness:1}));
  obj.position.set(x,y,z);parent.add(obj);return obj;
}
function plant(parent,x,z,scale=1) {
  const p=group(parent,x,0,z);p.scale.setScalar(scale);
  cylinder(p,.31,.23,.51,C.terracotta,0,.255,0);cylinder(p,.33,.33,.085,'#d89870',0,.51,0);cylinder(p,.28,.28,.03,'#685441',0,.55,0);
  for(let i=0;i<7;i++) {
    const a=i*2.399, r=.15+(i%3)*.085, h=.87+(i%3)*.22;
    const stem=cylinder(p,.018,.022,h-.52,'#6c7950',Math.sin(a)*r/2,(h+.52)/2,Math.cos(a)*r/2);stem.rotation.z=Math.sin(a)*.15;
    const leaf=sphere(p,.27,i%2?'#829c65':'#6f8a58',Math.sin(a)*r,h,Math.cos(a)*r,.57,1.5,.36);leaf.rotation.z=-Math.sin(a)*.65;leaf.rotation.x=Math.cos(a)*.7;
  }
  return p;
}
function mug(parent,x,y,z,color='#ede5d0') {
  const p=group(parent,x,y,z);cylinder(p,.09,.078,.19,color,0,.10,0);cylinder(p,.073,.073,.008,'#71533a',0,.197,0);
  const handle=mesh(p,new THREE.TorusGeometry(.067,.021,8,16),color,.1,.12,0);handle.rotation.y=0;return p;
}
function chair(parent,x,z,color,rotation=0) {
  const p=group(parent,x,0,z);p.rotation.y=rotation;
  cylinder(p,.055,.075,.48,C.metal,0,.26,0);
  for(let i=0;i<5;i++){const a=i*Math.PI*2/5;const leg=box(p,.55,.045,.045,C.metal,Math.sin(a)*.19,.08,Math.cos(a)*.19);leg.rotation.y=Math.PI/2-a;sphere(p,.058,'#474f44',Math.sin(a)*.4,.075,Math.cos(a)*.4);}
  box(p,.72,.17,.68,color,0,.56,0,.075);box(p,.72,.65,.14,color,0,.94,-.28,.065);
  for(const side of [-1,1]){box(p,.05,.24,.05,C.metal,side*.39,.73,0);box(p,.11,.06,.43,C.metal,side*.39,.86,.015);}
  return p;
}
function desk(parent,x,z,{rotation=0,boss=false,accent='#82967d',width=2.7}={}) {
  const p=group(parent,x,0,z);p.rotation.y=rotation;
  const w=width;
  box(p,w,.16,1.10,C.wood,0,1.05,-.07,.065);box(p,w,.035,1.10,'#d6ae80',0,1.14,-.07,.018);
  for(const dx of [-w/2+.2,w/2-.2])for(const dz of [-.42,.42])box(p,.095,1,.095,C.metal,dx,.52,dz);
  box(p,.62,.77,.93,'#a1ad93',-w/2+.44,.54,-.02);
  for(const dy of [.36,.62,.88]){box(p,.57,.225,.015,'#b8c1ab',-w/2+.44,dy,.454,.01);box(p,.19,.025,.03,'#76866b',-w/2+.44,dy+.03,.48);}
  box(p,1.75,.012,.7,accent,.2,1.164,.15,.015);
  // Monitor's screen faces +z, toward the seated worker.
  box(p,.43,.035,.26,C.metal,.18,1.20,-.27);box(p,.07,.3,.06,C.metal,.18,1.36,-.34);
  box(p,1.04,.65,.075,'#4d5c51',.18,1.7,-.33,.055);
  mesh(p,new THREE.PlaneGeometry(.93,.535),'#b9ccc0',.18,1.70,-.287,{emissive:'#82a99b',emissiveIntensity:.12});
  box(p,.14,.48,.008,'#8ea99c',-.2,1.7,-.279,.005);
  for(let i=0;i<5;i++)box(p,.23+(i%3)*.11,.019,.012,i===1?'#e7d3a3':'#698f7d',.12+(i%2)*.02,1.87-i*.08,-.27,.002);
  // A pull-out tray brings the keys below the desktop for the chibi rig.
  box(p,1.02,.055,.43,'#b6aa8e',0,.95,.64,.02);
  for(const side of [-1,1])box(p,.035,.10,.40,C.metal,side*.46,1.01,.44);
  box(p,D.keyboardWidth,.045,D.keyboardDepth,'#e6e6d9',D.keyboardX,D.keyboardY,D.keyboardZ,.022);
  for(let row=0;row<3;row++)for(let col=0;col<9;col++)box(p,.047,.008,.044,'#bdc8b8',D.keyboardX-.25+col*.059,D.keyTop-.004,D.keyboardZ-.075+row*.066,.002);
  sphere(p,.08,'#e8e6d6',.68,1.22,.27,.75,.4,1.1);mug(p,w/2-.29,1.17,.1,boss?'#d89469':'#f5edd6');
  box(p,.34,.045,.42,boss?'#566f60':'#d9ae77',-.89,1.195,.13);box(p,.30,.018,.38,'#f0ead9',-.89,1.22,.13);
  const pencil=cylinder(p,.012,.012,.30,'#b37d4c',-.85,1.241,.15);pencil.rotation.x=Math.PI/2;
}
export const primitives={group,mesh,box,sphere,cylinder,material,mug,textPanel};

export function createOffice(container,onSelect,{themeId='cozy',onAssetError=()=>{}}={}) {
  let theme=getTheme(themeId),focusDistance=null;
  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-10,10,8,-8,.1,100);camera.position.set(16,15.5,20);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  renderer.domElement.setAttribute('aria-label','3D 待命室，四人共享办公岛、咖啡角和休息区');renderer.domElement.dataset.workstations=String(WORKSTATIONS.length);container.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1.3,0);controls.enableDamping=true;controls.dampingFactor=.07;controls.enablePan=false;controls.minZoom=.65;controls.maxZoom=3.5;controls.minPolarAngle=.13;controls.maxPolarAngle=Math.PI/2.25;controls.minAzimuthAngle=-Math.PI*.46;controls.maxAzimuthAngle=Math.PI*.46;
  const hemi=new THREE.HemisphereLight('#fff3d9','#a4b29c',2.5);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#fff0cd',3.5);sun.position.set(-3,10,5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:.5,far:35});sun.shadow.normalBias=.035;sun.shadow.bias=-.0002;sun.shadow.radius=5;scene.add(sun);
  const fill=new THREE.DirectionalLight('#dae9f0',1.2);fill.position.set(6,6,-4);scene.add(fill);
  const warm=new THREE.PointLight('#ffcf86',0,16,1.5);warm.position.set(0,4,0);scene.add(warm);
  const ground=mesh(scene,new THREE.PlaneGeometry(200,200),'#efede5',0,-.47,0);ground.rotation.x=-Math.PI/2;ground.castShadow=false;ground.material=new THREE.ShadowMaterial({color:'#514735',opacity:.13});
  const room=group(scene);
  const shell=group(room);shell.name='original-office-shell';
  box(shell,ROOM.width+.22,.36,ROOM.depth+.2,'#c6ba9f',0,-.22,0,.12);box(shell,ROOM.width,.13,ROOM.depth,'#e2c399',0,-.015,0,.06);
  const floorRows=Math.ceil(ROOM.depth/.5),floorColumns=Math.ceil(ROOM.width/3.2),plankDepth=ROOM.depth/floorRows;
  for(let row=0;row<floorRows;row++){const z=-ROOM.depth/2+(row+.5)*plankDepth;for(let col=0;col<floorColumns;col++){const w=ROOM.width/floorColumns,x=-ROOM.width/2+w/2+col*w;box(shell,w-.025,.025,plankDepth-.023,row%3===0?'#d8b98e':row%3===1?'#dcc098':'#dfc59f',x,.06,z,.006);
    box(shell,1.6,.002,.006,'#cdb189',x+.22,.075,z+.09,0);}}
  box(shell,ROOM.width,3.5,.16,C.wall,0,1.80,ROOM.back,.025);box(shell,.16,3.5,ROOM.depth,'#d8decc',ROOM.left,1.80,0,.025);
  box(shell,ROOM.width+.1,.12,.21,'#f1f0e4',0,3.59,ROOM.back);box(shell,.21,.12,ROOM.depth+.1,'#e7eadb',ROOM.left,3.59,0);
  box(shell,ROOM.width,.17,.07,'#b8c1a7',0,.16,ROOM.back+.14);box(shell,.07,.17,ROOM.depth,'#b8c1a7',ROOM.left+.11,.16,0);
  // Swappable window and wall graphics.
  const studioWindow=group(shell,0,0,ROOM.back+6.22);
  box(studioWindow,3.48,2.12,.11,'#bec8b0',-.7,2.1,-6.08);box(studioWindow,3.20,1.86,.06,'#d9e8da',-.7,2.12,-6.00);
  for(let i=0;i<3;i++){box(studioWindow,.06,1.87,.11,'#f5f0dc',-2.23+i*1.53,2.12,-5.94);}
  box(studioWindow,3.55,.12,.32,'#f6edda',-.7,1.12,-5.89);
  for(let i=0;i<10;i++){const slat=box(studioWindow,3.2,.043,.14,'#edeeda',-.7,3.02-i*.112,-5.86,.009);slat.rotation.x=.32;}
  for(const dx of [-1.75,.35])box(studioWindow,.014,1.18,.012,'#bfcaac',dx,2.52,-5.77,0);
  // Left-wall print, with a simple sun and mountain illustration.
  const print=group(shell,ROOM.left+.115,2.23,-.5);print.rotation.y=Math.PI/2;
  box(print,1.35,1.58,.08,'#f0e7d0',0,0,0);box(print,1.16,1.4,.02,'#a8b49a',0,0,.052);
  const disc=mesh(print,new THREE.CircleGeometry(.23,32),'#e4cc8b',.21,.32,.07);disc.castShadow=false;
  const mountain=mesh(print,new THREE.ConeGeometry(.6,.66,3),'#718868',-.13,-.24,.07);mountain.rotation.x=Math.PI/2;mountain.rotation.z=Math.PI;
  textPanel(print,'MAKE SPACE',1.0,.19,0,-.52,.1,{bg:'#a8b49a',fg:'#eef0d8',size:95});
  // A single four-person bench: two facing pairs share a low fabric screen.
  box(room,7.0,.026,6.0,'#b4bfb5',WORK_ISLAND.x,.087,0,.20);
  box(room,6.8,.004,5.8,'#cdd3c8',WORK_ISLAND.x,.103,0,.15);
  const chairColors=['#667b60','#c6a579','#90a69b','#b6a481','#c79170','#94a6ae'],footrests=[],chairs=[];
  for(const [index,station] of WORKSTATIONS.entries()){
    const workstation=group(room);workstation.name=station.id;
    desk(workstation,station.x,station.z,{rotation:station.rotation,boss:station.boss,accent:station.color,width:station.width});
    chairs.push(chair(workstation,station.x,station.z+(station.rotation?-1.64:1.64),chairColors[index],station.facing));
    const footrest=group(workstation,station.x,0,station.z+(station.rotation?-1.30:1.30));footrest.rotation.y=station.facing;
    box(footrest,.68,.06,.38,'#b9b79e',0,.445,0);for(const side of [-1,1])box(footrest,.045,.39,.30,'#82917d',side*.25,.22,0);footrests.push(footrest);
  }
  box(room,5.5,.54,.06,'#8c9f94',WORK_ISLAND.x,1.43,0,.025);
  box(room,5.53,.025,.075,'#53655d',WORK_ISLAND.x,1.71,0,.008);
  box(room,5.25,.08,.25,'#596961',WORK_ISLAND.x,.9,0,.015);
  for(const x of [-4.26,.87])box(room,.05,.70,.07,'#56665e',x,1.38,0,.008);
  for(const [x,z,color] of [[-3.95,.041,'#efe2b9'],[-2.46,-.041,'#d6e2dc'],[.41,.041,'#d6d3c3']])box(room,.19,.20,.006,color,x,1.47,z,.008);
  const deskPlant=group(room,-4.18,1.17,.28);cylinder(deskPlant,.12,.10,.20,'#e6ded0',0,.1,0);for(let i=0;i<5;i++){const a=i*2.4;const leaf=sphere(deskPlant,.11,'#839878',Math.sin(a)*.07,.30+(i%2)*.07,Math.cos(a)*.06,.4,1.7,.4);leaf.rotation.z=Math.sin(a)*.5;}
  const furnishings=group(room);furnishings.name='original-office-furnishings';
  // Storage shelves in the back left corner.
  const shelf=group(furnishings,FURNITURE.shelf.x,0,FURNITURE.shelf.z);box(shelf,1.70,1.64,.52,'#b5a787',0,.90,0);box(shelf,1.50,1.43,.03,'#b1b295',0,.91,.265);
  for(const y of [.18,.69,1.19,1.71])box(shelf,1.74,.09,.62,'#d3bf99',0,y,.06);
  for(let i=0;i<6;i++){const colors=['#939f7a','#ddc78f','#c58b61','#71857c','#e5dfc7','#acb296'];const h=.31+(i%3)*.035;const book=box(shelf,.14,h,.32,colors[i],-.61+i*.175,1.25+h/2,.1,.006);if(i===5)book.rotation.z=-.15;box(shelf,.09,.018,.006,'#e7dfc6',-.61+i*.175,1.42,.266,0);}
  box(shelf,.52,.30,.4,'#d5d6bf',-.37,.9,.09);box(shelf,.15,.035,.012,'#a1ad8b',-.37,.93,.297);
  for(let i=0;i<3;i++)box(shelf,.46,.07,.35,['#91a087','#dcc993','#cfa77e'][i],.42,.25+i*.08,.09);
  plant(shelf,.48,.03,.42).position.y=1.76;
  // Printer credenza below the window makes this a working office, not a classroom.
  const storage=group(furnishings,FURNITURE.storage.x,0,FURNITURE.storage.z);
  box(storage,2.5,.77,.72,'#a9977e',0,.45,0,.045);box(storage,2.56,.07,.77,'#e7e1d5',0,.88,0);
  for(const x of [-.83,0,.83]){box(storage,.79,.64,.025,'#d8d6c8',x,.46,.373,.012);box(storage,.23,.023,.03,'#8e9587',x,.7,.397,.004);}
  box(storage,.74,.33,.50,'#d1d5cd',-.58,1.075,-.03,.04);box(storage,.72,.07,.49,'#5b6861',-.58,1.27,-.03,.02);
  box(storage,.46,.025,.30,'#f6f1e6',-.58,.98,.27,.005);box(storage,.15,.045,.015,'#92a99b',-.38,1.15,.23,.008);
  for(let i=0;i<4;i++)box(storage,.42,.035,.32,['#b5c2b0','#d8cab0','#aaa99a','#e7dfcf'][i],.15,.95+i*.035,.05,.008);
  plant(storage,.94,-.04,.30).position.y=.92;
  // Coffee counter and a tiny espresso machine.
  const coffee=group(furnishings,FURNITURE.coffee.x,0,FURNITURE.coffee.z);box(coffee,2.0,1.01,.93,'#a1b194',0,.53,0);box(coffee,2.16,.10,1.04,'#e8ddc2',0,1.07,0);
  for(const dx of [-.5,.5]){box(coffee,.92,.82,.035,'#b7c3a8',dx,.53,.484);box(coffee,.16,.03,.04,'#718367',dx,.75,.511);}
  const coffeeGear=group(coffee);
  box(coffeeGear,.64,.68,.53,'#68756b',.32,1.47,-.04,.07);box(coffeeGear,.54,.30,.02,'#3f4c43',.32,1.38,.233);box(coffeeGear,.60,.05,.40,'#4e5e51',.32,1.16,.10);cylinder(coffeeGear,.08,.08,.06,'#d3d1b7',.32,1.47,.27);mug(coffeeGear,.32,1.19,.19);mug(coffeeGear,-.47,1.13,.13,'#d49b6c');
  cylinder(coffeeGear,.18,.18,.32,'#d5ba8b',-.74,1.3,-.20);textPanel(coffeeGear,'COFFEE CLUB',1.55,.27,-.02,1.95,-.38,{bg:'#e4e4d5',fg:'#9ba487',size:92});
  // Warm timber slats and a small sign create a distinct pantry backdrop.
  const pantry=group(furnishings,4.5,0,ROOM.back+.12);
  box(pantry,3.75,3.04,.045,'#a99478',0,1.85,0,.012);
  for(let i=0;i<25;i++)box(pantry,.055,3.02,.04,'#c3b093',-1.80+i*.15,1.85,.039,.006);
  box(pantry,2.35,.48,.08,'#53635a',-.08,2.76,.09,.03);textPanel(pantry,'READYROOM',2.13,.25,-.08,2.76,.139,{bg:'#53635a',fg:'#eee7d6',size:130});
  mesh(pantry,new THREE.BoxGeometry(3.45,.025,.035),'#fff0cf',0,3.26,.10,{emissive:'#ffe6af',emissiveIntensity:.7});
  // A light glass screen divides the work and lounge circulation.
  const partition=group(furnishings,FURNITURE.partition.x,0,FURNITURE.partition.z);
  mesh(partition,new THREE.BoxGeometry(.018,2.04,2.62),'#ccdfd8',0,1.26,0,{transparent:true,opacity:.13,depthWrite:false,roughness:.25}).castShadow=false;
  mesh(partition,new THREE.BoxGeometry(.023,.13,2.62),'#ecf2ec',0,1.42,0,{transparent:true,opacity:.28,depthWrite:false}).castShadow=false;
  for(const z of [-1.35,1.35])box(partition,.055,2.38,.055,'#69796f',0,1.25,z,.008);
  for(const y of [.18,2.43])box(partition,.055,.045,2.75,'#69796f',0,y,0,.008);
  plant(furnishings,FURNITURE.plants[0].x,FURNITURE.plants[0].z,1.20);plant(furnishings,FURNITURE.plants[1].x,FURNITURE.plants[1].z,.93);
  // The lounge faces the work area; its furniture leaves the side aisle open.
  const loungeX=(FURNITURE.sofa.x+FURNITURE.table.x)/2;
  box(furnishings,3.5,.026,3.8,'#d9d7c3',loungeX,.088,FURNITURE.sofa.z,.18);
  box(furnishings,3.31,.005,3.61,'#e6e2cf',loungeX,.105,FURNITURE.sofa.z,.14);
  const sofa=group(furnishings,FURNITURE.sofa.x,0,FURNITURE.sofa.z);sofa.rotation.y=FURNITURE.sofa.rotation;
  for(const dx of [-1,1])for(const dz of [-.27,.27])cylinder(sofa,.04,.045,.22,'#8a795a',dx,.19,dz);
  box(sofa,2.40,.37,.9,'#c9916d',0,.46,0,.12);box(sofa,2.34,.65,.22,'#ca9672',0,.87,.38,.1);
  for(const dx of [-1.16,1.16])box(sofa,.21,.61,.94,'#c38d66',dx,.67,0,.09);
  for(const dx of [-.54,.54])box(sofa,1.01,.13,.65,'#d2a07b',dx,.71,-.025,.065);
  const pillow=box(sofa,.43,.40,.19,'#e1d4ac',-.66,.95,.18,.085);pillow.rotation.z=-.2;
  const table=group(furnishings,FURNITURE.table.x,0,FURNITURE.table.z);cylinder(table,.55,.55,.10,'#e2cda3',0,.64,0);cylinder(table,.065,.09,.59,'#9a9e7b',0,.33,0);cylinder(table,.29,.32,.05,'#a6a78a',0,.10,0);mug(table,.09,.70,0);box(table,.33,.04,.28,'#819878',-.16,.72,-.17);
  // Front edge details keep the dollhouse grounded.
  textPanel(furnishings,'L I T T L E   O F F I C E',3,.15,0,-.21,ROOM.depth/2+.111,{bg:'#c6ba9f',fg:'#8a816d',size:51});
  const baseSurfaces=[];room.traverse(object=>{if(object.isMesh)baseSurfaces.push({object,original:object.material});});
  function stationedCharacter(id,station){const home=station.home||station;const actor=createCharacter(room,id,home.x,home.z,primitives,theme,{onError:onAssetError});actor.stationId=station.id;actor.hasSeat=Boolean(station.home);actor.wantsSeat=actor.hasSeat;actor.homeRotation=station.facing??Math.PI;actor.targetRotation=actor.homeRotation;actor.root.rotation.y=actor.homeRotation;return actor;}
  const actors={boss:stationedCharacter('boss',WORKSTATIONS[0]),employee:stationedCharacter('employee',WORKSTATIONS[1])};
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down=null;
  renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
  renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(Object.values(actors).filter(a=>a.root.visible).map(a=>a.root),true).find(h=>h.object.userData.person);if(hit)onSelect(hit.object.userData.person);});
  let selected='boss',night=false,top=false;const decorations=new Map();let decoration,courtyardReflections;
  function refreshTheme(){
    shell.visible=furnishings.visible=theme.environment!=='courtyard';
    for(const {object,original} of baseSurfaces){
      const key='#'+original.color.getHexString(),color=theme.materials[key];object.material=color?material(color,{roughness:original.roughness}):original;
      if(theme.environment==='courtyard'){
        const wood=['#c99b6b','#d6ae80','#b8895c','#b6aa8e'].includes(key),fabric=['#667b60','#c6a579','#90a69b','#b6a481','#8c9f94','#b4bfb5','#cdd3c8'].includes(key);
        if(wood||fabric)createCourtyardMaterials().apply(object,wood?'wood':'fabric',color||key);
      }
    }
    for(const entry of decorations.values())entry.root.visible=false;
    if(!decorations.has(theme.environment)){const entry=createEnvironment(theme.environment,scene,primitives);decorations.set(theme.environment,entry);entry.ready?.catch(error=>{console.error(error);onAssetError(error.message);});}
    decoration=decorations.get(theme.environment);decoration.root.visible=true;
    studioWindow.visible=print.visible=coffeeGear.visible=theme.environment==='studio';
    for(const actor of Object.values(actors))actor.setTheme(theme);
    for(const footrest of footrests){footrest.visible=Boolean(theme.modelPack);footrest.scale.y=(theme.footrestHeight??.475)/.475;}
    for(const seat of chairs)seat.scale.y=theme.chairScale??1;
    renderer.domElement.dataset.theme=theme.id;refreshLighting();
  }
  function refreshLighting(){const light=theme.lighting;
    if(theme.environment==='courtyard'&&!courtyardReflections){const pmrem=new THREE.PMREMGenerator(renderer),studio=new RoomEnvironment();courtyardReflections=pmrem.fromScene(studio,.04).texture;studio.dispose();pmrem.dispose();}
    scene.environment=theme.environment==='courtyard'?courtyardReflections:null;scene.environmentIntensity=night?.18:.32;
    hemi.color.set(light.sky);hemi.groundColor.set(light.ground);sun.color.set(light.sun);fill.color.set(light.fill);sun.position.fromArray(light.sunPosition||[-3,10,5]);sun.intensity=night?.35:(light.sunIntensity??3.5);hemi.intensity=night?.85:(light.hemiIntensity??2.5);fill.intensity=night?.65:(light.fillIntensity??1.2);warm.intensity=night?18:0;ground.material.opacity=night?.2:.13;renderer.toneMappingExposure=night?1.1:light.exposure;decoration?.update(0,night);}
  refreshTheme();
  const resize=()=>{const w=container.clientWidth,h=container.clientHeight;const aspect=w/Math.max(h,1),height=Math.max(ROOM.depth+(theme.environment==='courtyard'?5.2:3.4),(ROOM.width+ROOM.depth)*(theme.environment==='courtyard'?.84:.78)/aspect);camera.left=-height*aspect/2;camera.right=height*aspect/2;camera.top=height/2;camera.bottom=-height/2;camera.updateProjectionMatrix();renderer.setSize(w,h);};
  new ResizeObserver(resize).observe(container);resize();controls.update();
  const temp=new THREE.Vector3(),exchanges=[];
  function clearExchanges(){for(const fx of exchanges){scene.remove(fx.group);fx.group.traverse(o=>{o.geometry?.dispose();if(o.material?.isLineBasicMaterial)o.material.dispose();});}exchanges.length=0;}
  return {
    actors,
    addActor(id,index){if(actors[id])return actors[id];actors[id]=stationedCharacter(id,extraHome(index));return actors[id];},
    removeActor(id){if(id==='boss'||id==='employee')return;const actor=actors[id];if(!actor)return;room.remove(actor.root);actor.disposeAppearance?.();actor.root.traverse(o=>{o.geometry?.dispose();if(o.isLine)o.material.dispose();});delete actors[id];},
    select(id){selected=id;},
    focusActor(id){const actor=actors[id];if(!actor)return;const p=actor.root.position,angle=actor.targetRotation+.15;controls.minAzimuthAngle=-Infinity;controls.maxAzimuthAngle=Infinity;controls.target.set(p.x,p.y+1.4,p.z);camera.position.set(THREE.MathUtils.clamp(p.x+Math.sin(angle)*4,ROOM.minX+.25,ROOM.maxX-.25),p.y+3.8,THREE.MathUtils.clamp(p.z+Math.cos(angle)*4,ROOM.minZ+.25,ROOM.maxZ-.25));camera.zoom=3.1;camera.updateProjectionMatrix();controls.update();focusDistance=camera.position.distanceTo(controls.target);protectActorView(camera,controls.target,actors,focusDistance);},
    clearExchanges,
    exchange(from,to,color='#c79b6b'){
      if(!actors[from]||!actors[to])return;
      const start=actors[from].root.position.clone().add(new THREE.Vector3(0,1.65,0)),end=actors[to].root.position.clone().add(new THREE.Vector3(0,1.65,0));
      const mid=start.clone().lerp(end,.5);mid.y+=1.3;const curve=new THREE.QuadraticBezierCurve3(start,mid,end),g=group(scene);
      const trail=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)),new THREE.LineBasicMaterial({color,transparent:true,opacity:.52}));g.add(trail);
      const envelope=box(g,.26,.17,.04,'#f9efcf',0,0,0,.015);const mark=box(envelope,.12,.012,.006,color,0,0,.025,.002);mark.rotation.z=.5;
      exchanges.push({group:g,curve,envelope,trail,elapsed:0});if(exchanges.length>5){const oldest=exchanges.shift();scene.remove(oldest.group);oldest.group.traverse(o=>{o.geometry?.dispose();if(o.material?.isLineBasicMaterial)o.material.dispose();});}
    },
    resetView(){focusDistance=null;top=false;controls.minAzimuthAngle=-Math.PI*.46;controls.maxAzimuthAngle=Math.PI*.46;camera.position.set(16,15.5,20);camera.zoom=1;controls.target.set(0,1.3,0);camera.updateProjectionMatrix();controls.update();},
    toggleView(){focusDistance=null;top=!top;controls.minAzimuthAngle=-Math.PI*.46;controls.maxAzimuthAngle=Math.PI*.46;camera.position.set(top?0:16,top?30:15.5,top?.001:20);camera.zoom=1;controls.target.set(0,1.3,0);camera.updateProjectionMatrix();controls.update();return top;},
    setTheme(id){theme=getTheme(id);refreshTheme();resize();return theme.id;},
    getTheme(){return theme.id;},
    toggleNight(){night=!night;refreshLighting();return night;},
    project(id){temp.copy(actors[id].root.position);temp.y+=actors[id].labelHeight||2.22;temp.project(camera);return {x:(temp.x*.5+.5)*container.clientWidth,y:(-.5*temp.y+.5)*container.clientHeight,visible:temp.z>-1&&temp.z<1};},
    update(dt,time){
      decoration?.update(time,night);
      for(let i=exchanges.length-1;i>=0;i--){const fx=exchanges[i];fx.elapsed+=dt;const t=Math.min(1,fx.elapsed/1.55);fx.envelope.position.copy(fx.curve.getPoint(t));fx.envelope.quaternion.copy(camera.quaternion);fx.trail.material.opacity=.5*Math.max(0,1-(fx.elapsed-1.3)/.9);if(fx.elapsed>2.2){scene.remove(fx.group);fx.group.traverse(o=>{o.geometry?.dispose();if(o.material?.isLineBasicMaterial)o.material.dispose();});exchanges.splice(i,1);}}
      Object.values(actors).forEach(a=>{
        if(!a.root.visible)return;
        updateCharacterPose(a,dt,time);a.ring.visible=selected===a.id;
      });
      for(const [index,rest] of footrests.entries()){
        const station=WORKSTATIONS[index],actor=Object.values(actors).find(a=>a.root.visible&&a.stationId===station.id),pull=supportsAvatarSelection(theme)?(actor?.deskPullIn||0):0;
        const slide=pull+(supportsAvatarSelection(theme)?-.42*(1-THREE.MathUtils.smoothstep(actor?.seatBlend||0,.65,1))+(actor?.modelMeta?.footrestOffsetZ||0)*(actor?.seatBlend||0):0);
        rest.scale.z=supportsAvatarSelection(theme)?(actor?.modelMeta?.footrestDepthScale??1):1;
        rest.position.x=station.home.x+Math.sin(station.facing)*slide;rest.position.z=station.home.z+Math.cos(station.facing)*slide;
        chairs[index].scale.y=(supportsAvatarSelection(theme)?actor?.modelMeta?.chairScaleY:undefined)??theme.chairScale??1;
        chairs[index].position.x=station.home.x+Math.sin(station.facing)*(D.chairZ+pull);chairs[index].position.z=station.home.z+Math.cos(station.facing)*(D.chairZ+pull);
      }
      controls.update();if(focusDistance!==null)protectActorView(camera,controls.target,actors,focusDistance);renderer.render(scene,camera);
    }
  };
}

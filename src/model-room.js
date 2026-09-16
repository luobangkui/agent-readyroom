import './model-room.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {DESK_ERGONOMICS as D} from './desk-ergonomics.js';
import {createRiggedModel,isSeatedMotion} from './assets/rigged-model.js';
import {STYLOO_MODELS as MODEL_CATALOG,loadStylooModel} from './assets/styloo.js';

const $=selector=>document.querySelector(selector),stage=$('#model-stage');
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(32,1,.1,80);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
renderer.domElement.setAttribute('aria-label','真实骨骼模型与坐姿动画');stage.append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.enablePan=false;controls.minDistance=3;controls.maxDistance=11;controls.maxPolarAngle=Math.PI*.49;
function resetCamera(){camera.position.set(4.8,3.4,2.4);controls.target.set(0,1.15,.5);controls.update();}
resetCamera();
scene.add(new THREE.HemisphereLight('#fffbec','#859888',2.1));
const sun=new THREE.DirectionalLight('#fff2d2',3.1);sun.position.set(-3,7,5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.1,far:20});sun.shadow.normalBias=.02;sun.shadow.bias=-.0001;scene.add(sun);
const fill=new THREE.DirectionalLight('#d6e7f6',1.3);fill.position.set(4,3,-3);scene.add(fill);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.ShadowMaterial({opacity:.15,color:'#56674c'}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.position.y=-.01;scene.add(floor);
const station=new THREE.Group();scene.add(station);
const materials=new Map();
function box(parent,w,h,d,color,x,y,z,r=.035){if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.7}));const mesh=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,Math.min(r,w/3,h/3,d/3)),materials.get(color));mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;}
// The source character has short shins. A footrest supports them instead of
// stretching the rig to adult proportions or leaving the feet hanging.
const chair=new THREE.Group();chair.position.z=.09;station.add(chair);
box(chair,.83,.13,.66,'#667e6a',0,.45,-.43);box(chair,.82,.50,.12,'#667e6a',0,.78,-.72);
for(const x of [-.3,.3])for(const z of [-.66,-.2])box(chair,.06,.42,.06,'#a39d84',x,.21,z);
const footrest=new THREE.Group();chair.add(footrest);
box(footrest,.72,.055,.38,'#b7b79f',0,.2025,-.04);
for(const x of [-.27,.27])box(footrest,.04,.18,.28,'#a39d84',x,.09,-.04);
const desk=new THREE.Group();desk.visible=true;station.add(desk);
box(desk,2.7,.16,1.10,'#b6a486',0,1.05,D.deskZ+.07);box(desk,2.72,.035,1.10,'#d5c3a4',0,1.14,D.deskZ+.07);
for(const x of [-1.15,1.15])for(const z of [.88,1.72])box(desk,.095,1,.095,'#637765',x,.52,z);
box(desk,.43,.035,.26,'#607162',-.18,1.20,1.57);box(desk,.07,.3,.06,'#607162',-.18,1.36,1.64);
box(desk,1.04,.65,.075,'#607162',-.18,1.70,1.63);box(desk,.93,.535,.01,'#bdd4be',-.18,1.70,1.587);
box(desk,1.02,.055,.43,'#b6aa8e',0,.95,D.deskZ-.64);
for(const side of [-1,1])box(desk,.035,.10,.40,'#607162',side*.46,1.01,D.deskZ-.44);
box(desk,D.keyboardWidth,.045,D.keyboardDepth,'#e0dec7',D.keyboardX,D.keyboardY,D.deskZ-D.keyboardZ);
for(let row=0;row<3;row++)for(let col=0;col<9;col++)box(desk,.047,.008,.044,'#a8b4a0',.25-col*.059,D.keyTop-.004,D.deskZ-D.keyboardZ+.075-row*.066,.002);
let model=null,requestId=0,paused=false,desired='typing',walkPhase=0,afterWalk='typing';
const status=$('#load-status');
for(const item of MODEL_CATALOG){const button=document.createElement('button');button.title=item.name;button.textContent=item.name;button.setAttribute('aria-label',`查看${item.name}`);button.dataset.model=item.id;button.style.setProperty('--person-color',item.color);button.onclick=()=>selectModel(item);$('#model-picker').append(button);}
async function selectModel(item){
  const token=++requestId;status.textContent='正在加载模型…';
  try{
    const gltf=await loadStylooModel(item);if(token!==requestId)return;
    const next=createRiggedModel(gltf);next.meta=gltf.officeMeta;model?.dispose();model=next;scene.add(model.root);model.motion.request(desired);
    walkPhase=0;$('#model-name').textContent=item.name;
    for(const button of document.querySelectorAll('[data-model]'))button.setAttribute('aria-pressed',String(button.dataset.model===item.id));
    status.textContent='';stage.dataset.model=item.id;
  }catch(error){if(token===requestId){status.textContent='模型加载失败，请重新点选重试。';console.error(error);}}
}
for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>{
  if(button.dataset.action==='walking'&&desired!=='walking')afterWalk=desired;
  desired=button.dataset.action;if(desired==='typing')$('#desk').setAttribute('aria-pressed','true');model?.motion.request(desired);paused=false;$('#pause').setAttribute('aria-pressed','false');$('#pause').setAttribute('aria-label','暂停动画');$('#pause').textContent='Ⅱ';
  for(const action of document.querySelectorAll('[data-action]'))action.setAttribute('aria-pressed',String(action===button));
};
$('#pause').onclick=()=>{paused=!paused;$('#pause').setAttribute('aria-pressed',String(paused));$('#pause').setAttribute('aria-label',paused?'继续动画':'暂停动画');$('#pause').textContent=paused?'▷':'Ⅱ';};
$('#desk').onclick=()=>{desk.visible=!desk.visible;$('#desk').setAttribute('aria-pressed',String(desk.visible));};
$('#reset-camera').onclick=resetCamera;
const resize=new ResizeObserver(()=>{const {width,height}=stage.getBoundingClientRect();if(!width||!height)return;camera.aspect=width/height;camera.zoom=Math.min(1,580/height,width/620);camera.updateProjectionMatrix();renderer.setSize(width,height);});resize.observe(stage);
let last=performance.now();
function frame(now){
  requestAnimationFrame(frame);const dt=Math.min((now-last)/1000,.04);last=now;
  if(model&&!paused&&!document.hidden){
    // Return to the chair before asking the rig to sit. Translation starts only
    // after the authored stand-up clip has finished.
    const returning=desired!=='walking'&&walkPhase>0;
    model.motion.request(returning?'walking':desired);model.motion.update(dt);
    if(!model.motion.canMove){const motion=model.motion,p=Math.min(1,motion.action.time/motion.action.getClip().duration),seated=isSeatedMotion(motion.state)?1:motion.state==='sitDown'?p:motion.state==='standUp'?1-p:0;model.root.position.y=(model.meta.seatOffsetY+.02)*seated;const pull=D.typingPull*motion.typingBlend;model.root.position.z=model.meta.seatOffsetZ*seated+pull;chair.position.z=.09+pull;footrest.position.z=-.42*(1-THREE.MathUtils.smoothstep(seated,.65,1));}
    if(model.motion.canMove){
      walkPhase+=dt*.65;
      if(walkPhase>=Math.PI*2){walkPhase=0;if(desired==='walking')desired=afterWalk;model.root.position.set(0,0,0);model.root.rotation.y=0;model.motion.request(desired);for(const action of document.querySelectorAll('[data-action]'))action.setAttribute('aria-pressed',String(action.dataset.action===desired));}
      else{walkPhase%=Math.PI*2;model.root.position.set(1.0*(1-Math.cos(walkPhase)),0,Math.sin(walkPhase));model.root.rotation.y=walkPhase;}
    }
    chair.visible=walkPhase===0;desk.visible=$('#desk').getAttribute('aria-pressed')==='true'&&walkPhase===0;
    stage.dataset.pose=model.motion.state;
  }
  controls.update();renderer.render(scene,camera);
}
requestAnimationFrame(frame);selectModel(MODEL_CATALOG[0]);

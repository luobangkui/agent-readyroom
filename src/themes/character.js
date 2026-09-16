import * as THREE from 'three';
import {characterStyle,supportsAvatarSelection} from './index.js';
import {leafBadge} from './symbols.js';
import {makeFace} from './face.js';
import {hairCap,lockGeometry,coatGeometry} from './sculpt.js';
import {attachRiggedAppearance} from '../assets/office-avatar.js';

export function createCharacter(parent,id,x,z,api,initialTheme,assetOptions){
  const {group,mesh,box,sphere,cylinder,material,mug,textPanel}=api;
  const root=group(parent,x,.02,z),body=group(root),head=group(body,0,1.49,0);
  const legs=[],arms=[],clothes=[],pants=[],skin=[],eyes=[];
  for(const side of [-1,1]){
    const leg=group(body,side*.135,.55,0);pants.push(mesh(leg,new THREE.CapsuleGeometry(.092,.25,8,16),'#58634d',0,-.18,0));
    const shoe=box(leg,.205,.11,.31,'#3f4945',0,-.395,.055,.047);legs.push(leg);
    const arm=group(body,side*.325,1.06,0);clothes.push(mesh(arm,new THREE.CapsuleGeometry(.105,.22,8,16),'#9cab82',0,-.11,0));
    skin.push(sphere(arm,.09,'#ecc39f',0,-.337,.025,.9,1,.75));skin.push(sphere(arm,.033,'#ecc39f',-side*.064,-.321,.075));arms.push(arm);
  }
  clothes.push(mesh(body,new THREE.CapsuleGeometry(.24,.25,10,24),'#9cab82',0,.85,0));
  skin.push(cylinder(body,.085,.10,.14,'#ecc39f',0,1.23,0));
  skin.push(sphere(head,.345,'#ecc39f',0,0,0,1.03,1.05,.90));
  for(const side of [-1,1])skin.push(sphere(head,.060,'#ecc39f',side*.339,-.025,-.015,.62,1,.60));
  const cup=mug(arms[1],0,-.415,.075);cup.visible=false;
  const document=group(body,0,.84,.39);document.rotation.x=-.2;box(document,.38,.46,.035,'#eee0bd',0,0,0,.015);box(document,.145,.05,.05,'#8d9978',0,.24,0,.01);
  for(let i=0;i<4;i++)box(document,.24-i%2*.06,.012,.009,'#9a9f85',0,.13-i*.07,.022,.003);document.visible=false;
  const ring=mesh(root,new THREE.RingGeometry(.46,.49,48),'#c19b6c',0,-.006,0,{transparent:true,opacity:.7});ring.rotation.x=-Math.PI/2;ring.castShadow=false;
  let theme=initialTheme,role=id==='boss'?'boss':'builder',avatarId=id==='boss'?'hiruzen':null,lookKey='',currentLook;
  const looks=new Map();
  const lock=(p,color,a,b,c,w)=>mesh(p,lockGeometry(a,b,c,w),color);
  function disposeLook(look){for(const p of [look.head,look.body,...look.arms]){p.removeFromParent();p.traverse(o=>{o.geometry?.dispose();if(o.isLine)o.material.dispose();});}look.face.open.dispose();look.face.closed.dispose();look.face.mesh.material.dispose();}
  function applyLook(){
    const style=characterStyle(theme,role,avatarId),key=JSON.stringify(style);if(key===lookKey)return;lookKey=key;
    for(const p of clothes)p.material=material(style.shirt);for(const p of pants)p.material=material(style.pants);for(const p of skin)p.material=material(style.skin);
    if(currentLook){currentLook.head.visible=false;currentLook.body.visible=false;currentLook.arms.forEach(a=>a.visible=false);}
    let look=looks.get(key);
    if(!look){
      look={head:group(head),body:group(body),arms:arms.map(a=>group(a))};look.face=makeFace(look.head,style);looks.set(key,look);
      const hair=look.head,kind=style.hairstyle;
      mesh(hair,hairCap(kind==='long'||kind==='bob'),style.hair);
      if(['naruto','spiky','gaara','kakashi'].includes(kind)){
        for(let i=0;i<7;i++){const x=-.27+i*.09,lean=kind==='kakashi'?.16:0,height=kind==='gaara'?.39:.48;lock(hair,style.hair,[x,.24,.04],[x*1.05+lean,.38,-.005],[x*1.40+lean,height+.055*Math.cos(i*.9),-.09],kind==='gaara'?.07:.088);}
        for(const side of [-1,1])lock(hair,style.hair,[side*.28,.14,-.02],[side*.37,.19,-.07],[side*.41,.18,-.14],.067);
      }else if(kind==='sasuke'){
        for(const side of [-1,1]){lock(hair,style.hair,[side*.08,.30,.22],[side*.25,.19,.29],[side*.265,-.16,.23],.10);lock(hair,style.hair,[side*.24,.13,-.19],[side*.39,.22,-.29],[side*.41,.20,-.42],.12);}
      }else if(kind==='bob'||kind==='long'){
        for(const side of [-1,1]){lock(hair,style.hair,[side*.05,.30,.20],[side*.22,.25,.30],[side*.30,.075,.24],.11);lock(hair,style.hair,[side*.29,.12,.005],[side*.34,-.10,.035],[side*.29,kind==='long'?-.43:-.27,.08],.115);}
      }else if(kind==='ponytail'){
        sphere(hair,.13,style.hair,0,.27,-.27,.95,.85,1.1);for(let i=0;i<5;i++)lock(hair,style.hair,[0,.29,-.28],[(i-2)*.08,.45,-.35],[(i-2)*.12,.54,-.40],.07);
      }else if(kind!=='short'){
        for(let i=0;i<4;i++)lock(hair,style.hair,[-.16+i*.105,.29,.19],[-.07+i*.10,.25,.28],[.03+i*.075,.14,.23],.09);
      }
      if(style.headband){
        mesh(hair,new THREE.SphereGeometry(.359,40,8,0,Math.PI*2,.99,.25),'#3a484a',0,0,-.008).scale.set(1.03,1.05,.94);
        const plate=group(hair,0,.155,.329);if(style.mask)plate.rotation.z=-.15;
        box(plate,.385,.115,.025,'#a9b8b4',0,0,0,.025);for(const side of [-1,1])sphere(plate,.01,'#657b76',side*.154,0,.017,1,1,.4);leafBadge(plate,.14,0,-.007,.022,'#4d6460');
        for(const side of [-1,1])lock(hair,'#3c474a',[side*.07,.13,-.32],[side*.13,-.04,-.37],[side*.15,-.26,-.36],.035);
      }
      if(style.elder){
        for(const side of [-1,1])lock(hair,'#b4b1a6',[side*.25,-.08,.1],[side*.26,-.20,.16],[side*.14,-.29,.25],.055);
        lock(hair,'#bdb8ac',[0,-.245,.246],[0,-.35,.275],[0,-.42,.22],.069);
        const hat=group(hair,0,.33,0);cylinder(hat,.58,.58,.034,'#ede4d3',0,0,0);
        mesh(hat,new THREE.ConeGeometry(.548,.32,48),'#af5948',0,.17,0);
        mesh(hat,new THREE.ConeGeometry(.558,.325,24,1,true,-.48,.96),'#f0e6d4',0,.173,.003);
        const symbol=textPanel(hat,'火',.17,.21,0,.145,.324,{bg:'#f0e6d4',fg:'#a95344',size:770});symbol.rotation.x=-1.06;
        for(const side of [-1,1]){const cloth=box(hair,.19,.49,.036,'#e6ddca',side*.315,-.02,-.19,.025);cloth.rotation.y=side*.30;}
      }
      if(style.glasses){for(const side of [-1,1]){const frame=mesh(hair,new THREE.TorusGeometry(.083,.009,8,24),'#68705b',side*.134,.025,.306);frame.scale.y=.66;}box(hair,.07,.012,.012,'#68705b',0,.03,.32,.003);}
      if(style.outfit==='hokage'||style.outfit==='akatsuki'){
        const outer=style.outfit==='hokage'?'#e8decd':'#374048';mesh(look.body,coatGeometry(),outer);
        box(look.body,.14,.57,.035,style.outfit==='hokage'?'#985349':'#aa514a',0,.69,.288,.016);
        for(const side of [-1,1]){const collar=box(look.body,.16,.24,.09,outer,side*.105,1.06,.255,.035);collar.rotation.z=side*.24;}
        if(style.outfit==='akatsuki'){const cloud=group(look.body,.20,.65,.265);for(const [dx,dy,r] of [[0,0,.067],[-.075,-.02,.054],[.07,.02,.051]])sphere(cloud,r,'#b3544e',dx,dy,0,1,.65,.18);}
      }else if(style.outfit==='shinobi'){
        box(look.body,.40,.055,.35,'#47504d',0,.585,0,.025);
        for(const arm of look.arms)box(arm,.194,.07,.20,'#ded2b8',0,-.248,0,.027);
        if(style.vest){for(const side of [-1,1]){box(look.body,.19,.42,.055,'#849269',side*.12,.86,.238,.03);for(let i=0;i<2;i++)box(look.body,.135,.10,.023,'#99a17b',side*.12,.76+i*.14,.277,.016);}}
        else{box(look.body,.021,.43,.018,'#ded0ad',0,.86,.246,.003);}
        if(style.whiskers)box(look.body,.40,.13,.062,'#404a4a',0,1.075,.19,.022);
        if(style.highCollar){for(const side of [-1,1]){const collar=box(look.body,.19,.19,.055,'#ddd9ca',side*.12,1.13,.20,.032);collar.rotation.z=side*.2;}}
        if(style.rope){const rope=mesh(look.body,new THREE.TorusGeometry(.26,.027,8,32),'#9381aa',0,.61,0);rope.rotation.x=Math.PI/2;lock(look.body,'#9381aa',[.21,.63,-.08],[.40,.62,-.11],[.25,.45,-.10],.034);}
        if(style.hood)sphere(look.body,.24,'#d5c9d4',0,1.10,-.12,1.1,.4,.55);
        if(style.gourd){sphere(look.body,.19,'#b29567',.02,.73,-.35,1,1.10,.78);sphere(look.body,.14,'#b29567',.02,1.00,-.33,1,1.03,.75);cylinder(look.body,.055,.069,.085,'#756345',.02,1.14,-.33);}
      }else{
        box(look.body,.16,.12,.015,'#cbd1b8',.10,.81,.245,.016);box(look.body,.10,.06,.018,'#e9dec7',-.105,1.08,.228,.008);
      }
      for(const container of [look.head,look.body,...look.arms])container.traverse(o=>{if(o.isMesh)o.userData.person=id;});
      if(looks.size>3){const [oldKey,oldLook]=looks.entries().next().value;if(oldKey!==key){disposeLook(oldLook);looks.delete(oldKey);}}
    }
    currentLook=look;look.head.visible=look.body.visible=true;look.arms.forEach(a=>a.visible=true);
  }
  applyLook();root.traverse(o=>{if(o.isMesh)o.userData.person=id;});root.rotation.y=id==='boss'?0:Math.PI;
  const actor={id,root,body,head,arms,legs,ring,cup,document,eyes,mode:'idle',home:new THREE.Vector3(x,.02,z),homeRotation:root.rotation.y,targetRotation:root.rotation.y,
    setRole(value){role=value;applyLook();},setTheme(value){theme=value;applyLook();},setAvatar(value){avatarId=value||null;applyLook();},themeId:()=>theme.id,
    get labelHeight(){return supportsAvatarSelection(theme)?(actor.modelMeta?.labelHeight??2.6):theme.modelPack?(role==='boss'?3.1:2.85):theme.cast==='naruto'&&characterStyle(theme,role,avatarId).elder?2.42:2.23;},
    updateFace(time){const face=currentLook.face,blink=time%4.7<.13;if(face.blink!==blink){face.blink=blink;face.mesh.material.map=blink?face.closed:face.open;}},
    disposeAppearance(){for(const look of looks.values())disposeLook(look);looks.clear();}
  };
  return typeof window!=='undefined'||assetOptions?attachRiggedAppearance(actor,initialTheme,assetOptions):actor;
}

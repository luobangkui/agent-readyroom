import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {ROOM,FURNITURE,WORKSTATIONS} from '../room-layout.js';
import {leafBadge} from './symbols.js';
import {createCourtyardMaterials} from './courtyard-materials.js';
import {loadCourtyardProp,placeCourtyardProp} from './courtyard-props.js';

const palette={wood:'#9b6b41',lightWood:'#cfa16a',dark:'#6a4931',paper:'#f1e3c4',jade:'#617b68',leaf:'#768a52',stone:'#a99f88',cream:'#ede1c7'};

// Merge only within semantic zones: keep lights and symbols separate, and avoid
// hundreds of draw calls from repeated tiles, scrolls and floorboards.
function batchZone(zone){
  zone.updateMatrixWorld(true);const inverse=zone.matrixWorld.clone().invert(),batches=new Map();
  zone.traverse(object=>{
    if(!object.isMesh||Array.isArray(object.material))return;
    const key=`${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
    if(!batches.has(key))batches.set(key,{material:object.material,cast:object.castShadow,receive:object.receiveShadow,objects:[],geometries:[]});
    const batch=batches.get(key),geometry=object.geometry.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,object.matrixWorld));
    batch.objects.push(object);batch.geometries.push(geometry.index?geometry.toNonIndexed():geometry);
    if(geometry.index)geometry.dispose();
  });
  for(const batch of batches.values()){
    const geometry=mergeGeometries(batch.geometries,false);if(!geometry){batch.geometries.forEach(g=>g.dispose());continue;}
    const combined=new T.Mesh(geometry,batch.material);combined.castShadow=batch.cast;combined.receiveShadow=batch.receive;combined.name=zone.name+'-batch';zone.add(combined);
    for(const object of batch.objects){object.removeFromParent();object.geometry.dispose();}batch.geometries.forEach(g=>g.dispose());
  }
}

export function createCourtyardEnvironment(scene,api){
  const {group,mesh,box,sphere,cylinder,mug}=api,root=group(scene);root.name='konoha-courtyard';
  const zones=[],lamps=[],glowMaterials=[],pending=[],pbr=createCourtyardMaterials(),grain='wood',paper='plaster',fabric='fabric';
  const zone=name=>{const node=group(root);node.name=name;zones.push(node);return node;};
  function finish(object,color,map=grain,extra={}){
    const kind=map==='wood'&&['#6a4931','#9b6b41','#94704a','#85603e'].includes(color)?'timber':map;
    return pbr.apply(object,kind,color,extra);
  }
  const wood=(p,w,h,d,color,x=0,y=0,z=0,r=.018)=>finish(box(p,w,h,d,color,x,y,z,r),color);
  function scroll(p,x,y,z,tint='#a6aa83',angle=0){
    const g=group(p,x,y,z);g.rotation.y=angle;
    const roll=cylinder(g,.105,.105,.38,palette.paper);roll.rotation.z=Math.PI/2;pbr.apply(roll,'plaster',palette.paper);
    for(const side of [-1,1]){
      const cap=cylinder(g,.122,.122,.042,palette.dark,side*.215,0,0);cap.rotation.z=Math.PI/2;pbr.apply(cap,'timber',palette.dark);
      for(const r of [.048,.072,.093]){const edge=mesh(g,new T.TorusGeometry(r,.004,4,20),'#bda981',side*.239,0,0);edge.rotation.y=Math.PI/2;}
    }
    finish(box(g,.058,.218,.218,tint,0,0,0,.006),tint,fabric);
    return g;
  }
  function bonsai(p,x,y,z,scale=1){
    const g=group(p,x,y,z);g.scale.setScalar(scale);
    box(g,.65,.22,.42,'#948064',0,.12,0,.06);box(g,.57,.012,.34,'#615640',0,.24,0,.04);
    const stem=cylinder(g,.05,.07,.54,palette.dark,-.05,.49,0);stem.rotation.z=-.25;
    for(const [dx,dy,dz,s] of [[-.24,.65,.02,.23],[.15,.86,-.01,.3],[.34,.68,.05,.19],[-.08,1.0,-.06,.22]]){
      const b=cylinder(g,.018,.025,.36,palette.dark,dx/2,dy-.17,dz/2);b.rotation.z=-dx*2;
      sphere(g,s,palette.leaf,dx,dy,dz,1.4,.55,1);sphere(g,s*.6,'#8b9c62',dx-.06,dy+.06,dz+.04,1.3,.5,1.1);
    }
    return g;
  }
  function lantern(p,x,y,z,scale=1){
    const g=group(p,x,y,z);g.scale.setScalar(scale);
    cylinder(g,.014,.014,.4,palette.dark,0,.67,0);
    const shade=sphere(g,.27,'#f2d59f',0,0,0,1,1.48,1);
    pbr.apply(shade,'fabric','#f2d59f',{emissive:'#ffac4e',emissiveIntensity:.25});glowMaterials.push(shade.material);
    for(const sy of [-1,1])cylinder(g,.2,.2,.06,palette.dark,0,sy*.395,0);
    for(let i=0;i<9;i++){const dy=-.32+i*.08,r=.265*Math.sqrt(1-(dy/.41)**2),rib=mesh(g,new T.TorusGeometry(r,.005,4,24),'#c6a977',0,dy,0);rib.rotation.x=Math.PI/2;}
    leafBadge(g,.48,0,0,.272,'#967143');
    const light=new T.PointLight('#ffc47d',.5,4,2);light.position.set(0,-.1,.2);g.add(light);lamps.push(light);
  }
  function stoneLamp(p,x,y,z,scale=.8){
    const g=group(p,x,y,z);g.scale.setScalar(scale);
    wood(g,.42,.1,.42,palette.dark,0,.08,0);wood(g,.42,.62,.42,palette.wood,0,.41,0);
    const glow=box(g,.34,.46,.34,'#fff0c6',0,.42,0);glow.material=new T.MeshStandardMaterial({color:'#fff0c6',emissive:'#ffc16b',emissiveIntensity:.35});glowMaterials.push(glow.material);
    for(const a of [-1,1])for(const b of [-1,1])wood(g,.036,.59,.036,palette.dark,a*.18,.42,b*.18);
    for(const h of [.22,.42,.62]){wood(g,.41,.025,.025,palette.dark,0,h,.182);wood(g,.025,.025,.41,palette.dark,.182,h,0);}
    wood(g,.53,.11,.53,palette.dark,0,.78,0);
  }

  const shell=zone('courtyard-shell');
  wood(shell,ROOM.width+.35,.35,ROOM.depth+.35,'#927450',0,-.19,0,.09);
  box(shell,ROOM.width+.55,.22,ROOM.depth+.55,'#a8a291',0,-.48,0,.045);
  // A stone plinth and warm staggered boards anchor the open-front room.
  for(let row=0;row<2;row++)for(let col=0;col<22;col++){
    const x=-6.47+col*.6+(row?.15:0);box(shell,.57,.14,.20,col%3?'#a5a18e':'#b8ad98',x,-.39-row*.16,5.32,.025);
  }
  for(let row=0;row<25;row++)for(let col=0;col<6;col++){
    const x=-5.5+col*2.2,z=-5+row*.416;
    wood(shell,2.18,.06,.402,['#d8b37e','#dfbe8c','#d3ac77','#e1bd87'][(row+col*3)%4],x,.025,z,.008);
  }
  for(const z of [-5.15,5.15])wood(shell,13.3,.13,.16,palette.wood,0,.04,z);
  for(const x of [-6.55,6.55])wood(shell,.16,.13,10.4,palette.wood,x,.04,0);
  const leftWall=wood(shell,.16,3.5,10.5,palette.paper,-6.63,1.8,0);finish(leftWall,palette.paper,paper);
  for(const [x,w] of [[-5.4,2.5],[4.65,3.9]])finish(box(shell,w,3.5,.16,palette.paper,x,1.8,-5.2),palette.paper,paper);
  finish(box(shell,6.75,1.02,.16,palette.paper,-.8,.54,-5.2),palette.paper,paper);
  for(const x of [-6.55,-4.15,2.65,6.55])wood(shell,.19,3.9,.2,palette.dark,x,1.92,-5.15);
  for(const z of [-5.12,-2.5,.15,2.8,5.14])wood(shell,.22,3.8,.18,palette.dark,-6.5,1.89,z);
  for(const y of [.25,1.0,3.5,3.78]){wood(shell,13.25,.14,.20,palette.wood,0,y,-5.10);wood(shell,.20,.14,10.45,palette.wood,-6.52,y,0);}
  // Window opening really reveals the exterior garden; it is not a room photo.
  const windows=zone('courtyard-shoji');
  for(let panel=0;panel<5;panel++){
    const x=-3.45+panel*1.22;
    if(panel===3)continue; // one open panel beside the garden
    const pane=mesh(windows,new T.PlaneGeometry(1.14,2.29),palette.paper,x,2.22,-5.115,{transparent:true,opacity:.57,depthWrite:false,side:T.DoubleSide});pane.castShadow=false;finish(pane,palette.paper,paper,{transparent:true,opacity:.57,depthWrite:false,side:T.DoubleSide});
    for(const side of [-1,1])wood(windows,.055,2.38,.08,palette.wood,x+side*.59,2.22,-5.06);
    for(let k=0;k<7;k++)wood(windows,1.18,.028,.045,'#b68b55',x,1.12+k*.366,-5.015,.003);
    for(const dx of [-.3,0,.3])wood(windows,.025,2.28,.04,'#b68b55',x+dx,2.22,-5.00,.003);
  }
  wood(windows,6.95,.13,.42,palette.lightWood,-.87,1.035,-5.04);

  const roof=zone('courtyard-jade-roof');
  function roofEdge(length,x,z,rotation){
    const g=group(roof,x,3.87,z);g.rotation.y=rotation;
    wood(g,length+.35,.16,1.06,palette.dark,0,-.12,0);
    for(let row=0;row<3;row++)for(let i=0;i<Math.ceil(length/.255);i++){
      const color=i%4?'#617d6c':'#718974',tile=mesh(g,new T.CylinderGeometry(.10,.115,.48,10),color,-length/2+i*.255,row*.10,-.35+row*.34);tile.rotation.x=Math.PI/2+.18;pbr.apply(tile,'plaster',color,{roughness:.56});
    }
    wood(g,length+.42,.09,.1,'#516857',0,-.01,.67);
    for(let i=0;i<length/.75;i++)wood(g,.055,.14,.62,'#ad8150',-length/2+i*.75,-.23,.1);
  }
  roofEdge(13.4,0,-5.18,0);roofEdge(10.8,-6.61,0,Math.PI/2);

  const library=zone('courtyard-scroll-library');
  // Wall-hugging shelves are beyond ROOM.minX, leaving the legal aisle free.
  const cabinet=group(library,-6.63,0,-.9);cabinet.rotation.y=Math.PI/2;
  wood(cabinet,5.0,2.85,.32,palette.dark,0,1.52,0);
  wood(cabinet,4.8,2.57,.045,'#85603e',0,1.52,.18);
  for(const y of [.2,.87,1.55,2.2,2.9])wood(cabinet,5.06,.10,.47,palette.lightWood,0,y,.05);
  for(const x of [-2.48,-.82,.82,2.48])wood(cabinet,.10,2.74,.43,palette.wood,x,1.55,.035);
  for(let level=0;level<4;level++)for(let col=0;col<3;col++){
    const x=-1.65+col*1.65,y=.4+level*.67;
    if(level===2&&col===1)continue;
    for(let j=0;j<3;j++)scroll(cabinet,x-.43+j*.43,y,.22,['#8c9869','#b26b51','#8d998e'][(j+col+level)%3]);
    if(level%2===0)for(let j=0;j<2;j++)scroll(cabinet,x-.2+j*.43,y+.2,.19,'#baa16d');
  }
  const missionBoard=group(library,-6.34,1.88,2.95);missionBoard.rotation.y=Math.PI/2;
  wood(missionBoard,1.48,1.9,.06,palette.dark);box(missionBoard,1.29,1.69,.025,'#bfa77f',0,0,.045);
  for(const [x,y,a] of [[-.27,.42,-.04],[.25,.36,.08],[-.24,-.21,.06],[.29,-.34,-.05]]){const note=box(missionBoard,.43,.57,.008,'#efe4ce',x,y,.066,.003);note.rotation.z=a;for(let k=0;k<4;k++)box(note,.27,.01,.003,'#bcad90',0,.15-k*.07,.006,.001);sphere(missionBoard,.025,'#a36343',x,y+.24,.09);}
  const shelf=group(library,FURNITURE.shelf.x,0,FURNITURE.shelf.z);
  wood(shelf,1.68,1.42,.51,palette.wood,0,.77,0);wood(shelf,1.74,.09,.59,palette.lightWood,0,1.52,0);
  for(const x of [-.4,.4]){wood(shelf,.72,1.21,.027,'#9f8057',x,.75,.27);sphere(shelf,.026,palette.dark,x+.21,.83,.30);}
  bonsai(shelf,0,1.57,0,.75);
  const banner=group(library,-5.08,2.57,-5.02);box(banner,1.1,1.55,.023,'#a95941');
  for(const y of [-.8,.8])wood(banner,1.24,.055,.08,palette.dark,0,y,0);
  leafBadge(banner,1,0,.09,.025,'#e7c997');

  const storage=zone('courtyard-window-cabinet'),cab=group(storage,FURNITURE.storage.x,0,FURNITURE.storage.z);
  wood(cab,2.45,.74,.64,palette.wood,0,.44,0);wood(cab,2.52,.08,.70,palette.lightWood,0,.87,0);
  for(const x of [-.8,0,.8]){wood(cab,.75,.6,.035,'#cfba91',x,.45,.34);wood(cab,.18,.035,.04,palette.dark,x,.67,.37);}
  bonsai(cab,-.8,.92,-.07,.55);for(let i=0;i<3;i++)scroll(cab,.32+i*.29,1.04,0,'#acb089',Math.PI/2);

  const pantry=zone('courtyard-ramen-tea'),stand=group(pantry,FURNITURE.coffee.x,0,FURNITURE.coffee.z);
  wood(stand,2,1.0,.88,palette.wood,0,.54,0);wood(stand,2.15,.12,1,palette.lightWood,0,1.09,0);
  for(const x of [-.5,.5]){wood(stand,.9,.78,.025,'#b48d60',x,.54,.455);wood(stand,.17,.03,.04,palette.dark,x,.8,.48);}
  for(const x of [-1,1])wood(stand,.085,1.61,.09,palette.dark,x,1.93,-.16);
  wood(stand,2.34,.15,1.13,palette.dark,0,2.79,-.19);
  for(let i=0;i<8;i++)wood(stand,.26,.04,1.09,'#94704a',-.98+i*.28,2.89,-.18);
  for(let i=0;i<3;i++){
    const geometry=new T.PlaneGeometry(.68,.64,20,12),positions=geometry.attributes.position;
    for(let v=0;v<positions.count;v++){
      const x=positions.getX(v),y=positions.getY(v),drop=(.32-y)/.64;
      positions.setZ(v,.036*Math.sin((x+.34)*Math.PI*7/.68)*(.25+.75*drop));
      positions.setY(v,y+.014*Math.cos(x*11)*drop*drop);
    }
    geometry.computeVertexNormals();const curtain=mesh(stand,geometry,'#71856b',-.72+i*.72,2.41,.27);
    finish(curtain,'#71856b',fabric,{side:T.DoubleSide});
  }
  leafBadge(stand,.65,0,2.45,.288,'#decc9c');
  for(const x of [-.56,.55]){
    cylinder(stand,.205,.12,.17,palette.cream,x,1.27,.05);cylinder(stand,.18,.18,.01,'#af803b',x,1.36,.05);
    for(let i=0;i<4;i++){const noodle=mesh(stand,new T.TorusGeometry(.05+i*.028,.009,5,18),'#edd29b',x,1.375,.05);noodle.rotation.x=Math.PI/2;}
    for(const side of [-1,1]){const chop=wood(stand,.012,.012,.42,palette.dark,x+side*.026,1.39,.11,.002);chop.rotation.y=.35;}
    sphere(stand,.055,'#80965c',x+.07,1.39,-.015,1,.3,1);sphere(stand,.065,'#eee2ba',x-.06,1.39,.03,1,.3,1);
  }
  // Stools stay tucked within the existing pantry obstacle, not in the aisle.
  for(const x of [-.65,.65]){const seat=group(stand,x,0,.39);for(const dx of [-.13,.13])for(const dz of [-.12,.12])wood(seat,.042,.60,.042,palette.dark,dx,.32,dz);box(seat,.39,.13,.37,'#89936b',0,.67,0,.06);}
  lantern(pantry,3.33,2.65,-4.89,.75);lantern(pantry,6.36,2.58,-4.89,.75);

  const detailedProps=group(root);detailedProps.name='courtyard-imported-props';
  const lounge=zone('courtyard-lounge'),sofa=group(lounge,FURNITURE.sofa.x,0,FURNITURE.sofa.z);sofa.rotation.y=FURNITURE.sofa.rotation;
  finish(box(lounge,3.28,.025,3.42,'#dad0b4',4.51,.085,1.55,.10),'#dad0b4',fabric);
  for(let i=0;i<10;i++)box(lounge,3.14,.002,.012,'#b5b497',4.51,.1,.06+i*.32,0);
  for(const x of [-1.05,1.05])for(const z of [-.3,.3])wood(sofa,.075,.32,.075,palette.dark,x,.23,z);
  wood(sofa,2.38,.25,.88,palette.wood,0,.43,0,.05);finish(box(sofa,2.21,.3,.80,palette.cream,0,.63,-.025,.10),palette.cream,fabric);finish(box(sofa,2.30,.61,.20,'#e6dbc1',0,.92,.35,.11),'#e6dbc1',fabric);
  for(const x of [-1.1,1.1])wood(sofa,.16,.5,.90,palette.wood,x,.71,0,.05);
  for(const [x,c,a] of [[-.63,'#8d9a70',-.18],[.48,'#caba95',.18]]){const pillow=finish(box(sofa,.48,.48,.18,c,x,.92,.13,.085),c,fabric);pillow.rotation.z=a;}
  const table=group(detailedProps,FURNITURE.table.x,0,FURNITURE.table.z),tea=group(table,0,.68,0);tea.name='ceramic-tea-service';tea.visible=false;
  const profile=[[.03,0],[.08,.012],[.12,.04],[.145,.09],[.14,.15],[.105,.20],[.073,.215]].map(([x,y])=>new T.Vector2(x,y));
  const pot=mesh(tea,new T.LatheGeometry(profile,40),'#718373');pot.material=pbr.material('plaster','#718373',{roughness:.29});
  const spout=new T.CatmullRomCurve3([new T.Vector3(.11,.07,0),new T.Vector3(.17,.11,0),new T.Vector3(.21,.18,0),new T.Vector3(.24,.19,0)]);
  const nozzle=mesh(tea,new T.TubeGeometry(spout,20,.026,10,false),'#718373');nozzle.material=pot.material;
  const handle=mesh(tea,new T.TorusGeometry(.09,.014,10,40,Math.PI*1.65),'#718373',-.12,.12,0);handle.rotation.z=.55;handle.material=pot.material;
  const lid=mesh(tea,new T.SphereGeometry(.085,28,12,0,Math.PI*2,0,Math.PI/2),'#809580',0,.21,0);lid.scale.y=.38;lid.material=pot.material;
  sphere(tea,.022,'#617264',0,.26,0);
  for(const [x,z] of [[-.29,.13],[.29,.16]]){
    const cup=group(tea,x,0,z),shape=[[.04,0],[.052,.012],[.063,.048],[.068,.086],[.061,.09],[.055,.045],[.035,.016]].map(([u,v])=>new T.Vector2(u,v));
    const ceramic=mesh(cup,new T.LatheGeometry(shape,28),'#dcc9aa');ceramic.material=pbr.material('plaster','#dcc9aa',{roughness:.35});cylinder(cup,.051,.051,.006,'#916b34',0,.063,0);
  }
  if(typeof document!=='undefined')pending.push(loadCourtyardProp('teaTable').then(gltf=>{
    const prop=placeCourtyardProp(gltf,table,{name:'carved-wood-tea-table',width:1.04,depth:1.04,height:.62,x:0,y:.09,z:0});
    prop.updateMatrixWorld(true);tea.position.y=new T.Box3().setFromObject(prop).max.y+.008;tea.visible=true;
  }));
  // A narrow wood divider replaces the old glass without changing its footprint.
  const divider=group(lounge,FURNITURE.partition.x,0,FURNITURE.partition.z);
  for(const z of [-1.29,1.29])wood(divider,.065,1.35,.065,palette.wood,0,.72,z);
  for(const y of [.22,.42,1.37])wood(divider,.065,.055,2.64,palette.lightWood,0,y,0);
  for(let i=0;i<11;i++)wood(divider,.045,.87,.04,palette.wood,0,.87,-1.2+i*.24);
  if(typeof document!=='undefined'){
    pending.push(loadCourtyardProp('plant').then(gltf=>{for(const [i,p] of FURNITURE.plants.entries())placeCourtyardProp(gltf,detailedProps,{name:'textured-plant-'+i,width:.92,depth:.92,height:1.4,x:p.x,y:.09,z:p.z,rotation:i*Math.PI/2});}));
  }

  const garden=zone('courtyard-garden');
  box(garden,7.5,.13,2.6,'#b8b398',-.7,-.04,-6.64,.17);box(garden,7.23,.018,2.36,'#e6ddc4',-.7,.035,-6.64,.17);
  for(let ring=0;ring<7;ring++){
    const curve=new T.EllipseCurve(0,0,.5+ring*.13,.28+ring*.07,0,Math.PI*2,false,0);
    const points=curve.getPoints(72).map(p=>new T.Vector3(p.x-.9,.05,p.y-6.7));
    garden.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:'#c4b99c',transparent:true,opacity:.7})));
  }
  for(const [x,z,s] of [[-1,-6.7,.44],[1.5,-6.86,.29],[-3.3,-6.4,.37]]){const rock=mesh(garden,new T.DodecahedronGeometry(s,1),palette.stone,x,.16,z);rock.scale.set(1.15,.65,.87);}
  for(const [x,z,s] of [[-2.8,-7.2,1.5],[2.1,-7.05,1.2],[.2,-7.5,.9]])bonsai(garden,x,.04,z,s);
  stoneLamp(garden,.95,.05,-6.65,.65);

  const entry=zone('courtyard-entry');
  wood(entry,3.0,.16,.8,palette.lightWood,0,-.06,5.57,.035);wood(entry,3.35,.13,.6,palette.wood,0,-.22,6.08,.035);
  const mat=mesh(entry,new T.CircleGeometry(.65,48),'#b99767',0,.03,5.48);mat.rotation.x=-Math.PI/2;
  const crest=group(entry,0,.041,5.48);crest.rotation.x=-Math.PI/2;leafBadge(crest,1,0,0,0,palette.dark);
  for(const x of [-6.52,6.52])stoneLamp(entry,x,.06,5.09,.86);
  for(const x of [-4.8,4.8]){wood(entry,2.25,.12,.18,palette.dark,x,.62,5.20);for(const dx of [-1.08,1.08])wood(entry,.14,1.02,.17,palette.wood,x+dx,.55,5.20);for(const y of [.24,.91])wood(entry,2.22,.085,.12,palette.lightWood,x,y,5.2);}

  const props=zone('courtyard-desk-props');
  for(const station of WORKSTATIONS){const g=group(props,station.x,0,station.z);g.rotation.y=station.rotation;scroll(g,-1.02,1.28,-.30,'#ab9d75',Math.PI/2);}
  lantern(library,-6.1,2.9,-3.65,.8);lantern(windows,-3.96,2.91,-4.96,.7);
  // A few trailing vines soften the joinery without occupying floor space.
  for(const [x,y,z] of [[-6.33,3.35,-2.38],[-6.33,3.35,1.04],[-4.04,3.42,-5.00]]){
    const vine=group(library,x,y,z);
    for(let i=0;i<8;i++){
      const dx=Math.sin(i*.8)*.10,dz=Math.cos(i*.6)*.045;
      cylinder(vine,.008,.009,.15,'#737346',dx,-i*.13,dz);
      const leaf=sphere(vine,.072,i%2?'#7c905b':'#97a269',dx+.05*(i%2?1:-1),-i*.13,dz,.45,1,.8);leaf.rotation.z=(i%2?1:-1)*.7;
    }
  }
  for(const node of zones)batchZone(node);
  root.userData={theme:'konoha-courtyard',source:'konoha-office-v2 concept',workstations:4,semanticZones:zones.map(z=>z.name),walkableInteriorUnchanged:true};
  let lastNight;
  const ready=Promise.all([...pending,pbr.ready()]).then(()=>{root.userData.assetsReady=true;}).catch(error=>{root.userData.assetError=error.message;throw error;});
  return {root,ready,update(_time,night){if(night===lastNight)return;lastNight=night;lamps.forEach(light=>{light.intensity=night?2.1:.45});glowMaterials.forEach(mat=>{mat.emissiveIntensity=night?1.25:.25});}};
}

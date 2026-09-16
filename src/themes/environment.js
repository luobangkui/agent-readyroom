import * as THREE from 'three';
import {ROOM,WORKSTATIONS,FURNITURE} from '../room-layout.js';
import {leafBadge} from './symbols.js';
import {createCourtyardEnvironment} from './courtyard-environment.js';

function dojo(scene,api){
  const {group,box,sphere,cylinder,mesh,textPanel}=api,root=group(scene),lights=[];
  const timber='#725435',trim='#577264',red='#b75b3f',paper='#ecd9ad';
  // Posts and beams sit against the existing walls, outside the walking lanes.
  for(const fraction of [-.49,-.25,0,.25,.49])box(root,.18,3.65,.20,timber,fraction*ROOM.width,1.82,ROOM.back+.08,.02);
  for(const fraction of [-.48,-.16,.16,.48])box(root,.20,3.65,.18,timber,ROOM.left+.08,1.82,fraction*ROOM.depth,.02);
  for(const y of [.55,3.40]){box(root,ROOM.width,.15,.20,timber,0,y,ROOM.back+.11,.015);box(root,.20,.15,ROOM.depth,timber,ROOM.left+.11,y,0,.015);}
  box(root,ROOM.width+.5,.14,.8,trim,0,3.72,ROOM.back,.025);
  box(root,.8,.14,ROOM.depth+.3,trim,ROOM.left,3.72,0,.025);
  for(let i=0;i<Math.ceil((ROOM.width+.3)/.3);i++){const tile=cylinder(root,.081,.081,.84,'#657e70',-ROOM.width/2-.05+i*.3,3.79,ROOM.back);tile.rotation.x=Math.PI/2;}
  for(let i=0;i<Math.ceil((ROOM.depth+.3)/.3);i++){const tile=cylinder(root,.081,.081,.84,'#657e70',ROOM.left,3.79,-ROOM.depth/2-.05+i*.3);tile.rotation.z=Math.PI/2;}
  // Shoji window and a circular Hidden Leaf emblem.
  box(root,3.75,2.1,.10,timber,-.7,2.12,ROOM.back+.16,.03);box(root,3.5,1.89,.05,'#f1e4bf',-.7,2.12,ROOM.back+.225,.01);
  for(let i=0;i<8;i++)box(root,.035,1.9,.04,'#a08250',-2.39+i*.483,2.12,ROOM.back+.26,.006);
  for(let i=0;i<6;i++)box(root,3.52,.029,.04,'#b49a66',-.7,1.27+i*.34,ROOM.back+.28,.004);
  const crest=mesh(root,new THREE.CircleGeometry(.63,48),'#ede1b9',4.3,2.48,ROOM.back+.26);crest.castShadow=false;
  const border=mesh(root,new THREE.TorusGeometry(.64,.033,8,48),timber,4.3,2.48,ROOM.back+.28);
  leafBadge(root,1.18,4.28,2.46,ROOM.back+.30,'#536848');
  textPanel(root,'木ノ葉',2.5,.42,4.3,1.56,ROOM.back+.26,{bg:'#e7d5ac',fg:'#80603d',size:135});
  const banner=group(root,ROOM.left+.145,2.08,.2);banner.rotation.y=Math.PI/2;
  box(banner,1.12,1.67,.025,'#b76543',0,0,0,.014);box(banner,1.28,.055,.06,timber,0,.87,0);box(banner,1.28,.055,.06,timber,0,-.87,0);
  textPanel(banner,'火',.94,1.43,0,.02,.022,{bg:'#b76543',fg:'#f6e6bd',size:660});
  // Paper lanterns with subtle ribs and warm lamps.
  for(const x of [-.25,.14,.44].map(f=>f*ROOM.width)){
    const lantern=group(root,x,2.66,ROOM.back+.67);cylinder(lantern,.018,.018,.60,timber,0,.56,0);
    sphere(lantern,.32,'#eac58e',0,0,0,1,1.36,1);cylinder(lantern,.23,.23,.055,timber,0,.41,0);cylinder(lantern,.23,.23,.055,timber,0,-.41,0);
    for(let rib=0;rib<7;rib++){const y=-.30+rib*.10,radius=.30*Math.sqrt(1-(y/.43)**2);const ring=mesh(lantern,new THREE.TorusGeometry(radius,.008,5,28),'#ca9a64',0,y,0);ring.rotation.x=Math.PI/2;}
    const tassel=cylinder(lantern,.025,.040,.27,red,0,-.59,0);const light=new THREE.PointLight('#ffbe6c',1.0,4,1.6);light.position.set(0,-.1,.3);lantern.add(light);lights.push(light);
  }
  // Scrolls rest on the desks and storage shelves, never in the navigation corridors.
  function scroll(parent,x,y,z,angle=0){const g=group(parent,x,y,z);g.rotation.y=angle;const sheet=cylinder(g,.11,.11,.42,paper);sheet.rotation.z=Math.PI/2;for(const side of [-1,1]){const cap=cylinder(g,.14,.14,.04,'#715a37',side*.24,0,0);cap.rotation.z=Math.PI/2;}box(g,.055,.22,.23,red,0,0,0,.006);}
  for(const station of WORKSTATIONS){const props=group(root,station.x,0,station.z);props.rotation.y=station.rotation;scroll(props,-1.04,1.28,-.32,Math.PI/2);}
  for(let i=0;i<3;i++)scroll(root,FURNITURE.shelf.x-.5+i*.46,1.45,FURNITURE.shelf.z+.12);
  // Ramen counter details at the existing coffee corner.
  const stand=group(root,FURNITURE.coffee.x,0,FURNITURE.coffee.z);
  for(const x of [-1.03,1.03])box(stand,.055,.96,.055,timber,x,1.58,.06,.008);
  box(stand,2.28,.11,.69,red,0,2.1,.09,.02);
  for(let i=0;i<3;i++)box(stand,.67,.40,.02,i===1?'#e7d5ac':red,-.72+i*.72,1.87,.44,.008);
  textPanel(stand,'一楽',.61,.31,0,1.88,.454,{bg:'#e7d5ac',fg:'#88613d',size:325});
  for(const x of [-.56,.50]){cylinder(stand,.20,.12,.17,'#e9d9b4',x,1.22,.03);cylinder(stand,.178,.178,.012,'#b78141',x,1.312,.03);for(let i=0;i<3;i++){const noodle=mesh(stand,new THREE.TorusGeometry(.085+i*.022,.012,5,20),'#edce89',x,1.32,.03);noodle.rotation.x=Math.PI/2;}for(const side of [-1,1]){const chopstick=box(stand,.012,.012,.45,timber,x+side*.027,1.36,.11,.002);chopstick.rotation.y=.22;}}
  // Bamboo outside the back wall adds a village silhouette without blocking characters.
  for(let i=0;i<7;i++){
    const x=ROOM.left-.38+(i%2)*.16,z=-ROOM.depth/2+.8+i*(ROOM.depth-1.6)/6,h=3.6+(i%3)*.35;
    cylinder(root,.055,.072,h,'#728357',x,h/2,z);
    for(let joint=.4;joint<h;joint+=.45)cylinder(root,.063,.063,.035,'#99a26d',x,joint,z);
    for(let leaf=0;leaf<3;leaf++){const foliage=sphere(root,.24,leaf%2?'#7d925f':'#94a66c',x+.15*Math.sin(i+leaf),h-.1-leaf*.30,z+.16*Math.cos(i+leaf),.22,1.6,.46);foliage.rotation.z=.8+(i%2)*.7;}
  }
  return {root,update(_time,night){lights.forEach(light=>light.intensity=night?3.8:.55);}};
}
export const ENVIRONMENTS={studio:(scene,api)=>({root:api.group(scene),update(){}}),dojo,courtyard:createCourtyardEnvironment};
export function createEnvironment(name,scene,api){return (ENVIRONMENTS[name]||ENVIRONMENTS.studio)(scene,api);}

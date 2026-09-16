// Furniture, character homes and navigation share one layout.
export const ROOM={width:13.2,depth:10.4,left:-6.56,back:-5.17,minX:-6.25,maxX:6.25,minZ:-4.92,maxZ:4.90};
export const WORKSTATIONS=[
  {x:-3.13,z:-.67,rotation:Math.PI,boss:true,color:'#b7c5bb'},
  {x:-3.13,z:.67,rotation:0,color:'#c4cabb'},
  {x:-.25,z:-.67,rotation:Math.PI,color:'#c5c9bd'},
  {x:-.25,z:.67,rotation:0,color:'#bac6bd'}
].map((desk,index)=>({...desk,id:`desk-${index+1}`,width:2.7,home:{x:desk.x,z:desk.z+(desk.rotation?-1.3:1.3)},facing:desk.rotation?0:Math.PI}));
export const WORK_ISLAND={x:-1.69,z:0,width:5.58,depth:2.58};
export const FURNITURE={shelf:{x:-5.2,z:-4.83},storage:{x:-.6,z:-4.7},partition:{x:2.3,z:-.7},coffee:{x:4.85,z:-4.6},sofa:{x:5.15,z:1.55,rotation:Math.PI/2},table:{x:3.8,z:1.75},plants:[{x:-5.85,z:3.9},{x:5.8,z:-2.35}]};
export const LEISURE={coffee:{x:4.55,z:-3.35},window:{x:-.75,z:-3.55},reading:{x:3.75,z:3.25}};
export const OVERFLOW_HOMES=[{x:3.05,z:-1.7,facing:Math.PI/2},{x:3.05,z:3.8,facing:Math.PI},{x:-1.4,z:4.2,facing:Math.PI},{x:-4.8,z:4.1,facing:Math.PI/2},{x:-5.65,z:-.1,facing:Math.PI/2}];
export function extraHome(index){const station=index+2;return WORKSTATIONS[station]||OVERFLOW_HOMES[Math.max(0,station-WORKSTATIONS.length)%OVERFLOW_HOMES.length];}

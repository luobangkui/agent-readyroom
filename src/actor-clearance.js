import {Box3,Matrix4,Vector3} from 'three';
import {DESK_ERGONOMICS as D} from './desk-ergonomics.js';

const cache=new WeakMap();
const fallback={radius:.42,minX:-.42,maxX:.42,minZ:-.42,maxZ:.42};
export const PERSON_GAP=.12;

// Measure once per model/pose, not for every frame or every route candidate.
// Coordinates remain actor-local so cached measurements can rotate/move safely.
export function actorEnvelope(actor){
  const model=actor.modelRoot?.visible!==false&&actor.assetMotion?actor.modelRoot:actor.body;
  if(!model?.isObject3D||!actor.root?.isObject3D)return fallback;
  const pose=actor.assetMotion?.state||'procedural';let entry=cache.get(actor);
  if(!entry||entry.model!==model){entry={model,poses:new Map(),radius:.42};cache.set(actor,entry);}
  if(!entry.poses.has(pose)){
    actor.root.updateWorldMatrix(true,false);actor.root.updateMatrixWorld(true);
    const inverse=new Matrix4().copy(actor.root.matrixWorld).invert(),transform=new Matrix4(),point=new Vector3(),box=new Box3();let radialSquared=0;
    model.traverse(mesh=>{
      if(!mesh.isMesh)return;for(let node=mesh;node;node=node.parent)if(node.visible===false)return;
      mesh.skeleton?.update();transform.multiplyMatrices(inverse,mesh.matrixWorld);
      for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,point).applyMatrix4(transform);box.expandByPoint(point);radialSquared=Math.max(radialSquared,point.x*point.x+point.z*point.z);}
    });
    const bounds=box.isEmpty()?fallback:{minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z};
    // Width plus a small animation allowance; walking also includes depth so
    // a turn cannot put the front/back of the body inside another person.
    entry.radius=Math.max(entry.radius,Math.abs(bounds.minX)+.06,Math.abs(bounds.maxX)+.06);
    if(['walking','idle','procedural'].includes(pose))entry.radius=Math.max(entry.radius,Math.sqrt(radialSquared)+.06);
    entry.poses.set(pose,bounds);
  }
  return {...entry.poses.get(pose),radius:entry.radius};
}
export function occupiedBy(actor,moverRadius){
  const body=actorEnvelope(actor),p=actor.root.position,nearSeat=actor.hasSeat&&Math.hypot(p.x-actor.home.x,p.z-actor.home.z)<.3;
  if(!nearSeat){const radius=body.radius+moverRadius+PERSON_GAP;return [p.x-radius,p.x+radius,p.z-radius,p.z+radius];}
  // Reserve the seated body and the whole pull-in/out sweep of its chair,
  // including while a person stands up or settles back into the seat.
  const yaw=actor.homeRotation??actor.root.rotation?.y??0,padding=moverRadius+PERSON_GAP;
  const transform=(origin,rotation,minX,maxX,minZ,maxZ)=>{const s=Math.sin(rotation),c=Math.cos(rotation);return [[minX,minZ],[minX,maxZ],[maxX,minZ],[maxX,maxZ]].map(([x,z])=>({x:origin.x+x*c+z*s,z:origin.z-x*s+z*c}));};
  const corners=[...transform(actor.home,yaw,-.65,.65,D.chairZ-.4,.75),...transform(p,actor.root.rotation?.y??yaw,body.minX,body.maxX,body.minZ,body.maxZ)];
  return [Math.min(...corners.map(p=>p.x))-padding,Math.max(...corners.map(p=>p.x))+padding,Math.min(...corners.map(p=>p.z))-padding,Math.max(...corners.map(p=>p.z))+padding];
}

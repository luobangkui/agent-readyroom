import {Vector3} from 'three';

// Includes the large heads, seated pull-in and extended arms of the office
// cast. The camera regression checks this envelope against the rendered GLBs.
const ACTOR_RADIUS=1.2;
const GAP=.15;
const direction=new Vector3();

export function protectActorView(camera,target,actors,minDistance){
  direction.copy(camera.position).sub(target).normalize();
  const horizontal=Math.hypot(direction.x,direction.z);
  let distance=minDistance;
  for(const actor of Object.values(actors)){
    if(actor.root.visible===false)continue;
    const p=actor.root.position,height=actor.labelHeight??2.7;
    const closest=(p.x-target.x)*direction.x+(p.y-target.y)*direction.y+(p.z-target.z)*direction.z
      +ACTOR_RADIUS*horizontal+Math.max(0,height*direction.y);
    distance=Math.max(distance,closest+camera.near+GAP);
  }
  // Orthographic magnification comes from zoom, not camera distance. Moving
  // only along the viewing axis preserves framing while protecting the near
  // plane; recomputing from minDistance avoids accumulating distance on orbit.
  camera.position.copy(target).addScaledVector(direction,distance);
  camera.updateMatrixWorld();
}

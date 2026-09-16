import * as T from 'three';
import {DESK_ERGONOMICS as D} from '../src/desk-ergonomics.js';

const point=bone=>bone.getWorldPosition(new T.Vector3());
const rotation=bone=>bone.getWorldQuaternion(new T.Quaternion());
const xAxis=new T.Vector3(1,0,0);
function turnWorld(bone,delta){
  bone.quaternion.copy(rotation(bone.parent).invert().multiply(delta.clone().multiply(rotation(bone))));
  bone.updateMatrixWorld(true);
}
function aim(bone,child,target){
  const origin=point(bone);
  turnWorld(bone,new T.Quaternion().setFromUnitVectors(point(child).sub(origin).normalize(),target.clone().sub(origin).normalize()));
}
function reach(upper,elbow,hand,target,side){
  const shoulder=point(upper),lengthA=shoulder.distanceTo(point(elbow)),lengthB=point(elbow).distanceTo(point(hand));
  const direction=target.clone().sub(shoulder),distance=T.MathUtils.clamp(direction.length(),.001,lengthA+lengthB-.002);direction.normalize();
  const pole=new T.Vector3(side*.6,-1,-.15);pole.addScaledVector(direction,-pole.dot(direction)).normalize();
  const along=(lengthA*lengthA-lengthB*lengthB+distance*distance)/(2*distance);
  const bend=shoulder.clone().addScaledVector(direction,along).addScaledVector(pole,Math.sqrt(Math.max(0,lengthA*lengthA-along*along)));
  aim(upper,elbow,bend);aim(elbow,hand,target);
}

// Read the original skinned fingertips; contact is measured against the visible
// mesh rather than the wrist or the base of a finger bone.
export function fingertipVertices(root,side){
  const pads=[];
  root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh||mesh.name!=='character_low')return;
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
    for(const finger of ['index','middle','ring','pinky']){
      const index=mesh.skeleton.bones.findIndex(b=>b.name===`DEF-f_${finger}03${side}`);if(index<0)continue;
      const vertices=[];
      for(let i=0;i<position.count;i++){
        let weight=0;for(let j=0;j<4;j++)if(skinIndex.getComponent(i,j)===index)weight+=skinWeight.getComponent(i,j);
        if(weight<.5)continue;
        const local=new T.Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[index]);
        vertices.push({mesh,index:i,y:local.y});
      }
      const end=Math.max(...vertices.map(v=>v.y));pads.push(...vertices.filter(v=>v.y>end-.009));
    }
  });
  if(!pads.length)throw new Error(`No skinned fingertips found for ${side}`);
  return pads;
}
export const posedPad=pad=>pad.mesh.getVertexPosition(pad.index,new T.Vector3()).applyMatrix4(pad.mesh.matrixWorld);

// Bake a gentle six-second loop on the imported skeleton. No mesh, texture,
// limb length or source GLB is modified.
export function bakeTyping(root,meta){
  const bones=[];root.traverse(bone=>{if(bone.isBone)bones.push({bone,q:bone.quaternion.clone(),p:bone.position.clone()});});
  const bone=name=>root.getObjectByName(name),hands=[];
  for(const [suffix,side] of [['L',1],['R',-1]]){
    const hand=bone(`DEF-hand${suffix}`),toLocal=p=>hand.worldToLocal(p);
    const forward=toLocal(point(bone(`DEF-f_middle01${suffix}`))).normalize();
    const across=toLocal(point(bone(`DEF-f_index01${suffix}`))).sub(toLocal(point(bone(`DEF-f_pinky01${suffix}`))));across.addScaledVector(forward,-across.dot(forward)).normalize();
    const localBasis=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(across,forward,across.clone().cross(forward)));
    const acrossWorld=new T.Vector3(-side,0,0),forwardWorld=new T.Vector3(0,-.05,1).normalize();
    const handQ=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(acrossWorld,forwardWorld,acrossWorld.clone().cross(forwardWorld))).multiply(localBasis.invert());
    hands.push({suffix,side,hand,handQ,upper:bone(`DEF-upper_arm${suffix}`),elbow:bone(`DEF-forearm${suffix}`),pads:fingertipVertices(root,suffix),height:1.06});
  }
  const keyboardY=D.keyTop-D.actorY-meta.seatOffsetY,keyboardZ=D.deskZ-D.keyboardZ-meta.seatOffsetZ-D.typingPull;
  const duration=6,frames=180,times=[],values=new Map(bones.map(({bone})=>[bone.name,[]]));
  const restore=()=>{for(const info of bones){info.bone.quaternion.copy(info.q);info.bone.position.copy(info.p);}root.updateMatrixWorld(true);};
  function fingers(info,t,animated){
    const phase=t/duration*Math.PI*2;
    const activity=.25+.75*(.5+.5*Math.cos(phase));
    for(const [i,name] of ['index','middle','ring','pinky'].entries()){
      const tap=animated?Math.pow(Math.max(0,Math.sin(phase*[10,13,7,5][i]+i*1.9+(info.side<0?Math.PI:0))),4)*activity:0;
      for(let joint=1;joint<=3;joint++)turnWorld(bone(`DEF-f_${name}0${joint}${info.suffix}`),new T.Quaternion().setFromAxisAngle(xAxis,[.075,.16,.11][joint-1]+tap*[.10,.18,.12][joint-1]));
    }
  }
  function poseHand(info,t,animated){
    const phase=t/duration*Math.PI*2,shift=animated?Math.sin(phase*2+info.side)*.018:0;
    const target=new T.Vector3(info.side*.135+shift,info.height,keyboardZ-.125+shift*.75);
    // Finger curls and wrist tilt change the fingertip height. Re-solve the arm
    // a couple of times so the lowest pad stays just above the key tops.
    for(let pass=0;pass<(animated?3:1);pass++){
      reach(info.upper,info.elbow,info.hand,target,info.side);
      const wristTilt=animated?Math.sin(phase*2+info.side)*.12:0;
      info.hand.quaternion.copy(rotation(info.hand.parent).invert().multiply(info.handQ.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),wristTilt))));root.updateMatrixWorld(true);
      fingers(info,t,animated);root.updateMatrixWorld(true);
      if(animated)target.y+=keyboardY+.006-Math.min(...info.pads.map(p=>posedPad(p).y));
    }
  }
  for(let pass=0;pass<3;pass++){
    restore();turnWorld(bone('DEF-spine003'),new T.Quaternion().setFromAxisAngle(xAxis,.035));
    for(const info of hands){poseHand(info,0,false);info.height+=keyboardY+.006-Math.min(...info.pads.map(p=>posedPad(p).y));}
  }
  for(let frame=0;frame<=frames;frame++){
    const t=frame/frames*duration;times.push(t);restore();
    turnWorld(bone('DEF-spine003'),new T.Quaternion().setFromAxisAngle(xAxis,.035+Math.sin(t/duration*Math.PI*2)*.004));
    turnWorld(bone('DEF-spine006'),new T.Quaternion().setFromAxisAngle(xAxis,-.19+Math.sin(t/duration*Math.PI*2)*.012));
    for(const info of hands)poseHand(info,t,true);
    for(const info of bones){const q=info.bone.quaternion,previous=values.get(info.bone.name);if(previous.length&&q.dot(new T.Quaternion().fromArray(previous,previous.length-4))<0)q.set(-q.x,-q.y,-q.z,-q.w);previous.push(...q.toArray());}
  }
  const tracks=bones.map(({bone})=>{
    const v=values.get(bone.name),constant=v.every((n,i)=>Math.abs(n-v[i%4])<1e-7);
    return new T.QuaternionKeyframeTrack(`${bone.name}.quaternion`,constant?[0,duration]:times,(constant?[...v.slice(0,4),...v.slice(0,4)]:v).map(n=>Number(n.toFixed(6))));
  });
  const hip=bones.find(({bone})=>bone.name==='DEF-spine');tracks.push(new T.VectorKeyframeTrack('DEF-spine.position',[0,duration],[...hip.p.toArray(),...hip.p.toArray()]));
  restore();return new T.AnimationClip('office_typing',duration,tracks);
}

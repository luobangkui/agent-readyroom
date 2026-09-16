import {createHash} from 'node:crypto';
import {AnimationClip} from 'three';

// Shared six-second seamless typing rhythm for the imported office characters.
export function typingTap(time,side){
  const beat=time*Math.PI*8+(side===1?0:Math.PI);
  return {beat,lift:.027*(1-Math.cos(beat))/2};
}

// AnimationClip.parse preserves JSON UUIDs; AnimationMixer caches by UUID.
// Stable, distinct IDs prevent sitting/typing/transitions sharing one action.
export function officeClipJSON(clip,character,name){
  const data=AnimationClip.toJSON(clip);data.name=name;
  data.uuid=createHash('sha256').update(character+'-office:'+clip.name).digest('hex').slice(0,32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
  return data;
}

import {AnimationClip,Euler,Quaternion,QuaternionKeyframeTrack} from 'three';

// Gentle upper-body motion over the imported seated pose. The authored pelvis,
// legs and feet stay untouched, including each model's seat/contact calibration.
const profiles={
  naruto:{gaze:1.15,breath:1.05,tilt:1.1,direction:1},
  hiruzen:{gaze:.65,breath:.85,tilt:.65,direction:-1},
  tsunade:{gaze:.9,breath:1,tilt:.85,direction:1},
  sakura:{gaze:1,breath:.9,tilt:1.15,direction:-1},
  mizukage:{gaze:.8,breath:.95,tilt:1,direction:1}
};
const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*t*(10+t*(-15+6*t));};
const gesture=(time,start,hold,end)=>smooth((time-start)/1.6)*(1-smooth((time-hold)/(end-hold)));

export function seatedLifeClip(clip,character){
  const profile=profiles[character.replace(/-custom$/,'')];
  if(!profile||!['Sitting','office_sitting'].includes(clip.name))return clip;
  const duration=36,count=duration*30,times=Float32Array.from({length:count+1},(_,i)=>i/30);
  const euler=new Euler(),base=new Quaternion(),offset=new Quaternion();
  const tracks=clip.tracks.map(track=>{
    const sample=track.createInterpolant(),stride=track.getValueSize(),values=new Float32Array(times.length*stride);
    for(let i=0;i<times.length;i++){
      const time=times[i],pose=sample.evaluate(time%clip.duration);
      values.set(pose,i*stride);
      if(!(track instanceof QuaternionKeyframeTrack))continue;
      const breath=Math.sin(time*Math.PI*2/4.5)*profile.breath;
      const left=gesture(time,2,5,8),right=gesture(time,12,16,19);
      const think=gesture(time,22,24,27),settle=gesture(time,29,31,34);
      let x=0,y=0,z=0;
      if(track.name==='Head.quaternion'){
        x=.024*breath+.105*think-.032*settle;
        y=(.19*left-.15*right)*profile.gaze*profile.direction;
        z=(.035*left+.022*think-.025*right)*profile.tilt*profile.direction;
      }else if(track.name==='Chest.quaternion'){
        x=.012*breath-.012*settle;z=.009*(left-right)*profile.tilt;
      }else if(track.name==='LeftUpperArm.quaternion'||track.name==='RightUpperArm.quaternion'){
        const side=track.name.startsWith('Left')?1:-1;
        z=side*(.007*breath+.023*settle)*profile.breath;
      }else continue;
      base.fromArray(pose);offset.setFromEuler(euler.set(x,y,z));base.multiply(offset).normalize().toArray(values,i*stride);
    }
    return new track.constructor(track.name,times,values,track.getInterpolation());
  });
  return new AnimationClip(clip.name,duration,tracks,clip.blendMode);
}

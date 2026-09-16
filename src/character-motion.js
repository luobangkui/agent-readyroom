export function updateCharacterPose(a,dt,time){
        if(dt===0)return;
        const diff=Math.atan2(Math.sin(a.targetRotation-a.root.rotation.y),Math.cos(a.targetRotation-a.root.rotation.y));a.root.rotation.y+=diff*Math.min(1,dt*9);
        a.ring.material.opacity=.55+Math.sin(time*2)*.12;
        if(a.updateAssetPose?.(dt))return;
        const walk=a.mode==='walking',work=a.mode==='working'&&!a.deskActivity,talk=a.mode==='talking',read=a.mode==='reading',think=a.mode==='thinking'&&!a.deskActivity,wait=a.mode==='waiting',blocked=a.mode==='blocked',celebrate=a.mode==='celebrating',paused=a.mode==='paused',listen=a.mode==='listening',stretch=a.mode==='stretching',gaze=a.mode==='gazing';
        const offset=a.id.split('').reduce((n,c)=>n+c.charCodeAt(0),0)*.013,t=time+offset;
        a.document.visible=read;
        a.body.position.y=walk?Math.abs(Math.sin(t*9))*.045:celebrate?Math.abs(Math.sin(t*6))*.07:Math.sin(t*2.2)*(paused?.004:.014);
        a.body.rotation.z=walk?Math.sin(t*9)*.025:paused?0:Math.sin(t*1.1)*.015;
        a.head.rotation.y=Math.sin(t*1.4)*(gaze?.26:talk?.2:paused?.015:.08);a.head.rotation.x=stretch?-.12:read?.22+Math.sin(t*3)*.03:work?.13+Math.sin(t*4)*.045:listen?Math.sin(t*4)*.09:Math.sin(t*1.8)*.035;a.head.rotation.z=think?.08:blocked?-.12:0;
        for(const eye of a.eyes)eye.scale.y=t%4.7<.13?.12:1.15;a.updateFace?.(t);
        a.legs.forEach((leg,i)=>{leg.rotation.x=walk?Math.sin(time*9+i*Math.PI)*.43:0;});
        a.arms.forEach((arm,i)=>{arm.rotation.x=walk?Math.sin(t*9+i*Math.PI)*.48:work?-.76+Math.sin(t*11+i*2)*.14:read?-1.03:stretch?-2.45+Math.sin(t*.8)*.15:celebrate?-2.5+Math.sin(t*6)*.17:wait&&i===1?-2.65+Math.sin(t*2)*.07:(think||blocked)&&i===1?-1.75:talk&&i===1?-.9+Math.sin(t*4)*.35:paused?.025:Math.sin(t*1.3+i)*.065;arm.rotation.z=(i?1:-1)*(celebrate||stretch?.35:read?.17:.08);});
}

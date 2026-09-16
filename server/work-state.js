const pending=new Set(['waiting_input','ready','queued','starting','running','waiting','suspending','suspended']);
function trace(w,entry){w.timeline??=[];w.timeline.push(entry);if(w.timeline.length>100)w.timeline.shift();}
export function setWaitReason(w,reason,at=Date.now()){
  const old=w.waitReason,changed=old?.kind!==reason?.kind||old?.target!==reason?.target;
  if(changed){if(old?.kind){w.waitTimings??={};w.waitTimings[old.kind]=(w.waitTimings[old.kind]||0)+Math.max(0,at-(Date.parse(w.waitSince)||at));}w.waitSince=new Date(at).toISOString();if(reason)trace(w,{at:w.waitSince,wait:reason.kind,target:reason.target,message:reason.message});}
  w.waitReason=reason;
}
export function transition(w,status,reason=null,at=Date.now()){
  if(w.status!==status){const elapsed=Math.max(0,at-(Date.parse(w.stateSince||w.createdAt)||at));w.timings??={};w.timings[w.status]=(w.timings[w.status]||0)+elapsed;w.stateSince=new Date(at).toISOString();w.status=status;trace(w,{at:w.stateSince,status,generation:w.generation});}
  setWaitReason(w,reason,at);if(!pending.has(status))w.finishedAt=new Date(at).toISOString();
}

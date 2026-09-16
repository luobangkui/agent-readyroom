import {TEAM,teamMember,teamRole,teamCanWrite} from '../src/team.js';
import {characterNameFor} from '../src/mission-avatars.js';

// override comes from mission creation (roleModels): the role contract and
// appearance stay bound to the role, only model/modelName/provider move.
export function assignProfile(mission,agent,role,override){
  const profile=teamMember(role);if(!profile)throw new Error('无效的待命室职位');
  const model=override?.model||profile.model,modelName=override?.modelName||profile.modelName,provider=override?.provider||profile.provider;
  const oldModel=agent.model||mission.model,oldProvider=agent.provider||'codex';
  if(agent.threadId&&(oldModel!==model||oldProvider!==provider)){
    // Keep the old session reference and all office messages. The next turn
    // starts on the assigned runtime with an explicit summary of prior work.
    agent.sessionHistory=[...(agent.sessionHistory||[]),{threadId:agent.threadId,provider:oldProvider,model:oldModel}];agent.threadId=null;agent.turnId=null;agent.needsSessionContext=true;
  }
  Object.assign(agent,profile,{model,modelName,provider,avatarId:mission.roleAvatars?.[profile.role]||profile.avatarId,write:teamCanWrite(mission.mode,profile.role),effort:provider==='codex'?(mission.effort||profile.effort):profile.effort});
  // The character chosen for this role is the member's identity everywhere:
  // prompt, roster, thread title and office events. Roles stay fixed; only the
  // person playing them changes.
  agent.name=characterNameFor(agent.avatarId,profile.name);
  return agent;
}

export function ensureRoster(mission,makeIdle){
  // Older chat sessions stored only the technical assistant. Keep their
  // existing coordinator and add the other three addressable office roles,
  // inheriting the chat model so switching recipients stays local/consistent.
  if(mission.kind==='chat'&&mission.agents.length<TEAM.length){
    const original=[...mission.agents],lead=original.find(a=>a.id===mission.coordinatorId)||original[0],used=new Set();
    mission.agents=TEAM.map(profile=>{
      const agent=original.find(a=>!used.has(a.id)&&teamRole(a.role)===profile.role)||(profile.role===lead?.role?lead:null);
      if(agent){used.add(agent.id);return assignProfile(mission,agent,profile.role,lead&&{model:lead.model,modelName:lead.modelName,provider:lead.provider});}
      return assignProfile(mission,makeIdle(profile.role),profile.role,lead&&{model:lead.model,modelName:lead.modelName,provider:lead.provider});
    });
    mission.coordinatorId=lead?.id||mission.agents.find(a=>a.role==='tech').id;mission.model=lead?.model||mission.agents[0].model;mission.rosterVersion=1;return true;
  }
  if(mission.rosterVersion===1){
    // Backfill access metadata for missions saved before fullAccess was added,
    // and rebind every member to the character the mission actually chose.
    let changed=false;
    for(const agent of mission.agents){
      const profile=teamMember(agent.role);
      if(!profile)continue;
      const name=characterNameFor(agent.avatarId,profile.name);
      if(agent.name!==name){agent.name=name;changed=true;}
      const fullAccess=profile.fullAccess===true;
      if(agent.fullAccess!==fullAccess){agent.fullAccess=fullAccess;changed=true;}
      const write=teamCanWrite(mission.mode,agent.role);
      if(agent.write!==write){agent.write=write;changed=true;}
      for(const key of ['position','shortPosition','description','contract'])if(JSON.stringify(agent[key])!==JSON.stringify(profile[key])){agent[key]=profile[key];changed=true;}
    }
    return changed;
  }
  const original=[...mission.agents],used=new Set(),coordinator=original.find(a=>a.id===mission.coordinatorId);
  mission.agents=TEAM.map(profile=>{
    const agent=profile.role==='boss'&&mission.mode==='plan'?coordinator:
      original.find(a=>!used.has(a.id)&&teamRole(a.role)===profile.role);
    if(agent){used.add(agent.id);return assignProfile(mission,agent,profile.role);}
    return makeIdle(profile.role);
  });
  const retired=original.filter(a=>!used.has(a.id));if(retired.length)mission.archivedAgents=[...(mission.archivedAgents||[]),...retired];
  mission.coordinatorId=mission.agents.find(a=>a.role===(mission.mode==='solo'?'builder':'boss')).id;
  mission.model=mission.agents.find(a=>a.id===mission.coordinatorId).model;mission.rosterVersion=1;
  return true;
}

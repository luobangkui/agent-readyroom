import {OFFICE_AVATARS,DEFAULT_BOSS_AVATAR} from './assets/avatar-catalog.js';
import {TEAM,teamRole} from './team.js';

const validAvatar=id=>OFFICE_AVATARS.some(item=>item.id===id);
export const defaultRoleAvatars=()=>Object.fromEntries(TEAM.map(member=>[member.role,member.role==='boss'?DEFAULT_BOSS_AVATAR:member.avatarId]));

// Creation-time appearance is data, not a runtime/model permission setting.
export function normalizeRoleAvatars(value){
  const result=defaultRoleAvatars();
  if(value===undefined)return result;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(new Error('人物配置必须按四个岗位指定。'),{status:400});
  for(const [role,id] of Object.entries(value)){
    if(!Object.hasOwn(result,role)||!validAvatar(id))throw Object.assign(new Error('人物配置包含无效的岗位或人物，请重新选择。'),{status:400});
    result[role]=id;
  }
  return result;
}

export function missionAvatarFor(mission,agent,index=0,legacyOverrides={}){
  const role=teamRole(agent.role),saved=mission?.roleAvatars?.[role];
  if(validAvatar(saved))return saved;
  // Read old browser choices only for historical sessions without a saved cast.
  if(validAvatar(legacyOverrides[agent.id]))return legacyOverrides[agent.id];
  if(role==='boss')return DEFAULT_BOSS_AVATAR;
  const old=OFFICE_AVATARS.find(item=>item.id===agent.avatarId||item.id===`${agent.avatarId}-custom`);
  return old?.id||defaultRoleAvatars()[role]||TEAM[index%TEAM.length].avatarId;
}

// The person selected at creation owns the mission identity. Appearance and
// name must not drift apart, otherwise the prompt keeps calling the member by
// the default role holder while the office shows the chosen character.
export function characterNameFor(avatarId,fallback){
  if(!avatarId)return fallback;
  return OFFICE_AVATARS.find(item=>item.id===avatarId||item.id===`${avatarId}-custom`)?.name||fallback;
}

// Older saved messages may already contain the default role holder as a
// leading self-label ("夏禾：…"). Rewrite only that stale prefix so history
// matches the person the office displays now.
export function alignSelfName(text,staleName,authorName){
  const value=String(text??'');
  return staleName&&authorName&&staleName!==authorName&&value.startsWith(`${staleName}：`)?`${authorName}${value.slice(staleName.length)}`:value;
}

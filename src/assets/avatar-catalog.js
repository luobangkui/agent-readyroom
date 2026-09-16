import {STYLOO_MODELS} from './styloo.js';
import {CUSTOM_CHARACTERS} from './custom-cast.js';

export const DEFAULT_BOSS_AVATAR='tsunade-custom';
const DEFAULT_CUSTOM_CLIPS={idle:'Idle',walking:'Walk',sitting:'office_sitting',typing:'office_typing',sitDown:'office_sit_down',standUp:'office_stand_up'};
const customAvatars=CUSTOM_CHARACTERS.map(item=>({...item,id:`${item.id}-custom`,kind:'custom',clips:item.clips??DEFAULT_CUSTOM_CLIPS}));
export const OFFICE_AVATARS=[...customAvatars,...STYLOO_MODELS.map(item=>({...item,kind:'styloo'}))];
export function officeAvatar(id,role='builder'){
  return OFFICE_AVATARS.find(item=>item.id===id)||OFFICE_AVATARS.find(item=>item.id===`${id}-custom`)||OFFICE_AVATARS.find(item=>item.id===(role==='boss'?DEFAULT_BOSS_AVATAR:'student'));
}

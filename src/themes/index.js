import cozy from './cozy.js';
import {NARUTO_CAST} from './cast.js';
import konoha from './konoha.js';
import styloo from './styloo.js';
import courtyard from './courtyard.js';
export const THEMES=[courtyard,styloo,cozy,konoha];
export const supportsAvatarSelection=theme=>['styloo','konoha'].includes(theme.modelPack);
export function getTheme(id){if(id==='konoha'||id==='kaykit')return konoha;return THEMES.find(theme=>theme.id===id)||cozy;}
export function characterStyle(theme,role,avatarId){if(theme.cast==='naruto'&&NARUTO_CAST[avatarId])return NARUTO_CAST[avatarId];return theme.characters[role]||theme.characters.builder;}
export function applyThemeUI(id,night=false){const theme=getTheme(id),root=document.documentElement;root.dataset.officeTheme=theme.id;root.style.setProperty('--office-background',night?theme.ui.night:theme.ui.background);root.style.setProperty('--accent',theme.ui.accent);root.style.setProperty('--theme-control',night?'#415247':theme.ui.control);root.style.setProperty('--theme-ink',night?'#d4ddc7':theme.ui.ink);root.style.setProperty('--theme-border',night?'#617362':theme.ui.border);return theme;}

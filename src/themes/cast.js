// Persisted character identity is independent of animation and model execution.
export const NARUTO_CAST={
  hiruzen:{name:'三代目',fullName:'猿飞日斩',outfit:'hokage',shirt:'#f0e7d7',pants:'#60554a',hair:'#a9a79f',hairstyle:'short',skin:'#d9b498',iris:'#544c42',elder:true},
  naruto:{name:'鸣人',fullName:'漩涡鸣人',outfit:'shinobi',shirt:'#d98a35',pants:'#c67431',hair:'#dfb23c',hairstyle:'naruto',skin:'#efc49e',iris:'#57959f',headband:true,whiskers:true},
  sasuke:{name:'佐助',fullName:'宇智波佐助',outfit:'shinobi',shirt:'#e6e0d1',pants:'#414457',hair:'#303746',hairstyle:'sasuke',skin:'#e8c9ae',iris:'#50585d',highCollar:true,rope:true},
  sakura:{name:'小樱',fullName:'春野樱',outfit:'shinobi',shirt:'#a24a58',pants:'#45474c',hair:'#cb8d97',hairstyle:'bob',skin:'#f0c9b5',iris:'#769278',headband:true,feminine:true},
  kakashi:{name:'卡卡西',fullName:'旗木卡卡西',outfit:'shinobi',shirt:'#637450',pants:'#35464c',hair:'#bfc3bf',hairstyle:'kakashi',skin:'#dfbfa5',iris:'#5a6262',headband:true,mask:true,vest:true},
  hinata:{name:'雏田',fullName:'日向雏田',outfit:'shinobi',shirt:'#b5a8c0',pants:'#45435c',hair:'#3b3c58',hairstyle:'long',skin:'#edcbb7',iris:'#c9c5d8',feminine:true,hood:true},
  shikamaru:{name:'鹿丸',fullName:'奈良鹿丸',outfit:'shinobi',shirt:'#7c8962',pants:'#424d4a',hair:'#353b34',hairstyle:'ponytail',skin:'#dcb693',iris:'#535849',vest:true,sleepy:true},
  gaara:{name:'我爱罗',fullName:'我爱罗',outfit:'shinobi',shirt:'#87504b',pants:'#544b48',hair:'#9b5844',hairstyle:'gaara',skin:'#e4c5ac',iris:'#7a9b8e',gourd:true,tattoo:true},
  itachi:{name:'鼬',fullName:'宇智波鼬',outfit:'akatsuki',shirt:'#353d43',pants:'#333d42',hair:'#30343a',hairstyle:'long',skin:'#dfbea7',iris:'#99584e',headband:true,tearLines:true}
};
export const NARUTO_STAFF=Object.keys(NARUTO_CAST).filter(id=>id!=='hiruzen');
export function chooseAvatar(role,used=[],random=Math.random){if(role==='boss')return 'hiruzen';const available=NARUTO_STAFF.filter(id=>!used.includes(id));const pool=available.length?available:NARUTO_STAFF;return pool[Math.min(pool.length-1,Math.floor(random()*pool.length))];}
export function ensureMissionAvatars(mission,random=Math.random){const used=mission.agents.filter(a=>NARUTO_CAST[a.avatarId]).map(a=>a.avatarId);for(const agent of mission.agents){if(!NARUTO_CAST[agent.avatarId]){agent.avatarId=chooseAvatar(agent.role,used,random);used.push(agent.avatarId);}}return mission;}
export function themePersonName(agent,themeId){return themeId==='konoha'?(NARUTO_CAST[agent.avatarId]?.name||(agent.role==='boss'?'三代目':agent.name)):agent.name;}

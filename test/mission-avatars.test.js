import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultRoleAvatars,normalizeRoleAvatars,missionAvatarFor,characterNameFor,alignSelfName} from '../src/mission-avatars.js';
import {TEAM} from '../src/team.js';

test('creation fills all four roles and validates avatar IDs and role names',()=>{
  const defaults=defaultRoleAvatars();assert.deepEqual(defaults,{boss:'tsunade-custom',tech:'student',builder:'archer',ops:'ninja'});
  const input={boss:'naruto-custom',ops:'sakura-custom'},saved=normalizeRoleAvatars(input);
  assert.deepEqual(saved,{...defaults,...input});assert.notEqual(saved,input);assert.deepEqual(input,{boss:'naruto-custom',ops:'sakura-custom'});
  for(const invalid of [null,[],true,'naruto',{boss:'unknown'},{boss:'naruto'},{tech:null},{admin:'student'},JSON.parse('{"__proto__":"student"}')])assert.throws(()=>normalizeRoleAvatars(invalid),error=>error.status===400);
  saved.boss='student';assert.equal(defaultRoleAvatars().boss,'tsunade-custom');
});

test('saved mission cast beats browser overrides and remains isolated across goals and chats',()=>{
  const agent={id:'office-resident-boss',role:'boss'},legacy={[agent.id]:'merchant'};
  const first={roleAvatars:normalizeRoleAvatars({boss:'naruto-custom'})},second={roleAvatars:normalizeRoleAvatars({boss:'sakura-custom'})};
  assert.equal(missionAvatarFor(first,agent,0,legacy),'naruto-custom');assert.equal(missionAvatarFor(first,agent),'naruto-custom');
  assert.equal(missionAvatarFor(second,agent,0,legacy),'sakura-custom');assert.equal(missionAvatarFor(null,agent,0,legacy),'merchant');
  assert.equal(missionAvatarFor({},agent,0,{[agent.id]:'unknown'}),'tsunade-custom');
});

test('chat scene-only residents use the saved four-role cast without inventing model sessions',()=>{
  const roleAvatars={boss:'hiruzen-custom',tech:'tsunade-custom',builder:'naruto-custom',ops:'sakura-custom'};
  const chat={kind:'chat',roleAvatars,agents:[{id:'real-assistant',role:'tech'}]},before=JSON.stringify(chat);
  const entries=TEAM.map(p=>chat.agents.find(a=>a.role===p.role)||({...p,id:`office-resident-${p.role}`,sceneOnly:true}));
  assert.deepEqual(entries.map((a,i)=>missionAvatarFor(chat,a,i)),Object.values(roleAvatars));assert.equal(JSON.stringify(chat),before);assert.equal(chat.agents.length,1);
});

test('historical avatar IDs and browser overrides remain readable without migrating user history',()=>{
  const m={id:'old',agents:[{id:'old-worker',role:'reviewer',avatarId:'sakura'}]},before=JSON.stringify(m),agent=m.agents[0];
  assert.equal(missionAvatarFor(m,agent),'sakura-custom');assert.equal(missionAvatarFor(m,agent,0,{'old-worker':'hiruzen-custom'}),'hiruzen-custom');assert.equal(JSON.stringify(m),before);
});

test('the chosen character supplies the member name for both current and legacy avatar IDs',()=>{
  assert.equal(characterNameFor('naruto-custom','夏禾'),'鸣人');
  assert.equal(characterNameFor('naruto','夏禾'),'鸣人');
  assert.equal(characterNameFor('sakura-custom','阿澄'),'小樱');
  assert.equal(characterNameFor('archer','夏禾'),'夏禾');
  assert.equal(characterNameFor('tsunade-custom','可可'),'纲手');
  for(const missing of [undefined,null,'','not-a-character'])assert.equal(characterNameFor(missing,'夏禾'),'夏禾');
});

test('only a stale self-label is rewritten, never ordinary message text',()=>{
  assert.equal(alignSelfName('夏禾：差异证据已固定','夏禾','鸣人'),'鸣人：差异证据已固定');
  assert.equal(alignSelfName('夏禾：差异证据已固定','夏禾','夏禾'),'夏禾：差异证据已固定');
  assert.equal(alignSelfName('鸣人：已经改好','夏禾','鸣人'),'鸣人：已经改好');
  assert.equal(alignSelfName('结论：已经完成','夏禾','鸣人'),'结论：已经完成');
  assert.equal(alignSelfName('交付说明里提到 夏禾：先做接口','夏禾','鸣人'),'交付说明里提到 夏禾：先做接口');
  assert.equal(alignSelfName('','夏禾','鸣人'),'');
  assert.equal(alignSelfName(undefined,'夏禾','鸣人'),'');
  assert.equal(alignSelfName('夏禾：缺少作者名','夏禾',undefined),'夏禾：缺少作者名');
});

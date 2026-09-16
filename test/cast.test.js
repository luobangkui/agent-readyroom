import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseAvatar,ensureMissionAvatars,NARUTO_STAFF,themePersonName} from '../src/themes/cast.js';

test('boss is Third Hokage and staff draw without duplicates until the cast is exhausted',()=>{
  assert.equal(chooseAvatar('boss',[],()=>.9),'hiruzen');const used=[];
  for(let i=0;i<NARUTO_STAFF.length;i++){const avatar=chooseAvatar('builder',used,()=>.5);assert.ok(!used.includes(avatar));assert.notEqual(avatar,'hiruzen');used.push(avatar);}
  assert.ok(NARUTO_STAFF.includes(chooseAvatar('reviewer',used,()=>.3)));
});

test('migration fills missing identities once and preserves them after saving and loading',()=>{
  const mission={agents:[{id:'b',role:'boss',name:'老罗'},{id:'w',role:'builder',name:'小林'},{id:'r',role:'reviewer',avatarId:'kakashi',name:'小周'}]};
  ensureMissionAvatars(mission,()=>.4);const saved=JSON.stringify(mission);const reloaded=JSON.parse(saved);ensureMissionAvatars(reloaded,()=>.9);assert.equal(JSON.stringify(reloaded),saved);assert.equal(reloaded.agents[0].avatarId,'hiruzen');assert.equal(reloaded.agents[2].avatarId,'kakashi');assert.equal(themePersonName(reloaded.agents[0],'konoha'),'三代目');assert.equal(themePersonName(reloaded.agents[0],'cozy'),'老罗');
});
